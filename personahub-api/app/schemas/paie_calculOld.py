"""
app/schemas/paie_calcul.py — Schémas Pydantic du calcul de bulletin.
Auteur : Adil DAIA
"""
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel


class CalculBulletinRequest(BaseModel):
    collaborateur_id: UUID
    periode_id: UUID
    persister: bool = False          # True = enregistre bulletin + lignes + cumuls
    type_lot: str = "UNITAIRE"       # UNITAIRE | SIMULATION


class LigneBulletinOut(BaseModel):
    code_rubrique: str
    libelle: str
    code_type: Optional[str] = None
    type_regle: Optional[str] = None
    ordre_calcul: Optional[int] = None
    ordre_affichage: int = 0
    base: Optional[Decimal] = None
    nombre: Optional[Decimal] = None
    taux: Optional[Decimal] = None
    montant: Decimal = Decimal("0")
    montant_patronal: Optional[Decimal] = None
    montant_cumul: Optional[Decimal] = None
    nombre_cumul: Optional[Decimal] = None
    sens: Optional[str] = None
    est_cotisation: bool = False
    type_periodicite: Optional[str] = None
    frequence_raz: Optional[str] = None
    date_valeur: Optional[str] = None
    texte: Optional[str] = None
    observation: Optional[str] = None


class TotauxOut(BaseModel):
    total_brut: Decimal
    total_brut_imposable: Decimal
    total_gains: Decimal
    total_retenues: Decimal
    total_cot_salariale: Decimal
    total_cot_patronale: Decimal
    net_imposable: Decimal
    net_a_payer: Decimal
    cout_employeur: Decimal


class CalculBulletinResult(BaseModel):
    bulletin_id: Optional[UUID] = None     # rempli si persister=True
    lot_id: Optional[UUID] = None
    collaborateur: dict
    periode: dict
    totaux: TotauxOut
    lignes: list[LigneBulletinOut]
    trace: list[Any]
    messages: list[str]
    a_erreur: bool = False


class BulletinLigneRead(LigneBulletinOut):
    id: UUID
    model_config = {"from_attributes": True}


class BulletinRead(BaseModel):
    id: UUID
    lot_id: UUID
    periode_id: UUID
    plan_paie_id: Optional[UUID] = None
    code_plan: Optional[str] = None
    collaborateur_id: UUID
    matricule: Optional[str] = None
    total_brut: Decimal
    total_gains: Decimal
    total_retenues: Decimal
    total_cot_salariale: Decimal
    total_cot_patronale: Decimal
    net_imposable: Decimal
    net_a_payer: Decimal
    cout_employeur: Decimal
    statut: str
    # Table d'où provient le bulletin : TEMP (précalcul) | VALIDE | HISTORIQUE
    origine: str = "VALIDE"
    a_erreur: bool
    messages: list = []
    calcule_le: datetime
    lignes: list[BulletinLigneRead] = []
    model_config = {"from_attributes": True}


# ---- Validation & historique --------------------------------------------
class ControleResultat(BaseModel):
    code: str
    libelle: str
    categorie: str
    niveau: str                 # BLOQUANT | ALERTE
    ok: bool
    message: Optional[str] = None


class RapportControle(BaseModel):
    bulletin_id: UUID
    statut: str
    controles: list[ControleResultat]
    bloquants_ko: int
    alertes_ko: int
    validable: bool


class ValiderRequest(BaseModel):
    forcer_alertes: bool = False
    commentaire: Optional[str] = None


class ValidationResult(BaseModel):
    valide: bool
    confirmation_requise: bool
    statut: str
    rapport: RapportControle


class HistoriqueRead(BaseModel):
    id: UUID
    periode_id: UUID
    bulletin_id: Optional[UUID] = None
    collaborateur_id: Optional[UUID] = None
    action: str
    statut_avant: Optional[str] = None
    statut_apres: Optional[str] = None
    decision: Optional[str] = None
    commentaire: Optional[str] = None
    utilisateur_id: Optional[UUID] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ---- Clôture annuelle ----------------------------------------------------
class ClotureAnneeRequest(BaseModel):
    plan_paie_id: UUID
    annee: int
    forcer_alertes: bool = False        # clôturer même si des bulletins ne sont pas validés
    commentaire: Optional[str] = None


class AnneePaieRead(BaseModel):
    id: UUID
    plan_paie_id: UUID
    annee: int
    statut: str
    cloture_le: Optional[datetime] = None
    cloture_par: Optional[UUID] = None
    commentaire: Optional[str] = None
    model_config = {"from_attributes": True}


# ---- Lancement en masse (population + lot) --------------------------------
class PopulationFiltres(BaseModel):
    # Unités organisationnelles (UUID) : cocher une UO inclut ses sous-unités.
    unite_ids: list[UUID] = []
    # Postes : CODES du référentiel ref_poste (pas des identifiants d'instance).
    codes_poste: list[str] = []

    types_contrat: list[str] = []
    statuts_contrat: list[str] = []
    temps: list[str] = []
    statuts_collaborateur: list[str] = []
    regimes: list[str] = []
    nationalites: list[str] = []
    matricule: Optional[str] = None
    collaborateur_ids: list[UUID] = []


class PopulationRequest(BaseModel):
    plan_paie_id: UUID
    periode_id: UUID
    filtres: PopulationFiltres = PopulationFiltres()


class CollaborateurCible(BaseModel):
    id: UUID
    matricule: Optional[str] = None
    nom: Optional[str] = None
    prenom: Optional[str] = None


class LotCalculRequest(PopulationRequest):
    persister: bool = True


class LigneLotResultat(BaseModel):
    collaborateur_id: UUID
    matricule: Optional[str] = None
    nom: Optional[str] = None
    net_a_payer: Optional[Decimal] = None
    a_erreur: bool = False
    message: Optional[str] = None


class LotCalculResult(BaseModel):
    nb_total: int
    nb_ok: int
    nb_erreur: int
    # Bulletins déjà validés : laissés intacts, ni recalculés ni comptés en erreur
    nb_ignores: int = 0
    total_net: Decimal
    total_cout: Decimal
    resultats: list[LigneLotResultat]


# ---- Validation en masse (lot) ------------------------------------------
class LotValiderRequest(PopulationRequest):
    forcer_alertes: bool = False


class LigneLotValidation(BaseModel):
    collaborateur_id: UUID
    matricule: Optional[str] = None
    nom: Optional[str] = None
    statut: str                    # VALIDE | BLOQUE | ALERTE | SANS_BULLETIN | DEJA_VALIDE
    bloquants: int = 0
    alertes: int = 0
    message: Optional[str] = None


class LotValidationResult(BaseModel):
    nb_total: int
    nb_valides: int
    nb_bloques: int
    nb_alertes: int
    nb_sans_bulletin: int
    resultats: list[LigneLotValidation]


# ---- Éditeur de règles spécifiques : validation & test -------------------
class InstructionIn(BaseModel):
    numero: int = 0
    instruction: str = ""
    label: Optional[str] = None


class ReglesValiderRequest(BaseModel):
    instructions: list[InstructionIn] = []


class ReglesValiderResult(BaseModel):
    ok: bool
    erreurs: list[str] = []
    avertissements: list[str] = []


class ReglesTesterRequest(BaseModel):
    instructions: list[InstructionIn] = []
    collaborateur_id: UUID
    periode_id: UUID
    seed: Optional[dict] = None


class ReglesTesterResult(BaseModel):
    sorties: dict
    trace: list
    avertissements: list[str] = []


class ReglesTesterManuelRequest(BaseModel):
    instructions: list[InstructionIn] = []
    seed: Optional[dict] = None
    rubriques: Optional[dict] = None       # {"CODE": {"MT":..,"NB":..,"TX":..,"BASE":..}}
    constantes: Optional[dict] = None      # {"CODE": valeur}
    cumuls: Optional[dict] = None          # {"CODE": valeur}
    precedents: Optional[dict] = None      # {"CODE": valeur} ou {"CODE:n": valeur}
    baremes: Optional[dict] = None         # {"CODE": valeur}
    date_paie: Optional[str] = None
    date_jour: Optional[str] = None
