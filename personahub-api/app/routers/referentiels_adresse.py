"""
Router FastAPI — Referentiels d'adresse (lecture seule).

Endpoints :
  GET /api/v1/referentiels/pays                 -> liste des pays actifs
  GET /api/v1/referentiels/regions              -> liste des regions (filtre code_pays)
  GET /api/v1/referentiels/villes               -> liste des villes (filtre code_region)

Notes :
  - Volume faible (~250 pays, ~quelques regions/villes) -> pas de pagination.
  - Frontend doit cacher les listes (5 minutes par exemple).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.models.referentiels_adresse import RefPays, RefRegion, RefVille
from app.schemas.referentiels_adresse import RefPaysRead, RefRegionRead, RefVilleRead

# Tout collaborateur authentifie peut lire les referentiels d'adresse
ALL_ROLES = (
    "administrateur", "gestionnaire_rh", "gestionnaire_paie",
    "manager", "collaborateur",
)

router = APIRouter(prefix="/referentiels", tags=["Referentiels · Adresse"])


@router.get("/pays", response_model=list[RefPaysRead])
def list_pays(
    actif: bool | None = Query(True, description="Filtre actif (defaut : True)"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*ALL_ROLES)),
):
    q = db.query(RefPays)
    if actif is not None:
        q = q.filter(RefPays.actif == actif)
    return q.order_by(RefPays.libelle.asc()).all()


@router.get("/regions", response_model=list[RefRegionRead])
def list_regions(
    code_pays: str | None = Query(None, description="Filtrer par pays"),
    actif: bool | None = Query(True),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*ALL_ROLES)),
):
    q = db.query(RefRegion)
    if code_pays:
        q = q.filter(RefRegion.code_pays == code_pays)
    if actif is not None:
        q = q.filter(RefRegion.actif == actif)
    return q.order_by(RefRegion.libelle.asc()).all()


@router.get("/villes", response_model=list[RefVilleRead])
def list_villes(
    code_region: str | None = Query(None, description="Filtrer par region"),
    code_pays: str | None = Query(None, description="Filtrer par pays (via region)"),
    search: str | None = Query(None, description="Recherche par libelle ou code postal"),
    actif: bool | None = Query(True),
    limit: int = Query(50, le=500, description="Limite le nombre de resultats"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*ALL_ROLES)),
):
    q = db.query(RefVille, RefRegion, RefPays).outerjoin(
        RefRegion, RefRegion.code == RefVille.code_region,
    ).outerjoin(
        RefPays, RefPays.code == RefRegion.code_pays,
    )

    if actif is not None:
        q = q.filter(RefVille.actif == actif)
    if code_region:
        q = q.filter(RefVille.code_region == code_region)
    if code_pays:
        q = q.filter(RefRegion.code_pays == code_pays)
    if search:
        like = f"%{search}%"
        q = q.filter((RefVille.libelle.ilike(like)) | (RefVille.code_postal.ilike(like)))

    rows = q.order_by(RefVille.libelle.asc()).limit(limit).all()

    out: list[RefVilleRead] = []
    for ville, region, pays in rows:
        item = RefVilleRead.model_validate(ville)
        if region:
            item.code_pays = region.code_pays
            item.libelle_region = region.libelle
        if pays:
            item.libelle_pays = pays.libelle
        out.append(item)
    return out
