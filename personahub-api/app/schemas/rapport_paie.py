"""
Schémas Pydantic — Module Rapports de paie (Phase 1).

⚠️ À aligner avec les conventions déjà en place dans
`app/schemas/paie_calcul.py` (mêmes types de base, mêmes conventions de
nommage) avant intégration définitive — ce fichier part des règles décrites
dans MODULE_PAIE.md, à confirmer contre le code réel.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# -----------------------------------------------------------------------------
# Snapshot collaborateur (figé au calcul)
# -----------------------------------------------------------------------------

class SnapshotIdentite(BaseModel):
    matricule: str
    civilite: Optional[str] = None
    nom: str
    prenom: str
    cin: Optional[str] = None
    date_naissance: Optional[str] = None


class SnapshotAffectation(BaseModel):
    organisation_id: Optional[str] = None
    organisation_libelle: Optional[str] = None
    # Instance de poste (rattachement physique du collaborateur)
    poste_instance_id: Optional[str] = None
    poste_instance_code: Optional[str] = None
    # Poste de référence (catalogue ref_poste) — capturé en plus de
    # l'instance pour avoir un maximum d'information disponible d'office ;
    # le choix de ce qui est affiché se fait au niveau de la config du
    # rapport, pas ici.
    poste_reference_code: Optional[str] = None
    poste_reference_libelle: Optional[str] = None
    code_classification: Optional[str] = None
    qualifications_requises: Optional[str] = None
    # Emploi (ref_emploi, via ref_poste.code_emploi)
    emploi_code: Optional[str] = None
    emploi_libelle: Optional[str] = None
    # Métier (ref_metier, via ref_emploi.code_metier)
    metier_code: Optional[str] = None
    metier_libelle: Optional[str] = None
    metier_famille: Optional[str] = None


class SnapshotContrat(BaseModel):
    code_type_contrat: Optional[str] = None
    code_statut_contrat: Optional[str] = None
    code_temps: Optional[str] = None
    date_embauche: Optional[str] = None


class SnapshotSituationFamiliale(BaseModel):
    code: Optional[str] = None
    nb_enfants_a_charge: Optional[int] = None
    nb_personnes_a_charge: Optional[int] = None
    nb_deductions_fiscales: Optional[int] = None


class BulletinSnapshotCollaborateur(BaseModel):
    identite: SnapshotIdentite
    affectation: SnapshotAffectation
    contrat: SnapshotContrat
    situation_familiale: Optional[SnapshotSituationFamiliale] = None


class BulletinSnapshotOut(BaseModel):
    id: UUID
    bulletin_id: UUID
    donnees: BulletinSnapshotCollaborateur
    date_capture: datetime
    calcul_origine: Literal["CALCUL", "RECALCUL"]


# -----------------------------------------------------------------------------
# Templates
# -----------------------------------------------------------------------------

class RapportTemplateBase(BaseModel):
    code: str
    libelle: str
    libelle_court: Optional[str] = None
    type_rapport: Literal["BULLETIN", "JOURNAL"]
    description: Optional[str] = None
    actif: bool = True
    par_defaut: bool = False


class RapportTemplateCreate(RapportTemplateBase):
    pass


class RapportTemplateOut(RapportTemplateBase):
    id: UUID
    date_creation: datetime
    date_maj: datetime


# -----------------------------------------------------------------------------
# Configuration Journal
# -----------------------------------------------------------------------------

class JournalColonne(BaseModel):
    type: Literal["champ", "rubrique", "total"]
    cle: Optional[str] = None            # pour type="champ" (clé du snapshot) ou type="total"
    code: Optional[str] = None           # pour type="rubrique"
    attribut: Optional[Literal["MT", "NB", "TX", "BASE"]] = None
    libelle: str


class JournalTri(BaseModel):
    colonne: str
    sens: Literal["asc", "desc"] = "asc"


class RapportJournalConfig(BaseModel):
    template_id: UUID
    colonnes: list[JournalColonne] = Field(default_factory=list)
    groupements: list[str] = Field(default_factory=list)   # ex: ["organisation", "plan_paie"]
    sous_totaux: list[str] = Field(default_factory=list)
    tri: list[JournalTri] = Field(default_factory=list)
    filtres_par_defaut: dict[str, Any] = Field(default_factory=dict)


# -----------------------------------------------------------------------------
# Périmètre libre du Journal (choix du gestionnaire)
# -----------------------------------------------------------------------------

class PerimetrePeriodePlan(BaseModel):
    mode: Literal["periode_plan"] = "periode_plan"
    plan_paie_id: UUID
    periode_id: UUID
    organisation_ids: Optional[list[UUID]] = None   # filtre UO optionnel


class PerimetreCollaborateur(BaseModel):
    mode: Literal["collaborateur"] = "collaborateur"
    collaborateur_id: UUID
    periode_id_debut: UUID
    periode_id_fin: UUID


class PerimetreAnnee(BaseModel):
    mode: Literal["annee"] = "annee"
    annee: int
    plan_paie_id: Optional[UUID] = None
    organisation_ids: Optional[list[UUID]] = None


PerimetreJournal = PerimetrePeriodePlan | PerimetreCollaborateur | PerimetreAnnee


class JournalApercuRequest(BaseModel):
    template_id: UUID
    perimetre: PerimetreJournal


class JournalLigne(BaseModel):
    valeurs: dict[str, Any]           # clé = libellé/cle de colonne, valeur formatée + brute
    groupe: Optional[dict[str, str]] = None


class JournalApercuResponse(BaseModel):
    colonnes: list[JournalColonne]
    lignes: list[JournalLigne]
    sous_totaux_par_groupe: dict[str, dict[str, float]] = Field(default_factory=dict)
    total_general: dict[str, float] = Field(default_factory=dict)
    nb_bulletins: int


class JournalGenererRequest(JournalApercuRequest):
    format_export: Literal["PDF", "EXCEL"]
