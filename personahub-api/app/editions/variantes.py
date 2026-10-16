"""
app/editions/variantes.py — Variantes de forme : surcharges appliquées sur une version de base.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Une variante ne touche QUE la présentation (RG-EDT-FORME-01). Elle est une
liste de surcharges, chacune visant un `id` stable de la définition :

    {"cible": "titre", "action": "MODIFIER", "proprietes": {"x": 20, "style": {"taille": 14}}}
    {"cible": "logo",  "action": "MASQUER"}
    {"cible": "pied",  "action": "AJOUTER", "element": {...élément de présentation...}}
    {"cible": "col_mt", "action": "MODIFIER", "proprietes": {"largeur": 30, "titre": "Montant"}}
    {"cible": "@page", "action": "MODIFIER", "proprietes": {"orientation": "PAYSAGE"}}

Règles :
    RG-EDT-FORME-01  modifiables : position, taille, style, affichage, calque,
                     libellé d'un TEXTE constant, titre/largeur/visibilité d'une
                     colonne, format/orientation/marges de page. Jamais les
                     jeux, paramètres, formules de calcul, conditions.
    RG-EDT-FORME-02  verrou TOTAL : ni masquable ni modifiable ; verrou FORME :
                     position et style seulement.
    RG-EDT-FORME-03  une surcharge dont la cible a disparu de la base est mise
                     de côté dans `conflits`, jamais une erreur de rendu.
    RG-EDT-FORME-04  AJOUTER n'accepte que des éléments de présentation
                     (TEXTE constant, IMAGE, LIGNE, CADRE).
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Optional

from pydantic import ValidationError

from app.editions import expressions as ex
from app.editions.definition import ELEMENTS_DE_PRESENTATION, Definition

PROPRIETES_FORME = {"x", "y", "l", "h", "style", "calque"}
PROPRIETES_ELEMENT = PROPRIETES_FORME | {"affichage", "extensible"}
PROPRIETES_COLONNE = {"titre", "largeur", "style", "affichage", "masquee"}
PROPRIETES_PAGE = {"format", "orientation", "marges"}
PROPRIETES_BANDE = {"hauteur"}


@dataclass
class Resultat:
    definition: Definition
    conflits: list[dict] = field(default_factory=list)
    appliquees: int = 0


def _est_constante(expr: str) -> bool:
    """Un TEXTE est un libellé (modifiable) s'il ne lit aucune donnée."""
    try:
        a = ex.analyser(expr)
    except ex.ErreurFormule:
        return False
    return not (a.champs or a.parametres or a.rubriques or a.constantes or a.agregats or a.erreurs)


def _index(d: dict) -> dict[str, tuple[str, Any, Optional[dict]]]:
    """id → (genre, objet, bande parente)."""
    idx: dict[str, tuple[str, Any, Optional[dict]]] = {}
    for bande in d["bandes"]:
        idx[bande["id"]] = ("BANDE", bande, None)
        for el in bande["elements"]:
            idx[el["id"]] = ("ELEMENT", el, bande)
            for col in el.get("colonnes", []) or []:
                idx[col["id"]] = ("COLONNE", col, bande)
    return idx


def _fusion(cible: dict, valeurs: dict) -> None:
    for k, v in valeurs.items():
        if isinstance(v, dict) and isinstance(cible.get(k), dict):
            _fusion(cible[k], v)
        else:
            cible[k] = v


def _appliquer_une(d: dict, s: dict) -> Optional[str]:
    """Applique une surcharge sur `d` (modifié en place). Renvoie le motif de refus, ou None."""
    cible, action = s.get("cible"), s.get("action")
    props = s.get("proprietes") or {}

    if cible == "@page":
        interdites = set(props) - PROPRIETES_PAGE
        if action != "MODIFIER" or interdites:
            return f"Page : seules {sorted(PROPRIETES_PAGE)} sont modifiables"
        _fusion(d["page"], props)
        return None

    idx = _index(d)
    if action == "AJOUTER":
        if cible not in idx or idx[cible][0] != "BANDE":
            return "Bande cible introuvable"
        el = s.get("element") or {}
        if el.get("type") not in ELEMENTS_DE_PRESENTATION:
            return "Seuls TEXTE, IMAGE, LIGNE et CADRE peuvent être ajoutés"
        if el.get("type") == "TEXTE" and not _est_constante(el.get("valeur", "")):
            return "Un texte ajouté ne peut pas lire de données"
        if el.get("id") in idx:
            return f"Identifiant déjà utilisé : {el.get('id')}"
        idx[cible][1]["elements"].append(copy.deepcopy(el))
        return None

    if cible not in idx:
        return "Cible absente de la version de base"                 # RG-EDT-FORME-03
    genre, objet, bande = idx[cible]
    verrou = objet.get("verrou", "AUCUN") if genre == "ELEMENT" else "AUCUN"

    if action == "MASQUER":
        if genre == "ELEMENT":
            if verrou == "TOTAL":
                return "Élément verrouillé : il ne peut pas être masqué"
            bande["elements"] = [e for e in bande["elements"] if e["id"] != cible]
            return None
        if genre == "COLONNE":
            objet["masquee"] = True
            return None
        return "Une bande ne se masque pas ; masquer ses éléments"

    if action != "MODIFIER":
        return f"Action inconnue : {action}"

    if genre == "BANDE":
        autorisees = set(PROPRIETES_BANDE)
    elif genre == "COLONNE":
        autorisees = set(PROPRIETES_COLONNE)
    elif verrou == "TOTAL":
        return "Élément verrouillé : non modifiable"
    elif verrou == "FORME":
        autorisees = set(PROPRIETES_FORME)
    else:
        autorisees = set(PROPRIETES_ELEMENT)
        if objet.get("type") == "TEXTE" and _est_constante(objet.get("valeur", "")):
            autorisees.add("valeur")
    interdites = set(props) - autorisees
    if "valeur" in props and "valeur" in autorisees and not _est_constante(str(props["valeur"])):
        interdites.add("valeur")
    if interdites:
        return f"Propriétés non modifiables par une variante : {sorted(interdites)}"
    _fusion(objet, props)
    return None


def appliquer(base: Definition, surcharges: list[dict]) -> Resultat:
    """Définition effective = base + surcharges. Une surcharge refusée ou qui
    rendrait la définition invalide est annulée et listée dans `conflits` ;
    les autres s'appliquent quand même."""
    d = copy.deepcopy(base.model_dump(mode="json"))
    conflits: list[dict] = []
    appliquees = 0
    for s in surcharges:
        avant = copy.deepcopy(d)
        motif = _appliquer_une(d, s)
        if motif is None:
            try:
                Definition.model_validate(d)
            except ValidationError as e:
                premiere = e.errors()[0]
                motif = f"Valeur invalide ({'.'.join(map(str, premiere['loc']))} : {premiere['msg']})"
        if motif is None:
            appliquees += 1
        else:
            d = avant
            conflits.append({**s, "motif": motif})
    return Resultat(Definition.model_validate(d), conflits, appliquees)
