from pydantic import BaseModel, field_validator
from datetime import date, datetime
from typing import Optional
from uuid import UUID


class TypeCongeRead(BaseModel):
    id: UUID
    code: str
    libelle: str
    duree_max_annuelle: Optional[int] = None
    deductible_paie: bool
    actif: bool
    model_config = {"from_attributes": True}


class TypeCongeCreate(BaseModel):
    code: str
    libelle: str
    duree_max_annuelle: Optional[int] = None
    deductible_paie: bool = False
    actif: bool = True


class DemandeCongeCreate(BaseModel):
    collaborateur_id: UUID
    type_conge_id: UUID
    date_debut: date
    date_fin: date
    nombre_jours: float
    motif: Optional[str] = None

    @field_validator("date_fin")
    @classmethod
    def fin_apres_debut(cls, v: date, info) -> date:
        debut = info.data.get("date_debut")
        if debut and v < debut:
            raise ValueError("La date de fin doit être après la date de début")
        return v


class DemandeCongeRead(BaseModel):
    id: UUID
    collaborateur_id: UUID
    type_conge_id: UUID
    date_debut: date
    date_fin: date
    nombre_jours: float
    statut: str
    motif: Optional[str] = None
    commentaire_valideur: Optional[str] = None
    valideur_id: Optional[UUID] = None
    date_validation: Optional[datetime] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class ValidationDecision(BaseModel):
    decision: str  # "approuvee" | "refusee"
    commentaire: Optional[str] = None

    @field_validator("decision")
    @classmethod
    def decision_valide(cls, v: str) -> str:
        if v not in ("approuvee", "refusee"):
            raise ValueError("La décision doit être 'approuvee' ou 'refusee'")
        return v


class CompteurCongeRead(BaseModel):
    id: UUID
    collaborateur_id: UUID
    type_conge_id: UUID
    annee: int
    solde_initial: float
    solde_acquis: float
    solde_pris: float
    solde_restant: float
    model_config = {"from_attributes": True}


class JourFerieCreate(BaseModel):
    date: date
    libelle: str
    recurrent: bool = False


class JourFerieRead(BaseModel):
    id: UUID
    date: date
    libelle: str
    annee: int
    recurrent: bool
    model_config = {"from_attributes": True}
