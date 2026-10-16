"""
app/routers/cong_operations.py — Opérations sur une demande de congé existante
Auteur : Adil DAIA

Gère l'annulation, le report (modification en place des dates) et la reprise
anticipée d'une demande de congé, chacune validée par le workflow N+1
(wf_operation_conge). L'effet métier est appliqué par le trigger
trg_appliquer_operation_conge quand le moteur passe l'opération à 'approuvee'.

Endpoints :
  POST /api/v1/cong-operations                         — créer + démarrer le workflow
  GET  /api/v1/cong-operations?demande_id=...           — historique des opérations d'une demande
  GET  /api/v1/cong-operations/{id}                     — détail d'une opération
  GET  /api/v1/cong-operations/eligibilite/{demande_id} — opérations autorisées (pour l'UI)
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload
from app.services.workflow_engine import WorkflowEngine

router = APIRouter(prefix="/cong-operations", tags=["conges-operations"])

WF_CODE = "wf_operation_conge"
TYPE_OBJET = "OPERATION_CONGE"


# ─── Schémas ────────────────────────────────────────────────────────────────
class OperationIn(BaseModel):
    demande_id: UUID
    type_operation: str = Field(..., description="annulation | report | reprise")
    motif: Optional[str] = None

    # Report
    nouvelle_date_debut: Optional[date] = None
    nouvelle_date_fin_absence: Optional[date] = None
    nouvelle_date_retour: Optional[date] = None

    # Reprise anticipée
    date_reprise_effective: Optional[date] = None

    # Jours recalculés côté client (report et reprise) — vérifiés ici
    nouveau_nbr_jours_calendaires: Optional[float] = None
    nouveau_nbr_jours_decomptes: Optional[float] = None


# ─── Helpers ────────────────────────────────────────────────────────────────
def _collab_from_auth(db: Session, user_id) -> Optional[UUID]:
    """collaborateur lié au compte authentifié (même motif que get_inbox)."""
    return db.execute(text("""
        SELECT collaborateur_id FROM profiles
        WHERE user_id = :u AND collaborateur_id IS NOT NULL
        LIMIT 1
    """), {"u": str(user_id)}).scalar()


def _load_demande(db: Session, demande_id: UUID) -> dict:
    row = db.execute(text("""
        SELECT d.*, t.absence_deductible, t.solde_negatif_autorise,
               t.duree_max, t.preavis_jours, t.controle_chevauchement, t.libelle AS type_libelle
        FROM cong_demandes d
        JOIN ref_type_conge t ON t.code = d.code_type_conge
        WHERE d.id = :id AND d.archive = false
    """), {"id": str(demande_id)}).mappings().first()
    if not row:
        raise HTTPException(404, "Demande de congé introuvable.")
    return dict(row)


def _resolve_wf(db: Session, code_type: str, type_op: str) -> Optional[str]:
    """Workflow applicable pour (type de congé, opération).
    Spécifique -> défaut global -> 'wf_operation_conge'.
    Retourne None si une ligne explicite vaut NULL (= application directe)."""
    row = db.execute(text("""
        SELECT code_workflow FROM cong_type_operation_workflow
        WHERE actif AND type_operation = :op AND code_type_conge = :c
    """), {"op": type_op, "c": code_type}).first()
    if row is not None:
        return row[0]
    row = db.execute(text("""
        SELECT code_workflow FROM cong_type_operation_workflow
        WHERE actif AND type_operation = :op AND code_type_conge IS NULL
    """), {"op": type_op}).first()
    if row is not None:
        return row[0]
    return "wf_operation_conge"


def _operation_en_cours(db: Session, demande_id: UUID) -> bool:
    return bool(db.execute(text("""
        SELECT 1 FROM cong_operation
        WHERE demande_id = :d AND statut = 'en_attente'
        LIMIT 1
    """), {"d": str(demande_id)}).scalar())


def _eligibilite(db: Session, d: dict) -> dict:
    """Pour chaque type d'opération : autorisée ou non (+ raison)."""
    today = date.today()
    statut = (d["statut"] or "").lower()
    debut = d["date_debut"]
    fin = d["date_fin_absence"]
    commencee = debut is not None and debut <= today
    terminee = fin is not None and fin < today
    en_cours = _operation_en_cours(db, d["id"])

    def bloc(ok, raison=None):
        return {"autorise": ok, "raison": raison}

    if en_cours:
        msg = "Une opération est déjà en attente de validation sur cette demande."
        return {"annulation": bloc(False, msg), "report": bloc(False, msg), "reprise": bloc(False, msg)}

    # Annulation : tant que non commencée (en_attente ou approuvée non démarrée)
    if statut not in ("en_attente", "approuvee"):
        annul = bloc(False, "La demande n'est ni en attente ni approuvée.")
    elif statut == "approuvee" and commencee and not terminee:
        annul = bloc(False, "Congé déjà commencé : utilisez la reprise anticipée.")
    elif terminee:
        annul = bloc(False, "Congé déjà terminé.")
    else:
        annul = bloc(True)

    # Report : avant le début uniquement
    if statut not in ("en_attente", "approuvee"):
        rep = bloc(False, "La demande n'est ni en attente ni approuvée.")
    elif commencee:
        rep = bloc(False, "Congé déjà commencé : report impossible.")
    else:
        rep = bloc(True)

    # Reprise anticipée : congé approuvé et en cours
    if statut != "approuvee":
        repr_ = bloc(False, "Seul un congé approuvé peut faire l'objet d'une reprise.")
    elif not commencee:
        repr_ = bloc(False, "Le congé n'a pas encore commencé.")
    elif terminee:
        repr_ = bloc(False, "Congé déjà terminé.")
    else:
        repr_ = bloc(True)

    return {"annulation": annul, "report": rep, "reprise": repr_}


def _valider_report(db: Session, d: dict, payload: OperationIn) -> None:
    """Rejoue les règles de gestion pour les nouvelles dates (l'UPDATE de
    cong_demandes ne passe pas par trg_valider_demande_conge, INSERT-only)."""
    nd, nf = payload.nouvelle_date_debut, payload.nouvelle_date_fin_absence
    if not nd or not nf:
        raise HTTPException(400, "Report : nouvelles dates de début et de fin requises.")
    decomptes = float(payload.nouveau_nbr_jours_decomptes or 0)

    erreurs: list[str] = []

    if nf < nd:
        erreurs.append("La date de fin doit être postérieure ou égale à la date de début.")

    if d.get("duree_max") and d["duree_max"] > 0 and decomptes > float(d["duree_max"]):
        erreurs.append(f"Durée maximale dépassée ({decomptes:g} j pour un maximum de {d['duree_max']} j).")

    if d.get("preavis_jours") and d["preavis_jours"] > 0:
        from datetime import timedelta
        min_debut = date.today() + timedelta(days=int(d["preavis_jours"]))
        if nd < min_debut:
            erreurs.append(f"Préavis insuffisant : début au plus tôt le {min_debut.isoformat()}.")

    if (d.get("controle_chevauchement") or "STRICT") == "STRICT":
        chevauche = db.execute(text("""
            SELECT 1 FROM cong_demandes cd
            WHERE cd.collaborateur_id = :cid
              AND cd.id <> :self
              AND lower(cd.statut) IN ('en_attente','approuvee','brouillon','modifiee')
              AND cd.date_debut <= :nf AND cd.date_fin_absence >= :nd
            LIMIT 1
        """), {"cid": str(d["collaborateur_id"]), "self": str(d["id"]),
               "nd": nd, "nf": nf}).scalar()
        if chevauche:
            erreurs.append("Chevauchement avec une autre demande active sur les nouvelles dates.")

    # Solde (uniquement si le type décompte un solde et interdit le négatif)
    if d.get("absence_deductible") and d.get("solde_negatif_autorise") is False:
        srow = db.execute(text("""
            SELECT COALESCE(solde_restant, 0) AS solde_restant
            FROM cong_solde
            WHERE collaborateur_id = :cid AND code_type_conge = :code AND archive = false
            ORDER BY exercice DESC LIMIT 1
        """), {"cid": str(d["collaborateur_id"]), "code": d["code_type_conge"]}).mappings().first()
        solde = float(srow["solde_restant"]) if srow else 0.0
        ancien = float(d.get("nbr_jours_decomptes") or 0)
        # approuvée : ses jours sont déjà décomptés -> on raisonne en delta
        dispo = solde + ancien if (d["statut"] or "").lower() == "approuvee" else solde
        if dispo - decomptes < 0:
            erreurs.append(f"Solde insuffisant : il manque {round(decomptes - dispo, 1):g} j.")

    if erreurs:
        raise HTTPException(400, " ".join(erreurs))


# ─── Endpoints ──────────────────────────────────────────────────────────────
@router.get("/eligibilite/{demande_id}")
def eligibilite(demande_id: UUID, db: Session = Depends(get_db)):
    return _eligibilite(db, _load_demande(db, demande_id))


@router.get("")
def lister(demande_id: UUID, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT o.*, i.statut AS wf_statut
        FROM cong_operation o
        LEFT JOIN wf_instance i ON i.id = o.wf_instance_id
        WHERE o.demande_id = :d AND o.archive = false
        ORDER BY o.created_at DESC
    """), {"d": str(demande_id)}).mappings().all()
    return [dict(r) for r in rows]


TYPES_OP = ("annulation", "report", "reprise")


class MappingIn(BaseModel):
    code_type_conge: str
    type_operation: str = Field(..., description="annulation | report | reprise")
    mode: str = Field(..., description="workflow | direct | inherit")
    code_workflow: Optional[str] = None


@router.get("/workflows")
def workflows_disponibles(db: Session = Depends(get_db)):
    """Workflows utilisables pour les opérations (type_objet = OPERATION_CONGE)."""
    rows = db.execute(text("""
        SELECT code, libelle, couleur, icone
        FROM ref_workflow
        WHERE type_objet = 'OPERATION_CONGE' AND statut = 'ACTIF' AND actif = true
        ORDER BY ordre, libelle
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.get("/mapping/{code_type_conge}")
def mapping_get(code_type_conge: str, db: Session = Depends(get_db)):
    """Affectation par opération pour un type de congé : valeur assignée,
    valeur effective (après héritage) et source."""
    out = []
    for op in TYPES_OP:
        row = db.execute(text("""
            SELECT code_workflow
            FROM cong_type_operation_workflow
            WHERE code_type_conge = :c AND type_operation = :op AND actif = true
        """), {"c": code_type_conge, "op": op}).mappings().first()

        if row is None:
            mode, assigned = "inherit", None
        elif row["code_workflow"] is None:
            mode, assigned = "direct", None
        else:
            mode, assigned = "workflow", row["code_workflow"]

        effectif = _resolve_wf(db, code_type_conge, op)
        if mode != "inherit":
            source = "type"
        elif db.execute(text("""
                SELECT 1 FROM cong_type_operation_workflow
                WHERE code_type_conge IS NULL AND type_operation = :op AND actif = true
             """), {"op": op}).scalar():
            source = "defaut"
        else:
            source = "integre"

        out.append({
            "type_operation": op, "mode": mode, "code_workflow": assigned,
            "effectif": effectif, "source": source,
        })
    return out


@router.post("/mapping")
def mapping_put(payload: MappingIn, db: Session = Depends(get_db)):
    if payload.type_operation not in TYPES_OP:
        raise HTTPException(400, "type_operation invalide.")
    if payload.mode not in ("workflow", "direct", "inherit"):
        raise HTTPException(400, "mode invalide.")

    if payload.mode == "inherit":
        db.execute(text("""
            DELETE FROM cong_type_operation_workflow
            WHERE code_type_conge = :c AND type_operation = :op
        """), {"c": payload.code_type_conge, "op": payload.type_operation})
    else:
        code_wf = payload.code_workflow if payload.mode == "workflow" else None
        if payload.mode == "workflow" and not code_wf:
            raise HTTPException(400, "code_workflow requis en mode workflow.")
        db.execute(text("""
            INSERT INTO cong_type_operation_workflow (code_type_conge, type_operation, code_workflow, actif)
            VALUES (:c, :op, :wf, true)
            ON CONFLICT (code_type_conge, type_operation)
            DO UPDATE SET code_workflow = EXCLUDED.code_workflow, actif = true, updated_at = now()
        """), {"c": payload.code_type_conge, "op": payload.type_operation, "wf": code_wf})
    db.commit()
    return {"status": "ok"}


@router.get("/{operation_id}")
def detail(operation_id: UUID, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT o.*, i.statut AS wf_statut
        FROM cong_operation o
        LEFT JOIN wf_instance i ON i.id = o.wf_instance_id
        WHERE o.id = :id
    """), {"id": str(operation_id)}).mappings().first()
    if not row:
        raise HTTPException(404, "Opération introuvable.")
    return dict(row)


@router.post("")
def creer(payload: OperationIn, db: Session = Depends(get_db),
          auth: dict = Depends(get_current_user_payload)):
    if payload.type_operation not in ("annulation", "report", "reprise"):
        raise HTTPException(400, "type_operation invalide.")

    d = _load_demande(db, payload.demande_id)
    elig = _eligibilite(db, d)[payload.type_operation]
    if not elig["autorise"]:
        raise HTTPException(409, elig["raison"] or "Opération non autorisée.")

    # Validations spécifiques + normalisation des valeurs cibles
    nouvelle_dd = nouvelle_df = nouvelle_dr = None
    reprise = None
    new_cal = new_dec = None

    if payload.type_operation == "report":
        _valider_report(db, d, payload)
        nouvelle_dd = payload.nouvelle_date_debut
        nouvelle_df = payload.nouvelle_date_fin_absence
        nouvelle_dr = payload.nouvelle_date_retour
        new_cal = payload.nouveau_nbr_jours_calendaires
        new_dec = payload.nouveau_nbr_jours_decomptes

    elif payload.type_operation == "reprise":
        reprise = payload.date_reprise_effective
        if not reprise:
            raise HTTPException(400, "Reprise : date de reprise effective requise.")
        if not (d["date_debut"] < reprise <= d["date_fin_absence"]):
            raise HTTPException(
                400,
                f"La date de reprise doit être comprise entre le "
                f"{(d['date_debut']).isoformat()} (exclu) et le "
                f"{(d['date_fin_absence']).isoformat()} (inclus).",
            )
        new_cal = payload.nouveau_nbr_jours_calendaires
        new_dec = payload.nouveau_nbr_jours_decomptes
        if new_dec is not None and float(new_dec) > float(d.get("nbr_jours_decomptes") or 0):
            raise HTTPException(400, "Reprise : les jours décomptés ne peuvent pas augmenter.")

    created_by = _collab_from_auth(db, auth.get("sub"))

    # Insertion de l'opération (snapshot de l'état d'origine)
    try:
        op_id = db.execute(text("""
            INSERT INTO cong_operation (
                demande_id, collaborateur_id, demandeur_id, type_operation, statut, motif,
                ancienne_date_debut, ancienne_date_fin_absence, ancienne_date_retour,
                ancien_nbr_jours_calendaires, ancien_nbr_jours_decomptes,
                nouvelle_date_debut, nouvelle_date_fin_absence, nouvelle_date_retour,
                date_reprise_effective,
                nouveau_nbr_jours_calendaires, nouveau_nbr_jours_decomptes,
                created_by
            ) VALUES (
                :demande_id, :collab, :demandeur, :type, 'en_attente', :motif,
                :a_dd, :a_df, :a_dr, :a_cal, :a_dec,
                :n_dd, :n_df, :n_dr, :reprise, :n_cal, :n_dec, :created_by
            ) RETURNING id
        """), {
            "demande_id": str(d["id"]),
            "collab": str(d["collaborateur_id"]),
            "demandeur": str(d["collaborateur_id"]),  # workflow -> N+1 du propriétaire
            "type": payload.type_operation,
            "motif": payload.motif,
            "a_dd": d["date_debut"], "a_df": d["date_fin_absence"], "a_dr": d["date_retour"],
            "a_cal": d.get("nbr_jours_calendaires"), "a_dec": d.get("nbr_jours_decomptes"),
            "n_dd": nouvelle_dd, "n_df": nouvelle_df, "n_dr": nouvelle_dr,
            "reprise": reprise, "n_cal": new_cal, "n_dec": new_dec,
            "created_by": str(created_by) if created_by else None,
        }).scalar()
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Une opération est déjà en attente sur cette demande.")

    # Résolution du workflow pour ce (type de congé, opération).
    # None = aucun workflow configuré -> application directe (sans validation).
    code_wf = _resolve_wf(db, d["code_type_conge"], payload.type_operation)

    if not code_wf:
        db.execute(text("UPDATE cong_operation SET statut = 'approuvee' WHERE id = :o"),
                   {"o": str(op_id)})
        db.commit()
        return {
            "id": str(op_id), "type_operation": payload.type_operation,
            "statut": "approuvee", "application": "directe",
            "wf_instance_id": None, "lien_suivi": None,
        }

    # Démarrage du workflow (auto-soumission -> 1re étape de validation)
    engine = WorkflowEngine(db)
    instance_id = engine.start_by_code(
        code_workflow=code_wf,
        id_objet=op_id,
        demandeur_id=d["collaborateur_id"],
        contexte={
            "__type_objet__": TYPE_OBJET,
            "nature": "operation_conge",
            "type_operation": payload.type_operation,
            "code_type_conge": d["code_type_conge"],
            "collaborateur_id": str(d["collaborateur_id"]),
            "demande_id": str(d["id"]),
        },
    )
    if instance_id:
        db.execute(text("UPDATE cong_operation SET wf_instance_id = :i WHERE id = :o"),
                   {"i": str(instance_id), "o": str(op_id)})
        db.commit()

    return {
        "id": str(op_id),
        "type_operation": payload.type_operation,
        "statut": "en_attente",
        "workflow": code_wf,
        "wf_instance_id": str(instance_id) if instance_id else None,
        "lien_suivi": f"/gestion-demandes?instance={instance_id}" if instance_id else None,
    }
