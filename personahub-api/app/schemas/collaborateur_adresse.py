"""
Schemas Pydantic 2 — Adresses des collaborateurs.

Validation metier appliquee :
  - email format valide (si renseigne)
  - au moins un role (principale/correspondance/residence/professionnelle) coche
  - coherence pays / region / ville (verifie cote service avec la DB)
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class CollaborateurAdresseBase(BaseModel):
    adresse: str = Field(..., min_length=1, max_length=500)
    complement_adresse: str | None = Field(None, max_length=500)
    code_postal: str | None = Field(None, max_length=20)

    code_pays: str | None = None
    code_region: str | None = None
    code_ville: str | None = None

    telephone: str | None = Field(None, max_length=30)
    telephone_bis: str | None = Field(None, max_length=30)
    email: str | None = Field(None, max_length=200)

    is_adresse_principale: bool = False
    is_adresse_correspondance: bool = False
    is_adresse_residence: bool = False
    is_adresse_professionnelle: bool = False

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        # Validation legere : on accepte les emails vides mais on verifie la forme si non vide
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Format d'email invalide")
        return v.lower().strip()

    @model_validator(mode="after")
    def _at_least_one_role(self) -> "CollaborateurAdresseBase":
        roles = [
            self.is_adresse_principale,
            self.is_adresse_correspondance,
            self.is_adresse_residence,
            self.is_adresse_professionnelle,
        ]
        if not any(roles):
            raise ValueError(
                "L'adresse doit avoir au moins un role coche "
                "(principale, correspondance, residence ou professionnelle)"
            )
        return self


class CollaborateurAdresseCreate(CollaborateurAdresseBase):
    """Charge utile pour creer une adresse (collaborateur_id passe via l'URL)."""


class CollaborateurAdresseUpdate(BaseModel):
    """Mise a jour partielle — tous les champs sont optionnels."""

    adresse: str | None = Field(None, min_length=1, max_length=500)
    complement_adresse: str | None = Field(None, max_length=500)
    code_postal: str | None = Field(None, max_length=20)
    code_pays: str | None = None
    code_region: str | None = None
    code_ville: str | None = None
    telephone: str | None = Field(None, max_length=30)
    telephone_bis: str | None = Field(None, max_length=30)
    email: str | None = Field(None, max_length=200)
    is_adresse_principale: bool | None = None
    is_adresse_correspondance: bool | None = None
    is_adresse_residence: bool | None = None
    is_adresse_professionnelle: bool | None = None
    archive: bool | None = None


class CollaborateurAdresseRead(CollaborateurAdresseBase):
    id: UUID
    collaborateur_id: UUID
    archive: bool
    created_at: datetime
    updated_at: datetime

    # Libelles enrichis pour l'affichage (joints depuis les referentiels)
    libelle_pays: str | None = None
    libelle_region: str | None = None
    libelle_ville: str | None = None

    model_config = ConfigDict(from_attributes=True)
