"""
app/editions/sources/base.py — Contrat commun des fournisseurs de données.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Un fournisseur = une source du catalogue (BULLETIN, BULLETIN_LIGNE, SOCIETE…).
Il déclare ses champs et ses relations, et sait lire ses lignes pour un
contexte de sécurité donné. Le moteur ne connaît que ce contrat : ajouter une
source = écrire une classe et l'enregistrer, sans toucher au moteur.

RG-EDT-SOURCE-03 (Adil DAIA) : toute lecture est filtrée par la société active ;
aucun paramètre ne permet de lever ce filtre.
RG-EDT-SECU-01 (Adil DAIA) : un champ sensible est remplacé par MASQUE_SENSIBLE
à la sortie du fournisseur pour qui n'a pas le droit DONNEES_SENSIBLES ;
aucune formule ne peut donc le lire.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

MASQUE_SENSIBLE = "****"
Ligne = dict[str, Any]


@dataclass(frozen=True)
class ChampDecl:
    code: str                       # chemin pointé : identite.matricule
    libelle: str
    type_donnee: str = "TEXTE"      # TEXTE | NOMBRE | MONTANT | DATE | BOOLEEN | IMAGE
    groupe: Optional[str] = None
    sensible: bool = False
    masque_defaut: Optional[str] = None


@dataclass(frozen=True)
class RelationDecl:
    code: str                       # nom de navigation (lignes)
    cible: str                      # source cible
    cardinalite: str                # UN | PLUSIEURS
    cle_source: str
    cle_cible: str


@dataclass(frozen=True)
class ContexteSecurite:
    utilisateur_id: Optional[str]
    societe_id: str
    roles: frozenset[str] = frozenset()
    donnees_sensibles: bool = False


class ErreurSource(Exception):
    """Paramètre manquant ou incohérent pour lire une source (→ 400)."""


class Fournisseur:
    code: str = ""
    libelle: str = ""
    nature: str = "REFERENTIEL"     # PAIE_SNAPSHOT | RH_DATE | REFERENTIEL | CALCULEE
    contexte_requis: tuple[str, ...] = ()

    def champs(self) -> list[ChampDecl]:
        return []

    def relations(self) -> list[RelationDecl]:
        return []

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        """Lignes du jeu PRINCIPAL pour ces paramètres."""
        raise NotImplementedError

    def lire_enfants(self, db: Session, cles: list[Any], sec: ContexteSecurite,
                     parametres: Optional[dict] = None) -> dict[Any, list[Ligne]]:
        """Lignes d'un jeu SECONDAIRE, chargées en bloc pour toutes les clés du
        parent (RG-EDT-SOURCE-05) et regroupées par clé."""
        raise NotImplementedError

    # ---- utilitaires communs ----
    def champs_sensibles(self) -> set[str]:
        return {c.code for c in self.champs() if c.sensible}

    def masquer(self, lignes: list[Ligne], sec: ContexteSecurite,
                sensibles: Optional[Iterable[str]] = None) -> list[Ligne]:
        """RG-EDT-SECU-01. `sensibles` vient du catalogue (administrable) ; à défaut,
        des déclarations du fournisseur."""
        if sec.donnees_sensibles:
            return lignes
        chemins = set(sensibles) if sensibles is not None else self.champs_sensibles()
        for ligne in lignes:
            for chemin in chemins:
                _remplacer(ligne, chemin.split("."), MASQUE_SENSIBLE)
        return lignes


def _remplacer(objet: Any, parties: list[str], valeur: Any) -> None:
    if not parties or not isinstance(objet, (dict, list)):
        return
    tete, reste = parties[0], parties[1:]
    if isinstance(objet, list):
        for x in objet:
            _remplacer(x, parties, valeur)
        return
    if tete == "*":
        for k in list(objet):
            if reste:
                _remplacer(objet[k], reste, valeur)
            elif objet[k] is not None:
                objet[k] = valeur
        return
    if tete not in objet:
        return
    if reste:
        _remplacer(objet[tete], reste, valeur)
    elif objet[tete] is not None:
        objet[tete] = valeur


def propre(v: Any) -> Any:
    """Valeur de base de données → valeur d'édition : UUID en texte (Pydantic v2
    et JSON), numériques en Decimal, le reste inchangé."""
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return v
    return v


def ligne_propre(row: Any) -> Ligne:
    return {k: propre(v) for k, v in dict(row).items()}


REGISTRE: dict[str, Fournisseur] = {}


def enregistrer(f: Fournisseur) -> Fournisseur:
    if not f.code:
        raise ValueError("Un fournisseur doit avoir un code")
    REGISTRE[f.code] = f
    return f
