"""
Router FastAPI — Adresses des collaborateurs.

Endpoints scopes par collaborateur :
  GET    /api/v1/collaborateurs/{collab_id}/adresses          -> liste
  GET    /api/v1/collaborateurs/{collab_id}/adresses/{id}     -> detail
  POST   /api/v1/collaborateurs/{collab_id}/adresses          -> creation
  PATCH  /api/v1/collaborateurs/{collab_id}/adresses/{id}     -> mise a jour
  DELETE /api/v1/collaborateurs/{collab_id}/adresses/{id}     -> archivage (soft)
                                                              -> suppression def. avec ?hard=true

Regles metier :
  - Au moins une adresse "principale" non archivee doit exister par collab.
  - On ne peut pas decocher / archiver la derniere adresse principale.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_
from sqlalchemy.orm import Session, aliased

from app.core.database import get_db
from app.core.security import require_roles
from app.models.collaborateur_adresse import CollaborateurAdresse
from app.models.referentiels_adresse import RefPays, RefRegion, RefVille
from app.schemas.collaborateur_adresse import (
    CollaborateurAdresseCreate,
    CollaborateurAdresseRead,
    CollaborateurAdresseUpdate,
)

COLLAB_ROLES = ("administrateur", "gestionnaire_rh", "manager")
EDIT_ROLES = ("administrateur", "gestionnaire_rh")

router = APIRouter(
    prefix="/collaborateurs/{collaborateur_id}/adresses",
    tags=["Collaborateurs · Adresses"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _enrich(db: Session, adresse: CollaborateurAdresse) -> CollaborateurAdresseRead:
    """Convertit un CollaborateurAdresse SQLAlchemy en schema Read avec libelles."""
    out = CollaborateurAdresseRead.model_validate(adresse)
    if adresse.code_pays:
        p = db.get(RefPays, adresse.code_pays)
        out.libelle_pays = p.libelle if p else None
    if adresse.code_region:
        r = db.get(RefRegion, adresse.code_region)
        out.libelle_region = r.libelle if r else None
    if adresse.code_ville:
        v = db.get(RefVille, adresse.code_ville)
        out.libelle_ville = v.libelle if v else None
    return out


def _get_or_404(db: Session, collab_id: UUID, adresse_id: UUID) -> CollaborateurAdresse:
    obj = (
        db.query(CollaborateurAdresse)
        .filter(
            CollaborateurAdresse.id == adresse_id,
            CollaborateurAdresse.collaborateur_id == collab_id,
        )
        .first()
    )
    if obj is None:
        raise HTTPException(404, detail="Adresse introuvable pour ce collaborateur")
    return obj


def _count_active_principales(db: Session, collab_id: UUID, exclude_id: UUID | None = None) -> int:
    q = db.query(CollaborateurAdresse).filter(
        CollaborateurAdresse.collaborateur_id == collab_id,
        CollaborateurAdresse.is_adresse_principale.is_(True),
        CollaborateurAdresse.archive.is_(False),
    )
    if exclude_id is not None:
        q = q.filter(CollaborateurAdresse.id != exclude_id)
    return q.count()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("", response_model=list[CollaborateurAdresseRead])
def list_adresses(
    collaborateur_id: UUID,
    archive: bool | None = Query(False, description="Par defaut : non archivees"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*COLLAB_ROLES)),
):
    q = db.query(CollaborateurAdresse).filter(
        CollaborateurAdresse.collaborateur_id == collaborateur_id
    )
    if archive is not None:
        q = q.filter(CollaborateurAdresse.archive == archive)

    rows = q.order_by(
        CollaborateurAdresse.is_adresse_principale.desc(),
        CollaborateurAdresse.created_at.asc(),
    ).all()
    return [_enrich(db, r) for r in rows]


@router.get("/{adresse_id}", response_model=CollaborateurAdresseRead)
def get_adresse(
    collaborateur_id: UUID,
    adresse_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*COLLAB_ROLES)),
):
    obj = _get_or_404(db, collaborateur_id, adresse_id)
    return _enrich(db, obj)


@router.post(
    "",
    response_model=CollaborateurAdresseRead,
    status_code=status.HTTP_201_CREATED,
)
def create_adresse(
    collaborateur_id: UUID,
    payload: CollaborateurAdresseCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*EDIT_ROLES)),
):
    obj = CollaborateurAdresse(
        collaborateur_id=collaborateur_id,
        **payload.model_dump(),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _enrich(db, obj)


@router.patch("/{adresse_id}", response_model=CollaborateurAdresseRead)
def update_adresse(
    collaborateur_id: UUID,
    adresse_id: UUID,
    payload: CollaborateurAdresseUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*EDIT_ROLES)),
):
    obj = _get_or_404(db, collaborateur_id, adresse_id)

    data = payload.model_dump(exclude_unset=True)

    # Garde-fou : on ne peut pas decocher la derniere principale active
    becoming_non_principale = (
        "is_adresse_principale" in data
        and data["is_adresse_principale"] is False
        and obj.is_adresse_principale is True
    )
    becoming_archived = (
        "archive" in data and data["archive"] is True and obj.archive is False
        and obj.is_adresse_principale is True
    )
    if becoming_non_principale or becoming_archived:
        if _count_active_principales(db, collaborateur_id, exclude_id=adresse_id) == 0:
            raise HTTPException(
                400,
                detail=(
                    "Impossible : cette adresse est l'unique adresse principale active. "
                    "Marquez d'abord une autre adresse comme principale."
                ),
            )

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return _enrich(db, obj)


@router.delete("/{adresse_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_adresse(
    collaborateur_id: UUID,
    adresse_id: UUID,
    hard: bool = Query(False, description="Si true, suppression definitive"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*EDIT_ROLES)),
):
    obj = _get_or_404(db, collaborateur_id, adresse_id)

    # Garde-fou : pas de suppression de la derniere principale
    if obj.is_adresse_principale and not obj.archive:
        if _count_active_principales(db, collaborateur_id, exclude_id=adresse_id) == 0:
            raise HTTPException(
                400,
                detail=(
                    "Impossible : cette adresse est l'unique adresse principale active. "
                    "Marquez d'abord une autre adresse comme principale."
                ),
            )

    if hard:
        db.delete(obj)
    else:
        obj.archive = True
    db.commit()
