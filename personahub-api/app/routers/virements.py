"""
app/routers/virements.py
Endpoints REST du module Virements des salaires & Retenues à la source.

Imports confirmés via app/routers/prets.py :
 - get_db : app.core.database
 - get_current_user_payload, require_roles : app.core.security

✅ Confirmé : `get_current_user_payload` retourne un dict dont la clé
d'identifiant est "sub" (claim JWT standard, confirmée par décodage d'un
token réel dans les logs) — pas "user_id" comme supposé initialement.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload, require_roles
from app.schemas.virements import (
    GenererOrdreIn,
    LigneVirementOut,
    OrdreAdHocIn,
    OrdreVirementOut,
    RetenueTiersIn,
    RetenueTiersOut,
    SignalerRejetIn,
    VirementSyntheseKpiOut,
)
from app.services import virements_service
from app.services.virements_service import VirementServiceError

import uuid as _uuid_module


def _serialiser(rows) -> list[dict]:
    """Convertit les objets uuid.UUID renvoyés par psycopg2 en str, pour que
    la validation du response_model Pydantic (champs déclarés en str) ne
    lève plus de ResponseValidationError."""
    return [
        {k: (str(v) if isinstance(v, _uuid_module.UUID) else v) for k, v in dict(r).items()}
        for r in rows
    ]

router = APIRouter(prefix="/virements", tags=["virements"])

ROLES_GESTION = ["administrateur", "gestionnaire_rh", "gestionnaire_paie"]

# Note : la liste/création/édition des comptes émetteurs (societe_comptes_bancaires)
# et du référentiel banques (ref_banque) passent par l'endpoint générique
# /db/{table} déjà utilisé partout ailleurs dans l'app — pas de route dédiée
# ici. Seuls les 3 champs propres au virement (code_simt_effectif, rib,
# raison_sociale_emetteur) ont été ajoutés à societe_comptes_bancaires
# (migration 060) ; db.update() suffit pour les compléter.

# ---------------------------------------------------------------------------
# RG-MULTISOCIETE-08 (migration 057) : ordre_virement/ligne_virement n'ont
# PAS de societe_id en propre (catégorie A) -- la société se déduit via
# ordre_virement.banque_emettrice_id -> societe_comptes_bancaires.societe_id
# (NOT NULL, confirmé). Ces helpers centralisent ce chemin de jointure pour
# tous les endpoints ci-dessous qui manipulent un ordre_id/banque_id/ligne_id.
# ---------------------------------------------------------------------------

def _societe_active(payload: dict) -> str:
    sid = payload.get("societe_active_id")
    if not sid:
        raise HTTPException(403, "Aucune société active sur ce token — reconnexion requise")
    return sid


def _ordre_ou_404(db: Session, ordre_id: str, societe_id: str) -> None:
    """404 (pas 403) si l'ordre n'existe pas OU appartient à une autre
    société -- ne jamais confirmer l'existence d'un ordre hors périmètre."""
    ok = db.execute(text("""
        SELECT 1 FROM ordre_virement ov
        JOIN societe_comptes_bancaires scb ON scb.id = ov.banque_emettrice_id
        WHERE ov.id = :oid AND scb.societe_id = :sid
    """), {"oid": ordre_id, "sid": societe_id}).first()
    if not ok:
        raise HTTPException(404, "Ordre de virement introuvable.")


def _ligne_ou_404(db: Session, ligne_id: str, societe_id: str) -> None:
    ok = db.execute(text("""
        SELECT 1 FROM ligne_virement lv
        JOIN ordre_virement ov ON ov.id = lv.ordre_virement_id
        JOIN societe_comptes_bancaires scb ON scb.id = ov.banque_emettrice_id
        WHERE lv.id = :lid AND scb.societe_id = :sid
    """), {"lid": ligne_id, "sid": societe_id}).first()
    if not ok:
        raise HTTPException(404, "Ligne de virement introuvable.")


def _banque_ou_403(db: Session, banque_id: str, societe_id: str) -> None:
    """403 (pas 404) ici : contrairement à un ordre déjà créé, le compte
    émetteur est choisi PAR l'appelant dans le formulaire -- s'il en propose
    un d'une autre société, c'est un contournement à signaler explicitement,
    pas une ressource simplement absente."""
    ok = db.execute(text(
        "SELECT 1 FROM societe_comptes_bancaires WHERE id = :id AND societe_id = :sid"
    ), {"id": banque_id, "sid": societe_id}).first()
    if not ok:
        raise HTTPException(403, "Compte bancaire émetteur non accessible pour cette société.")


def _periode_ou_403(db: Session, periode_id: str, societe_id: str) -> None:
    ok = db.execute(text(
        "SELECT 1 FROM calendrier_paie WHERE id = :id AND societe_id = :sid"
    ), {"id": periode_id, "sid": societe_id}).first()
    if not ok:
        raise HTTPException(403, "Période non accessible pour cette société.")


def _collaborateur_ou_403(db: Session, collaborateur_id: str, societe_id: str) -> None:
    """Un collaborateur appartient à la société active si l'un de ses
    contrats (non archivé) porte ce societe_id -- même logique que le
    cloisonnement paie (contrat = ancre de la société, RG-01)."""
    ok = db.execute(text("""
        SELECT 1 FROM collaborateur_contrats
         WHERE collaborateur_id = :cid AND societe_id = :sid AND archive = false
    """), {"cid": collaborateur_id, "sid": societe_id}).first()
    if not ok:
        raise HTTPException(403, "Collaborateur non accessible pour cette société.")


# ---------------------------------------------------------------------------
# Tiers payeurs (voir /db/tiers_payeur générique — plus de route dédiée) /
# dossiers de retenue
# ---------------------------------------------------------------------------

@router.get("/retenues-tiers", response_model=list[RetenueTiersOut])
def get_retenues_tiers(
    collaborateur_id: str | None = None,
    statut: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*ROLES_GESTION)),
    payload_utilisateur: dict = Depends(get_current_user_payload),
):
    sid = _societe_active(payload_utilisateur)
    # RG-MULTISOCIETE-08 : filtre systématique à la société active via le
    # contrat actif du collaborateur (catégorie A, pas de societe_id propre
    # sur retenue_tiers).
    conditions, params = [
        "EXISTS (SELECT 1 FROM collaborateur_contrats cc WHERE cc.collaborateur_id = rt.collaborateur_id "
        "AND cc.societe_id = :sid AND cc.archive = false)"
    ], {"sid": sid}
    if collaborateur_id:
        conditions.append("rt.collaborateur_id = :collaborateur_id")
        params["collaborateur_id"] = collaborateur_id
    if statut:
        conditions.append("rt.statut = :statut")
        params["statut"] = statut
    clause_where = f"WHERE {' AND '.join(conditions)}"

    rows = db.execute(text(f"""
        SELECT rt.*, c.nom || ' ' || c.prenom AS collaborateur_nom, c.matricule AS collaborateur_matricule,
               tp.nom AS tiers_payeur_nom, trs.libelle AS type_retenue_source_libelle,
               trs.rubrique_paie_code, rp.libelle AS rubrique_paie_libelle
        FROM retenue_tiers rt
        JOIN collaborateurs c ON c.id = rt.collaborateur_id
        JOIN tiers_payeur tp ON tp.id = rt.tiers_payeur_id
        JOIN ref_type_retenue_source trs ON trs.code = rt.type_retenue_source_code
        JOIN rubrique_paie rp ON rp.code = trs.rubrique_paie_code
        {clause_where}
        ORDER BY rt.priorite, rt.created_at DESC
    """), params).mappings().all()
    return _serialiser(rows)


@router.post("/retenues-tiers", response_model=RetenueTiersOut)
def creer_retenue_tiers(payload: RetenueTiersIn, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                        payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _collaborateur_ou_403(db, payload.collaborateur_id, sid)
    import uuid
    nouvel_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO retenue_tiers
            (id, collaborateur_id, tiers_payeur_id, type_retenue_source_code, priorite, reference_dossier, date_debut, date_fin, statut)
        VALUES
            (:id, :collaborateur_id, :tiers_payeur_id, :type_retenue_source_code, :priorite, :reference_dossier, :date_debut, :date_fin, :statut)
    """), {"id": nouvel_id, **payload.model_dump()})
    db.commit()
    return {**payload.model_dump(), "id": nouvel_id}


@router.patch("/retenues-tiers/{dossier_id}", response_model=RetenueTiersOut)
def modifier_retenue_tiers(dossier_id: str, payload: dict, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                           payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    # RG-MULTISOCIETE-08 : le dossier ciblé doit appartenir à la société
    # active -- vérifié via son collaborateur, avant toute modification.
    existant = db.execute(text("SELECT collaborateur_id FROM retenue_tiers WHERE id = :id"), {"id": dossier_id}).mappings().first()
    if not existant:
        raise HTTPException(404, "Dossier de retenue introuvable.")
    _collaborateur_ou_403(db, str(existant["collaborateur_id"]), sid)
    champs_autorises = {
        "statut", "date_fin", "priorite", "reference_dossier",
        "collaborateur_id", "tiers_payeur_id", "type_retenue_source_code", "date_debut",
    }
    a_modifier = {k: v for k, v in payload.items() if k in champs_autorises}
    if not a_modifier:
        raise HTTPException(400, "Aucun champ valide à mettre à jour.")
    if "collaborateur_id" in a_modifier:
        # Interdit de déplacer le dossier vers un collaborateur d'une autre société.
        _collaborateur_ou_403(db, str(a_modifier["collaborateur_id"]), sid)
    assignations = ", ".join(f"{champ} = :{champ}" for champ in a_modifier)
    db.execute(text(f"UPDATE retenue_tiers SET {assignations}, updated_at = now() WHERE id = :id"), {**a_modifier, "id": dossier_id})
    db.commit()
    row = db.execute(text("SELECT * FROM retenue_tiers WHERE id = :id"), {"id": dossier_id}).mappings().first()
    return row


# ---------------------------------------------------------------------------
# KPI / ordres de virement
# ---------------------------------------------------------------------------

@router.get("/kpi", response_model=VirementSyntheseKpiOut)
def get_kpi_periode(periode_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                    payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _periode_ou_403(db, periode_id, sid)
    net_a_payer = db.execute(text("""
        SELECT COALESCE(SUM(b.net_a_payer), 0) AS montant, COUNT(*) AS nb
        FROM bulletin b
        JOIN calendrier_paie cal ON cal.id = b.periode_id
        JOIN collaborateur_plan_paie cpp
            ON cpp.collaborateur_id = b.collaborateur_id AND cpp.plan_paie_id = cal.plan_paie_id AND cpp.archive = false
        WHERE b.periode_id = :p AND UPPER(b.statut) IN ('VALIDE', 'CLOTURE', 'CLOTUREE') AND b.net_a_payer > 0
    """), {"p": periode_id}).mappings().first()

    retenues = db.execute(text("""
        SELECT COALESCE(SUM(bl.montant), 0) AS montant, COUNT(DISTINCT rt.id) AS nb
        FROM bulletin_ligne bl
        JOIN bulletin b ON b.id = bl.bulletin_id
        JOIN calendrier_paie cal ON cal.id = b.periode_id
        JOIN collaborateur_plan_paie cpp
            ON cpp.collaborateur_id = b.collaborateur_id AND cpp.plan_paie_id = cal.plan_paie_id AND cpp.archive = false
        JOIN retenue_tiers rt ON rt.collaborateur_id = b.collaborateur_id AND rt.statut = 'ACTIF'
        JOIN ref_type_retenue_source trs ON trs.code = rt.type_retenue_source_code AND trs.rubrique_paie_code = bl.code_rubrique
        WHERE b.periode_id = :p
    """), {"p": periode_id}).mappings().first()

    prets = db.execute(text("""
        SELECT COALESCE(SUM(bl.montant), 0) AS montant, COUNT(*) AS nb
        FROM bulletin_ligne bl
        JOIN bulletin b ON b.id = bl.bulletin_id
        JOIN calendrier_paie cal ON cal.id = b.periode_id
        JOIN collaborateur_plan_paie cpp
            ON cpp.collaborateur_id = b.collaborateur_id AND cpp.plan_paie_id = cal.plan_paie_id AND cpp.archive = false
        JOIN prets p ON p.collaborateur_id = b.collaborateur_id AND p.rubrique_paie_code = bl.code_rubrique AND p.pret_interne = false
        WHERE b.periode_id = :p
    """), {"p": periode_id}).mappings().first()

    rejets = db.execute(text("""
        SELECT COUNT(*) FROM ligne_virement lv
        JOIN ordre_virement ov ON ov.id = lv.ordre_virement_id
        WHERE ov.periode_id = :p AND lv.statut_ligne = 'REJETEE'
    """), {"p": periode_id}).scalar()

    return {
        "net_a_payer": {"montant": float(net_a_payer["montant"]), "nb_collaborateurs": net_a_payer["nb"]},
        "retenues_tiers": {"montant": float(retenues["montant"]), "nb_dossiers": retenues["nb"]},
        "prets_externes": {"montant": float(prets["montant"]), "nb_echeances": prets["nb"]},
        "rejets_a_traiter": rejets or 0,
    }


@router.get("/ordres", response_model=list[OrdreVirementOut])
def get_ordres_virement(
    periode_id: str | None = None,
    banque_emettrice_id: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*ROLES_GESTION)),
    payload_utilisateur: dict = Depends(get_current_user_payload),
):
    sid = _societe_active(payload_utilisateur)
    conditions, params = ["scb.societe_id = :sid"], {"sid": sid}
    if periode_id:
        conditions.append("ov.periode_id = :periode_id")
        params["periode_id"] = periode_id
    if banque_emettrice_id:
        conditions.append("ov.banque_emettrice_id = :banque_id")
        params["banque_id"] = banque_emettrice_id
    clause_where = f"WHERE {' AND '.join(conditions)}"

    rows = db.execute(text(f"""
        SELECT ov.*, rb.libelle || ' — ' || scb.numero_compte AS banque_emettrice_libelle
        FROM ordre_virement ov
        JOIN societe_comptes_bancaires scb ON scb.id = ov.banque_emettrice_id
        JOIN ref_banque rb ON rb.code = scb.code_banque
        {clause_where}
        ORDER BY ov.created_at DESC
    """), params).mappings().all()
    return _serialiser(rows)


@router.post("/ordres/generer", response_model=list[dict])
def generer_ordre(payload: GenererOrdreIn, db: Session = Depends(get_db), utilisateur=Depends(require_roles(*ROLES_GESTION)), payload_utilisateur: dict = Depends(get_current_user_payload)):
    """Crée l'ordre (ou plusieurs, en mode VENTILE) en statut BROUILLON —
    ne produit plus le fichier SIMT ici (voir /ordres/{id}/generer-fichier,
    accessible seulement une fois l'ordre VALIDE)."""
    sid = _societe_active(payload_utilisateur)
    _banque_ou_403(db, payload.banque_emettrice_id, sid)
    _periode_ou_403(db, payload.periode_id, sid)
    try:
        return virements_service.initier_ordre_virement(
            db, payload.type, payload.periode_id, payload.mode,
            payload.date_valeur, payload_utilisateur["sub"],
            banque_emettrice_id=payload.banque_emettrice_id,
        )
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.post("/ordres/ad-hoc", response_model=dict)
def generer_ordre_ad_hoc(payload: OrdreAdHocIn, db: Session = Depends(get_db), utilisateur=Depends(require_roles(*ROLES_GESTION)), payload_utilisateur: dict = Depends(get_current_user_payload)):
    """Virement d'un montant libre pour une population de collaborateurs
    (ex. prime exceptionnelle) — sans lien avec bulletin_ligne. La sélection
    de la population (multi-picker / filtre / import Excel) est résolue côté
    frontend ; le backend ne reçoit que la liste finale collaborateur+montant."""
    sid = _societe_active(payload_utilisateur)
    _banque_ou_403(db, payload.banque_emettrice_id, sid)
    try:
        return virements_service.creer_ordre_ad_hoc(
            db, payload.banque_emettrice_id, payload.date_valeur, payload.libelle_motif,
            [l.model_dump() for l in payload.lignes], payload_utilisateur["sub"],
            societe_id=sid, plan_paie_id=payload.plan_paie_id,
        )
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.get("/ordres/{ordre_id}/lignes", response_model=list[LigneVirementOut])
def get_lignes_ordre(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                     payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    rows = db.execute(text("""
        SELECT lv.*, c.nom || ' ' || c.prenom AS collaborateur_nom
        FROM ligne_virement lv
        JOIN collaborateurs c ON c.id = lv.collaborateur_id
        WHERE lv.ordre_virement_id = :id
        ORDER BY c.nom, c.prenom
    """), {"id": ordre_id}).mappings().all()
    return _serialiser(rows)


@router.get("/ordres/{ordre_id}/fichier-simt")
def telecharger_fichier_simt(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                             payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    from fastapi.responses import FileResponse
    row = db.execute(text("SELECT fichier_genere_path, reference_lot FROM ordre_virement WHERE id = :id"), {"id": ordre_id}).mappings().first()
    if not row or not row["fichier_genere_path"]:
        raise HTTPException(404, "Fichier non généré pour cet ordre.")
    return FileResponse(row["fichier_genere_path"], filename=f"{row['reference_lot']}.txt", media_type="text/plain")


@router.patch("/ordres/{ordre_id}/transmis", response_model=dict)
def marquer_transmis(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                     payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        virements_service.marquer_transmis(db, ordre_id)
        return {"id": ordre_id, "statut": "TRANSMIS"}
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.patch("/ordres/{ordre_id}/execute", response_model=dict)
def marquer_execute(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                    payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        virements_service.marquer_execute(db, ordre_id)
        return {"id": ordre_id, "statut": "EXECUTE"}
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.patch("/ordres/{ordre_id}/rejet", response_model=dict)
def signaler_rejet(ordre_id: str, payload: SignalerRejetIn, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                   payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        virements_service.signaler_rejet(db, ordre_id, payload.lignes_rejetees)
        return {"id": ordre_id}
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.post("/ordres/{ordre_id}/regenerer", response_model=dict)
def regenerer_ordre(ordre_id: str, db: Session = Depends(get_db), utilisateur=Depends(require_roles(*ROLES_GESTION)), payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        return virements_service.regenerer_ordre_virement(db, ordre_id, payload_utilisateur["sub"])
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# Workflow de contrôle (migration 063) : BROUILLON -> ENREGISTRE ->
# EN_CONTROLE -> VALIDE -> GENERE
# ---------------------------------------------------------------------------

@router.post("/ordres/{ordre_id}/regenerer-lignes", response_model=dict)
def regenerer_lignes_brouillon(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                               payload_utilisateur: dict = Depends(get_current_user_payload)):
    """Reconstruit les lignes d'un ordre en BROUILLON à partir de la source (si des dossiers/bulletins ont changé)."""
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        return virements_service.regenerer_lignes_brouillon(db, ordre_id)
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.patch("/ordres/{ordre_id}/enregistrer", response_model=dict)
def enregistrer_ordre(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)), payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        virements_service.enregistrer_ordre(db, ordre_id, payload_utilisateur["sub"])
        return {"id": ordre_id, "statut": "ENREGISTRE"}
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.post("/ordres/{ordre_id}/controler", response_model=list[dict])
def controler_ordre(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)), payload_utilisateur: dict = Depends(get_current_user_payload)):
    """Passe l'ordre en EN_CONTROLE et exécute les 5 rapprochements
    (montant total, RIB/doublons, écart vs période précédente, nb de lignes
    attendu, compte émetteur toujours actif)."""
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        return virements_service.passer_en_controle(db, ordre_id, payload_utilisateur["sub"])
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.get("/ordres/{ordre_id}/controles", response_model=list[dict])
def get_controles_ordre(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                        payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    rows = db.execute(text("""
        SELECT type_controle, resultat, message, controle_par, controle_le
        FROM ordre_virement_controle WHERE ordre_virement_id = :id ORDER BY controle_le DESC
    """), {"id": ordre_id}).mappings().all()
    return _serialiser(rows)


@router.patch("/lignes/{ligne_id}/cocher", response_model=dict)
def cocher_ligne(ligne_id: str, valeur: bool, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)), payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ligne_ou_404(db, ligne_id, sid)
    virements_service.cocher_ligne(db, ligne_id, payload_utilisateur["sub"], valeur)
    return {"id": ligne_id, "controlee": valeur}


@router.patch("/ordres/{ordre_id}/valider", response_model=dict)
def valider_ordre(ordre_id: str, forcer_alertes: bool = False, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)), payload_utilisateur: dict = Depends(get_current_user_payload)):
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        virements_service.valider_ordre(db, ordre_id, payload_utilisateur["sub"], forcer_alertes)
        return {"id": ordre_id, "statut": "VALIDE"}
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.post("/ordres/{ordre_id}/generer-fichier", response_model=dict)
def generer_fichier_ordre(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                          payload_utilisateur: dict = Depends(get_current_user_payload)):
    """Produit le fichier SIMT ("support magnétique") — uniquement possible depuis VALIDE."""
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        return virements_service.generer_fichier_ordre(db, ordre_id)
    except VirementServiceError as e:
        raise HTTPException(400, str(e))


@router.post("/ordres/{ordre_id}/revenir-arriere", response_model=dict)
def revenir_en_arriere(ordre_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*ROLES_GESTION)),
                       payload_utilisateur: dict = Depends(get_current_user_payload)):
    """Fait régresser l'ordre d'une étape (ENREGISTRE/EN_CONTROLE/VALIDE uniquement — pas après génération du fichier)."""
    sid = _societe_active(payload_utilisateur)
    _ordre_ou_404(db, ordre_id, sid)
    try:
        virements_service.revenir_en_arriere(db, ordre_id)
        return {"id": ordre_id}
    except VirementServiceError as e:
        raise HTTPException(400, str(e))
