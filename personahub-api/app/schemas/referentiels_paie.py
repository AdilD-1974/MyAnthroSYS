"""
Schémas Pydantic 2 — Référentiels paie.

Tous les référentiels partagent la même structure : un seul jeu de schémas
suffit (Create / Update / Read).
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ReferentielBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=50, description="Code unique (ex: SAL_BASE)")
    libelle: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    ordre: int = 0
    actif: bool = True


class ReferentielCreate(ReferentielBase):
    """Charge utile pour la création."""


class ReferentielUpdate(BaseModel):
    """Mise à jour partielle — tous les champs sont optionnels."""

    code: str | None = Field(None, min_length=1, max_length=50)
    libelle: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    ordre: int | None = None
    actif: bool | None = None


class ReferentielRead(ReferentielBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
