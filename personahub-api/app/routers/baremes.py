"""
Router FastAPI — Barèmes (refonte multi-clés / multi-sorties).

Endpoints :
  GET    /api/v1/paie/baremes/              -> liste (vue allégée)
  GET    /api/v1/paie/baremes/{id}          -> détail complet (cles + sorties + lignes)
  POST   /api/v1/paie/baremes/              -> création (en-tête + cles + sorties + lignes)
  PUT    /api/v1/paie/baremes/{id}          -> remplacement atomique de tout le barème
  PATCH  /api/v1/paie/baremes/{id}/header   -> mise à jour partielle de l'en-tête
  DELETE /api/v1/paie/baremes/{id}          -> archivage (soft) ou suppression (?hard=true)

Le PUT est atomique : on remplace en bloc cles/sorties/lignes pour éviter les
incohérences pendant l'édition (équivalent du clic "Enregistrer" du form).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.security import require_roles
from app.models.bareme import Bareme, BaremeCle, BaremeLigne, BaremeSortie
from app.schemas.bareme import (
    BaremeCreate,
    BaremeHeaderUpdate,
    BaremeListItem,
    BaremeRead,
    BaremeUpdate,
)

PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")

router = APIRouter(prefix="/baremes", tags=["Paie · Barèmes"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _get_or_404(db: Session, bareme_id: UUID) -> Bareme:
    obj = (
        db.query(Bareme)
        .options(
            selectinload(Bareme.cles),
            selectinload(Bareme.sorties),
            selectinload(Bareme.lignes),
        )
        .filter(Bareme.id == bareme_id)
        .first()
    )
    if obj is None:
        raise HTTPException(status_code=404, detail="Barème introuvable")
    return obj


def _replace_children(db: Session, bareme: Bareme, payload: BaremeCreate | BaremeUpdate) -> None:
    """
    Remplace en bloc les cles/sorties/lignes du barème.
    Doit être appelé dans une transaction ouverte.
    """
    # Suppression brute des enfants existants
    db.query(BaremeLigne).filter(BaremeLigne.bareme_id == bareme.id).delete(synchronize_session=False)
    db.query(BaremeCle).filter(BaremeCle.bareme_id == bareme.id).delete(synchronize_session=False)
    db.query(BaremeSortie).filter(BaremeSortie.bareme_id == bareme.id).delete(synchronize_session=False)
    db.flush()

    # Recréation
    for i, cle in enumerate(payload.cles):
        db.add(
            BaremeCle(
                bareme_id=bareme.id,
                **cle.model_dump(exclude={"ordre"}),
                ordre=cle.ordre or i,
            )
        )
    for i, sortie in enumerate(payload.sorties):
        db.add(
            BaremeSortie(
                bareme_id=bareme.id,
                **sortie.model_dump(exclude={"ordre"}),
                ordre=sortie.ordre or i,
            )
        )
    for i, ligne in enumerate(payload.lignes):
        db.add(
            BaremeLigne(
                bareme_id=bareme.id,
                **ligne.model_dump(exclude={"ordre"}),
                ordre=ligne.ordre or i,
            )
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("", response_model=list[BaremeListItem])
def list_baremes(
    actif: bool | None = Query(None),
    archive: bool | None = Query(False, description="Par défaut : exclut les archivés"),
    search: str | None = Query(None, description="Recherche dans code/libellé"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    # Sous-requêtes pour les comptages (évite N+1)
    nb_cles_sq = (
        select(BaremeCle.bareme_id, func.count().label("n"))
        .group_by(BaremeCle.bareme_id)
        .subquery()
    )
    nb_sorties_sq = (
        select(BaremeSortie.bareme_id, func.count().label("n"))
        .group_by(BaremeSortie.bareme_id)
        .subquery()
    )
    nb_lignes_sq = (
        select(BaremeLigne.bareme_id, func.count().label("n"))
        .group_by(BaremeLigne.bareme_id)
        .subquery()
    )

    q = (
        db.query(
            Bareme,
            func.coalesce(nb_cles_sq.c.n, 0).label("nb_cles"),
            func.coalesce(nb_sorties_sq.c.n, 0).label("nb_sorties"),
            func.coalesce(nb_lignes_sq.c.n, 0).label("nb_lignes"),
        )
        .outerjoin(nb_cles_sq, nb_cles_sq.c.bareme_id == Bareme.id)
        .outerjoin(nb_sorties_sq, nb_sorties_sq.c.bareme_id == Bareme.id)
        .outerjoin(nb_lignes_sq, nb_lignes_sq.c.bareme_id == Bareme.id)
    )

    if actif is not None:
        q = q.filter(Bareme.actif == actif)
    if archive is not None:
        q = q.filter(Bareme.archive == archive)
    if search:
        like = f"%{search}%"
        q = q.filter(Bareme.code.ilike(like) | Bareme.libelle.ilike(like))

    rows = q.order_by(Bareme.code.asc()).all()

    # Construction de la réponse
    return [
        BaremeListItem(
            id=row.Bareme.id,
            code=row.Bareme.code,
            libelle=row.Bareme.libelle,
            description=row.Bareme.description,
            date_debut_validite=row.Bareme.date_debut_validite,
            date_fin_validite=row.Bareme.date_fin_validite,
            reference_decision=row.Bareme.reference_decision,
            actif=row.Bareme.actif,
            archive=row.Bareme.archive,
            nb_cles=row.nb_cles,
            nb_sorties=row.nb_sorties,
            nb_lignes=row.nb_lignes,
            updated_at=row.Bareme.updated_at,
        )
        for row in rows
    ]


@router.get("/{bareme_id}", response_model=BaremeRead)
def get_bareme(
    bareme_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    return _get_or_404(db, bareme_id)


@router.post("", response_model=BaremeRead, status_code=status.HTTP_201_CREATED)
def create_bareme(
    payload: BaremeCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    # Création de l'en-tête
    header_data = payload.model_dump(exclude={"cles", "sorties", "lignes"})
    bareme = Bareme(**header_data)
    db.add(bareme)

    try:
        db.flush()  # nécessaire pour avoir bareme.id
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail=f"Le code '{payload.code}' existe déjà.")

    # Ajout des enfants
    _replace_children(db, bareme, payload)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, detail=f"Conflit d'intégrité : {e.orig}")

    db.refresh(bareme)
    return _get_or_404(db, bareme.id)


@router.put("/{bareme_id}", response_model=BaremeRead)
def replace_bareme(
    bareme_id: UUID,
    payload: BaremeUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Remplacement atomique : en-tête + clés + sorties + lignes.
    Correspond au clic "Enregistrer" sur le formulaire complet.
    """
    bareme = _get_or_404(db, bareme_id)

    # Mise à jour de l'en-tête
    header_data = payload.model_dump(exclude={"cles", "sorties", "lignes"})
    for k, v in header_data.items():
        setattr(bareme, k, v)

    # Remplacement des enfants
    _replace_children(db, bareme, payload)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, detail=f"Conflit d'intégrité : {e.orig}")

    return _get_or_404(db, bareme.id)


@router.patch("/{bareme_id}/header", response_model=BaremeRead)
def update_bareme_header(
    bareme_id: UUID,
    payload: BaremeHeaderUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Mise à jour partielle de l'en-tête (sans toucher aux clés/sorties/lignes)."""
    bareme = _get_or_404(db, bareme_id)

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(bareme, k, v)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail="Conflit (code déjà utilisé ?).")

    return _get_or_404(db, bareme.id)


@router.delete("/{bareme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bareme(
    bareme_id: UUID,
    hard: bool = Query(False, description="Si true, suppression définitive"),
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    bareme = _get_or_404(db, bareme_id)

    if hard:
        db.delete(bareme)
    else:
        bareme.archive = True
        bareme.actif = False

    db.commit()
