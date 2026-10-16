"""
Schémas Pydantic — Journal de paie en grille (format réglementaire).

Distinct du Journal "standard" (colonnes plates, rapport_paie.py) : ici
chaque collaborateur occupe un bloc de plusieurs lignes dans un tableau à
cases positionnées, configurable par l'utilisateur.
"""
from __future__ import annotations

from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class GrilleCondition(BaseModel):
    """Condition d'affichage d'une case, évaluée bulletin par bulletin.

    cible : "SELF" (la valeur de la case elle-même) ou la clé "ligne_colonne"
    d'une autre case (ex. "2_3") dont on teste la valeur brute.
    sinon : que faire quand la condition est fausse — VIDE laisse la case à
    sa place avec une valeur vide ; MASQUER efface toute la case (libellé
    compris).
    """
    cible: str = "SELF"
    operateur: Literal[
        "RENSEIGNEE", "NON_ZERO", "EGAL", "DIFFERENT",
        "SUPERIEUR", "INFERIEUR", "CONTIENT",
    ] = "RENSEIGNEE"
    valeur: Optional[str] = None
    sinon: Literal["VIDE", "MASQUER"] = "VIDE"


class GrilleMasque(BaseModel):
    code: str
    libelle: str
    exemple: str


class GrilleCase(BaseModel):
    id: Optional[UUID] = None
    ligne: int
    colonne: int
    rowspan: int = 1
    colspan: int = 1
    libelle: str
    type_source: Literal["IDENTITE", "RUBRIQUE", "CONSTANTE"]
    cle_identite: Optional[str] = None       # si IDENTITE
    code_rubrique: Optional[str] = None      # si RUBRIQUE
    attribut: Optional[Literal["MT", "NB", "TX", "BASE"]] = None
    valeur_constante: Optional[str] = None   # si CONSTANTE
    ordre_affichage: int = 0
    # --- Habillage du modèle de sortie (tous optionnels : absents = rendu historique)
    masque: Optional[str] = None             # code d'un masque (voir rapport_grille_engine.MASQUES)
    texte_avant: Optional[str] = None
    texte_apres: Optional[str] = None
    # None = tiret "-" (historique) ; "" = laisser vide ; autre = ce texte
    valeur_si_vide: Optional[str] = None
    condition_affichage: Optional[GrilleCondition] = None


class GrilleConfig(BaseModel):
    template_id: UUID
    cases: list[GrilleCase] = Field(default_factory=list)


class GrilleEnteteSociete(BaseModel):
    adresse: Optional[str] = None
    identifiant_fiscal: Optional[str] = None
    affiliation_cnss: Optional[str] = None
    logo_path: Optional[str] = None


class GrilleBlocCollaborateur(BaseModel):
    """Un bloc = les valeurs de toutes les cases pour un collaborateur donné."""
    bulletin_id: UUID
    valeurs: dict[str, Any]   # clé = "ligne_colonne" (ex. "1_5"), valeur DÉJÀ formatée (masque, texte, condition)
    masquees: list[str] = Field(default_factory=list)  # clés des cases à effacer entièrement (condition "MASQUER")


# Réutilise PerimetreJournal (même formes de périmètre que le Journal standard)
from app.schemas.rapport_paie import PerimetreJournal  # noqa: E402


class GrilleApercuRequest(BaseModel):
    template_id: UUID
    perimetre: PerimetreJournal


class GrilleApercuResponse(BaseModel):
    entete: GrilleEnteteSociete
    cases: list[GrilleCase]
    blocs: list[GrilleBlocCollaborateur]
    nb_collaborateurs: int


class GrilleGenererRequest(GrilleApercuRequest):
    format_export: Literal["PDF"] = "PDF"
