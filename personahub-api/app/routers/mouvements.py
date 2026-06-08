from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel
from app.core.database import get_db
from app.core.security import require_roles, get_current_user_payload
from app.models.mouvement import Mouvement, Depart
from app.models.collaborateur import Collaborateur

router = APIRouter(tags=["Mouvements & Départs"])

RH_ROLES = ("administrateur", "gestionnaire_rh")


# ── Schémas ───────────────────────────────────────────────────────────────────

class MouvementCreate(BaseModel):
    collaborateur_id: UUID
    type_mouvement: str
    date_mouvement: date
    organisation_origine_id: Optional[UUID] = None
    organisation_destination_id: Optional[UUID] = None
    poste_origine_id: Optional[UUID] = None
    poste_destination_id: Optional[UUID] = None
    motif: Optional[str] = None


class MouvementRead(MouvementCreate):
    id: UUID
    created_at: datetime
    created_by: Optional[UUID]
    model_config = {"from_attributes": True}


class DepartCreate(BaseModel):
    collaborateur_id: UUID
    type_depart: str
    date_depart: date
    motif: Optional[str] = None
    solde_conge_restant: Optional[float] = None
    indemnite_calculee: Optional[float] = None


class DepartRead(DepartCreate):
    id: UUID
    statut: str
    created_at: datetime
    created_by: Optional[UUID]
    model_config = {"from_attributes": True}


# ── Mouvements internes ───────────────────────────────────────────────────────

@router.get("/mouvements", response_model=list[MouvementRead])
def list_mouvements(
    collaborateur_id: UUID = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*RH_ROLES, "manager")),
):
    q = db.query(Mouvement)
    if collaborateur_id:
        q = q.filter(Mouvement.collaborateur_id == collaborateur_id)
    return q.order_by(Mouvement.date_mouvement.desc()).all()


@router.post("/mouvements", response_model=MouvementRead, status_code=201)
def create_mouvement(
    data: MouvementCreate,
    db: Session = Depends(get_db),
    payload: dict = Depends(require_roles(*RH_ROLES)),
):
    """
    Enregistre un mouvement interne et met à jour l'affectation du collaborateur.
    """
    collab = db.query(Collaborateur).filter(Collaborateur.id == data.collaborateur_id).first()
    if not collab or collab.archive:
        raise HTTPException(404, detail="Collaborateur introuvable ou archivé")

    m = Mouvement(**data.model_dump(), created_by=payload.get("sub"))
    db.add(m)

    # Mettre à jour l'affectation active si une destination est précisée
    if data.organisation_destination_id or data.poste_destination_id:
        from app.models.collaborateur import Affectation
        from datetime import date as date_type
        # Clôturer l'affectation courante
        aff_active = db.query(Affectation).filter(
            Affectation.collaborateur_id == data.collaborateur_id,
            Affectation.est_active == True
        ).first()
        if aff_active:
            aff_active.est_active = False
            aff_active.date_fin = data.date_mouvement

        # Créer la nouvelle affectation
        db.add(Affectation(
            collaborateur_id=data.collaborateur_id,
            organisation_id=data.organisation_destination_id,
            poste_id=data.poste_destination_id,
            date_debut=data.date_mouvement,
            est_active=True,
        ))

    db.commit()
    db.refresh(m)
    return m


@router.get("/mouvements/{mouv_id}", response_model=MouvementRead)
def get_mouvement(mouv_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    m = db.query(Mouvement).filter(Mouvement.id == mouv_id).first()
    if not m:
        raise HTTPException(404, detail="Mouvement introuvable")
    return m


# ── Départs ───────────────────────────────────────────────────────────────────

@router.get("/departs", response_model=list[DepartRead])
def list_departs(
    statut: str = Query(""),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*RH_ROLES)),
):
    q = db.query(Depart)
    if statut:
        q = q.filter(Depart.statut == statut)
    return q.order_by(Depart.date_depart.desc()).all()


@router.post("/departs", response_model=DepartRead, status_code=201)
def create_depart(
    data: DepartCreate,
    db: Session = Depends(get_db),
    payload: dict = Depends(require_roles(*RH_ROLES)),
):
    """
    Enregistre un départ. Archive automatiquement le collaborateur à la date de départ.
    """
    collab = db.query(Collaborateur).filter(Collaborateur.id == data.collaborateur_id).first()
    if not collab or collab.archive:
        raise HTTPException(404, detail="Collaborateur introuvable ou déjà archivé")

    # Vérifier qu'il n'y a pas déjà un départ en cours
    depart_existant = db.query(Depart).filter(
        Depart.collaborateur_id == data.collaborateur_id,
        Depart.statut.in_(["en_cours", "valide"])
    ).first()
    if depart_existant:
        raise HTTPException(409, detail="Un départ est déjà en cours pour ce collaborateur")

    d = Depart(**data.model_dump(), created_by=payload.get("sub"))
    db.add(d)

    # Archiver le collaborateur
    collab.archive = True
    collab.statut_collaborateur = "inactif"

    db.commit()
    db.refresh(d)
    return d


@router.patch("/departs/{depart_id}/statut", response_model=DepartRead)
def update_depart_statut(
    depart_id: UUID,
    statut: str,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur")),
):
    """Change le statut d'un départ (valide / annule)."""
    if statut not in ("valide", "annule"):
        raise HTTPException(400, detail="Statut invalide. Valeurs acceptées : valide, annule")
    d = db.query(Depart).filter(Depart.id == depart_id).first()
    if not d:
        raise HTTPException(404, detail="Départ introuvable")

    d.statut = statut
    # Si annulation → réactiver le collaborateur
    if statut == "annule":
        collab = db.query(Collaborateur).filter(Collaborateur.id == d.collaborateur_id).first()
        if collab:
            collab.archive = False
            collab.statut_collaborateur = "actif"

    db.commit()
    db.refresh(d)
    return d
