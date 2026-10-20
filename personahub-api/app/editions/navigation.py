"""
app/editions/navigation.py — Écrans d'édition générés dans la navigation de l'application.
Auteur : Adil DAIA — 20/10/2026 — RG-EDT-NAV-02..04

RG-EDT-NAV-02 (Adil DAIA) : un état publié, ou un dossier du menu d'éditions, peut devenir un ÉCRAN de
    l'application : une entrée nav_menu_item visible dans Configuration › Navigation, comme les autres
    écrans (section, ordre, imbrication, rôles s'y règlent ensuite).
      - état   → /editions/etat/<CODE>  (lancement direct de l'état ; ?module=RH pour un autre module)
      - dossier → /paie/editions-paie?dossier=<id>       (menu d'éditions réduit à ce dossier)
    Placement initial : à côté de « Éditions de la paie » (même section, même parent), avec ses rôles ;
    à défaut ceux des gestionnaires et de l'administrateur.
RG-EDT-NAV-03 (Adil DAIA) : génération idempotente : un second appel met à jour le libellé, jamais de doublon
    (code d'écran edt_m_<code état> / edt_d_<dossier>).
RG-EDT-NAV-04 (Adil DAIA) : retirer l'écran supprime l'entrée et ses rôles ; l'état ou le dossier restent.
"""
from __future__ import annotations

import re
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

ROLES_DEFAUT = ("administrateur", "gestionnaire_paie", "gestionnaire_rh")
REPERES = ("/paie/editions-paie", "/paie/edition-bulletins", "/paie/editions/bulletins", "/paie/editions", "/editions")


class ErreurNavigation(Exception):
    pass


def disponible(db: Session) -> bool:
    return db.execute(text("""SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                              AND table_name IN ('nav_menu_item', 'nav_role_visibilite')""")).scalar() == 2


def _code_ecran(type_: str, ident: str) -> str:
    base = re.sub(r"[^a-z0-9_]+", "_", ident.lower()).strip("_")
    return (f"edt_m_{base}" if type_ == "MODELE" else f"edt_d_{base[:36]}")[:80]


def _cible(db: Session, type_: str, ident: str, societe_id: str) -> dict:
    if type_ == "MODELE":
        r = db.execute(text("""SELECT m.id, m.code, m.libelle, m.version_publiee_id, m.societe_id FROM edt_modele m
                               WHERE (CAST(m.id AS text) = :i OR m.code = :i) AND (m.societe_id IS NULL OR CAST(m.societe_id AS text) = :s)
                               ORDER BY CASE WHEN m.societe_id IS NULL THEN 1 ELSE 0 END LIMIT 1"""),
                       {"i": ident, "s": societe_id}).mappings().first()
        if not r:
            raise ErreurNavigation("État introuvable dans la société active")
        if not r["version_publiee_id"]:
            raise ErreurNavigation("Publiez l'état avant d'en faire un écran")
        return {"code": _code_ecran("MODELE", r["code"]), "libelle": r["libelle"], "icone": "FileText",
                "chemin": f"/editions/etat/{r['code']}"}
    r = db.execute(text("""SELECT id, libelle, module FROM edt_theme WHERE CAST(id AS text) = :i
                           AND (societe_id IS NULL OR CAST(societe_id AS text) = :s)"""),
                   {"i": ident, "s": societe_id}).mappings().first()
    if not r:
        raise ErreurNavigation("Dossier introuvable dans la société active")
    module = (r.get("module") or "PAIE").upper()
    base = "/paie/editions-paie" if module == "PAIE" else f"/editions/menu/{module.lower()}"
    return {"code": _code_ecran("DOSSIER", str(r["id"])), "libelle": r["libelle"], "icone": "FolderOpen",
            "chemin": f"{base}?dossier={r['id']}"}


def _repere(db: Session) -> Optional[dict]:
    for chemin in REPERES:
        r = db.execute(text("""SELECT id, section_id, parent_id, ordre, module_code FROM nav_menu_item
                               WHERE chemin = :c ORDER BY actif DESC LIMIT 1"""), {"c": chemin}).mappings().first()
        if r:
            return dict(r)
    return None


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
    ref = _repere(db) or {}
    nouvel = str(uuid.uuid4())
    db.execute(text("""INSERT INTO nav_menu_item (id, code, label, icone, chemin, section_id, parent_id, ordre, actif, module_code)
                       VALUES (:id, :c, :l, :ic, :ch, :s, :p, :o, true, :m)"""),
               {"id": nouvel, "c": c["code"], "l": label, "ic": c["icone"], "ch": c["chemin"], "s": ref.get("section_id"),
                "p": ref.get("parent_id"), "o": (ref.get("ordre") or 0) + 1, "m": ref.get("module_code") or "paie"})
    roles = [r[0] for r in db.execute(text("SELECT role_code FROM nav_role_visibilite WHERE item_id = :i"),
                                      {"i": ref.get("id")}).all()] if ref.get("id") else []
    for role in roles or ROLES_DEFAUT:
        db.execute(text("INSERT INTO nav_role_visibilite (id, item_id, role_code) VALUES (:id, :i, :r)"),
                   {"id": str(uuid.uuid4()), "i": nouvel, "r": role})
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
