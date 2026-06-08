"""
app/routers/cotisations.py — Endpoints REST pour les cotisations
Auteur : Adil DAIA

Ce sous-router est inclus dans paie.py. Il expose :

  Régimes :
    GET    /paie/cotisation/regimes              → liste
    POST   /paie/cotisation/regimes              → créer
    PATCH  /paie/cotisation/regimes/{code}       → modifier
    DELETE /paie/cotisation/regimes/{code}       → désactiver

  Règles de cotisation (avec composantes) :
    GET    /paie/cotisation/regles               → liste avec composantes
    GET    /paie/cotisation/regles/{id}          → détail
    POST   /paie/cotisation/regles               → créer (entête + composantes)
    PATCH  /paie/cotisation/regles/{id}          → modifier (PATCH partiel)
    DELETE /paie/cotisation/regles/{id}          → archiver

  Affectation collaborateur ↔ régime :
    GET    /paie/cotisation/collaborateurs/{id}/regimes
    POST   /paie/cotisation/collaborateurs/{id}/regimes
    DELETE /paie/cotisation/collaborateurs/{id}/regimes/{code_regime}

  Calcul (moteur) :
    POST   /paie/cotisation/calcul → { collaborateur_id, code_regle, periode_mois, assiette_montant }
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from uuid import UUID
from typing import List

from app.core.database import get_db
from app.core.security import require_roles
from app.models.cotisation import (
    RefRegimeCotisation,
    RegleCalculCotisation,
    RegleCalculCotisationComposante,
    CollaborateurRegime,
)
from app.schemas.cotisation import (
    RefRegimeCotisationRead, RefRegimeCotisationWrite,
    RegleCotisationRead, RegleCotisationWrite, RegleCotisationUpdate,
    CollaborateurRegimeRead, CollaborateurRegimeWrite,
    CotisationCalculRequest, CotisationCalculResult,
)
from app.services.cotisation_engine import calculer_cotisation


router = APIRouter(prefix="/cotisation", tags=["Cotisations"])

PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


# ═════════════════════════════════════════════════════════════════════════════
# Régimes de cotisation
# ═════════════════════════════════════════════════════════════════════════════
@router.get("/regimes", response_model=List[RefRegimeCotisationRead])
def list_regimes(db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    return (
        db.query(RefRegimeCotisation)
        .order_by(RefRegimeCotisation.ordre, RefRegimeCotisation.code)
        .all()
    )


@router.post("/regimes", response_model=RefRegimeCotisationRead, status_code=201)
def create_regime(
    data: RefRegimeCotisationWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    if db.query(RefRegimeCotisation).filter(RefRegimeCotisation.code == data.code).first():
        raise HTTPException(400, f"Le régime '{data.code}' existe déjà")
    r = RefRegimeCotisation(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.patch("/regimes/{code}", response_model=RefRegimeCotisationRead)
def update_regime(
    code: str,
    data: RefRegimeCotisationWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    r = db.query(RefRegimeCotisation).filter(RefRegimeCotisation.code == code).first()
    if not r:
        raise HTTPException(404, "Régime introuvable")
    for field, value in data.model_dump(exclude_unset=True, exclude={"code"}).items():
        setattr(r, field, value)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/regimes/{code}", status_code=204)
def delete_regime(
    code: str,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    r = db.query(RefRegimeCotisation).filter(RefRegimeCotisation.code == code).first()
    if not r:
        raise HTTPException(404, "Régime introuvable")
    r.actif = False
    db.commit()


# ═════════════════════════════════════════════════════════════════════════════
# Règles de cotisation (entête + composantes)
# ═════════════════════════════════════════════════════════════════════════════
@router.get("/regles", response_model=List[RegleCotisationRead])
def list_regles(db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    """Liste des règles de cotisation avec leurs composantes (eager-loaded)."""
    return (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(RegleCalculCotisation.archive == False)  # noqa: E712
        .order_by(RegleCalculCotisation.code)
        .all()
    )


@router.get("/regles/{regle_id}", response_model=RegleCotisationRead)
def get_regle(
    regle_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    regle = (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(RegleCalculCotisation.id == regle_id)
        .first()
    )
    if not regle:
        raise HTTPException(404, "Règle introuvable")
    return regle


@router.post("/regles", response_model=RegleCotisationRead, status_code=201)
def create_regle(
    data: RegleCotisationWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    if db.query(RegleCalculCotisation).filter(RegleCalculCotisation.code == data.code).first():
        raise HTTPException(400, f"Le code règle '{data.code}' existe déjà")

    payload = data.model_dump(exclude={"composantes"})
    regle = RegleCalculCotisation(**payload)

    for compo_data in data.composantes:
        regle.composantes.append(
            RegleCalculCotisationComposante(**compo_data.model_dump())
        )

    db.add(regle)
    db.commit()
    db.refresh(regle)
    return regle


@router.patch("/regles/{regle_id}", response_model=RegleCotisationRead)
def update_regle(
    regle_id: UUID,
    data: RegleCotisationUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    PATCH partiel : seuls les champs fournis sont mis à jour.
    Si `composantes` est fourni, on remplace TOUTES les composantes (delete + insert).
    """
    regle = (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(RegleCalculCotisation.id == regle_id)
        .first()
    )
    if not regle:
        raise HTTPException(404, "Règle introuvable")

    update_data = data.model_dump(exclude_unset=True)
    composantes = update_data.pop("composantes", None)

    for field, value in update_data.items():
        setattr(regle, field, value)

    if composantes is not None:
        # Reset des composantes (cascade delete-orphan via la relation)
        regle.composantes.clear()
        db.flush()
        for c in composantes:
            regle.composantes.append(RegleCalculCotisationComposante(**c))

    db.commit()
    db.refresh(regle)
    return regle


@router.delete("/regles/{regle_id}", status_code=204)
def archive_regle(
    regle_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    regle = db.query(RegleCalculCotisation).filter(RegleCalculCotisation.id == regle_id).first()
    if not regle:
        raise HTTPException(404, "Règle introuvable")
    regle.archive = True
    regle.actif = False
    db.commit()


# ═════════════════════════════════════════════════════════════════════════════
# Affectation collaborateur ↔ régime (immatriculations)
# ═════════════════════════════════════════════════════════════════════════════
@router.get("/collaborateurs/{collaborateur_id}/regimes", response_model=List[CollaborateurRegimeRead])
def list_collab_regimes(
    collaborateur_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    return (
        db.query(CollaborateurRegime)
        .filter(CollaborateurRegime.collaborateur_id == collaborateur_id)
        .all()
    )


@router.post(
    "/collaborateurs/{collaborateur_id}/regimes",
    response_model=CollaborateurRegimeRead,
    status_code=201,
)
def affect_regime(
    collaborateur_id: UUID,
    data: CollaborateurRegimeWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    # Vérifier l'unicité
    existing = (
        db.query(CollaborateurRegime)
        .filter(
            CollaborateurRegime.collaborateur_id == collaborateur_id,
            CollaborateurRegime.code_regime == data.code_regime,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            400,
            f"Le collaborateur est déjà affecté au régime '{data.code_regime}'",
        )

    cr = CollaborateurRegime(
        collaborateur_id=collaborateur_id,
        **data.model_dump(),
    )
    db.add(cr)
    db.commit()
    db.refresh(cr)
    return cr


@router.delete(
    "/collaborateurs/{collaborateur_id}/regimes/{code_regime}",
    status_code=204,
)
def remove_collab_regime(
    collaborateur_id: UUID,
    code_regime: str,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    cr = (
        db.query(CollaborateurRegime)
        .filter(
            CollaborateurRegime.collaborateur_id == collaborateur_id,
            CollaborateurRegime.code_regime == code_regime,
        )
        .first()
    )
    if not cr:
        raise HTTPException(404, "Affectation introuvable")
    db.delete(cr)
    db.commit()


# ═════════════════════════════════════════════════════════════════════════════
# MOTEUR DE CALCUL
# ═════════════════════════════════════════════════════════════════════════════
@router.post("/calcul", response_model=CotisationCalculResult)
def calculer(
    req: CotisationCalculRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Calcule une cotisation pour un collaborateur sur une période donnée.

    Le moteur :
      1. Vérifie l'affectation du collaborateur au régime
      2. Applique les options sur l'assiette (négative, prorata)
      3. Calcule chaque composante (taux × base plafonnée)
      4. Applique les min/max
      5. Renvoie le détail composante par composante
    """
    return calculer_cotisation(db, req)
