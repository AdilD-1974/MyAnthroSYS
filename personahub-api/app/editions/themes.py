"""
app/editions/themes.py — Thèmes (dossiers) des états, indicateur Actif et menus en arborescence.
Auteur : Adil DAIA — 19/10/2026 (migration 078)

    RG-EDT-THEME-01  les états sont rangés dans des thèmes d'un module (PAIE, RH…),
                     éventuellement imbriqués ; un thème contient plusieurs modèles.
    RG-EDT-THEME-02  thèmes système livrés (non modifiables) ; chaque société crée les
                     siens. Un modèle non classé va dans le thème de sa catégorie.
    RG-EDT-THEME-03  supprimer un thème de la société : ses sous-thèmes sont supprimés,
                     ses modèles retournent dans le thème de leur catégorie.
    RG-EDT-ACTIF-01  indicateur Actif par société : un état inactif n'est plus proposé
                     ni lançable, il reste modifiable dans le designer.
    RG-EDT-MENU-01   le menu d'éditions d'un module (ex. Paie › Éditions de la paie)
                     montre l'arborescence des thèmes avec les états publiés, actifs et
                     lançables par l'utilisateur ; les thèmes vides n'y figurent pas.
"""
from __future__ import annotations

import re
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.editions import ecrans as ec
from app.editions import service as sv

MODULES = {"PAIE": "Paie", "RH": "Ressources humaines"}
# RG-EDT-THEME-04 (Adil DAIA) : dossier d'origine des modèles livrés dont la catégorie ne suffit pas
THEMES_MODELES_SYSTEME = {
    "ETAT_ECARTS_M_M1": "PAIE_CONTROLE", "CONTROLE_ANOMALIES_PAIE": "PAIE_CONTROLE", "CONTROLE_IR": "PAIE_CONTROLE",
    "MASSE_SALARIALE": "PAIE_SYNTHESE", "MASSE_SALARIALE_COLLABORATEURS": "PAIE_SYNTHESE",
    "FICHE_SYNTHESE_ANNUELLE": "PAIE_SYNTHESE",
    "ECARTS_RUBRIQUES": "PAIE_CONTROLE", "CONTROLE_DEUX_PERIODES": "PAIE_CONTROLE", "COMPARATIF_RUBRIQUES": "PAIE_CONTROLE",
    "BULLETIN_RECAP_EXERCICE": "PAIE_BULLETINS",
}
# catégories sans thème dédié → thème « standard » du module
REPLI_CATEGORIE = {"AUTRE": "LISTE"}


def _propre(r) -> dict:
    d = dict(r)
    for k in ("id", "parent_id", "societe_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    return d


def lister_themes(db: Session, u: sv.Utilisateur, module: Optional[str] = None) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT id, code, libelle, module, parent_id, societe_id, categorie_defaut, ordre, actif
        FROM edt_theme
        WHERE (societe_id IS NULL OR societe_id = :s) {"AND module = :mod" if module else ""}
        ORDER BY module, ordre, libelle"""), {"s": u.societe_id, "mod": module}).mappings().all()
    return [_propre(r) | {"est_systeme": r["societe_id"] is None} for r in rows]


def _theme(db: Session, u: sv.Utilisateur, theme_id: str) -> dict:
    t = next((x for x in lister_themes(db, u) if x["id"] == str(theme_id)), None)
    if t is None:
        raise sv.Introuvable("Thème introuvable")
    return t


def theme_par_defaut(themes: list[dict], categorie: str) -> Optional[dict]:
    """RG-EDT-THEME-02 : le thème d'un modèle non classé (thème de la société d'abord)."""
    cat = REPLI_CATEGORIE.get(categorie, categorie)
    candidats = [t for t in themes if t["categorie_defaut"] == cat and t["actif"]]
    candidats.sort(key=lambda t: (t["est_systeme"], t["ordre"]))
    return candidats[0] if candidats else None


def creer_theme(db: Session, u: sv.Utilisateur, *, libelle: str, module: str = "PAIE",
                parent_id: Optional[str] = None, ordre: Optional[int] = None) -> dict:
    sv.exiger(db, u, "PUBLIER")
    libelle = (libelle or "").strip()
    if not libelle:
        raise sv.Invalide("Libellé du thème obligatoire")
    if module not in MODULES:
        raise sv.Invalide(f"Module inconnu : {module}")
    if parent_id:
        p = _theme(db, u, parent_id)
        if p["module"] != module:
            raise sv.Invalide("Le thème parent est d'un autre module")
    base = re.sub(r"[^A-Z0-9]+", "_", libelle.upper().encode("ascii", "ignore").decode()).strip("_")[:30] or "THEME"
    if not base[0].isalpha():
        base = f"T_{base}"
    code, i = base, 1
    while db.execute(text("SELECT 1 FROM edt_theme WHERE code = :c AND societe_id = :s"),
                     {"c": code, "s": u.societe_id}).first():
        i += 1
        code = f"{base}_{i}"
    if ordre is None:
        ordre = (db.execute(text("""SELECT max(ordre) FROM edt_theme WHERE module = :m
                                    AND (societe_id IS NULL OR societe_id = :s)"""),
                            {"m": module, "s": u.societe_id}).scalar() or 0) + 10
    tid = str(uuid.uuid4())
    db.execute(text("""INSERT INTO edt_theme (id, code, libelle, module, parent_id, societe_id, ordre)
                       VALUES (:id, :c, :l, :m, :p, :s, :o)"""),
               {"id": tid, "c": code, "l": libelle, "m": module, "p": parent_id, "s": u.societe_id, "o": int(ordre)})
    sv.auditer(db, u, "THEME_CREATION", "THEME", tid, {"libelle": libelle, "module": module})
    return _theme(db, u, tid)


def _modifiable(db: Session, u: sv.Utilisateur, theme_id: str) -> dict:
    sv.exiger(db, u, "PUBLIER")
    t = _theme(db, u, theme_id)
    if t["est_systeme"]:
        raise sv.Interdit("Thème livré avec l'application : créez un thème de la société")
    return t


def modifier_theme(db: Session, u: sv.Utilisateur, theme_id: str, *, libelle: Optional[str] = None,
                   parent_id: Optional[str] = "", ordre: Optional[int] = None, actif: Optional[bool] = None) -> dict:
    t = _modifiable(db, u, theme_id)
    champs, val = [], {"id": t["id"]}
    if libelle is not None:
        if not libelle.strip():
            raise sv.Invalide("Libellé du thème obligatoire")
        champs.append("libelle = :l"); val["l"] = libelle.strip()
    if parent_id != "":                                   # "" : inchangé ; None : à la racine
        if parent_id:
            p = _theme(db, u, parent_id)
            if p["module"] != t["module"]:
                raise sv.Invalide("Le thème parent est d'un autre module")
            courant: Optional[dict] = p                    # pas de boucle : le parent n'est pas un descendant
            while courant:
                if courant["id"] == t["id"]:
                    raise sv.Invalide("Un thème ne peut pas être rangé dans lui-même")
                courant = _theme(db, u, courant["parent_id"]) if courant["parent_id"] else None
        champs.append("parent_id = :p"); val["p"] = parent_id
    if ordre is not None:
        champs.append("ordre = :o"); val["o"] = int(ordre)
    if actif is not None:
        champs.append("actif = :a"); val["a"] = bool(actif)
    if champs:
        db.execute(text(f"UPDATE edt_theme SET {', '.join(champs)} WHERE id = :id"), val)
        sv.auditer(db, u, "THEME_MODIFICATION", "THEME", t["id"], {k: v for k, v in val.items() if k != "id"})
    return _theme(db, u, t["id"])


def supprimer_theme(db: Session, u: sv.Utilisateur, theme_id: str) -> None:
    t = _modifiable(db, u, theme_id)
    # RG-EDT-THEME-03 : modèles des thèmes supprimés → thème de leur catégorie (theme_id ON DELETE SET NULL)
    db.execute(text("DELETE FROM edt_theme WHERE id = :id"), {"id": t["id"]})
    sv.auditer(db, u, "THEME_SUPPRESSION", "THEME", t["id"], {"libelle": t["libelle"]})


# ---------------------------------------------------------------------------
# Réglage d'un modèle pour la société : actif, thème, ordre
# ---------------------------------------------------------------------------
def regler_modele(db: Session, u: sv.Utilisateur, modele_id: str, *, actif: Optional[bool] = None,
                  theme_id: Optional[str] = "", ordre: Optional[int] = None) -> dict:
    m = sv.lire_modele(db, u, modele_id)
    sv.exiger(db, u, "PUBLIER", m)
    if theme_id:
        _theme(db, u, theme_id)
    existe = db.execute(text("SELECT actif, theme_id, ordre FROM edt_modele_reglage WHERE modele_id = :m AND societe_id = :s"),
                        {"m": m["id"], "s": u.societe_id}).mappings().first()
    nouveau = {
        "actif": bool(actif) if actif is not None else (existe["actif"] if existe else True),
        "theme": (theme_id or None) if theme_id != "" else (str(existe["theme_id"]) if existe and existe["theme_id"] else None),
        "ordre": int(ordre) if ordre is not None else (existe["ordre"] if existe else 0),
    }
    params = {"m": m["id"], "s": u.societe_id, "a": nouveau["actif"], "t": nouveau["theme"], "o": nouveau["ordre"]}
    if existe:
        db.execute(text("""UPDATE edt_modele_reglage SET actif = :a, theme_id = :t, ordre = :o, modifie_le = CURRENT_TIMESTAMP
                           WHERE modele_id = :m AND societe_id = :s"""), params)
    else:
        db.execute(text("""INSERT INTO edt_modele_reglage (modele_id, societe_id, actif, theme_id, ordre)
                           VALUES (:m, :s, :a, :t, :o)"""), params)
    sv.auditer(db, u, "REGLAGE", "MODELE", m["id"], nouveau)
    return sv.lire_modele(db, u, m["id"])


def avec_theme(db: Session, u: sv.Utilisateur, modeles: list[dict]) -> list[dict]:
    """Ajoute à chaque modèle son thème effectif (classé, sinon celui de sa catégorie)."""
    themes = lister_themes(db, u)
    par_id = {t["id"]: t for t in themes}
    for m in modeles:
        t = par_id.get(str(m.get("theme_id"))) if m.get("theme_id") else None
        implicite = t is None
        if t is None and m.get("est_systeme") and m.get("code") in THEMES_MODELES_SYSTEME:
            t = next((x for x in themes if x["est_systeme"] and x["code"] == THEMES_MODELES_SYSTEME[m["code"]]), None)
        t = t or theme_par_defaut(themes, m["categorie"])
        m["theme_effectif_id"] = t["id"] if t else None
        m["theme_libelle"] = t["libelle"] if t else None
        m["theme_module"] = t["module"] if t else None
        m["theme_implicite"] = implicite
    return modeles


# ---------------------------------------------------------------------------
# Menu en arborescence d'un module — RG-EDT-MENU-01
# ---------------------------------------------------------------------------
def arbre(db: Session, u: sv.Utilisateur, module: str = "PAIE", tout: bool = False) -> dict:
    """{module, themes: [{id, libelle, parent_id, est_systeme, modeles: [...]}]} — à plat, l'écran
    construit l'arbre. `tout` (concepteurs) : garde les thèmes vides pour pouvoir y classer."""
    if module not in MODULES:
        raise sv.Introuvable("Module inconnu")
    themes = [t for t in lister_themes(db, u, module) if t["actif"]]
    modeles = avec_theme(db, u, sv.lister_modeles(db, u))
    par_theme: dict[str, list[dict]] = {t["id"]: [] for t in themes}
    for m in modeles:
        if m["theme_effectif_id"] not in par_theme:
            continue
        if not m["version_publiee_id"] or not m.get("actif", True) or not sv.peut(db, u, "LANCER", m):
            continue
        f = ec.fiche_lancement(db, m)
        if f:
            par_theme[m["theme_effectif_id"]].append({**f, "ordre": m.get("ordre_theme") or 0})
    for liste in par_theme.values():
        liste.sort(key=lambda x: (x["ordre"], x["est_systeme"], x["libelle"].lower()))
    sortie = [{**t, "modeles": par_theme[t["id"]]} for t in themes]
    if not tout:                                        # thèmes vides (et sans descendant garni) masqués
        garnis = {t["id"] for t in sortie if t["modeles"]}
        parents = {t["id"]: t["parent_id"] for t in sortie}
        for tid in list(garnis):
            p = parents.get(tid)
            while p:
                garnis.add(p)
                p = parents.get(p)
        sortie = [t for t in sortie if t["id"] in garnis]
    return {"module": module, "libelle": MODULES[module], "themes": sortie}


def lancer(db: Session, u: sv.Utilisateur, module: str, modele_id: str, parametres: dict,
           forme: Optional[str] = None) -> dict:
    """Lancement depuis le menu d'un module : l'état doit y figurer (actif, publié, du module)."""
    a = arbre(db, u, module)
    if not any(m["id"] == modele_id for t in a["themes"] for m in t["modeles"]):
        raise sv.Interdit("Cet état n'est pas proposé dans ce menu (inactif, non publié ou d'un autre module)")
    res = sv.lancer(db, u, modele_id, parametres or {}, forme)
    if not res["documents"]:
        raise sv.ErreurEdition("Aucun document pour ces paramètres")
    m = sv.lire_modele(db, u, modele_id)
    return {**res, "modele": {"id": m["id"], "code": m["code"], "libelle": m["libelle"]}}

