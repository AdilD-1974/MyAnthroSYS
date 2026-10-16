"""
app/schemas/controle_paie.py — Schémas du référentiel des contrôles de paie.
Auteur : Adil DAIA
"""
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel


class ControlePaieRead(BaseModel):
    code: str
    libelle: str
    categorie: str
    description: Optional[str] = None
    niveau: str                 # BLOQUANT | ALERTE | INACTIF
    niveau_defaut: str
    parametrable: bool
    valeur_parametre: Optional[Decimal] = None
    unite_parametre: Optional[str] = None
    ordre: int
    actif: bool
    model_config = {"from_attributes": True}


class ControlePaieUpdate(BaseModel):
    """Mise à jour administrable : niveau, valeur du paramètre, activation."""
    niveau: Optional[str] = None            # BLOQUANT | ALERTE | INACTIF
    valeur_parametre: Optional[Decimal] = None
    actif: Optional[bool] = None
