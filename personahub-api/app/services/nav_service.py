# ============================================================
# nav_service.py — app/services/nav_service.py
# ------------------------------------------------------------
# get_menu_pour_role durci :
#   • Filtrage par rôle via nav_role_visibilite (inchangé).
#   • Construction d'arbre robuste : un enfant dont le parent
#     n'est PAS visible pour ce rôle n'est plus perdu — il est
#     remonté au niveau de sa section (plus d'orphelin invisible).
#   • Tri parents et enfants par `ordre`.
#   • Renvoie aussi `roles` par item (utile au filtrage front).
# ============================================================
from __future__ import annotations
import uuid
from typing import Optional, List
from sqlalchemy import text
from sqlalchemy.orm import Session


# ──────────────────────────────────────────────────────────────
# LECTURE (utilisé par Sidebar + contexte frontend)
# ──────────────────────────────────────────────────────────────

def get_menu_pour_role(db: Session, role_code: str) -> List[dict]:
    """
    Arbre de navigation filtré pour un rôle : liste de sections,
    chaque section portant ses items (avec enfants imbriqués).
    """
    rows = db.execute(text("""
        SELECT
            i.id, i.code, i.label, i.icone, i.chemin,
            i.parent_id, i.ordre, i.actif,
            i.section_id, i.module_code,
            s.label AS section_label,
            s.ordre AS section_ordre,
            s.code  AS section_code,
            COALESCE(
                (SELECT array_agg(v2.role_code ORDER BY v2.role_code)
                 FROM nav_role_visibilite v2 WHERE v2.item_id = i.id),
                ARRAY[]::TEXT[]
            ) AS roles
        FROM nav_menu_item i
        LEFT JOIN nav_section s ON s.id = i.section_id
        WHERE i.actif = TRUE
          AND (s.actif IS NULL OR s.actif = TRUE)
          AND EXISTS (
              SELECT 1 FROM nav_role_visibilite v
              WHERE v.item_id = i.id AND v.role_code = :role
          )
        ORDER BY s.ordre NULLS LAST, i.ordre
    """), {"role": role_code}).fetchall()

    items = [dict(r._mapping) for r in rows]

    # Normalisation : ids en str, init enfants, ordre par défaut
    for it in items:
        it["id"] = str(it["id"])
        it["parent_id"] = str(it["parent_id"]) if it["parent_id"] else None
        it["section_id"] = str(it["section_id"]) if it["section_id"] else None
        it["ordre"] = it.get("ordre") or 0
        it["enfants"] = []

    visibles_ids = {it["id"] for it in items}
    par_id = {it["id"]: it for it in items}

    # 1) Rattacher chaque enfant à son parent SI le parent est visible.
    #    Sinon l'enfant est "promu" racine de sa section (plus d'orphelin).
    racines: List[dict] = []
    for it in items:
        pid = it["parent_id"]
        if pid and pid in visibles_ids:
            par_id[pid]["enfants"].append(it)
        else:
            racines.append(it)

    # 2) Regrouper les racines par section
    sections: dict = {}
    for it in racines:
        sec_id = it["section_id"] or "__sans_section__"
        if sec_id not in sections:
            sections[sec_id] = {
                "id":    sec_id,
                "code":  it.get("section_code") or "__sans_section__",
                "label": it.get("section_label") or "",
                "ordre": it.get("section_ordre") if it.get("section_ordre") is not None else 999,
                "items": [],
            }
        sections[sec_id]["items"].append(it)

    # 3) Tri : items de chaque section, puis enfants de chaque item
    def trier(noeuds: List[dict]) -> None:
        noeuds.sort(key=lambda n: n.get("ordre", 0))
        for n in noeuds:
            if n.get("enfants"):
                trier(n["enfants"])

    for sec in sections.values():
        trier(sec["items"])

    return sorted(sections.values(), key=lambda s: s["ordre"])


def get_tous_items(db: Session) -> List[dict]:
    """Tous les items (admin) avec leurs rôles."""
    rows = db.execute(text("""
        SELECT
            i.*,
            s.label AS section_label, s.ordre AS section_ordre, s.code AS section_code,
            COALESCE(
                (SELECT array_agg(v.role_code ORDER BY v.role_code)
                 FROM nav_role_visibilite v WHERE v.item_id = i.id),
                ARRAY[]::TEXT[]
            ) AS roles
        FROM nav_menu_item i
        LEFT JOIN nav_section s ON s.id = i.section_id
        ORDER BY s.ordre NULLS LAST, i.ordre
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


def get_toutes_sections(db: Session) -> List[dict]:
    rows = db.execute(text(
        "SELECT * FROM nav_section ORDER BY ordre"
    )).fetchall()
    return [dict(r._mapping) for r in rows]


# ──────────────────────────────────────────────────────────────
# ÉCRITURE (admin uniquement)
# ──────────────────────────────────────────────────────────────

def creer_item(
    db: Session, *, code: str, label: str, icone: Optional[str] = None,
    chemin: Optional[str] = None, section_id: Optional[str] = None,
    parent_id: Optional[str] = None, ordre: int = 0,
    module_code: Optional[str] = None,
) -> dict:
    item_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO nav_menu_item
            (id, code, label, icone, chemin, section_id, parent_id, ordre, module_code)
        VALUES
            (:id, :code, :label, :icone, :chemin, :section_id, :parent_id, :ordre, :module_code)
    """), {"id": item_id, "code": code, "label": label, "icone": icone,
           "chemin": chemin, "section_id": section_id, "parent_id": parent_id,
           "ordre": ordre, "module_code": module_code})
    return _get_item(db, item_id)


def _cascade_actif_descendants(db: Session, item_id: str, actif: bool) -> None:
    """Propage l'état `actif` à TOUS les descendants (sous-menus, sous-sous-menus…)
    d'un élément. Désactiver un menu parent désactive ses sous-menus ; le
    réactiver les réactive."""
    db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT id FROM nav_menu_item WHERE parent_id = :id
            UNION ALL
            SELECT c.id FROM nav_menu_item c
            JOIN descendants d ON c.parent_id = d.id
        )
        UPDATE nav_menu_item SET actif = :actif
        WHERE id IN (SELECT id FROM descendants)
    """), {"id": item_id, "actif": actif})


def modifier_item(db: Session, item_id: str, **champs) -> Optional[dict]:
    autorises = {"label", "icone", "chemin", "section_id", "parent_id", "ordre", "actif", "module_code"}
    updates = {k: v for k, v in champs.items() if k in autorises}
    if not updates:
        return _get_item(db, item_id)
    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    params = dict(updates)
    params["item_id"] = item_id
    db.execute(text(f"UPDATE nav_menu_item SET {set_clause} WHERE id = :item_id"), params)
    # Cascade hiérarchique de l'état actif vers les sous-menus
    if "actif" in updates:
        _cascade_actif_descendants(db, item_id, updates["actif"])
    return _get_item(db, item_id)


def supprimer_item(db: Session, item_id: str) -> bool:
    # Soft delete : désactiver plutôt que supprimer, puis cascade aux sous-menus
    r = db.execute(text(
        "UPDATE nav_menu_item SET actif = FALSE WHERE id = :id"), {"id": item_id})
    _cascade_actif_descendants(db, item_id, False)
    return r.rowcount > 0


def reordonner_items(db: Session, ordres: List[dict]) -> None:
    for entry in ordres:
        db.execute(text(
            "UPDATE nav_menu_item SET ordre = :ordre WHERE id = :id"),
            {"ordre": entry["ordre"], "id": entry["id"]})


def set_roles_item(db: Session, item_id: str, roles: List[str]) -> None:
    """Remplace intégralement les rôles d'un item."""
    db.execute(text(
        "DELETE FROM nav_role_visibilite WHERE item_id = :id"), {"id": item_id})
    for role in roles:
        db.execute(text("""
            INSERT INTO nav_role_visibilite (id, item_id, role_code)
            VALUES (gen_random_uuid(), :item_id, :role)
            ON CONFLICT (item_id, role_code) DO NOTHING
        """), {"item_id": item_id, "role": role})


# Sections
def creer_section(db: Session, *, code: str, label: str, ordre: int = 0) -> dict:
    sec_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO nav_section (id, code, label, ordre)
        VALUES (:id, :code, :label, :ordre)
    """), {"id": sec_id, "code": code, "label": label, "ordre": ordre})
    return _get_section(db, sec_id)


def modifier_section(db: Session, sec_id: str, **champs) -> Optional[dict]:
    autorises = {"label", "ordre", "actif"}
    updates = {k: v for k, v in champs.items() if k in autorises}
    if not updates:
        return _get_section(db, sec_id)
    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    params = dict(updates)
    params["sec_id"] = sec_id
    db.execute(text(f"UPDATE nav_section SET {set_clause} WHERE id = :sec_id"), params)

    # Cascade : l'état actif d'une section gouverne TOUS ses écrans et
    # sous-menus. Désactiver la section -> tout devient inactif ;
    # la réactiver -> tout redevient actif.
    if "actif" in updates:
        db.execute(text("""
            UPDATE nav_menu_item
            SET actif = :actif
            WHERE section_id = :sec
               OR parent_id IN (SELECT id FROM nav_menu_item WHERE section_id = :sec)
        """), {"actif": updates["actif"], "sec": sec_id})

    return _get_section(db, sec_id)


def reordonner_sections(db: Session, ordres: List[dict]) -> None:
    for entry in ordres:
        db.execute(text("UPDATE nav_section SET ordre = :ordre WHERE id = :id"),
                   {"ordre": entry["ordre"], "id": entry["id"]})


# ── Helpers privés ────────────────────────────────────────────
def _get_item(db: Session, item_id: str) -> Optional[dict]:
    row = db.execute(text("""
        SELECT i.*, s.label AS section_label,
               COALESCE(
                   (SELECT array_agg(v.role_code) FROM nav_role_visibilite v WHERE v.item_id = i.id),
                   ARRAY[]::TEXT[]
               ) AS roles
        FROM nav_menu_item i
        LEFT JOIN nav_section s ON s.id = i.section_id
        WHERE i.id = :id
    """), {"id": item_id}).fetchone()
    return dict(row._mapping) if row else None


def _get_section(db: Session, sec_id: str) -> Optional[dict]:
    row = db.execute(text(
        "SELECT * FROM nav_section WHERE id = :id"), {"id": sec_id}).fetchone()
    return dict(row._mapping) if row else None
