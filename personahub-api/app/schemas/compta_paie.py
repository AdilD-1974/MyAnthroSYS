"""
Schémas Pydantic du sous-module de comptabilisation de la paie.
Cf. MODULE_COMPTA_PAIE.md §6 pour le contrat d'API.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

Part = Literal["SALARIALE", "PATRONALE", "NEUTRE"]
Sens = Literal["D", "C"]
ModeGeneration = Literal["GLOBAL", "NOMINATIF"]
StatutLot = Literal["BROUILLON", "GENERE", "EXPORTE", "COMPTABILISE"]


# ---------------------------------------------------------------------------
# Imputations
# ---------------------------------------------------------------------------
# Reflète le schéma DÉFINITIF de rubrique_paie_imputation (voir
# 23_comptabilite_paie.sql §1 pour l'historique). Non consommé par le
# routeur (le CRUD passe par le proxy générique /api/v1/db/..., cf.
# RubriqueForm.tsx, onglet Comptabilité) — gardé ici pour typer les autres endpoints
# si besoin.
class ImputationIn(BaseModel):
    rubrique_paie_code: str
    part: Part = "NEUTRE"
    compte_debit: Optional[str] = None
    compte_credit: Optional[str] = None
    axe_debit: Optional[str] = None
    axe_credit: Optional[str] = None
    date_debut: date = date(1900, 1, 1)
    date_fin: Optional[date] = None
    actif: bool = True
    commentaire: Optional[str] = None


class ImputationOut(ImputationIn):
    id: UUID


class RubriqueSansImputation(BaseModel):
    rubrique_paie_code: str
    libelle: str
    categorie: str  # code_type réel : ASS / CALC / COT (cf. correctif du 05/08)
    # Montants sur la période, séparés salarial/patronal (05/08) — None si
    # plan_paie_id/periode_id absents de la requête (comportement legacy).
    montant_salarial: Optional[Decimal] = None
    montant_patronal: Optional[Decimal] = None


# ---------------------------------------------------------------------------
# Contrôle d'effectif (§1)
# ---------------------------------------------------------------------------
class CollaborateurEcart(BaseModel):
    collaborateur_id: UUID
    matricule: str
    nom_complet: str
    motif: str  # "Pas de bulletin" / "Bulletin au statut CALCULE (non validé)"


class ControleEffectifOut(BaseModel):
    plan_paie_id: UUID
    periode_id: UUID
    effectif_attendu: int
    effectif_valide: int
    ok: bool
    ecarts: list[CollaborateurEcart] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Lots
# ---------------------------------------------------------------------------
class LotCreateIn(BaseModel):
    plan_paie_id: UUID
    periode_id: UUID
    mode_generation: ModeGeneration = "GLOBAL"
    journal_code: str = "PAIE"
    date_ecriture: Optional[date] = None
    numero_piece: Optional[str] = None


class LotOut(BaseModel):
    id: UUID
    plan_paie_id: UUID
    periode_id: UUID
    mode_generation: ModeGeneration
    statut: StatutLot
    journal_code: str
    date_ecriture: Optional[date]
    numero_piece: Optional[str]
    numero_generation: int = 0
    effectif_attendu: Optional[int]
    effectif_valide: Optional[int]
    controle_ok: Optional[bool]
    force_par: Optional[str]
    motif_forcage: Optional[str]
    total_debit: Optional[Decimal]
    total_credit: Optional[Decimal]
    nb_lignes_exclues: int
    genere_le: Optional[datetime]
    genere_par: Optional[str]
    # Résolus par compta_paie.py::_identite_auteur (profiles -> collaborateurs) —
    # None si l'auteur n'a pas de profil (ex. compte technique), cf. écran de
    # confirmation de régénération (GenerationEcrituresPage.tsx).
    genere_par_nom: Optional[str] = None
    genere_par_matricule: Optional[str] = None
    # Option A (05/08) : simple tampon date/auteur sur le lot, sans statut
    # par écriture — comptabilise_generation fige le numero_generation au
    # moment de la comptabilisation, pour détecter un décalage si le lot est
    # régénéré ensuite (cf. discussion — les lignes ne sont jamais écrasées,
    # seule la génération courante change).
    comptabilise_le: Optional[datetime] = None
    comptabilise_par: Optional[str] = None
    comptabilise_generation: Optional[int] = None


class GenererLotIn(BaseModel):
    forcer: bool = False
    motif_forcage: Optional[str] = None  # obligatoire si forcer=True et contrôle KO


class EcartCollaborateurOut(BaseModel):
    collaborateur_id: UUID
    matricule: str
    nom_complet: str
    total_debit: Decimal
    total_credit: Decimal


class EcartAxeOut(BaseModel):
    axe_analytique: Optional[str]
    total_debit: Decimal
    total_credit: Decimal
    collaborateurs: list[EcartCollaborateurOut]


class LigneBruteOut(BaseModel):
    """
    Ligne non persistée, renvoyée uniquement quand la génération est en
    déséquilibre (rien n'est écrit en base, le lot reste BROUILLON) — pour
    permettre à l'écran de grouper compte -> rubrique -> matricule et
    d'afficher le relevé complet d'un agent malgré tout (05/08).
    """
    compte: str
    sens: Sens
    montant: Decimal
    rubrique_paie_code: str
    part: Part
    axe_analytique: Optional[str]
    collaborateur_id: UUID
    matricule: Optional[str]
    nom_complet: Optional[str]


class GenererLotResultOut(BaseModel):
    """
    Réponse de POST /lots/{id}/generer. `lot` rempli si la génération a
    réussi, `desequilibre` rempli (et `lot` à None) si débit ≠ crédit —
    avec la ventilation par axe puis par collaborateur pour diagnostiquer,
    plutôt qu'un message d'erreur générique. `lignes_brutes` accompagne
    `desequilibre` (détail non persisté, pour le relevé par agent).
    """
    lot: Optional[LotOut] = None
    desequilibre: Optional[list[EcartAxeOut]] = None
    lignes_brutes: Optional[list[LigneBruteOut]] = None


class LigneExclue(BaseModel):
    bulletin_id: UUID
    matricule: str
    rubrique_paie_code: str
    montant: Decimal
    motif: str  # "Aucune imputation active pour cette rubrique/part à cette date"


class EcritureLigneOut(BaseModel):
    id: UUID
    compte: str
    libelle: Optional[str]
    sens: Sens
    montant: Decimal
    axe_analytique: Optional[str]


class EcritureDetailOut(BaseModel):
    id: UUID
    bulletin_id: UUID
    collaborateur_id: UUID
    rubrique_paie_code: str
    part: Part
    compte: str
    sens: Sens
    montant: Decimal
    axe_analytique: Optional[str]


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
class FormatExportOut(BaseModel):
    code: str
    libelle: str
    description: Optional[str]


class ExporterLotIn(BaseModel):
    format_code: str
