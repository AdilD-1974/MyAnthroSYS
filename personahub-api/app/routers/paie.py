"""
app/routers/paie.py — Module Paie & Rémunération
Auteur : Adil DAIA

Sous-routers inclus :
  - /paie/baremes/...      (paramétrage des barèmes)
  - /paie/cotisation/...   (régimes, règles, composantes, calcul)  ← AJOUT 06/05/2026
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from uuid import UUID
from app.core.database import get_db
from app.core.security import require_roles
# ⚠️ Retrait des imports Bareme/BaremeLigne — ils sont remplacés par app.models.bareme
from app.models.paie import Rubrique, Cotisation, SalaireFixe
from app.routers import baremes as baremes_router
from app.routers import cotisations as cotisations_router  # ← AJOUT (RG-COTIS-COMPO-01)
from app.routers import paie_calcul as paie_calcul_router      # ← AJOUT (moteur de calcul)
from app.routers import controles_paie as controles_paie_router  # ← AJOUT (contrôles de validation)
from app.routers import rapports_paie as rapports_paie_router  # ← AJOUT (module Rapports, Phase 1 : Journal)
from app.routers import compta_paie as compta_paie_router      # ← AJOUT (comptabilisation de la paie)
from app.models import paie_resultat  # noqa: F401  (enregistrement ORM des tables résultat)
from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional

router = APIRouter(prefix="/paie", tags=["Paie & Rémunération"])

# ── Sous-routers ──────────────────────────────────────────────────────────────
router.include_router(baremes_router.router)         # → /api/v1/paie/baremes/...
router.include_router(cotisations_router.router)     # → /api/v1/paie/cotisation/...  ← AJOUT
router.include_router(paie_calcul_router.router)     # → /api/v1/paie/calcul, /paie/bulletins  ← AJOUT
router.include_router(controles_paie_router.router) # → /api/v1/paie/controles  ← AJOUT
router.include_router(rapports_paie_router.router)  # → /api/v1/paie/rapports/...  ← AJOUT
router.include_router(compta_paie_router.router)    # → /api/v1/paie/compta/...    ← AJOUT

PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


# ── Schémas inline (pour concision — à déplacer dans schemas/paie.py si nécessaire) ──

class RubriqueRead(BaseModel):
    id: UUID
    code: str
    libelle: str
    type_rubrique: Optional[str]
    nature: Optional[str]
    actif: bool
    model_config = {"from_attributes": True}


class RubriqueCreate(BaseModel):
    code: str
    libelle: str
    type_rubrique: Optional[str] = None
    nature: Optional[str] = None
    actif: bool = True


# ⚠️ DÉPRÉCIÉ — le modèle Cotisation v1 (simple, mono-tranche) est conservé
# pour rétrocompatibilité. Les NOUVEAUX endpoints multi-composantes sont dans
# app/routers/cotisations.py (préfixe /paie/cotisation/...).
class CotisationRead(BaseModel):
    id: UUID
    code: str
    libelle: str
    taux_salarial: Optional[float]
    taux_patronal: Optional[float]
    plafond: Optional[float]
    actif: bool
    model_config = {"from_attributes": True}


class CotisationCreate(BaseModel):
    code: str
    libelle: str
    taux_salarial: Optional[float] = None
    taux_patronal: Optional[float] = None
    plafond: Optional[float] = None
    actif: bool = True


class SalaireFixeCreate(BaseModel):
    collaborateur_id: UUID
    rubrique_id: UUID
    montant: float
    date_debut: date
    date_fin: Optional[date] = None


class SalaireFixeRead(SalaireFixeCreate):
    id: UUID
    actif: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Rubriques ─────────────────────────────────────────────────────────────────

@router.get("/rubriques", response_model=list[RubriqueRead])
def list_rubriques(db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    return db.query(Rubrique).filter(Rubrique.archive == False).all()


@router.post("/rubriques", response_model=RubriqueRead, status_code=201)
def create_rubrique(data: RubriqueCreate, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    if db.query(Rubrique).filter(Rubrique.code == data.code).first():
        raise HTTPException(400, detail=f"Le code rubrique '{data.code}' existe déjà")
    r = Rubrique(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/rubriques/{rubrique_id}", status_code=204)
def delete_rubrique(rubrique_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    r = db.query(Rubrique).filter(Rubrique.id == rubrique_id).first()
    if not r:
        raise HTTPException(404, detail="Rubrique introuvable")
    r.archive = True
    db.commit()


# ── Cotisations (v1 simple — DÉPRÉCIÉ, voir /paie/cotisation/* pour la v2) ───

@router.get("/cotisations", response_model=list[CotisationRead], deprecated=True)
def list_cotisations(db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    """⚠️ DÉPRÉCIÉ — utiliser GET /paie/cotisation/regles à la place."""
    return db.query(Cotisation).filter(Cotisation.actif == True).all()


@router.post("/cotisations", response_model=CotisationRead, status_code=201, deprecated=True)
def create_cotisation(data: CotisationCreate, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    """⚠️ DÉPRÉCIÉ — utiliser POST /paie/cotisation/regles à la place."""
    if db.query(Cotisation).filter(Cotisation.code == data.code).first():
        raise HTTPException(400, detail=f"Le code cotisation '{data.code}' existe déjà")
    c = Cotisation(**data.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.patch("/cotisations/{cot_id}", response_model=CotisationRead, deprecated=True)
def update_cotisation(
    cot_id: UUID,
    data: CotisationCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """⚠️ DÉPRÉCIÉ — utiliser PATCH /paie/cotisation/regles/{id} à la place."""
    c = db.query(Cotisation).filter(Cotisation.id == cot_id).first()
    if not c:
        raise HTTPException(404, detail="Cotisation introuvable")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    return c


# ── Salaires fixes ────────────────────────────────────────────────────────────

@router.get("/salaires-fixes", response_model=list[SalaireFixeRead])
def list_salaires_fixes(
    collaborateur_id: UUID = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    q = db.query(SalaireFixe).filter(SalaireFixe.actif == True)
    if collaborateur_id:
        q = q.filter(SalaireFixe.collaborateur_id == collaborateur_id)
    return q.all()


@router.post("/salaires-fixes", response_model=SalaireFixeRead, status_code=201)
def create_salaire_fixe(
    data: SalaireFixeCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    sf = SalaireFixe(**data.model_dump())
    db.add(sf)
    db.commit()
    db.refresh(sf)
    return sf


@router.delete("/salaires-fixes/{sf_id}", status_code=204)
def delete_salaire_fixe(sf_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    sf = db.query(SalaireFixe).filter(SalaireFixe.id == sf_id).first()
    if not sf:
        raise HTTPException(404, detail="Salaire fixe introuvable")
    sf.actif = False
    db.commit()
