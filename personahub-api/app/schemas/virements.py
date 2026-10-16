"""
schemas/virements.py
Schémas Pydantic In/Out du module Virements.
⚠️ Sur le modèle de schemas/pret.py — à aligner si votre convention de
nommage (BaseModel, orm_mode/from_attributes selon version Pydantic) diffère.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Référentiel / comptes émetteurs
# ---------------------------------------------------------------------------

class RefBanqueOut(BaseModel):
    code: str
    libelle: str
    code_pays: str
    code_simt: Optional[str] = None
    actif: bool


class BanqueEmettriceIn(BaseModel):
    ref_banque_code: str
    code_simt_effectif: str = Field(min_length=3, max_length=3)
    rib: str = Field(min_length=24, max_length=24)
    intitule_compte: str
    raison_sociale_emetteur: str = Field(max_length=35)
    actif: bool = True


class BanqueEmettriceOut(BanqueEmettriceIn):
    id: str
    ref_banque_libelle: Optional[str] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Tiers payeurs / retenues
# ---------------------------------------------------------------------------

TypeTiersPayeur = Literal["HUISSIER", "CREANCIER", "EX_CONJOINT", "ORGANISME", "SYNDICAT", "AUTRE"]
StatutRetenueTiers = Literal["ACTIF", "SUSPENDU", "SOLDE"]


class TiersPayeurIn(BaseModel):
    type: TypeTiersPayeur
    nom: str
    rib: Optional[str] = Field(default=None, min_length=24, max_length=24)
    reference_externe: Optional[str] = None
    actif: bool = True


class TiersPayeurOut(TiersPayeurIn):
    id: str


class TypeRetenueSourceOut(BaseModel):
    code: str
    libelle: str
    rubrique_paie_code: str
    rubrique_paie_libelle: Optional[str] = None
    priorite_defaut: int
    actif: bool


class RetenueTiersIn(BaseModel):
    collaborateur_id: str
    tiers_payeur_id: str
    type_retenue_source_code: str
    priorite: int = 100
    reference_dossier: Optional[str] = None
    date_debut: date
    date_fin: Optional[date] = None
    statut: StatutRetenueTiers = "ACTIF"


class RetenueTiersOut(RetenueTiersIn):
    id: str
    collaborateur_nom: Optional[str] = None
    collaborateur_matricule: Optional[str] = None
    tiers_payeur_nom: Optional[str] = None
    type_retenue_source_libelle: Optional[str] = None
    rubrique_paie_code: Optional[str] = None
    rubrique_paie_libelle: Optional[str] = None


# ---------------------------------------------------------------------------
# Ordres / lignes de virement
# ---------------------------------------------------------------------------

TypeOrdreVirement = Literal["SALAIRE", "RETENUE_TIERS", "PRET_EXTERNE", "AD_HOC"]
StatutOrdreVirement = Literal["BROUILLON", "ENREGISTRE", "EN_CONTROLE", "VALIDE", "GENERE", "TRANSMIS", "EXECUTE", "PARTIEL", "REJETE"]
ModeGeneration = Literal["MANUEL", "VENTILE"]


class GenererOrdreIn(BaseModel):
    type: Literal["SALAIRE", "RETENUE_TIERS", "PRET_EXTERNE"]
    periode_id: str
    mode: ModeGeneration = "MANUEL"
    banque_emettrice_id: Optional[str] = None  # requis si mode == MANUEL
    date_valeur: date


class LigneAdHocIn(BaseModel):
    collaborateur_id: str
    montant: float = Field(gt=0)


class OrdreAdHocIn(BaseModel):
    banque_emettrice_id: str
    date_valeur: date
    libelle_motif: str = Field(max_length=35)
    plan_paie_id: Optional[str] = None
    lignes: list[LigneAdHocIn]


class OrdreVirementOut(BaseModel):
    id: str
    type: TypeOrdreVirement
    nature_operation: Literal["34", "32", "35"]
    periode_id: Optional[str] = None
    periode_libelle: Optional[str] = None
    banque_emettrice_id: str
    banque_emettrice_libelle: Optional[str] = None
    date_valeur: date
    reference_lot: str
    statut: StatutOrdreVirement
    nb_lignes: int
    montant_total: float
    created_at: datetime


class LigneVirementOut(BaseModel):
    id: str
    ordre_virement_id: str
    beneficiaire_type: Literal["COLLABORATEUR_PRINCIPAL", "TIERS_RETENUE", "ORGANISME_CREDIT_PRET"]
    collaborateur_nom: Optional[str] = None
    nom_beneficiaire_snapshot: str
    rib_beneficiaire_snapshot: str
    montant: float
    libelle_motif: str
    statut_ligne: Literal["GENEREE", "EXECUTEE", "REJETEE"]
    motif_rejet: Optional[str] = None


class SignalerRejetIn(BaseModel):
    lignes_rejetees: list[dict] = Field(description="[{ligne_id, motif}, ...]")


class KpiSousBloc(BaseModel):
    montant: float
    nb_collaborateurs: Optional[int] = None
    nb_dossiers: Optional[int] = None
    nb_echeances: Optional[int] = None


class VirementSyntheseKpiOut(BaseModel):
    net_a_payer: KpiSousBloc
    retenues_tiers: KpiSousBloc
    prets_externes: KpiSousBloc
    rejets_a_traiter: int
