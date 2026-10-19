"""
app/editions/population.py — Filtres de population au lancement et axes de regroupement.
Auteur : Adil DAIA — 19/10/2026

    RG-EDT-FILTRE-01  au lancement de toute édition sur les bulletins, l'utilisateur restreint
                      la population : unités organisationnelles (avec, par défaut, les UO qui
                      leur sont rattachées), catégories professionnelles, classifications,
                      emplois, métiers, types de contrat. Plusieurs valeurs d'un même critère
                      = OU ; plusieurs critères = ET.
    RG-EDT-FILTRE-02  les filtres portent sur la situation FIGÉE au calcul du bulletin
                      (snapshot) : une mutation postérieure ne change pas une édition passée.
    RG-EDT-FILTRE-03  l'arbre des UO, les UO rattachées et les valeurs proposées sont limités
                      à la société active ; un identifiant étranger est ignoré.
    RG-EDT-GROUPE-01  chaque bulletin reçoit des axes prêts à trier et regrouper : UO (code,
                      chemin complet, UO de 1er et 2e niveau), libellés de la catégorie
                      professionnelle et du type de contrat.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

_UUID = re.compile(r"^[0-9a-fA-F-]{36}$")
# critère → (libellé, chemins du snapshot lus dans l'ordre, table de référence)
CRITERES: dict[str, tuple[str, tuple[str, ...], Optional[str]]] = {
    "categories": ("Catégories professionnelles", ("qualification.code_categorie_professionnelle",), "ref_categorie_professionnelle"),
    "classifications": ("Classifications", ("qualification.code_classification", "affectation.code_classification"), "ref_classification"),
    "emplois": ("Emplois", ("affectation.emploi_code", "qualification.code_emploi"), "ref_emploi"),
    "metiers": ("Métiers", ("affectation.metier_code",), "ref_metier"),
    "contrats": ("Types de contrat", ("contrat.code_type_contrat",), "ref_type_contrat"),
}


def _lire(ligne: dict, chemin: str) -> Any:
    v: Any = ligne
    for p in chemin.split("."):
        v = v.get(p) if isinstance(v, dict) else None
    return v


def _ecrire(ligne: dict, chemin: str, valeur: Any) -> None:
    *parents, fin = chemin.split(".")
    d = ligne
    for p in parents:
        if not isinstance(d.get(p), dict):
            d[p] = {}
        d = d[p]
    if d.get(fin) in (None, ""):
        d[fin] = valeur


def _sur(db: Session, sql: str, params: dict) -> list[dict]:
    """Lecture tolérante : une table de référence absente ne casse pas l'édition."""
    try:
        with db.begin_nested():
            return [dict(r) for r in db.execute(text(sql), params).mappings()]
    except SQLAlchemyError:
        return []


# ---------------------------------------------------------------------------
# Unités organisationnelles de la société
# ---------------------------------------------------------------------------
def uos(db: Session, societe_id: str) -> list[dict]:
    rows = _sur(db, """SELECT u.id, u.parent_id, u.code, u.libelle, u.niveau
                       FROM unites_organisationnelles u JOIN etablissements e ON e.id = u.etablissement_id
                       WHERE e.societe_id = :s AND COALESCE(u.actif, true)
                       ORDER BY u.niveau, u.libelle""", {"s": societe_id})
    return [{**r, "id": str(r["id"]), "parent_id": str(r["parent_id"]) if r["parent_id"] else None} for r in rows]


def avec_rattachees(liste: list[dict], choisies: list[str]) -> set[str]:
    """RG-EDT-FILTRE-01 : les UO choisies et toutes celles qui leur sont rattachées (descendantes)."""
    enfants: dict[str, list[str]] = {}
    for u in liste:
        if u["parent_id"]:
            enfants.setdefault(u["parent_id"], []).append(u["id"])
    connues = {u["id"] for u in liste}
    resultat, pile = set(), [c for c in choisies if c in connues]
    while pile:
        x = pile.pop()
        if x in resultat:
            continue
        resultat.add(x)
        pile.extend(enfants.get(x, []))
    return resultat


def _chemins(liste: list[dict]) -> dict[str, list[dict]]:
    par_id = {u["id"]: u for u in liste}
    res = {}
    for u in liste:
        chaine, x, vus = [], u, set()
        while x and x["id"] not in vus:
            vus.add(x["id"])
            chaine.insert(0, x)
            x = par_id.get(x["parent_id"]) if x["parent_id"] else None
        res[u["id"]] = chaine
    return res


# ---------------------------------------------------------------------------
# Valeurs proposées à l'écran de lancement
# ---------------------------------------------------------------------------
def valeurs(db: Session, societe_id: str) -> dict:
    sortie: dict[str, Any] = {"uos": uos(db, societe_id), "criteres": []}
    for code, (libelle, _chemins_, table) in CRITERES.items():
        options = _sur(db, f"SELECT code, libelle FROM {table} WHERE COALESCE(actif, true) ORDER BY libelle", {}) if table else []
        sortie["criteres"].append({"code": code, "libelle": libelle,
                                   "options": [{"code": str(o["code"]), "libelle": o["libelle"]} for o in options]})
    return sortie


# ---------------------------------------------------------------------------
# Enrichissement (axes de tri et de regroupement) puis filtrage
# ---------------------------------------------------------------------------
def enrichir(db: Session, lignes: list[dict], societe_id: str, liste_uos: Optional[list[dict]] = None) -> None:
    """RG-EDT-GROUPE-01 : complète chaque bulletin (sans écraser le snapshot)."""
    if not lignes:
        return
    liste_uos = uos(db, societe_id) if liste_uos is None else liste_uos
    chemins = _chemins(liste_uos)
    cats = {str(r["code"]): r["libelle"] for r in _sur(db, "SELECT code, libelle FROM ref_categorie_professionnelle", {})}
    contrats = {str(r["code"]): r["libelle"] for r in _sur(db, "SELECT code, libelle FROM ref_type_contrat", {})}
    for l in lignes:
        chaine = chemins.get(str(_lire(l, "affectation.organisation_id") or ""), [])
        if chaine:
            _ecrire(l, "affectation.uo_code", chaine[-1].get("code"))
            _ecrire(l, "affectation.organisation_libelle", chaine[-1]["libelle"])
            _ecrire(l, "affectation.uo_chemin", " › ".join(u["libelle"] for u in chaine))
            _ecrire(l, "affectation.uo_niveau1_libelle", chaine[0]["libelle"])
            _ecrire(l, "affectation.uo_niveau2_libelle", chaine[1]["libelle"] if len(chaine) > 1 else chaine[0]["libelle"])
        cat = _lire(l, "qualification.code_categorie_professionnelle")
        if cat:
            _ecrire(l, "qualification.categorie_professionnelle_libelle", cats.get(str(cat), str(cat)))
        ct = _lire(l, "contrat.code_type_contrat")
        if ct:
            _ecrire(l, "contrat.type_contrat_libelle", contrats.get(str(ct), str(ct)))


def normaliser(filtres: Any) -> dict:
    """Filtres reçus de l'écran : listes de chaînes, UO en UUID, booléen « UO rattachées »."""
    if not isinstance(filtres, dict):
        return {}
    res: dict[str, Any] = {}
    uo = [str(x) for x in (filtres.get("uo") or []) if _UUID.match(str(x))]
    if uo:
        res["uo"] = uo
        res["uo_rattachees"] = filtres.get("uo_rattachees", True) is not False
    for code in CRITERES:
        v = [str(x) for x in (filtres.get(code) or []) if str(x).strip()][:500]
        if v:
            res[code] = v
    return res


def filtrer(db: Session, lignes: list[dict], filtres: Any, societe_id: str) -> list[dict]:
    f = normaliser(filtres)
    if not f or not lignes:
        return lignes
    garder_uo: Optional[set[str]] = None
    if "uo" in f:
        liste = uos(db, societe_id)                                     # RG-EDT-FILTRE-03
        connues = {u["id"] for u in liste}
        garder_uo = avec_rattachees(liste, f["uo"]) if f["uo_rattachees"] else {x for x in f["uo"] if x in connues}
    sortie = []
    for l in lignes:
        if garder_uo is not None and str(_lire(l, "affectation.organisation_id") or "") not in garder_uo:
            continue
        ok = True
        for code, (_lib, chemins, _t) in CRITERES.items():
            if code in f:
                valeurs_ligne = {str(_lire(l, c)) for c in chemins if _lire(l, c) not in (None, "")}
                if not valeurs_ligne & set(f[code]):
                    ok = False
                    break
        if ok:
            sortie.append(l)
    return sortie


def resume(filtres: Any) -> str:
    """Libellé court pour les traces (audit, nom de demande)."""
    f = normaliser(filtres)
    morceaux = []
    if "uo" in f:
        morceaux.append(f"{len(f['uo'])} UO" + (" et rattachées" if f["uo_rattachees"] else ""))
    for code, (lib, _c, _t) in CRITERES.items():
        if code in f:
            morceaux.append(f"{lib.lower()} : {len(f[code])}")
    return ", ".join(morceaux)
