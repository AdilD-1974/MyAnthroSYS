"""
Schemas Pydantic — Referentiels d'adresse (read-only).
"""
from pydantic import BaseModel, ConfigDict


class RefPaysRead(BaseModel):
    code: str
    libelle: str
    actif: bool | None = True
    code_pays_alpha2: str | None = None
    continent: str | None = None
    devise: str | None = None

    model_config = ConfigDict(from_attributes=True)


class RefRegionRead(BaseModel):
    code: str
    libelle: str
    code_pays: str | None = None
    actif: bool | None = True

    model_config = ConfigDict(from_attributes=True)


class RefVilleRead(BaseModel):
    code: str
    libelle: str
    code_region: str
    code_postal: str | None = None
    actif: bool | None = True
    # Champs deduits utiles cote frontend (cascading)
    code_pays: str | None = None  # rempli via la jointure region
    libelle_region: str | None = None
    libelle_pays: str | None = None

    model_config = ConfigDict(from_attributes=True)
