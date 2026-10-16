"""
conges_droits.py — Endpoints FastAPI pour les barèmes et le moteur de droits.

Auteur  : Adil DAIA
Fichier : app/routers/conges_droits.py

À enregistrer dans main.py :
    from app.routers.conges_droits import router as conges_droits_router
    app.include_router(conges_droits_router, prefix="/api/v1")
"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload
from app.services.droits_conge import (
    recalculer_droits_collaborateur,
    simuler_droit,
    ResultatDroitConge,
)

router = APIRouter(prefix="/conges", tags=["Droits & Barèmes Congés"])

# RG-MULTISOCIETE-08 (migration 057) : bareme_droit_conge et ses tranches
# restent un référentiel GLOBAL non touché ici (comme bareme_droit_conge
# n'a pas de societe_id dans les fichiers fournis, pas de RG-03 appliqué --
# à revoir si Adil veut un jour des barèmes de congés par société, sur le
# même modèle que les barèmes de paie). Seuls les deux endpoints ci-dessous
# qui opèrent sur un id_collaborateur précis sont bornés à la société active
# (catégorie A via collaborateur_contrats).

def _collaborateur_ou_403(db: Session, id_collaborateur: str, societe_id: str) -> None:
    ok = db.execute(text("""
        SELECT 1 FROM collaborateur_contrats
         WHERE collaborateur_id = :cid AND societe_id = :sid AND archive = false
    """), {"cid": id_collaborateur, "sid": societe_id}).first()
    if not ok:
        raise HTTPException(403, detail="Collaborateur non accessible pour cette société.")


# ─────────────────────────────────────────────────────────────────────────────
# Schémas Pydantic
# ─────────────────────────────────────────────────────────────────────────────

class TrancheIn(BaseModel):
    anciennete_min_mois: Optional[int] = None
    anciennete_max_mois: Optional[int] = None
    categorie_pro:  Optional[str] = None
    type_contrat:   Optional[str] = None
    temps_travail_min_pct: Optional[float] = None
    temps_travail_max_pct: Optional[float] = None
    valeur_jours:   float = Field(..., ge=0)
    valeur_heures:  Optional[float] = None
    ordre:          int = 0


class BaremeIn(BaseModel):
    code:                str   = Field(..., min_length=1, max_length=30)
    libelle:             str   = Field(..., min_length=1)
    description:         Optional[str] = None
    critere_principal:   str   = Field(...)
    critere_secondaire:  Optional[str] = None
    actif:               bool  = True
    ordre:               Optional[int] = 0
    tranches:            List[TrancheIn] = []


class SimulationIn(BaseModel):
    code_bareme:        str
    anciennete_mois:    int   = Field(..., ge=0)
    categorie_pro:      str   = ""
    type_contrat:       str   = "CDI"
    taux_temps_travail: float = Field(1.0, ge=0.1, le=1.0)
    arrondi:            str   = "SUPERIEUR"


class RecalculIn(BaseModel):
    type_evenement: str = "MANUEL"


# ─────────────────────────────────────────────────────────────────────────────
# Barèmes — CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/baremes")
def list_baremes(
    actif: Optional[bool] = None,
    avec_tranches: bool = Query(False, alias="avec_tranches"),
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user_payload),
):
    """Liste tous les barèmes, avec ou sans leurs tranches."""
    where = "WHERE actif = :actif" if actif is not None else ""
    rows = db.execute(
        text(f"SELECT * FROM bareme_droit_conge {where} ORDER BY ordre, code"),
        {"actif": actif} if actif is not None else {},
    ).fetchall()
    baremes = [dict(r._mapping) for r in rows]

    if avec_tranches:
        codes = [b["code"] for b in baremes]
        if codes:
            tranches = db.execute(text("""
                SELECT * FROM bareme_droit_conge_tranche
                WHERE code_bareme = ANY(:codes)
                ORDER BY code_bareme, ordre
            """), {"codes": codes}).fetchall()
            tranches_par_code: dict[str, list] = {}
            for t in tranches:
                td = dict(t._mapping)
                tranches_par_code.setdefault(td["code_bareme"], []).append(td)
            for b in baremes:
                b["tranches"] = tranches_par_code.get(b["code"], [])

    return baremes


@router.get("/baremes/{code}")
def get_bareme(
    code: str,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user_payload),
):
    """Retourne un barème avec toutes ses tranches."""
    bareme = db.execute(
        text("SELECT * FROM bareme_droit_conge WHERE code = :code"),
        {"code": code},
    ).fetchone()
    if not bareme:
        raise HTTPException(404, detail=f"Barème '{code}' introuvable")

    result = dict(bareme._mapping)
    tranches = db.execute(text("""
        SELECT * FROM bareme_droit_conge_tranche
        WHERE code_bareme = :code ORDER BY ordre
    """), {"code": code}).fetchall()
    result["tranches"] = [dict(t._mapping) for t in tranches]
    return result


@router.post("/baremes", status_code=201)
def create_bareme(
    body: BaremeIn,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """Crée un barème et ses tranches."""
    # Vérifier que le code n'existe pas
    exists = db.execute(
        text("SELECT 1 FROM bareme_droit_conge WHERE code = :code"),
        {"code": body.code},
    ).fetchone()
    if exists:
        raise HTTPException(409, detail=f"Un barème avec le code '{body.code}' existe déjà")

    criteres_valides = ("ANCIENNETE", "CATEGORIE_PRO", "TYPE_CONTRAT", "TEMPS_TRAVAIL")
    if body.critere_principal.upper() not in criteres_valides:
        raise HTTPException(400, detail=f"critere_principal doit être parmi {criteres_valides}")

    # Insertion en-tête
    db.execute(text("""
        INSERT INTO bareme_droit_conge
          (code, libelle, description, critere_principal, critere_secondaire, actif, ordre)
        VALUES (:code, :lib, :desc, :crit, :crit2, :actif, :ordre)
    """), {
        "code":  body.code,
        "lib":   body.libelle,
        "desc":  body.description,
        "crit":  body.critere_principal.upper(),
        "crit2": body.critere_secondaire,
        "actif": body.actif,
        "ordre": body.ordre,
    })

    # Insertion tranches
    _insert_tranches(db, body.code, body.tranches)

    db.commit()
    return get_bareme(body.code, db, payload)


@router.put("/baremes/{code}")
def update_bareme(
    code: str,
    body: BaremeIn,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """Met à jour un barème et remplace toutes ses tranches."""
    exists = db.execute(
        text("SELECT 1 FROM bareme_droit_conge WHERE code = :code"),
        {"code": code},
    ).fetchone()
    if not exists:
        raise HTTPException(404, detail=f"Barème '{code}' introuvable")

    db.execute(text("""
        UPDATE bareme_droit_conge
        SET libelle = :lib, description = :desc,
            critere_principal = :crit, critere_secondaire = :crit2,
            actif = :actif, ordre = :ordre,
            updated_at = NOW()
        WHERE code = :code
    """), {
        "code":  code,
        "lib":   body.libelle,
        "desc":  body.description,
        "crit":  body.critere_principal.upper(),
        "crit2": body.critere_secondaire,
        "actif": body.actif,
        "ordre": body.ordre,
    })

    # Remplacer les tranches
    db.execute(
        text("DELETE FROM bareme_droit_conge_tranche WHERE code_bareme = :code"),
        {"code": code},
    )
    _insert_tranches(db, code, body.tranches)

    db.commit()
    return get_bareme(code, db, payload)


@router.delete("/baremes/{code}", status_code=204)
def delete_bareme(
    code: str,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user_payload),
):
    """Supprime un barème (et ses tranches via CASCADE)."""
    # Vérifier qu'aucun type de congé n'utilise ce barème
    usage = db.execute(text("""
        SELECT code FROM ref_type_conge
        WHERE code_bareme_legal = :code
           OR code_bareme_convention = :code
           OR code_bareme_particulier = :code
        LIMIT 1
    """), {"code": code}).fetchone()
    if usage:
        raise HTTPException(
            409,
            detail=f"Le barème '{code}' est utilisé par le type de congé '{usage[0]}'. "
                   "Désassociez-le d'abord.",
        )

    db.execute(
        text("DELETE FROM bareme_droit_conge WHERE code = :code"),
        {"code": code},
    )
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Simulation
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/simuler-droit")
def simuler(
    body: SimulationIn,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user_payload),
):
    """
    Simule le calcul d'un droit selon un barème et un profil hypothétique.
    N'écrit rien en base. Utilisé par le formulaire de paramétrage.
    """
    result = simuler_droit(
        db=db,
        code_bareme=body.code_bareme,
        anciennete_mois=body.anciennete_mois,
        categorie_pro=body.categorie_pro,
        type_contrat=body.type_contrat,
        taux_temps_travail=body.taux_temps_travail,
        arrondi=body.arrondi,
    )
    if result["droit_brut"] is None:
        raise HTTPException(
            404,
            detail=f"Aucune tranche du barème '{body.code_bareme}' ne correspond au profil fourni.",
        )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Recalcul des droits
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/recalcul-droits/{id_collaborateur}")
def recalcul_droits(
    id_collaborateur: str,
    body: RecalculIn = RecalculIn(),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """
    Recalcule tous les droits de congé d'un collaborateur.
    Écrit en base (solde_conge + histo_recalcul_droits).
    Retourne le détail de chaque type de congé recalculé.
    """
    user_id = payload.get("sub")
    societe_active = payload.get("societe_active_id")
    if not societe_active:
        raise HTTPException(403, detail="Aucune société active sur ce token — reconnexion requise")
    _collaborateur_ou_403(db, id_collaborateur, societe_active)
    try:
        resultats = recalculer_droits_collaborateur(
            db=db,
            id_collaborateur=id_collaborateur,
            type_evenement=body.type_evenement,
            created_by=user_id,
        )
    except ValueError as exc:
        raise HTTPException(404, detail=str(exc))

    nb_modifies = sum(1 for r in resultats if r.modifie)
    return {
        "id_collaborateur": id_collaborateur,
        "type_evenement": body.type_evenement,
        "nb_types_recalcules": len(resultats),
        "nb_modifications": nb_modifies,
        "details": [
            {
                "code_type_conge":  r.code_type_conge,
                "libelle":          r.libelle,
                "droit_legal":      r.droit_legal,
                "droit_convention": r.droit_convention,
                "droit_particulier":r.droit_particulier,
                "droit_effectif":   r.droit_effectif,
                "ancienne_valeur":  r.ancienne_valeur,
                "modifie":          r.modifie,
                "mode_calcul":      r.mode_calcul,
            }
            for r in resultats
        ],
    }


@router.get("/histo-recalculs/{id_collaborateur}")
def histo_recalculs(
    id_collaborateur: str,
    code_type_conge: Optional[str] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """Historique des recalculs de droits pour un collaborateur."""
    societe_active = payload.get("societe_active_id")
    if not societe_active:
        raise HTTPException(403, detail="Aucune société active sur ce token — reconnexion requise")
    _collaborateur_ou_403(db, id_collaborateur, societe_active)
    where = "WHERE id_collaborateur = :collab"
    params: dict = {"collab": id_collaborateur}
    if code_type_conge:
        where += " AND code_type_conge = :code"
        params["code"] = code_type_conge

    rows = db.execute(text(f"""
        SELECT * FROM histo_recalcul_droits
        {where}
        ORDER BY created_at DESC
        LIMIT :lim
    """), {**params, "lim": limit}).fetchall()

    return [dict(r._mapping) for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# Helper interne
# ─────────────────────────────────────────────────────────────────────────────

def _insert_tranches(db: Session, code_bareme: str, tranches: List[TrancheIn]) -> None:
    for t in tranches:
        db.execute(text("""
            INSERT INTO bareme_droit_conge_tranche
              (code_bareme, anciennete_min_mois, anciennete_max_mois,
               categorie_pro, type_contrat,
               temps_travail_min_pct, temps_travail_max_pct,
               valeur_jours, valeur_heures, ordre)
            VALUES
              (:code, :anc_min, :anc_max,
               :cat, :contrat,
               :tt_min, :tt_max,
               :jours, :heures, :ordre)
        """), {
            "code":    code_bareme,
            "anc_min": t.anciennete_min_mois,
            "anc_max": t.anciennete_max_mois,
            "cat":     t.categorie_pro,
            "contrat": t.type_contrat,
            "tt_min":  t.temps_travail_min_pct,
            "tt_max":  t.temps_travail_max_pct,
            "jours":   t.valeur_jours,
            "heures":  t.valeur_heures,
            "ordre":   t.ordre,
        })
