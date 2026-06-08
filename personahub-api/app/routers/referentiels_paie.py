"""
Router FastAPI — Référentiels paie.

Endpoints (5 référentiels × 5 verbes) générés via factory :

  GET    /api/v1/paie/referentiels/{ref}/        -> liste (filtre actif=)
  GET    /api/v1/paie/referentiels/{ref}/{id}    -> détail
  POST   /api/v1/paie/referentiels/{ref}/        -> création
  PATCH  /api/v1/paie/referentiels/{ref}/{id}    -> mise à jour partielle
  DELETE /api/v1/paie/referentiels/{ref}/{id}    -> suppression (soft = actif=false par défaut)

Avec {ref} ∈ {familles, types, flux, frequences, zones-fixes}.

Sécurité : aligné sur le module paie — seuls les rôles
  administrateur / gestionnaire_rh / gestionnaire_paie
peuvent gérer les référentiels.
"""
from typing import Type
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.models.referentiels_paie import REFERENTIEL_MODELS
from app.schemas.referentiels_paie import (
    ReferentielCreate,
    ReferentielRead,
    ReferentielUpdate,
)

PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")

router = APIRouter(
    prefix="/referentiels",
    tags=["Paie · Référentiels"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _get_model(ref: str) -> Type:
    """Résout le slug d'URL vers la classe SQLAlchemy correspondante."""
    model = REFERENTIEL_MODELS.get(ref)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Référentiel '{ref}' inconnu. "
                f"Valeurs valides : {sorted(REFERENTIEL_MODELS.keys())}"
            ),
        )
    return model


def _get_or_404(db: Session, model: Type, item_id: UUID):
    obj = db.get(model, item_id)
    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Élément introuvable",
        )
    return obj


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/{ref}", response_model=list[ReferentielRead])
def list_items(
    ref: str,
    actif: bool | None = Query(None, description="Filtre actif=true/false"),
    search: str | None = Query(None, description="Recherche dans code/libellé"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Liste tous les éléments d'un référentiel, triés par ordre puis libellé."""
    model = _get_model(ref)
    query = db.query(model)

    if actif is not None:
        query = query.filter(model.actif == actif)

    if search:
        like = f"%{search}%"
        query = query.filter(
            (model.code.ilike(like)) | (model.libelle.ilike(like))
        )

    return query.order_by(model.ordre.asc(), model.libelle.asc()).all()


@router.get("/{ref}/{item_id}", response_model=ReferentielRead)
def get_item(
    ref: str,
    item_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    model = _get_model(ref)
    return _get_or_404(db, model, item_id)


@router.post(
    "/{ref}",
    response_model=ReferentielRead,
    status_code=status.HTTP_201_CREATED,
)
def create_item(
    ref: str,
    payload: ReferentielCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    model = _get_model(ref)
    obj = model(**payload.model_dump())
    db.add(obj)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Le code '{payload.code}' existe déjà dans ce référentiel.",
        )
    db.refresh(obj)
    return obj


@router.patch("/{ref}/{item_id}", response_model=ReferentielRead)
def update_item(
    ref: str,
    item_id: UUID,
    payload: ReferentielUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    model = _get_model(ref)
    obj = _get_or_404(db, model, item_id)

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(obj, k, v)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflit d'unicité (code déjà utilisé).",
        )
    db.refresh(obj)
    return obj


@router.delete("/{ref}/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    ref: str,
    item_id: UUID,
    hard: bool = Query(False, description="Si true, suppression définitive"),
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    """
    Suppression :
      - par défaut (`hard=false`) : soft delete via `actif=false`
      - `hard=true` : suppression définitive en base

    Le soft delete est recommandé : un référentiel peut être référencé
    par des rubriques de paie, supprimer en dur casserait l'historique.

    Restreint aux administrateurs et gestionnaires paie (rôle RH exclu),
    cohérent avec la suppression de rubrique.
    """
    model = _get_model(ref)
    obj = _get_or_404(db, model, item_id)

    if hard:
        try:
            db.delete(obj)
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Impossible de supprimer : cet élément est référencé "
                    "par une rubrique. Désactivez-le (soft delete) à la place."
                ),
            )
    else:
        obj.actif = False
        db.commit()
