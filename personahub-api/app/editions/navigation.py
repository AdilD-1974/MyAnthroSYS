"""
app/editions/navigation.py — Écrans d'édition générés dans la navigation de l'application.
Auteur : Adil DAIA — 20/10/2026 — RG-EDT-NAV-02..04

RG-EDT-NAV-02 (Adil DAIA) : un état publié, ou un dossier du menu d'éditions, peut devenir un ÉCRAN de
    l'application : une entrée nav_menu_item visible dans Configuration › Navigation, comme les autres
    écrans (section, ordre, imbrication, rôles s'y règlent ensuite).
      - état   → /editions/etat/<CODE>  (lancement direct de l'état ; ?module=RH pour un autre module)
      - dossier → /paie/editions-paie?dossier=<id>       (menu d'éditions réduit à ce dossier)
    Placement initial : sous « Éditions de la paie » (sous-menu, même section), avec ses rôles ;
    à défaut ceux des gestionnaires et de l'administrateur.
RG-EDT-NAV-03 (Adil DAIA) : génération idempotente : un second appel met à jour le libellé, jamais de doublon
    (code d'écran edt_m_<code état> / edt_d_<dossier>).
RG-EDT-NAV-04 (Adil DAIA) : retirer l'écran supprime l'entrée et ses rôles ; l'état ou le dossier restent.
RG-EDT-NAV-05 (Adil DAIA) : « Publier le menu dans la navigation » : les dossiers du menu d'éditions (et, au choix,
    leurs états) deviennent les SOUS-MENUS de « Éditions de la paie », dans l'arborescence et l'ordre des dossiers.
    Idempotent : libellés mis à jour, nouveaux dossiers ajoutés, écrans des dossiers et états disparus retirés ;
    un écran déjà déplacé par l'administrateur dans la Navigation garde sa place.
"""
from __future__ import annotations

import re
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

ROLES_DEFAUT = ("administrateur", "gestionnaire_paie", "gestionnaire_rh")
REPERES = ("/paie/editions-paie", "/paie/edition-bulletins", "/paie/editions/bulletins", "/paie/editions", "/editions")
# RG-EDT-NAV-07 (Adil DAIA) : chaque module a son écran repère ; celui des éditions RH (attestations, courriers) est
# créé au besoin, à côté de la fiche collaborateur, pour l'administrateur et le gestionnaire RH.
CHEMIN_MODULE = {"PAIE": "/paie/editions-paie", "RH": "/editions/menu/rh"}
ANCRES_RH = ("/collaborateurs", "/rh/collaborateurs", "/collaborateurs/liste", "/rh")


class ErreurNavigation(Exception):
    pass


def disponible(db: Session) -> bool:
    return db.execute(text("""SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                              AND table_name IN ('nav_menu_item', 'nav_role_visibilite')""")).scalar() == 2


def _code_ecran(type_: str, ident: str) -> str:
    base = re.sub(r"[^a-z0-9_]+", "_", ident.lower()).strip("_")
    return (f"edt_m_{base}" if type_ == "MODELE" else f"edt_d_{base[:36]}")[:80]


def module_modele(db: Session, modele_id: str, categorie: str, societe_id: str) -> str:
    """Module du menu d'éditions où figure l'état : celui de son dossier choisi pour la société, sinon RH pour une
    attestation ou un courrier, PAIE pour le reste (dossiers livrés par catégorie)."""
    try:
        m = db.execute(text("""SELECT t.module FROM edt_modele_reglage r JOIN edt_theme t ON t.id = r.theme_id
                               WHERE r.modele_id = :m AND CAST(r.societe_id AS text) = :s"""),
                       {"m": modele_id, "s": societe_id}).scalar()
    except Exception:
        m = None
    return (m or ("RH" if categorie in ("ATTESTATION", "COURRIER") else "PAIE")).upper()


def _cible(db: Session, type_: str, ident: str, societe_id: str) -> dict:
    if type_ == "MODELE":
        r = db.execute(text("""SELECT m.id, m.code, m.libelle, m.version_publiee_id, m.societe_id, m.categorie FROM edt_modele m
                               WHERE (CAST(m.id AS text) = :i OR m.code = :i) AND (m.societe_id IS NULL OR CAST(m.societe_id AS text) = :s)
                               ORDER BY CASE WHEN m.societe_id IS NULL THEN 1 ELSE 0 END LIMIT 1"""),
                       {"i": ident, "s": societe_id}).mappings().first()
        if not r:
            raise ErreurNavigation("État introuvable dans la société active")
        if not r["version_publiee_id"]:
            raise ErreurNavigation("Publiez l'état avant d'en faire un écran")
        module = module_modele(db, r["id"], r["categorie"], societe_id)
        return {"code": _code_ecran("MODELE", r["code"]), "libelle": r["libelle"], "icone": "FileText", "module": module,
                "chemin": f"/editions/etat/{r['code']}" + ("" if module == "PAIE" else f"?module={module}")}
    r = db.execute(text("""SELECT id, libelle, module FROM edt_theme WHERE CAST(id AS text) = :i
                           AND (societe_id IS NULL OR CAST(societe_id AS text) = :s)"""),
                   {"i": ident, "s": societe_id}).mappings().first()
    if not r:
        raise ErreurNavigation("Dossier introuvable dans la société active")
    module = (r.get("module") or "PAIE").upper()
    base = "/paie/editions-paie" if module == "PAIE" else f"/editions/menu/{module.lower()}"
    return {"code": _code_ecran("DOSSIER", str(r["id"])), "libelle": r["libelle"], "icone": "FolderOpen", "module": module,
            "chemin": f"{base}?dossier={r['id']}"}


def _repere(db: Session, module: str = "PAIE", creer: bool = False) -> Optional[dict]:
    chemins = REPERES if module == "PAIE" else (CHEMIN_MODULE.get(module, f"/editions/menu/{module.lower()}"),)
    for chemin in chemins:
        r = db.execute(text("""SELECT id, section_id, parent_id, ordre, module_code FROM nav_menu_item
                               WHERE chemin = :c ORDER BY actif DESC LIMIT 1"""), {"c": chemin}).mappings().first()
        if r:
            return dict(r)
    if module == "PAIE" or not creer:
        return None
    # RG-EDT-NAV-07 : « Éditions RH » créé à côté de la fiche collaborateur (sinon dans la section de la paie)
    ancre = None
    for chemin in ANCRES_RH:
        ancre = db.execute(text("""SELECT id, section_id, parent_id, ordre, module_code FROM nav_menu_item
                                   WHERE chemin = :c ORDER BY actif DESC LIMIT 1"""), {"c": chemin}).mappings().first()
        if ancre:
            break
    ancre = dict(ancre) if ancre else (_repere(db, "PAIE") or {})
    code = f"{module.lower()}_editions"
    if db.execute(text("SELECT 1 FROM nav_menu_item WHERE code = :c"), {"c": code}).first():
        code = f"edt_racine_{module.lower()}"
    nid = _creer(db, code, "Éditions RH" if module == "RH" else f"Éditions {module}", "FileText",
                 CHEMIN_MODULE.get(module, f"/editions/menu/{module.lower()}"),
                 {"section_id": ancre.get("section_id"), "id": ancre.get("parent_id"), "module_code": ancre.get("module_code")},
                 (ancre.get("ordre") or 0) + 1, ["administrateur", "gestionnaire_rh"])
    return _repere(db, module)


def etat(db: Session, type_: str, ident: str, societe_id: str) -> dict:
    """L'écran existe-t-il déjà ? (pour le bouton du menu d'éditions)"""
    if not disponible(db):
        return {"disponible": False, "existe": False}
    try:
        c = _cible(db, type_, ident, societe_id)
    except ErreurNavigation:
        return {"disponible": True, "existe": False}
    r = db.execute(text("SELECT id, label, chemin, actif FROM nav_menu_item WHERE code = :c"), {"c": c["code"]}).mappings().first()
    return {"disponible": True, "existe": bool(r), "code": c["code"], "chemin": c["chemin"],
            **({"libelle": r["label"], "actif": r["actif"]} if r else {})}


def generer(db: Session, type_: str, ident: str, societe_id: str, libelle: Optional[str] = None) -> dict:
    if type_ not in ("MODELE", "DOSSIER"):
        raise ErreurNavigation("Type attendu : MODELE ou DOSSIER")
    if not disponible(db):
        raise ErreurNavigation("Navigation configurable absente (tables nav_menu_item, nav_role_visibilite)")
    c = _cible(db, type_, ident, societe_id)
    label = (libelle or c["libelle"]).strip()[:120]
    existe = db.execute(text("SELECT id FROM nav_menu_item WHERE code = :c"), {"c": c["code"]}).scalar()
    if existe:                                                     # RG-EDT-NAV-03
        db.execute(text("UPDATE nav_menu_item SET label = :l, chemin = :ch, actif = true WHERE id = :id"),
                   {"l": label, "ch": c["chemin"], "id": existe})
        return {"id": str(existe), "code": c["code"], "chemin": c["chemin"], "libelle": label, "cree": False}
    ref = _repere(db, c.get("module", "PAIE"), creer=True) or {}
    ordre = db.execute(text("SELECT COALESCE(max(ordre), 0) + 1 FROM nav_menu_item WHERE parent_id = :p"), {"p": ref.get("id")}).scalar() \
        if ref.get("id") else 1
    # RG-EDT-NAV-05 : sous-menu de « Éditions de la paie »
    nouvel = _creer(db, c["code"], label, c["icone"], c["chemin"], ref, ordre, _roles(db, ref.get("id")))
    return {"id": nouvel, "code": c["code"], "chemin": c["chemin"], "libelle": label, "cree": True}


def retirer(db: Session, type_: str, ident: str, societe_id: str) -> None:
    c = _cible(db, type_, ident, societe_id)
    item = db.execute(text("SELECT id FROM nav_menu_item WHERE code = :c"), {"c": c["code"]}).scalar()
    if not item:
        raise ErreurNavigation("Aucun écran généré pour cet élément")
    if db.execute(text("SELECT 1 FROM nav_menu_item WHERE parent_id = :i"), {"i": item}).first():
        raise ErreurNavigation("Des écrans sont rangés sous celui-ci dans la navigation : déplacez-les d'abord")
    db.execute(text("DELETE FROM nav_role_visibilite WHERE item_id = :i"), {"i": item})
    db.execute(text("DELETE FROM nav_menu_item WHERE id = :i"), {"i": item})


def _roles(db: Session, item_id) -> list[str]:
    return [r[0] for r in db.execute(text("SELECT role_code FROM nav_role_visibilite WHERE item_id = :i"), {"i": item_id}).all()] if item_id else []


def _creer(db: Session, code: str, label: str, icone: str, chemin: str, parent: dict, ordre: int, roles: list[str]) -> str:
    nouvel = str(uuid.uuid4())
    db.execute(text("""INSERT INTO nav_menu_item (id, code, label, icone, chemin, section_id, parent_id, ordre, actif, module_code)
                       VALUES (:id, :c, :l, :ic, :ch, :s, :p, :o, true, :m)"""),
               {"id": nouvel, "c": code, "l": label[:120], "ic": icone, "ch": chemin, "s": parent.get("section_id"),
                "p": parent.get("id"), "o": ordre, "m": parent.get("module_code") or "paie"})
    for role in roles or ROLES_DEFAUT:
        db.execute(text("INSERT INTO nav_role_visibilite (id, item_id, role_code) VALUES (:id, :i, :r)"),
                   {"id": str(uuid.uuid4()), "i": nouvel, "r": role})
    return nouvel


def synchroniser(db: Session, arbre: dict, avec_etats: bool = True) -> dict:
    """RG-EDT-NAV-05 : arborescence du menu d'éditions (themes.arbre) → sous-menus de « Éditions de la paie »."""
    if not disponible(db):
        raise ErreurNavigation("Navigation configurable absente (tables nav_menu_item, nav_role_visibilite)")
    racine = _repere(db, arbre.get("module", "PAIE"), creer=True)
    if not racine:
        raise ErreurNavigation("Écran « Éditions de la paie » introuvable dans la navigation")
    roles = _roles(db, racine["id"])
    module = arbre.get("module", "PAIE")
    base = "/paie/editions-paie" if module == "PAIE" else f"/editions/menu/{module.lower()}"
    bilan = {"crees": 0, "mis_a_jour": 0, "retires": 0}
    voulus: set[str] = set()
    themes = arbre["themes"]
    par_id = {t["id"]: t for t in themes}
    ids_nav: dict[str, dict] = {}

    def item(code: str) -> Optional[dict]:
        r = db.execute(text("SELECT id, section_id, parent_id, module_code FROM nav_menu_item WHERE code = :c"), {"c": code}).mappings().first()
        return dict(r) if r else None

    def poser(code: str, label: str, icone: str, chemin: str, parent: dict, ordre: int) -> dict:
        voulus.add(code)
        r = item(code)
        if r:
            db.execute(text("UPDATE nav_menu_item SET label = :l, chemin = :ch, icone = :ic, actif = true WHERE id = :i"),
                       {"l": label[:120], "ch": chemin, "ic": icone, "i": r["id"]})
            bilan["mis_a_jour"] += 1
            return r
        nid = _creer(db, code, label, icone, chemin, parent, ordre, roles)
        bilan["crees"] += 1
        return {"id": nid, "section_id": parent.get("section_id"), "module_code": parent.get("module_code")}

    def profondeur(t: dict) -> int:
        n, p = 0, t.get("parent_id")
        while p and p in par_id:
            n, p = n + 1, par_id[p].get("parent_id")
        return n

    for k, t in enumerate(sorted(themes, key=profondeur)):            # parents d'abord ; ordre du menu conservé
        parent = ids_nav.get(t.get("parent_id")) or racine
        n = poser(_code_ecran("DOSSIER", str(t["id"])), t["libelle"], "FolderOpen", f"{base}?dossier={t['id']}",
                  parent, themes.index(t) + 1)
        ids_nav[t["id"]] = n
        if avec_etats:
            for j, m in enumerate(t["modeles"]):
                chemin = f"/editions/etat/{m['code']}" + ("" if module == "PAIE" else f"?module={module}")
                poser(_code_ecran("MODELE", m["code"]), m["libelle"], "FileText", chemin, n, j + 1)
    # écrans générés dont le dossier ou l'état N'EXISTE PLUS (supprimé, archivé). Un dossier d'une autre société,
    # un état inactif ou masqué ici gardent leur écran (et ses rôles d'accès).
    dossiers = {_code_ecran("DOSSIER", str(r[0])) for r in db.execute(text("SELECT id FROM edt_theme")).all()}
    etats = {_code_ecran("MODELE", r[0]) for r in db.execute(text(
        "SELECT code FROM edt_modele WHERE COALESCE(archive, false) = false")).all()}
    for r in db.execute(text("""SELECT id, code, chemin FROM nav_menu_item WHERE code LIKE 'edt\\_d\\_%' OR code LIKE 'edt\\_m\\_%'""")).mappings():
        if r["code"] in voulus or r["code"] in dossiers or r["code"] in etats:
            continue
        if db.execute(text("SELECT 1 FROM nav_menu_item WHERE parent_id = :i AND code NOT LIKE 'edt\\_%'"), {"i": r["id"]}).first():
            continue                                                     # l'administrateur y a rangé d'autres écrans
        db.execute(text("UPDATE nav_menu_item SET parent_id = NULL WHERE parent_id = :i"), {"i": r["id"]})
        db.execute(text("DELETE FROM nav_role_visibilite WHERE item_id = :i"), {"i": r["id"]})
        db.execute(text("DELETE FROM nav_menu_item WHERE id = :i"), {"i": r["id"]})
        bilan["retires"] += 1
    return bilan


# ---------------------------------------------------------------------------
# RG-EDT-ACCES-01..03 : accès aux états par les rôles des écrans de la navigation
# ---------------------------------------------------------------------------
# RG-EDT-ACCES-01 (Adil DAIA) : quand un état ou un dossier a son écran dans la navigation, les rôles cochés
#   sur cet écran (Configuration › Navigation, ou bouton « Accès » du menu d'éditions) décident qui VOIT et
#   LANCE l'état dans le menu d'éditions, l'écran direct et l'API de lancement du menu.
# RG-EDT-ACCES-02 (Adil DAIA) : l'écran de l'état prime ; sinon celui de son dossier, puis des dossiers parents ;
#   sans aucun écran, l'accès reste celui des droits des éditions (aucun changement). Un écran désactivé ferme
#   l'accès. L'administrateur voit tout.
# RG-EDT-ACCES-03 (Adil DAIA) : régler l'accès d'un état ou d'un dossier sans écran crée l'écran (sous son dossier).
LIBELLES_ROLES = {"collaborateur": "Collaborateur", "manager": "Manager", "gestionnaire_rh": "Gestionnaire RH",
                  "gestionnaire_paie": "Gestionnaire paie", "administrateur": "Administrateur"}


def _ecrans_generes(db: Session) -> dict[str, dict]:
    """code d'écran edt_* → {actif, roles}"""
    res: dict[str, dict] = {}
    for r in db.execute(text("""SELECT i.code, i.actif, v.role_code FROM nav_menu_item i
                                LEFT JOIN nav_role_visibilite v ON v.item_id = i.id
                                WHERE i.code LIKE 'edt\\_d\\_%' OR i.code LIKE 'edt\\_m\\_%'""")).mappings():
        e = res.setdefault(r["code"], {"actif": bool(r["actif"]), "roles": set()})
        if r["role_code"]:
            e["roles"].add(r["role_code"])
    return res


def filtrer_acces(db: Session, roles: frozenset, admin: bool, themes: list[dict]) -> list[dict]:
    """RG-EDT-ACCES-01/02 : retire des thèmes (arbre du menu) les états que ces rôles ne peuvent pas voir."""
    if admin or not disponible(db):
        return themes
    ecrans = _ecrans_generes(db)
    if not ecrans:
        return themes
    par_id = {t["id"]: t for t in themes}

    def regle(theme_id: Optional[str]) -> Optional[dict]:
        while theme_id:
            e = ecrans.get(_code_ecran("DOSSIER", str(theme_id)))
            if e:
                return e
            theme_id = (par_id.get(theme_id) or {}).get("parent_id")
        return None

    def ouvert(e: Optional[dict]) -> bool:
        return e is None or (e["actif"] and bool(e["roles"] & set(roles)))

    sortie = []
    for t in themes:
        du_dossier = regle(t["id"])
        modeles = [m for m in t["modeles"] if ouvert(ecrans.get(_code_ecran("MODELE", m["code"])) or du_dossier)]
        sortie.append({**t, "modeles": modeles})
    # dossiers devenus vides (et sans descendant garni) masqués
    garnis = {t["id"] for t in sortie if t["modeles"]}
    parents = {t["id"]: t.get("parent_id") for t in sortie}
    for tid in list(garnis):
        p = parents.get(tid)
        while p:
            garnis.add(p)
            p = parents.get(p)
    return [t for t in sortie if t["id"] in garnis]


def roles_disponibles(db: Session) -> list[dict]:
    codes = set(LIBELLES_ROLES)
    if disponible(db):
        codes |= {r[0] for r in db.execute(text("SELECT DISTINCT role_code FROM nav_role_visibilite")).all() if r[0]}
    ordre = list(LIBELLES_ROLES)
    return [{"code": c, "libelle": LIBELLES_ROLES.get(c, c.replace("_", " ").capitalize())}
            for c in sorted(codes, key=lambda c: (ordre.index(c) if c in ordre else 99, c))]


def acces(db: Session, type_: str, ident: str, societe_id: str, theme_parent: Optional[str] = None) -> dict:
    """Rôles de l'écran de l'état ou du dossier ; à défaut, ceux dont il hérite (dossier, « Éditions de la paie »)."""
    c = _cible(db, type_, ident, societe_id)
    ecrans = _ecrans_generes(db) if disponible(db) else {}
    propre = ecrans.get(c["code"])
    herite_de, roles = None, None
    if propre is None:
        t = theme_parent
        while t:
            e = ecrans.get(_code_ecran("DOSSIER", str(t)))
            if e:
                herite_de, roles = "dossier", sorted(e["roles"])
                break
            t = db.execute(text("SELECT CAST(parent_id AS text) FROM edt_theme WHERE CAST(id AS text) = :t"), {"t": t}).scalar()
    return {"code": c["code"], "existe": propre is not None, "actif": propre["actif"] if propre else None,
            "roles": sorted(propre["roles"]) if propre else (roles or []), "herite_de": herite_de if propre is None else None,
            "roles_disponibles": roles_disponibles(db)}


def regler_acces(db: Session, type_: str, ident: str, societe_id: str, roles: list[str], parent_theme: Optional[str] = None) -> dict:
    """RG-EDT-ACCES-03 : écrit les rôles de l'écran (créé au besoin, sous l'écran de son dossier s'il existe)."""
    c = _cible(db, type_, ident, societe_id)
    item = db.execute(text("SELECT id FROM nav_menu_item WHERE code = :c"), {"c": c["code"]}).scalar()
    if not item:
        generer(db, type_, ident, societe_id)
        item = db.execute(text("SELECT id FROM nav_menu_item WHERE code = :c"), {"c": c["code"]}).scalar()
        parent = None
        t = parent_theme
        while t and not parent:                    # sous l'écran du dossier (ou d'un dossier parent) s'il existe
            parent = db.execute(text("SELECT id FROM nav_menu_item WHERE code = :c"), {"c": _code_ecran("DOSSIER", str(t))}).scalar()
            if not parent:
                t = db.execute(text("SELECT CAST(parent_id AS text) FROM edt_theme WHERE CAST(id AS text) = :t"), {"t": t}).scalar()
        if parent and parent != item:
            db.execute(text("UPDATE nav_menu_item SET parent_id = :p WHERE id = :i"), {"p": parent, "i": item})
    db.execute(text("DELETE FROM nav_role_visibilite WHERE item_id = :i"), {"i": item})
    for role in sorted(set(r for r in roles if r)):
        db.execute(text("INSERT INTO nav_role_visibilite (id, item_id, role_code) VALUES (:id, :i, :r)"),
                   {"id": str(uuid.uuid4()), "i": item, "r": role})
    return acces(db, type_, ident, societe_id, parent_theme)
