"""
app/routers/controles_paie.py — Administration du référentiel des contrôles
de validation de la paie.
Auteur : Adil DAIA

Monté sous /paie :
    GET   /paie/controles                 liste (filtre catégorie/actif)
    GET   /paie/controles/{code}          détail
    PATCH /paie/controles/{code}          régler niveau / valeur_parametre / actif
    POST  /paie/controles/{code}/reset    remettre le niveau par défaut
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.models.paie_resultat import RefControlePaie
from app.schemas.controle_paie import ControlePaieRead, ControlePaieUpdate

router = APIRouter(tags=["Paie — Contrôles de validation"])

ADMIN_ROLES = ("administrateur", "gestionnaire_paie")
NIVEAUX = {"BLOQUANT", "ALERTE", "INACTIF"}


@router.get("/controles", response_model=list[ControlePaieRead])
def lister_controles(
    categorie: str | None = Query(None),
    actif: bool | None = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh", "gestionnaire_paie")),
):
    q = db.query(RefControlePaie)
    if categorie:
        q = q.filter(RefControlePaie.categorie == categorie)
    if actif is not None:
        q = q.filter(RefControlePaie.actif == actif)
    return q.order_by(RefControlePaie.ordre).all()


@router.get("/controles/{code}", response_model=ControlePaieRead)
def lire_controle(code: str, db: Session = Depends(get_db),
                  _=Depends(require_roles("administrateur", "gestionnaire_rh", "gestionnaire_paie"))):
    ctrl = db.get(RefControlePaie, code)
    if not ctrl:
        raise HTTPException(404, "Contrôle introuvable")
    return ctrl


@router.patch("/controles/{code}", response_model=ControlePaieRead)
def maj_controle(code: str, payload: ControlePaieUpdate,
                 db: Session = Depends(get_db),
                 _=Depends(require_roles(*ADMIN_ROLES))):
    ctrl = db.get(RefControlePaie, code)
    if not ctrl:
        raise HTTPException(404, "Contrôle introuvable")
    if payload.niveau is not None:
        if payload.niveau not in NIVEAUX:
            raise HTTPException(400, f"Niveau invalide : {payload.niveau}")
        ctrl.niveau = payload.niveau
    if payload.valeur_parametre is not None:
        if not ctrl.parametrable:
            raise HTTPException(400, "Ce contrôle n'est pas paramétrable")
        ctrl.valeur_parametre = payload.valeur_parametre
    if payload.actif is not None:
        ctrl.actif = payload.actif
    db.commit()
    db.refresh(ctrl)
    return ctrl


@router.post("/controles/{code}/reset", response_model=ControlePaieRead)
def reset_controle(code: str, db: Session = Depends(get_db),
                   _=Depends(require_roles(*ADMIN_ROLES))):
    ctrl = db.get(RefControlePaie, code)
    if not ctrl:
        raise HTTPException(404, "Contrôle introuvable")
    ctrl.niveau = ctrl.niveau_defaut
    db.commit()
    db.refresh(ctrl)
    return ctrl
