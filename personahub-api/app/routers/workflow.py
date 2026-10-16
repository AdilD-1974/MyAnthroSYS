"""
app/routers/workflow.py — Endpoints FastAPI pour le moteur de workflow
Auteur : Adil DAIA

Endpoints :
  POST   /api/v1/workflow/start          — Démarrer une instance
  POST   /api/v1/workflow/decide         — Acteur prend une décision
  POST   /api/v1/workflow/resubmit/{id}  — Resoumission après modification
  GET    /api/v1/workflow/instances/{id} — Détails complets d'une instance
  GET    /api/v1/workflow/inbox/{user}   — Demandes en attente d'un utilisateur
"""
from __future__ import annotations

from datetime import date
from typing import Optional, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload
from app.services.workflow_engine import WorkflowEngine

router = APIRouter(prefix="/workflow", tags=["workflow"])


# ─── Résolution des responsables par étape (nom / poste / UO) ───────────────────

# Libellés d'affichage des rôles (étapes de type ROLE). Étiquetage UI uniquement,
# pas de logique de workflow. Externalisable plus tard dans une table de référence.
ROLE_LABELS = {
    "administrateur": "Administration",
    "gestionnaire_rh": "Service RH",
    "gestionnaire_paie": "Service Paie",
    "manager": "Manager",
    "collaborateur": "Collaborateur",
}

# Statuts d'étape considérés comme « déjà décidés » → responsable réel
_STATUTS_DECIDES = ("VALIDE", "REJETE", "PASSE")


def _role_label(code: Optional[str]) -> str:
    if not code:
        return "Responsable"
    return ROLE_LABELS.get(code, code.replace("_", " ").capitalize())


def _collaborateur_info(db: Session, cid) -> Optional[dict]:
    """Nom, prénom, poste (libellé) et UO (libellé) d'un collaborateur,
    d'après son affectation active."""
    if not cid:
        return None
    row = db.execute(text("""
        SELECT c.id, c.nom, c.prenom,
               rp.libelle AS poste,
               uo.libelle AS uo
        FROM collaborateurs c
        LEFT JOIN LATERAL (
            SELECT code_poste, unite_id
            FROM collaborateur_affectations
            WHERE collaborateur_id = c.id AND archive = false
              AND (date_fin_uo IS NULL OR date_fin_uo >= CURRENT_DATE)
            ORDER BY date_debut_uo DESC LIMIT 1
        ) aff ON true
        LEFT JOIN ref_poste rp ON rp.code = aff.code_poste
        LEFT JOIN unites_organisationnelles uo ON uo.id = aff.unite_id
        WHERE c.id = :cid
    """), {"cid": str(cid)}).mappings().first()
    return dict(row) if row else None


def _resolve_responsables_etape(db: Session, etape: dict, demandeur_id) -> list[dict]:
    """Liste des responsables d'une étape (réels si décidée, prévus sinon)."""
    statut = etape.get("statut")
    type_etape = etape.get("type_etape")
    out: list[dict] = []

    # Les étapes non humaines (condition/automatique) n'ont pas de responsable
    if type_etape in ("CONDITION", "AUTOMATIQUE"):
        return out

    # ── Étape décidée → décideur(s) réel(s) depuis l'historique ──────────────
    if statut in _STATUTS_DECIDES:
        rows = db.execute(text("""
            SELECT DISTINCT acteur_id
            FROM wf_instance_action
            WHERE id_instance_etape = :ie
              AND type_decision IN ('VALIDER', 'REJETER', 'RENVOYER')
        """), {"ie": str(etape["id"])}).scalars().all()
        for cid in rows:
            info = _collaborateur_info(db, cid)
            if info:
                out.append({**info, "type": "REEL", "source": "reel"})
        return out

    # ── Étape à venir → responsable(s) prévu(s) ──────────────────────────────
    acteurs = db.execute(text("""
        SELECT id, type_acteur, valeur
        FROM ref_workflow_acteur
        WHERE id_etape = :ed AND actif = true AND COALESCE(est_observateur, false) = false
        ORDER BY ordre_delegation NULLS LAST
    """), {"ed": str(etape["id_etape_def"])}).mappings().all()

    for a in acteurs:
        type_acteur = a["type_acteur"]

        if type_acteur == "ROLE":
            out.append({
                "type": "ROLE", "source": "prevu",
                "libelle_role": _role_label(a["valeur"]),
                "nom": None, "prenom": None, "poste": None, "uo": None,
            })

        elif type_acteur == "UTILISATEUR_FIXE":
            # valeur = user_id (compte) → résoudre le collaborateur lié
            cid = db.execute(text("""
                SELECT collaborateur_id FROM profiles
                WHERE user_id = :u AND collaborateur_id IS NOT NULL LIMIT 1
            """), {"u": a["valeur"]}).scalar()
            info = _collaborateur_info(db, cid)
            if info:
                out.append({**info, "type": "UTILISATEUR_FIXE", "source": "prevu"})

        elif type_acteur in (
            "HIERARCHIE_N1", "HIERARCHIE_N2", "UO_RESPONSABLE",
            "UO_PARENTE_RESPONSABLE", "UO_GRAND_PARENTE_RESPONSABLE",
            "UO_RACINE_RESPONSABLE",
        ):
            cids = db.execute(
                text("SELECT collaborateur_id FROM wf_resolve_acteur(:a, :d)"),
                {"a": str(a["id"]), "d": str(demandeur_id)},
            ).scalars().all()
            for cid in cids:
                info = _collaborateur_info(db, cid)
                if info:
                    out.append({**info, "type": type_acteur, "source": "prevu"})
        # GROUPE / DYNAMIQUE : non résolus ici (laisser vide)

    return out


# ─── Schémas Pydantic ──────────────────────────────────────────────────────────

class StartWorkflowIn(BaseModel):
    type_objet: str = Field(..., description="CONGE, DEPART, RECRUTEMENT…")
    id_objet: UUID = Field(..., description="UUID de la demande")
    demandeur_id: UUID
    contexte: dict[str, Any] = Field(default_factory=dict)


class DecideIn(BaseModel):
    instance_etape_id: UUID
    acteur_id: UUID
    type_decision: str = Field(..., description="VALIDER | REJETER | RENVOYER | DELEGUER | VISER")
    commentaire: Optional[str] = None
    pieces_jointes: Optional[list[dict]] = None
    cible_id: Optional[UUID] = None  # délégataire (collaborateur) si DELEGUER


class DecideBatchIn(BaseModel):
    instance_etape_ids: list[UUID]
    acteur_id: UUID
    type_decision: str = Field(..., description="VALIDER | REJETER | RENVOYER | DELEGUER")
    commentaire: Optional[str] = None
    cible_id: Optional[UUID] = None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/start")
def start_workflow(payload: StartWorkflowIn, db: Session = Depends(get_db)):
    engine = WorkflowEngine(db)
    instance_id = engine.start(
        type_objet=payload.type_objet,
        id_objet=payload.id_objet,
        demandeur_id=payload.demandeur_id,
        contexte=payload.contexte,
    )
    if not instance_id:
        raise HTTPException(404, "Aucun workflow applicable")
    return {"instance_id": str(instance_id), "statut": "EN_COURS"}


@router.post("/decide")
def decide(payload: DecideIn, db: Session = Depends(get_db)):
    engine = WorkflowEngine(db)
    try:
        result = engine.decide(
            instance_etape_id=payload.instance_etape_id,
            acteur_id=payload.acteur_id,
            type_decision=payload.type_decision,
            commentaire=payload.commentaire,
            pieces_jointes=payload.pieces_jointes,
            cible_id=payload.cible_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/decide-batch")
def decide_batch(payload: DecideBatchIn, db: Session = Depends(get_db)):
    """Applique la même décision à plusieurs tâches. Ne s'arrête pas au premier
    échec : renvoie le détail par tâche."""
    engine = WorkflowEngine(db)
    results = []
    ok, ko = 0, 0
    for ie_id in payload.instance_etape_ids:
        try:
            engine.decide(
                instance_etape_id=ie_id,
                acteur_id=payload.acteur_id,
                type_decision=payload.type_decision,
                commentaire=payload.commentaire,
                cible_id=payload.cible_id,
            )
            results.append({"instance_etape_id": str(ie_id), "ok": True})
            ok += 1
        except Exception as e:  # noqa
            db.rollback()
            results.append({"instance_etape_id": str(ie_id), "ok": False, "erreur": str(e)})
            ko += 1
    return {"traitees": ok, "echecs": ko, "resultats": results}
def resubmit(instance_id: UUID, db: Session = Depends(get_db)):
    """Le demandeur a modifié sa demande après un RENVOYER. On relance l'étape courante."""
    engine = WorkflowEngine(db)
    engine.resubmit(instance_id)
    return {"status": "resubmitted"}


class RetourAdminIn(BaseModel):
    motif: str = Field(..., min_length=1, description="Motif obligatoire du retour")


@router.post("/admin/retour/{instance_id}")
def admin_retour_etape(
    instance_id: UUID,
    payload_body: RetourAdminIn,
    db: Session = Depends(get_db),
    auth: dict = Depends(get_current_user_payload),
):
    """Pouvoir d'ADMINISTRATION : ramène l'instance à la dernière étape franchie,
    avec motif obligatoire. Réservé aux utilisateurs ayant le rôle administrateur
    (vérifié côté serveur, on ne se fie pas au frontend)."""
    user_id = auth.get("sub")
    est_admin = db.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM user_roles WHERE user_id = :u AND role = 'administrateur'
        )
    """), {"u": str(user_id)}).scalar()
    if not est_admin:
        raise HTTPException(403, "Action réservée à l'administrateur.")

    engine = WorkflowEngine(db)
    try:
        return engine.admin_retour_etape_precedente(instance_id, payload_body.motif)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/instances/{instance_id}")
def get_instance(instance_id: UUID, db: Session = Depends(get_db)):
    """Détails complets d'une instance avec toutes ses étapes et actions.

    Chaque étape est enrichie d'une liste `responsables` :
      - étape décidée (VALIDE/REJETE/PASSE) → le(s) décideur(s) RÉEL(S)
        (depuis l'historique des actions) ;
      - étape à venir (EN_COURS/EN_ATTENTE) → le(s) responsable(s) PRÉVU(S),
        résolu(s) dynamiquement (HIERARCHIE_*/UO_* via wf_resolve_acteur,
        UTILISATEUR_FIXE via le compte nommé) ; les acteurs de type ROLE
        sont affichés via un libellé générique (ex. « Service RH »), sans noms.
    Chaque responsable porte : nom, prenom, poste, uo, type, source.
    """
    inst = db.execute(text("""
        SELECT i.*, w.libelle AS workflow_libelle
        FROM wf_instance i
        JOIN ref_workflow w ON w.id = i.id_workflow
        WHERE i.id = :id
    """), {"id": str(instance_id)}).mappings().first()
    if not inst:
        raise HTTPException(404, "Instance introuvable")

    demandeur_id = inst["demandeur_id"]

    etapes = db.execute(text("""
        SELECT ie.*, e.code AS etape_code, e.libelle AS etape_libelle,
               e.type_etape, e.mode_validation
        FROM wf_instance_etape ie
        JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
        WHERE ie.id_instance = :id
        ORDER BY ie.ordre
    """), {"id": str(instance_id)}).mappings().all()

    actions = db.execute(text("""
        SELECT a.*, ie.ordre AS etape_ordre
        FROM wf_instance_action a
        JOIN wf_instance_etape ie ON ie.id = a.id_instance_etape
        WHERE ie.id_instance = :id
        ORDER BY a.date_action
    """), {"id": str(instance_id)}).mappings().all()

    etapes_out = []
    for e in etapes:
        e_dict = dict(e)
        e_dict["responsables"] = _resolve_responsables_etape(db, e, demandeur_id)
        etapes_out.append(e_dict)

    return {
        "instance": dict(inst),
        "etapes": etapes_out,
        "actions": [dict(a) for a in actions],
    }


# ─── Suppression / désactivation d'une étape (éditeur de workflow) ──────────────

def _compter_instances_etape(db: Session, etape_id: str) -> int:
    """Nombre d'instances (en cours ou historisées) qui utilisent l'étape.
    Tant que > 0, l'étape ne doit PAS être supprimée (perte d'historique)."""
    return db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM wf_instance       WHERE id_etape_courante = :id)
        + (SELECT COUNT(*) FROM wf_instance_etape WHERE id_etape_def      = :id)
    """), {"id": etape_id}).scalar() or 0


@router.delete("/etapes/{etape_id}")
def supprimer_etape(etape_id: UUID, db: Session = Depends(get_db)):
    """Suppression sûre d'une étape de workflow (donnée de configuration).

    Règles :
      - Si une instance (en cours ou historisée) utilise l'étape → 409 :
        on ne supprime pas (préservation de l'historique), on suggère la
        désactivation.
      - Sinon : on DÉTACHE d'abord toutes les références entrantes de
        configuration (transitions condition vrai/faux, décisions ciblant
        l'étape, étape courante éventuelle), puis on supprime. Les enfants
        directs (acteurs, actions, décisions sortantes) partent en CASCADE.
    Le tout en une seule transaction.
    """
    eid = str(etape_id)

    exists = db.execute(text("SELECT 1 FROM ref_workflow_etape WHERE id = :id"), {"id": eid}).scalar()
    if not exists:
        raise HTTPException(404, "Étape introuvable")

    nb_instances = _compter_instances_etape(db, eid)
    if nb_instances > 0:
        raise HTTPException(
            status_code=409,
            detail=(f"Cette étape est utilisée par {nb_instances} demande(s) et ne peut "
                    f"pas être supprimée sans perdre l'historique. Désactivez-la à la place."),
        )

    try:
        # Détacher les références entrantes (FK NO ACTION) qui bloqueraient le DELETE
        db.execute(text("UPDATE ref_workflow_etape SET etape_si_vrai_id = NULL WHERE etape_si_vrai_id = :id"), {"id": eid})
        db.execute(text("UPDATE ref_workflow_etape SET etape_si_faux_id = NULL WHERE etape_si_faux_id = :id"), {"id": eid})
        db.execute(text("UPDATE ref_workflow_decision SET etape_cible_id = NULL WHERE etape_cible_id = :id"), {"id": eid})
        # Sécurité : si une instance pointait l'étape courante (normalement écarté ci-dessus)
        db.execute(text("UPDATE wf_instance SET id_etape_courante = NULL WHERE id_etape_courante = :id"), {"id": eid})

        # Supprimer l'étape (acteurs / actions / décisions sortantes → CASCADE)
        db.execute(text("DELETE FROM ref_workflow_etape WHERE id = :id"), {"id": eid})
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Suppression impossible : {e}")

    return {"status": "deleted", "id": eid}


@router.patch("/etapes/{etape_id}/desactiver")
def desactiver_etape(etape_id: UUID, db: Session = Depends(get_db)):
    """Désactive une étape (actif = false) sans la supprimer : elle disparaît
    des nouveaux parcours mais l'historique des demandes reste intact."""
    eid = str(etape_id)
    res = db.execute(text("""
        UPDATE ref_workflow_etape SET actif = false, updated_at = now()
        WHERE id = :id RETURNING id
    """), {"id": eid}).scalar()
    if not res:
        db.rollback()
        raise HTTPException(404, "Étape introuvable")
    db.commit()
    return {"status": "deactivated", "id": eid}


# ─── Suppression / archivage d'un workflow complet ──────────────────────────────

@router.delete("/{workflow_id}")
def supprimer_workflow(workflow_id: UUID, db: Session = Depends(get_db)):
    """Suppression sûre d'un workflow entier (définition).

    Règle : si des instances (demandes) utilisent ce workflow → 409, on refuse
    (préservation de l'historique) et on suggère l'archivage. Sinon, pour chaque
    étape : détachement des références entrantes (transitions/décisions ciblantes)
    puis suppression ; enfin suppression du workflow. Le tout en une transaction.
    """
    wid = str(workflow_id)

    exists = db.execute(text("SELECT 1 FROM ref_workflow WHERE id = :id"), {"id": wid}).scalar()
    if not exists:
        raise HTTPException(404, "Workflow introuvable")

    nb_instances = db.execute(
        text("SELECT COUNT(*) FROM wf_instance WHERE id_workflow = :id"), {"id": wid}
    ).scalar() or 0
    if nb_instances > 0:
        raise HTTPException(
            status_code=409,
            detail=(f"Ce workflow est utilisé par {nb_instances} demande(s) et ne peut "
                    f"pas être supprimé sans perdre l'historique. Archivez-le à la place."),
        )

    try:
        # Étapes du workflow
        etape_ids = db.execute(
            text("SELECT id FROM ref_workflow_etape WHERE id_workflow = :id"), {"id": wid}
        ).scalars().all()
        eids = [str(x) for x in etape_ids]

        if eids:
            # Détacher toutes les références entrantes pointant vers CES étapes
            ph = ", ".join(f":e{i}" for i in range(len(eids)))
            params = {f"e{i}": v for i, v in enumerate(eids)}
            db.execute(text(f"UPDATE ref_workflow_etape SET etape_si_vrai_id = NULL WHERE etape_si_vrai_id IN ({ph})"), params)
            db.execute(text(f"UPDATE ref_workflow_etape SET etape_si_faux_id = NULL WHERE etape_si_faux_id IN ({ph})"), params)
            db.execute(text(f"UPDATE ref_workflow_decision SET etape_cible_id = NULL WHERE etape_cible_id IN ({ph})"), params)
            db.execute(text(f"UPDATE wf_instance SET id_etape_courante = NULL WHERE id_etape_courante IN ({ph})"), params)
            # Supprimer les étapes (acteurs / actions / décisions sortantes → CASCADE)
            db.execute(text(f"DELETE FROM ref_workflow_etape WHERE id IN ({ph})"), params)

        # Supprimer le workflow
        db.execute(text("DELETE FROM ref_workflow WHERE id = :id"), {"id": wid})
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Suppression impossible : {e}")

    return {"status": "deleted", "id": wid, "etapes_supprimees": len(eids)}


@router.patch("/{workflow_id}/archiver")
def archiver_workflow(workflow_id: UUID, db: Session = Depends(get_db)):
    """Archive un workflow (statut = ARCHIVE, actif = false) sans rien supprimer :
    il ne démarre plus de nouvelles demandes mais l'historique reste intact."""
    wid = str(workflow_id)
    res = db.execute(text("""
        UPDATE ref_workflow SET statut = 'ARCHIVE', actif = false, updated_at = now()
        WHERE id = :id RETURNING id
    """), {"id": wid}).scalar()
    if not res:
        db.rollback()
        raise HTTPException(404, "Workflow introuvable")
    db.commit()
    return {"status": "archived", "id": wid}


@router.get("/inbox/{user_id}")
def get_inbox(user_id: UUID, db: Session = Depends(get_db)):
    """Renvoie les instances étapes en attente de décision pour un utilisateur.

    Filtrage par type d'acteur :
      - UTILISATEUR_FIXE : valeur = auth user_id.
      - ROLE             : l'utilisateur a le rôle (user_roles) ET le demandeur
                           est dans son périmètre de gestion
                           (wf_collaborateur_dans_perimetre ; GLOBAL = sans restriction).
      - HIÉRARCHIE/UO_*  : l'utilisateur (via son collaborateur) est un acteur
                           réel de l'étape pour ce demandeur (wf_resolve_acteur).
    """
    rows = db.execute(text("""
        WITH base AS (
            SELECT ie.id AS ie_id, ie.id_instance, ie.id_etape_def,
                   ie.date_debut, ie.date_echeance, e.libelle AS etape_libelle,
                   i.type_objet, i.id_objet, i.demandeur_id,
                   c.nom AS demandeur_nom, c.prenom AS demandeur_prenom,
                   c.matricule AS demandeur_matricule,
                   w.code AS workflow_code, w.libelle AS workflow_libelle,
                   (SELECT d.table_source FROM ref_workflow_declencheur d
                     WHERE d.type_objet = i.type_objet LIMIT 1) AS table_source
            FROM wf_instance_etape ie
            JOIN wf_instance i ON i.id = ie.id_instance AND i.statut = 'EN_COURS'
            JOIN ref_workflow w ON w.id = i.id_workflow
            JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
            LEFT JOIN collaborateurs c ON c.id = i.demandeur_id
            WHERE ie.statut = 'EN_COURS'
        ),
        moi AS (
            SELECT collaborateur_id FROM profiles WHERE user_id = :u AND collaborateur_id IS NOT NULL LIMIT 1
        )
        SELECT b.*
        FROM base b
        WHERE
            -- (A) ACTEUR DIRECT (règles d'origine, par user_id) ET n'a pas délégué cette tâche
            (
                EXISTS (
                    SELECT 1
                    FROM ref_workflow_acteur a
                    WHERE a.id_etape = b.id_etape_def AND a.actif = true
                      AND (
                          (a.type_acteur = 'UTILISATEUR_FIXE' AND a.valeur::uuid = :u)
                          OR (a.type_acteur = 'ROLE'
                              AND EXISTS (SELECT 1 FROM user_roles ur
                                          WHERE ur.user_id = :u AND ur.role = a.valeur)
                              AND wf_collaborateur_dans_perimetre(:u, a.valeur, b.demandeur_id))
                          OR (a.type_acteur IN ('HIERARCHIE_N1','HIERARCHIE_N2',
                                                'UO_RESPONSABLE','UO_PARENTE_RESPONSABLE',
                                                'UO_GRAND_PARENTE_RESPONSABLE','UO_RACINE_RESPONSABLE')
                              AND EXISTS (
                                  SELECT 1
                                  FROM wf_resolve_acteur(a.id, b.demandeur_id) ra
                                  JOIN moi ON moi.collaborateur_id = ra.collaborateur_id
                              ))
                      )
                )
                -- pas de délégation PONCTUELLE active émise par moi sur cette tâche
                AND NOT EXISTS (
                    SELECT 1 FROM wf_instance_delegation wid
                    WHERE wid.id_instance_etape = b.ie_id AND wid.actif = true
                      AND wid.delegant_id = (SELECT collaborateur_id FROM moi)
                      AND wid.date_debut <= CURRENT_DATE
                      AND (wid.date_fin IS NULL OR wid.date_fin >= CURRENT_DATE)
                )
                -- pas de délégation PERMANENTE active émise par moi couvrant cette tâche
                AND NOT EXISTS (
                    SELECT 1 FROM wf_delegation d
                    WHERE d.delegant_id = (SELECT collaborateur_id FROM moi) AND d.actif = true
                      AND d.date_debut <= CURRENT_DATE
                      AND (d.date_fin IS NULL OR d.date_fin >= CURRENT_DATE)
                      AND (d.scope_type_objet IS NULL OR d.scope_type_objet = b.type_objet)
                      AND (d.scope_workflow_code IS NULL OR d.scope_workflow_code = b.workflow_code)
                )
            )

            -- (B) DÉLÉGATION PONCTUELLE reçue
            OR EXISTS (
                SELECT 1 FROM wf_instance_delegation wid
                WHERE wid.id_instance_etape = b.ie_id AND wid.actif = true
                  AND wid.delegue_id = (SELECT collaborateur_id FROM moi)
                  AND wid.date_debut <= CURRENT_DATE
                  AND (wid.date_fin IS NULL OR wid.date_fin >= CURRENT_DATE)
            )

            -- (C) DÉLÉGATION PERMANENTE reçue (du délégant qui aurait eu la tâche)
            OR EXISTS (
                SELECT 1 FROM wf_delegation d
                WHERE d.delegue_id = (SELECT collaborateur_id FROM moi) AND d.actif = true
                  AND d.date_debut <= CURRENT_DATE
                  AND (d.date_fin IS NULL OR d.date_fin >= CURRENT_DATE)
                  AND (d.scope_type_objet IS NULL OR d.scope_type_objet = b.type_objet)
                  AND (d.scope_workflow_code IS NULL OR d.scope_workflow_code = b.workflow_code)
                  AND wf_collab_matches_etape(d.delegant_id, b.id_etape_def, b.demandeur_id)
            )
        ORDER BY b.date_echeance ASC NULLS LAST
    """), {"u": str(user_id)}).mappings().all()
    return [dict(r) for r in rows]


# ════════════════════════════════════════════════════════════════════════════
#  DÉLÉGATIONS PERMANENTES (wf_delegation) — gestion par l'utilisateur et le RH
# ════════════════════════════════════════════════════════════════════════════

def _collab_of_user(db: Session, user_id) -> Optional[UUID]:
    """Collaborateur lié au compte authentifié (profiles.user_id)."""
    return db.execute(text("""
        SELECT collaborateur_id FROM profiles
        WHERE user_id = :u AND collaborateur_id IS NOT NULL
        LIMIT 1
    """), {"u": str(user_id)}).scalar()


def _peut_gerer_autrui(db: Session, user_id) -> bool:
    """RH ou administrateur : peut créer/voir des délégations pour autrui."""
    return bool(db.execute(text("""
        SELECT 1 FROM user_roles
        WHERE user_id = :u AND role IN ('administrateur', 'gestionnaire_rh')
        LIMIT 1
    """), {"u": str(user_id)}).scalar())


class DelegationIn(BaseModel):
    delegue_id: UUID                              # collaborateur délégataire
    date_debut: Optional[date] = None
    date_fin: Optional[date] = None               # NULL = sans fin
    scope_type_objet: Optional[str] = None        # NULL = tous
    scope_workflow_code: Optional[str] = None     # NULL = tous
    motif: Optional[str] = None
    delegant_id: Optional[UUID] = None            # RH/admin uniquement : pour le compte d'autrui


@router.post("/delegations")
def creer_delegation(payload: DelegationIn, db: Session = Depends(get_db),
                     auth: dict = Depends(get_current_user_payload)):
    moi = _collab_of_user(db, auth.get("sub"))
    if not moi:
        raise HTTPException(400, "Aucun collaborateur lié à votre compte.")

    # Délégant : soi-même par défaut ; autrui réservé RH/admin
    delegant = payload.delegant_id or moi
    if str(delegant) != str(moi) and not _peut_gerer_autrui(db, auth.get("sub")):
        raise HTTPException(403, "Seul un RH/administrateur peut déléguer pour autrui.")

    if str(delegant) == str(payload.delegue_id):
        raise HTTPException(400, "Le délégant et le délégataire doivent être différents.")
    if payload.date_fin and payload.date_debut and payload.date_fin < payload.date_debut:
        raise HTTPException(400, "La date de fin doit être postérieure à la date de début.")

    new_id = db.execute(text("""
        INSERT INTO wf_delegation
            (delegant_id, delegue_id, date_debut, date_fin,
             scope_type_objet, scope_workflow_code, motif, created_by)
        VALUES
            (:del, :due, COALESCE(:dd, CURRENT_DATE), :df,
             :sto, :swc, :motif, :cb)
        RETURNING id
    """), {
        "del": str(delegant), "due": str(payload.delegue_id),
        "dd": payload.date_debut, "df": payload.date_fin,
        "sto": payload.scope_type_objet, "swc": payload.scope_workflow_code,
        "motif": payload.motif, "cb": str(moi),
    }).scalar()
    db.commit()
    return {"id": str(new_id), "status": "ok"}


@router.get("/delegations")
def lister_delegations(delegant_id: Optional[UUID] = None,
                       db: Session = Depends(get_db),
                       auth: dict = Depends(get_current_user_payload)):
    """Délégations émises. Par défaut les miennes ; un RH/admin peut filtrer
    sur un autre délégant (ou tout voir sans filtre)."""
    moi = _collab_of_user(db, auth.get("sub"))
    admin = _peut_gerer_autrui(db, auth.get("sub"))

    if delegant_id:
        if str(delegant_id) != str(moi) and not admin:
            raise HTTPException(403, "Accès réservé au RH/administrateur.")
        where, params = "d.delegant_id = :f", {"f": str(delegant_id)}
    elif admin:
        where, params = "TRUE", {}
    else:
        where, params = "d.delegant_id = :f", {"f": str(moi)}

    rows = db.execute(text(f"""
        SELECT d.*,
               da.nom AS delegant_nom, da.prenom AS delegant_prenom, da.matricule AS delegant_matricule,
               de.nom AS delegue_nom,  de.prenom AS delegue_prenom,  de.matricule AS delegue_matricule
        FROM wf_delegation d
        LEFT JOIN collaborateurs da ON da.id = d.delegant_id
        LEFT JOIN collaborateurs de ON de.id = d.delegue_id
        WHERE {where}
        ORDER BY d.actif DESC, d.date_debut DESC
    """), params).mappings().all()
    return [dict(r) for r in rows]


@router.get("/delegations/recues")
def delegations_recues(db: Session = Depends(get_db),
                       auth: dict = Depends(get_current_user_payload)):
    """Délégations dont je suis le délégataire (actives)."""
    moi = _collab_of_user(db, auth.get("sub"))
    if not moi:
        return []
    rows = db.execute(text("""
        SELECT d.*,
               da.nom AS delegant_nom, da.prenom AS delegant_prenom, da.matricule AS delegant_matricule
        FROM wf_delegation d
        LEFT JOIN collaborateurs da ON da.id = d.delegant_id
        WHERE d.delegue_id = :m AND d.actif = true
          AND d.date_debut <= CURRENT_DATE
          AND (d.date_fin IS NULL OR d.date_fin >= CURRENT_DATE)
        ORDER BY d.date_debut DESC
    """), {"m": str(moi)}).mappings().all()
    return [dict(r) for r in rows]


@router.delete("/delegations/{delegation_id}")
def revoquer_delegation(delegation_id: UUID, db: Session = Depends(get_db),
                        auth: dict = Depends(get_current_user_payload)):
    """Révoque (désactive) une délégation. Réservé au délégant ou au RH/admin."""
    moi = _collab_of_user(db, auth.get("sub"))
    deleg = db.execute(text("SELECT delegant_id FROM wf_delegation WHERE id = :i"),
                       {"i": str(delegation_id)}).scalar()
    if not deleg:
        raise HTTPException(404, "Délégation introuvable.")
    if str(deleg) != str(moi) and not _peut_gerer_autrui(db, auth.get("sub")):
        raise HTTPException(403, "Action réservée au délégant ou au RH/administrateur.")
    db.execute(text("UPDATE wf_delegation SET actif = false, updated_at = now() WHERE id = :i"),
               {"i": str(delegation_id)})
    db.commit()
    return {"status": "revoked"}
