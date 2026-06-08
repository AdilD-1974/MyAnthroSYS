# app/services/tache_service.py
# ------------------------------------------------------------
# Service métier — Module tâches PersonaHub HR
# Logique : périmètre par rôle, CRUD, assignation, rappels
# ------------------------------------------------------------
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


# ────────────────────────────────────────────────────────────
# Helpers internes
# ────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row_to_dict(row) -> dict:
    """Convertit un Row SQLAlchemy en dict sérialisable."""
    return dict(row._mapping)


# ────────────────────────────────────────────────────────────
# Périmètre — quelles tâches un utilisateur peut-il voir ?
# ────────────────────────────────────────────────────────────

def get_taches_perimetre(
    db: Session,
    user_id: str,
    roles: list[str],
    *,
    statut: Optional[str] = None,
    priorite: Optional[str] = None,
    type_tache: Optional[str] = None,
    date_debut: Optional[date] = None,
    date_fin: Optional[date] = None,
    assignataire_id: Optional[str] = None,
    etiquette: Optional[str] = None,
    search: Optional[str] = None,
    include_terminees: bool = False,
) -> list[dict]:
    """
    Retourne les tâches visibles par l'utilisateur selon son rôle :
    - collaborateur    : ses tâches perso + où il est assigné
    - manager / RH / paie : idem + tâches de son périmètre hiérarchique
    - administrateur   : toutes
    """
    is_admin = "administrateur" in roles
    is_manager = any(r in roles for r in ("manager", "gestionnaire_rh", "gestionnaire_paie"))

    conditions = []
    params: dict[str, Any] = {"user_id": user_id}

    if is_admin:
        base_filter = "1=1"
    elif is_manager:
        base_filter = """(
            t.proprietaire_id = :user_id
            OR t.createur_id   = :user_id
            OR EXISTS (
                SELECT 1 FROM tache_assignation ta
                WHERE ta.tache_id = t.id AND ta.collaborateur_id = :user_id
            )
            OR t.proprietaire_id IN (
                SELECT collab_id FROM v_perimetre_manager WHERE manager_id = :user_id
            )
        )"""
    else:
        base_filter = """(
            t.proprietaire_id = :user_id
            OR t.createur_id   = :user_id
            OR EXISTS (
                SELECT 1 FROM tache_assignation ta
                WHERE ta.tache_id = t.id AND ta.collaborateur_id = :user_id
            )
        )"""

    conditions.append(base_filter)

    if not include_terminees:
        conditions.append("t.statut NOT IN ('terminee','annulee')")

    if statut:
        conditions.append("t.statut = :statut")
        params["statut"] = statut

    if priorite:
        conditions.append("t.priorite = :priorite")
        params["priorite"] = priorite

    if type_tache:
        conditions.append("t.type_tache = :type_tache")
        params["type_tache"] = type_tache

    if date_debut:
        conditions.append("t.date_echeance >= :date_debut")
        params["date_debut"] = date_debut

    if date_fin:
        conditions.append("t.date_echeance <= :date_fin")
        params["date_fin"] = date_fin

    if assignataire_id:
        conditions.append("""EXISTS (
            SELECT 1 FROM tache_assignation ta2
            WHERE ta2.tache_id = t.id AND ta2.collaborateur_id = :assignataire_id
        )""")
        params["assignataire_id"] = assignataire_id

    if etiquette:
        conditions.append(":etiquette = ANY(t.etiquettes)")
        params["etiquette"] = etiquette

    if search:
        conditions.append("(t.titre ILIKE :search OR t.description ILIKE :search)")
        params["search"] = f"%{search}%"

    where_clause = " AND ".join(conditions)

    sql = text(f"""
        SELECT
            t.*,
            COALESCE(
                json_agg(
                    json_build_object(
                        'collaborateur_id', ta.collaborateur_id,
                        'role_assignation', ta.role_assignation
                    )
                ) FILTER (WHERE ta.id IS NOT NULL),
                '[]'::json
            ) AS assignations,
            CASE WHEN t.date_echeance < CURRENT_DATE
                      AND t.statut NOT IN ('terminee','annulee')
                 THEN TRUE ELSE FALSE END AS en_retard
        FROM tache t
        LEFT JOIN tache_assignation ta ON ta.tache_id = t.id
        WHERE {where_clause}
        GROUP BY t.id
        ORDER BY
            CASE t.priorite
                WHEN 'urgente' THEN 1 WHEN 'haute' THEN 2
                WHEN 'normale' THEN 3 ELSE 4
            END,
            t.date_echeance NULLS LAST,
            t.cree_le DESC
    """)

    rows = db.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


# ────────────────────────────────────────────────────────────
# CRUD
# ────────────────────────────────────────────────────────────

def get_tache_by_id(db: Session, tache_id: str, user_id: str, roles: list[str]) -> Optional[dict]:
    is_admin = "administrateur" in roles
    params: dict[str, Any] = {"tache_id": tache_id, "user_id": user_id}

    access_filter = "" if is_admin else """
        AND (
            t.proprietaire_id = :user_id
            OR t.createur_id   = :user_id
            OR EXISTS (SELECT 1 FROM tache_assignation ta WHERE ta.tache_id = t.id AND ta.collaborateur_id = :user_id)
        )
    """

    sql = text(f"""
        SELECT t.*,
            COALESCE(
                json_agg(
                    json_build_object(
                        'collaborateur_id', ta.collaborateur_id,
                        'role_assignation', ta.role_assignation,
                        'assigne_le', ta.assigne_le
                    )
                ) FILTER (WHERE ta.id IS NOT NULL),
                '[]'::json
            ) AS assignations,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', tr.id,
                        'date_rappel', tr.date_rappel,
                        'type_rappel', tr.type_rappel,
                        'envoye', tr.envoye
                    )
                ) FILTER (WHERE tr.id IS NOT NULL AND tr.destinataire_id = :user_id),
                '[]'::json
            ) AS rappels
        FROM tache t
        LEFT JOIN tache_assignation ta ON ta.tache_id = t.id
        LEFT JOIN tache_rappel tr ON tr.tache_id = t.id
        WHERE t.id = :tache_id {access_filter}
        GROUP BY t.id
    """)

    row = db.execute(sql, params).fetchone()
    return _row_to_dict(row) if row else None


def create_tache(db: Session, data: dict, createur_id: str) -> dict:
    tache_id = str(uuid.uuid4())
    proprietaire_id = data.get("proprietaire_id") or createur_id

    sql = text("""
        INSERT INTO tache (
            id, titre, description, type_tache, statut, priorite,
            date_echeance, date_debut, createur_id, proprietaire_id,
            demande_id, wf_instance_id, wf_etape_id, etiquettes, metadata
        ) VALUES (
            :id, :titre, :description, :type_tache, :statut, :priorite,
            :date_echeance, :date_debut, :createur_id, :proprietaire_id,
            :demande_id, :wf_instance_id, :wf_etape_id, :etiquettes, :metadata
        )
        RETURNING *
    """)

    params = {
        "id":             tache_id,
        "titre":          data["titre"],
        "description":    data.get("description"),
        "type_tache":     data.get("type_tache", "personnelle"),
        "statut":         data.get("statut", "a_faire"),
        "priorite":       data.get("priorite", "normale"),
        "date_echeance":  data.get("date_echeance"),
        "date_debut":     data.get("date_debut"),
        "createur_id":    createur_id,
        "proprietaire_id": proprietaire_id,
        "demande_id":     data.get("demande_id"),
        "wf_instance_id": data.get("wf_instance_id"),
        "wf_etape_id":    data.get("wf_etape_id"),
        "etiquettes":     data.get("etiquettes", []) or [],
        "metadata":       json.dumps(data.get("metadata", {}) or {}),
    }

    row = db.execute(sql, params).fetchone()

    # Assignations initiales
    assignations = data.get("assignations", [])
    for a in assignations:
        _insert_assignation(db, tache_id, a["collaborateur_id"], a.get("role", "responsable"), createur_id)

    # Lien workflow si présent
    if data.get("wf_instance_id"):
        db.execute(text("""
            INSERT INTO tache_lien_wf(tache_id, instance_id, etape_id)
            VALUES (:tache_id, :instance_id, :etape_id)
            ON CONFLICT DO NOTHING
        """), {
            "tache_id":   tache_id,
            "instance_id": data["wf_instance_id"],
            "etape_id":   data.get("wf_etape_id"),
        })

    db.commit()
    return _row_to_dict(row)


def update_tache(db: Session, tache_id: str, data: dict, user_id: str) -> Optional[dict]:
    allowed = {
        "titre", "description", "statut", "priorite",
        "date_echeance", "date_debut", "etiquettes", "metadata",
        "proprietaire_id", "demande_id"
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return get_tache_by_id(db, tache_id, user_id, [])

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["tache_id"] = tache_id

    row = db.execute(text(f"""
        UPDATE tache SET {set_clause}
        WHERE id = :tache_id
        RETURNING *
    """), updates).fetchone()

    if not row:
        return None

    # Gestion des assignations si fournies
    if "assignations" in data:
        db.execute(text("DELETE FROM tache_assignation WHERE tache_id = :tid"), {"tid": tache_id})
        for a in data["assignations"]:
            _insert_assignation(db, tache_id, a["collaborateur_id"], a.get("role", "responsable"), user_id)

    db.commit()
    return _row_to_dict(row)


def delete_tache(db: Session, tache_id: str, user_id: str, roles: list[str]) -> bool:
    is_admin = "administrateur" in roles
    extra = "" if is_admin else "AND (createur_id = :user_id OR proprietaire_id = :user_id)"
    result = db.execute(
        text(f"DELETE FROM tache WHERE id = :tache_id {extra} RETURNING id"),
        {"tache_id": tache_id, "user_id": user_id}
    ).fetchone()
    db.commit()
    return result is not None


# ────────────────────────────────────────────────────────────
# Assignations
# ────────────────────────────────────────────────────────────

def _insert_assignation(db: Session, tache_id: str, collab_id: str, role: str, assigne_par: str):
    db.execute(text("""
        INSERT INTO tache_assignation(tache_id, collaborateur_id, role_assignation, assigne_par)
        VALUES (:tache_id, :collab_id, :role, :assigne_par)
        ON CONFLICT (tache_id, collaborateur_id) DO UPDATE SET role_assignation = EXCLUDED.role_assignation
    """), {"tache_id": tache_id, "collab_id": collab_id, "role": role, "assigne_par": assigne_par})


# ────────────────────────────────────────────────────────────
# Compteurs (pour le badge sidebar)
# ────────────────────────────────────────────────────────────

def get_compteurs(db: Session, user_id: str) -> dict:
    row = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE statut IN ('a_faire','en_cours'))                        AS total_actives,
            COUNT(*) FILTER (WHERE statut IN ('a_faire','en_cours')
                                    AND date_echeance < CURRENT_DATE)                       AS en_retard,
            COUNT(*) FILTER (WHERE statut IN ('a_faire','en_cours')
                                    AND date_echeance = CURRENT_DATE)                       AS dues_aujourd_hui,
            COUNT(*) FILTER (WHERE statut = 'a_faire'
                                    AND (priorite = 'urgente' OR priorite = 'haute'))        AS haute_priorite
        FROM tache
        WHERE (
            proprietaire_id = :uid
            OR createur_id   = :uid
            OR EXISTS (
                SELECT 1 FROM tache_assignation ta WHERE ta.tache_id = tache.id AND ta.collaborateur_id = :uid
            )
        )
    """), {"uid": user_id}).fetchone()
    return _row_to_dict(row)


# ────────────────────────────────────────────────────────────
# Création depuis workflow_engine (TACHE_SYSTEME)
# ────────────────────────────────────────────────────────────

def create_tache_depuis_workflow(
    db: Session,
    *,
    titre: str,
    description: str | None,
    proprietaire_id: str,
    instance_id: str,
    etape_id: str | None = None,
    date_echeance: date | None = None,
    priorite: str = "normale",
    assignations: list[dict] | None = None,
    demande_id: str | None = None,
) -> dict:
    """
    Appelé par workflow_engine.py lors d'une action TACHE_SYSTEME.
    Crée une tâche de type 'workflow' liée à l'instance.
    """
    data = {
        "titre":          titre,
        "description":    description,
        "type_tache":     "workflow",
        "priorite":       priorite,
        "date_echeance":  date_echeance,
        "wf_instance_id": instance_id,
        "wf_etape_id":    etape_id,
        "demande_id":     demande_id,
        "proprietaire_id": proprietaire_id,
        "assignations":   assignations or [],
    }
    return create_tache(db, data, createur_id=proprietaire_id)
