"""
app/schemas/cotisation.py — Schémas Pydantic pour les cotisations
Auteur : Adil DAIA
"""
from pydantic import BaseModel, Field, ConfigDict
from uuid import UUID
from datetime import date, datetime
from typing import Optional, List, Literal
from decimal import Decimal


# ─────────────────────────────────────────────────────────────────────────────
# Régimes de cotisation
# ─────────────────────────────────────────────────────────────────────────────
class RefRegimeCotisationRead(BaseModel):
    code: str
    libelle: str
    description: Optional[str] = None
    organisme: Optional[str] = None
    code_organisme: Optional[str] = None
    code_regle_cotisation: Optional[str] = None
    actif: bool
    ordre: int
    model_config = ConfigDict(from_attributes=True)


class RefRegimeCotisationWrite(BaseModel):
    code: str
    libelle: str
    description: Optional[str] = None
    organisme: Optional[str] = None
    code_organisme: Optional[str] = None
    code_regle_cotisation: Optional[str] = None
    actif: bool = True
    ordre: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Composantes d'une règle de cotisation
# ─────────────────────────────────────────────────────────────────────────────
class CotisationComposanteBase(BaseModel):
    code: str
    libelle: str
    ordre: int = 0
    code_rubrique_assiette: Optional[str] = None
    taux_salarial: Optional[Decimal] = None
    taux_patronal: Optional[Decimal] = None
    plafond_mensuel: Optional[Decimal] = None
    code_rubrique_part_salariale: Optional[str] = None
    code_rubrique_part_patronale: Optional[str] = None
    actif: bool = True


class CotisationComposanteRead(CotisationComposanteBase):
    id: UUID
    id_regle: UUID
    model_config = ConfigDict(from_attributes=True)


class CotisationComposanteWrite(CotisationComposanteBase):
    pass


# ─────────────────────────────────────────────────────────────────────────────
# Règle de cotisation (entête + composantes)
# ─────────────────────────────────────────────────────────────────────────────
class RegleCotisationBase(BaseModel):
    code: str
    libelle: str
    description: Optional[str] = None
    code_regime: Optional[str] = None
    date_debut_validite: Optional[date] = None
    date_fin_validite: Optional[date] = None
    decision_reference: Optional[str] = None
    actif: bool = True
    # RG-MULTISOCIETE-03 (migrations 059/060) : None = règle générique
    # (visible/utilisée par toutes les sociétés), une valeur = surcharge
    # propre à cette société uniquement. Jamais fourni par le client sur
    # RegleCotisationUpdate (voir plus bas) -- une règle ne change pas de
    # société après coup, elle se recrée.
    societe_id: Optional[UUID] = None

    # Modalités
    mode_calcul: Literal["PERIODIQUE", "CUMUL", "GLISSANT"] = "PERIODIQUE"
    code_rubrique_nb_paie: Optional[str] = None
    code_rubrique_nb_jours: Optional[str] = None
    code_rubrique_trentieme: Optional[str] = None
    code_rubrique_rapport: Optional[str] = None
    valeur_defaut_nb_paie: Optional[Decimal] = None
    valeur_defaut_nb_jours: Optional[Decimal] = None
    valeur_defaut_trentieme: Optional[Decimal] = None
    valeur_defaut_rapport: Optional[Decimal] = None
    assiette_negative_acceptee: bool = False
    assiette_negative_ramenee_zero: bool = False
    prorata_temporis: bool = False
    minimum_salarial: Optional[Decimal] = None
    minimum_patronal: Optional[Decimal] = None
    maximum_salarial: Optional[Decimal] = None
    maximum_patronal: Optional[Decimal] = None
    code_bareme_taux: Optional[str] = None


class RegleCotisationRead(RegleCotisationBase):
    id: UUID
    archive: bool
    composantes: List[CotisationComposanteRead] = []
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class RegleCotisationWrite(RegleCotisationBase):
    composantes: List[CotisationComposanteWrite] = Field(default_factory=list)


class RegleCotisationUpdate(BaseModel):
    """PATCH partiel — tous les champs optionnels"""
    libelle: Optional[str] = None
    description: Optional[str] = None
    code_regime: Optional[str] = None
    date_debut_validite: Optional[date] = None
    date_fin_validite: Optional[date] = None
    decision_reference: Optional[str] = None
    actif: Optional[bool] = None
    mode_calcul: Optional[Literal["PERIODIQUE", "CUMUL", "GLISSANT"]] = None
    code_rubrique_nb_paie: Optional[str] = None
    code_rubrique_nb_jours: Optional[str] = None
    code_rubrique_trentieme: Optional[str] = None
    code_rubrique_rapport: Optional[str] = None
    valeur_defaut_nb_paie: Optional[Decimal] = None
    valeur_defaut_nb_jours: Optional[Decimal] = None
    valeur_defaut_trentieme: Optional[Decimal] = None
    valeur_defaut_rapport: Optional[Decimal] = None
    assiette_negative_acceptee: Optional[bool] = None
    assiette_negative_ramenee_zero: Optional[bool] = None
    prorata_temporis: Optional[bool] = None
    minimum_salarial: Optional[Decimal] = None
    minimum_patronal: Optional[Decimal] = None
    maximum_salarial: Optional[Decimal] = None
    maximum_patronal: Optional[Decimal] = None
    code_bareme_taux: Optional[str] = None
    composantes: Optional[List[CotisationComposanteWrite]] = None


# ─────────────────────────────────────────────────────────────────────────────
# CollaborateurRegime — affectation
# ─────────────────────────────────────────────────────────────────────────────
class CollaborateurRegimeRead(BaseModel):
    id: UUID
    collaborateur_id: UUID
    code_regime: str
    matricule_organisme: Optional[str] = None
    date_affiliation: Optional[date] = None
    date_radiation: Optional[date] = None
    actif: bool
    model_config = ConfigDict(from_attributes=True)


class CollaborateurRegimeWrite(BaseModel):
    code_regime: str
    matricule_organisme: Optional[str] = None
    date_affiliation: Optional[date] = None
    date_radiation: Optional[date] = None
    actif: bool = True


# ─────────────────────────────────────────────────────────────────────────────
# Calcul de cotisation — moteur métier
# ─────────────────────────────────────────────────────────────────────────────
class CotisationCalculRequest(BaseModel):
    """
    Requête de calcul d'une cotisation pour un collaborateur sur une période.

    Le collaborateur doit être affecté au régime correspondant (sinon 404).
    L'assiette doit être fournie (calculée en amont par le moteur de paie).
    """
    collaborateur_id: UUID
    code_regle: str = Field(..., description="Code de la règle de cotisation à appliquer")
    periode_mois: date = Field(..., description="1er jour du mois de paie (ex: 2026-05-01)")
    assiette_montant: Decimal = Field(..., description="Montant de l'assiette de calcul")
    jours_presents: Optional[int] = Field(None, description="Pour prorata temporis (sinon 30)")
    jours_du_mois: int = Field(30, description="Diviseur du prorata (typiquement 30)")


class CotisationComposanteResult(BaseModel):
    """Résultat de calcul pour UNE composante."""
    code: str
    libelle: str
    base_appliquee: Decimal      # assiette (avec plafond éventuel)
    plafond_applique: Optional[Decimal] = None
    taux_salarial: Optional[Decimal] = None
    taux_patronal: Optional[Decimal] = None
    montant_salarial: Decimal
    montant_patronal: Decimal
    code_rubrique_part_salariale: Optional[str] = None
    code_rubrique_part_patronale: Optional[str] = None


class CotisationCalculResult(BaseModel):
    """Résultat global du calcul d'une cotisation."""
    code_regle: str
    libelle_regle: str
    code_regime: Optional[str] = None
    mode_calcul: str
    assiette_initiale: Decimal
    assiette_apres_options: Decimal
    composantes: List[CotisationComposanteResult]
    total_salarial: Decimal
    total_patronal: Decimal
    minimum_applique: bool = False
    maximum_applique: bool = False
    avertissements: List[str] = Field(default_factory=list)
