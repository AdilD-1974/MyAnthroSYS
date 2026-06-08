from pydantic import BaseModel, EmailStr, field_validator
from datetime import date, datetime
from typing import Optional
from uuid import UUID


# ── Collaborateur ─────────────────────────────────────────────────────────────

class CollaborateurBase(BaseModel):
    matricule: str
    civilite: Optional[str] = None
    nom: str
    prenom: str
    nom_jeune_fille: Optional[str] = None
    date_naissance: date
    lieu_naissance: Optional[str] = None
    code_nationalite: Optional[str] = None
    code_genre: str
    statut_collaborateur: str = "actif"
    telephone: Optional[str] = None
    gsm: Optional[str] = None
    email_personnel: Optional[EmailStr] = None
    email_professionnel: Optional[EmailStr] = None

    @field_validator("code_genre")
    @classmethod
    def genre_valide(cls, v: str) -> str:
        if v not in ("M", "F"):
            raise ValueError("code_genre doit être 'M' ou 'F'")
        return v


class CollaborateurCreate(CollaborateurBase):
    """Schéma pour la création d'un collaborateur (POST)."""
    pass


class CollaborateurUpdate(BaseModel):
    """Schéma pour la mise à jour partielle (PATCH) — tous les champs optionnels."""
    civilite: Optional[str] = None
    nom: Optional[str] = None
    prenom: Optional[str] = None
    nom_jeune_fille: Optional[str] = None
    date_naissance: Optional[date] = None
    lieu_naissance: Optional[str] = None
    code_nationalite: Optional[str] = None
    code_genre: Optional[str] = None
    statut_collaborateur: Optional[str] = None
    telephone: Optional[str] = None
    gsm: Optional[str] = None
    email_personnel: Optional[EmailStr] = None
    email_professionnel: Optional[EmailStr] = None


class CollaborateurRead(CollaborateurBase):
    """Schéma de lecture — inclut les champs générés automatiquement."""
    id: UUID
    archive: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CollaborateurList(BaseModel):
    """Réponse paginée pour la liste des collaborateurs."""
    total: int
    page: int
    page_size: int
    items: list[CollaborateurRead]


# ── Contrat ───────────────────────────────────────────────────────────────────

class ContratBase(BaseModel):
    type_contrat: str
    date_debut: date
    date_fin: Optional[date] = None
    motif_fin: Optional[str] = None
    est_actif: bool = True


class ContratCreate(ContratBase):
    collaborateur_id: UUID


class ContratRead(ContratBase):
    id: UUID
    collaborateur_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
