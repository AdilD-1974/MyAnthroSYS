"""Schémas Pydantic — Bulletin de paie (5 modèles de présentation)."""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class EnteteChamp(BaseModel):
    libelle: str
    cle_identite: str


class CorpsColonne(BaseModel):
    cle: str   # "libelle" | "base" | "nombre" | "taux" | "montant" | "montant_patronal"
    libelle: str


class CorpsConfig(BaseModel):
    colonnes: list[CorpsColonne] = Field(default_factory=list)
    afficher_section_gains: bool = True
    afficher_section_retenues: bool = True
    afficher_cotisations_patronales: bool = True
    libelle_section_gains: str = "GAINS"
    libelle_section_retenues: str = "RETENUES ET COTISATIONS"


class PiedCumul(BaseModel):
    code_rubrique: str
    libelle: str


class PiedConfig(BaseModel):
    cumuls: list[PiedCumul] = Field(default_factory=list)
    mentions_legales: str = ""
    afficher_signature: bool = True
    texte_signature: str = ""
    afficher_date_paiement: bool = True


class BulletinConfig(BaseModel):
    template_id: UUID
    style: str = "classique"
    entete_config: list[EnteteChamp] = Field(default_factory=list)
    corps_config: CorpsConfig = Field(default_factory=CorpsConfig)
    pied_config: PiedConfig = Field(default_factory=PiedConfig)


class BulletinConfigUpdate(BaseModel):
    style: str
    entete_config: list[EnteteChamp]
    corps_config: CorpsConfig
    pied_config: PiedConfig


class LigneBulletinAffichee(BaseModel):
    libelle: str
    sens: str  # GAIN | RETENUE
    valeurs: dict[str, Any]  # clé = colonne.cle (base/nombre/taux/montant/montant_patronal), valeur formatée


class BulletinApercuRequest(BaseModel):
    template_id: UUID
    bulletin_id: UUID


class BulletinApercuResponse(BaseModel):
    entete_societe: dict[str, Optional[str]]
    entete_collaborateur: list[dict[str, Any]]  # [{"libelle": ..., "valeur": ...}]
    lignes: list[LigneBulletinAffichee]
    totaux: dict[str, float]
    cumuls: list[dict[str, Any]]
    mentions_legales: str
    afficher_signature: bool
    texte_signature: str
    periode_libelle: str
    date_paiement: Optional[str] = None


class BulletinGenererRequest(BulletinApercuRequest):
    format_export: str = "PDF"
