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
    RG-EDT-SITUATION-01  (Adil DAIA) un bloc VIDE de la situation figée au calcul (qualification,
                      contrat, affectation) est complété depuis la fiche RH, à la date de fin de la
                      période (même règles que la capture : non archivé, en vigueur à cette date).
                      Cas réel : qualification saisie dans la fiche après le calcul de la paie.
                      Ce qui a été figé n'est jamais remplacé ; `situation.completee` liste les blocs
                      complétés. Recalculer la paie du mois refait la situation figée.
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
# Situation figée incomplète → fiche RH à la date de la période (RG-EDT-SITUATION-01)
# ---------------------------------------------------------------------------
def _vide(bloc: Any, cles: tuple[str, ...]) -> bool:
    return not isinstance(bloc, dict) or all(bloc.get(k) in (None, "") for k in cles)


def _a_date(lignes_rh: list[dict], champ_debut: str, a_date: Any, champ_fin: Optional[str] = None) -> Optional[dict]:
    """La ligne en vigueur à `a_date` : début ≤ date (et fin ≥ date), la plus récente."""
    candidats = [r for r in lignes_rh if r.get(champ_debut) is not None and str(r[champ_debut]) <= str(a_date)
                 and (champ_fin is None or r.get(champ_fin) is None or str(r[champ_fin]) >= str(a_date))]
    return max(candidats, key=lambda r: str(r[champ_debut])) if candidats else None


def completer_situation(db: Session, lignes: list[dict]) -> None:
    besoin = {"qualification": [], "contrat": [], "affectation": []}
    for l in lignes:
        if not l.get("collaborateur_id") or not (l.get("periode") or {}).get("date_fin"):
            continue
        if _vide(l.get("qualification"), ("code_categorie_professionnelle", "code_classification", "code_qualification",
                                          "code_grade", "date_evolution")):
            besoin["qualification"].append(l)
        if _vide(l.get("contrat"), ("code_type_contrat", "date_embauche")):
            besoin["contrat"].append(l)
        if _vide(l.get("affectation"), ("organisation_id",)):
            besoin["affectation"].append(l)
    if not any(besoin.values()):
        return

    def lire(sql: str, liste: list[dict]) -> dict[str, list[dict]]:
        ids = sorted({str(l["collaborateur_id"]) for l in liste})
        res: dict[str, list[dict]] = {}
        if not ids:
            return res
        for r in _sur(db, sql, {"ids": ids}):
            res.setdefault(str(r["collaborateur_id"]), []).append(r)
        return res

    def noter(l: dict, bloc: str) -> None:
        sit = l.setdefault("situation", {})
        sit["completee"] = ", ".join(x for x in [sit.get("completee"), bloc] if x)

    quals = lire("""
        SELECT cq.collaborateur_id, cq.date_evolution, cq.code_classification, rcl.libelle AS classification_libelle,
               cq.code_qualification, rq.libelle AS qualification_libelle, cq.code_categorie_professionnelle,
               cq.code_categorie, cq.code_grade, cq.code_echelle, cq.echelon_actuel, cq.code_emploi, cq.code_fonction,
               cq.code_niveau, cq.code_filiere
        FROM collaborateur_qualifications cq
        LEFT JOIN ref_classification rcl ON rcl.code = cq.code_classification
        LEFT JOIN ref_qualification rq ON rq.code = cq.code_qualification
        WHERE CAST(cq.collaborateur_id AS text) = ANY(:ids) AND COALESCE(cq.archive, false) = false""", besoin["qualification"])
    for l in besoin["qualification"]:
        r = _a_date(quals.get(str(l["collaborateur_id"]), []), "date_evolution", l["periode"]["date_fin"])
        if r:
            q = dict(l.get("qualification") or {})
            for k, v in r.items():
                if k != "collaborateur_id" and q.get(k) in (None, ""):
                    q[k] = str(v) if k == "date_evolution" and v is not None else v
            l["qualification"] = q
            noter(l, "qualification")

    contrats = lire("""
        SELECT collaborateur_id, code_type_contrat, code_statut_contrat, code_temps, date_debut AS date_embauche, date_fin
        FROM collaborateur_contrats
        WHERE CAST(collaborateur_id AS text) = ANY(:ids) AND COALESCE(archive, false) = false""", besoin["contrat"])
    for l in besoin["contrat"]:
        r = _a_date(contrats.get(str(l["collaborateur_id"]), []), "date_embauche", l["periode"]["date_fin"], "date_fin")
        if r:
            c = dict(l.get("contrat") or {})
            for k in ("code_type_contrat", "code_statut_contrat", "code_temps", "date_embauche"):
                if c.get(k) in (None, "") and r.get(k) is not None:
                    c[k] = str(r[k]) if k == "date_embauche" else r[k]
            l["contrat"] = c
            noter(l, "contrat")

    affs = lire("""
        SELECT ca.collaborateur_id, ca.unite_id, o.libelle AS organisation_libelle, ca.date_debut_uo, ca.date_fin_uo
        FROM collaborateur_affectations ca LEFT JOIN unites_organisationnelles o ON o.id = ca.unite_id
        WHERE CAST(ca.collaborateur_id AS text) = ANY(:ids) AND COALESCE(ca.archive, false) = false""", besoin["affectation"])
    for l in besoin["affectation"]:
        r = _a_date(affs.get(str(l["collaborateur_id"]), []), "date_debut_uo", l["periode"]["date_fin"], "date_fin_uo")
        if r and r.get("unite_id"):
            a = dict(l.get("affectation") or {})
            a["organisation_id"] = str(r["unite_id"])
            if a.get("organisation_libelle") in (None, ""):
                a["organisation_libelle"] = r.get("organisation_libelle")
            l["affectation"] = a
            noter(l, "affectation")


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
