from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import extract
from uuid import UUID
from datetime import datetime
from app.core.database import get_db
from app.core.security import require_roles, get_current_user_payload
from app.models.absences import TypeConge, DemandeConge, CompteurConge, JourFerie
from app.schemas.absences import (
    TypeCongeCreate, TypeCongeRead,
    DemandeCongeCreate, DemandeCongeRead, ValidationDecision,
    CompteurCongeRead, JourFerieCreate, JourFerieRead,
)

router = APIRouter(tags=["Absences & Congés"])

RH_ROLES = ("administrateur", "gestionnaire_rh", "manager")


# ── Types de congé ────────────────────────────────────────────────────────────

@router.get("/types-conge", response_model=list[TypeCongeRead])
def list_types_conge(db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    return db.query(TypeConge).filter(TypeConge.actif == True).all()


@router.post("/types-conge", response_model=TypeCongeRead, status_code=201)
def create_type_conge(
    data: TypeCongeCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur")),
):
    if db.query(TypeConge).filter(TypeConge.code == data.code).first():
        raise HTTPException(400, detail=f"Le code '{data.code}' existe déjà")
    tc = TypeConge(**data.model_dump())
    db.add(tc)
    db.commit()
    db.refresh(tc)
    return tc


# ── Demandes de congé ─────────────────────────────────────────────────────────

@router.get("/absences/demandes", response_model=list[DemandeCongeRead])
def list_demandes(
    statut: str = Query("", description="Filtrer par statut"),
    collaborateur_id: UUID = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*RH_ROLES)),
):
    """Liste les demandes de congé. Le manager ne voit que son équipe (à implémenter)."""
    q = db.query(DemandeConge)
    if statut:
        q = q.filter(DemandeConge.statut == statut)
    if collaborateur_id:
        q = q.filter(DemandeConge.collaborateur_id == collaborateur_id)
    return q.order_by(DemandeConge.created_at.desc()).all()


@router.post("/absences/demandes", response_model=DemandeCongeRead, status_code=201)
def create_demande(
    data: DemandeCongeCreate,
    db: Session = Depends(get_db),
    _=Depends(get_current_user_payload),  # tout utilisateur connecté peut demander
):
    """Soumet une nouvelle demande de congé."""
    # Vérifier le type de congé
    if not db.query(TypeConge).filter(TypeConge.id == data.type_conge_id, TypeConge.actif == True).first():
        raise HTTPException(404, detail="Type de congé introuvable ou inactif")

    # Vérifier qu'il n'y a pas de chevauchement
    chevauchement = db.query(DemandeConge).filter(
        DemandeConge.collaborateur_id == data.collaborateur_id,
        DemandeConge.statut.in_(["en_attente", "approuvee"]),
        DemandeConge.date_debut <= data.date_fin,
        DemandeConge.date_fin >= data.date_debut,
    ).first()
    if chevauchement:
        raise HTTPException(409, detail="Une demande de congé chevauche cette période")

    demande = DemandeConge(**data.model_dump())
    db.add(demande)
    db.commit()
    db.refresh(demande)
    return demande


@router.get("/absences/demandes/{demande_id}", response_model=DemandeCongeRead)
def get_demande(
    demande_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*RH_ROLES)),
):
    d = db.query(DemandeConge).filter(DemandeConge.id == demande_id).first()
    if not d:
        raise HTTPException(404, detail="Demande introuvable")
    return d


@router.post("/absences/demandes/{demande_id}/valider", response_model=DemandeCongeRead)
def valider_demande(
    demande_id: UUID,
    decision: ValidationDecision,
    db: Session = Depends(get_db),
    payload: dict = Depends(require_roles("administrateur", "gestionnaire_rh", "manager")),
):
    """Approuve ou refuse une demande de congé."""
    demande = db.query(DemandeConge).filter(DemandeConge.id == demande_id).first()
    if not demande:
        raise HTTPException(404, detail="Demande introuvable")
    if demande.statut != "en_attente":
        raise HTTPException(400, detail=f"La demande est déjà '{demande.statut}'")

    demande.statut = decision.decision
    demande.commentaire_valideur = decision.commentaire
    demande.valideur_id = payload.get("sub")
    demande.date_validation = datetime.utcnow()

    # Mettre à jour le compteur si approuvée
    if decision.decision == "approuvee":
        compteur = db.query(CompteurConge).filter(
            CompteurConge.collaborateur_id == demande.collaborateur_id,
            CompteurConge.type_conge_id == demande.type_conge_id,
            CompteurConge.annee == demande.date_debut.year,
        ).first()
        if compteur:
            compteur.solde_pris = float(compteur.solde_pris) + float(demande.nombre_jours)
            compteur.solde_restant = float(compteur.solde_acquis) - float(compteur.solde_pris)

    db.commit()
    db.refresh(demande)
    return demande


@router.delete("/absences/demandes/{demande_id}", status_code=204)
def annuler_demande(
    demande_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(get_current_user_payload),
):
    """Annule une demande en attente."""
    demande = db.query(DemandeConge).filter(DemandeConge.id == demande_id).first()
    if not demande:
        raise HTTPException(404, detail="Demande introuvable")
    if demande.statut != "en_attente":
        raise HTTPException(400, detail="Seules les demandes en attente peuvent être annulées")
    demande.statut = "annulee"
    db.commit()


# ── Compteurs de congé ────────────────────────────────────────────────────────

@router.get("/absences/compteurs/{collaborateur_id}", response_model=list[CompteurCongeRead])
def get_compteurs(
    collaborateur_id: UUID,
    annee: int = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*RH_ROLES)),
):
    q = db.query(CompteurConge).filter(CompteurConge.collaborateur_id == collaborateur_id)
    if annee:
        q = q.filter(CompteurConge.annee == annee)
    return q.all()


# ── Jours fériés ──────────────────────────────────────────────────────────────

@router.get("/jours-feries", response_model=list[JourFerieRead])
def list_jours_feries(
    annee: int = Query(None, description="Filtrer par année"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user_payload),
):
    q = db.query(JourFerie)
    if annee:
        q = q.filter(JourFerie.annee == annee)
    return q.order_by(JourFerie.date).all()


@router.post("/jours-feries", response_model=JourFerieRead, status_code=201)
def create_jour_ferie(
    data: JourFerieCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur")),
):
    jf = JourFerie(**data.model_dump(), annee=data.date.year)
    db.add(jf)
    db.commit()
    db.refresh(jf)
    return jf


@router.delete("/jours-feries/{jf_id}", status_code=204)
def delete_jour_ferie(
    jf_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur")),
):
    jf = db.query(JourFerie).filter(JourFerie.id == jf_id).first()
    if not jf:
        raise HTTPException(404, detail="Jour férié introuvable")
    db.delete(jf)
    db.commit()
