"""
app/routers/demandes.py — Registre unifié des demandes (lecture enrichie)
Auteur : Adil DAIA

Expose la liste des demandes (en-tête générique `demande`) enrichie de :
  - le libellé du type (ref_type_demande)
  - le demandeur (nom / prénom / matricule)
  - un résumé métier selon le type (pour CONGE : dates, jours, type de congé)

Endpoints :
  GET /api/v1/demandes/mes/{collaborateur_id}   — mes demandes (demandeur)
  GET /api/v1/demandes/perimetre/{user_id}      — demandes du périmètre d'un gestionnaire/manager
                                                  (périmètre de gestion OU hiérarchie), tous statuts

Le résumé métier est ajouté de façon générique : pour chaque type connu, on
joint la table métier. Ajouter un type = ajouter une branche de résumé ici,
sans toucher au frontend.
"""
from __future__ import annotations

from typing import Optional, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload

router = APIRouter(prefix="/demandes", tags=["demandes"])


# ─── Enrichissement : résumé métier par type ────────────────────────────────────

def _resume_conge(db: Session, ids: list[str]) -> dict[str, dict]:
    """Détail complet des demandes de congé indexé par id_objet
    (toutes les colonnes + libellé du type, pour la fiche de consultation)."""
    if not ids:
        return {}
    # Clause IN paramétrée (robuste quel que soit le driver, évite ANY(:list))
    placeholders = ", ".join(f":id{i}" for i in range(len(ids)))
    params = {f"id{i}": str(v) for i, v in enumerate(ids)}
    rows = db.execute(text(f"""
        SELECT cd.*, rt.libelle AS libelle_type_conge
        FROM cong_demandes cd
        LEFT JOIN ref_type_conge rt ON rt.code = cd.code_type_conge
        WHERE cd.id IN ({placeholders})
    """), params).mappings().all()
    return {str(r["id"]): dict(r) for r in rows}


# Table métier → fonction de résumé (générique, extensible)
_RESUME_PAR_TABLE = {
    "cong_demandes": _resume_conge,
}


def _enrichir(db: Session, rows: list[dict]) -> list[dict]:
    """Ajoute le résumé métier à chaque demande, groupé par table_objet."""
    par_table: dict[str, list[str]] = {}
    for r in rows:
        par_table.setdefault(r["table_objet"], []).append(str(r["id_objet"]))

    resumes: dict[str, dict[str, dict]] = {}
    for table, ids in par_table.items():
        fn = _RESUME_PAR_TABLE.get(table)
        resumes[table] = fn(db, ids) if fn else {}

    out = []
    for r in rows:
        d = dict(r)
        d["resume"] = resumes.get(r["table_objet"], {}).get(str(r["id_objet"]))
        out.append(d)
    return out


_BASE_SELECT = """
    SELECT d.id, d.reference, d.type_demande, td.libelle AS type_libelle,
           td.icone AS type_icone, d.table_objet, d.id_objet,
           d.demandeur_id, c.nom AS demandeur_nom, c.prenom AS demandeur_prenom,
           c.matricule AS demandeur_matricule,
           d.statut, d.wf_instance_id, d.date_soumission, d.date_decision,
           d.created_at, d.updated_at
    FROM demande d
    LEFT JOIN ref_type_demande td ON td.code = d.type_demande
    LEFT JOIN collaborateurs c ON c.id = d.demandeur_id
"""


@router.get("/mes/{collaborateur_id}")
def mes_demandes(
    collaborateur_id: UUID,
    type_demande: Optional[str] = None,
    statut: Optional[str] = None,
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    """Demandes dont le collaborateur est le demandeur (tous types, tous statuts)."""
    sql = _BASE_SELECT + " WHERE d.demandeur_id = :cid AND d.archive = false"
    params: dict[str, Any] = {"cid": str(collaborateur_id)}
    if type_demande:
        sql += " AND d.type_demande = :t"; params["t"] = type_demande
    if statut:
        sql += " AND d.statut = :s"; params["s"] = statut
    sql += " ORDER BY d.created_at DESC"
    rows = db.execute(text(sql), params).mappings().all()
    return _enrichir(db, [dict(r) for r in rows])


@router.get("/perimetre/{user_id}")
def demandes_perimetre(
    user_id: UUID,
    type_demande: Optional[str] = None,
    statut: Optional[str] = None,
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    """Toutes les demandes du périmètre d'un gestionnaire/manager, tous statuts.

    Un demandeur est dans le périmètre si :
      - le user est ADMINISTRATEUR → il voit TOUTES les demandes (sans restriction), OU
      - il est dans le périmètre de GESTION du user (wf_collaborateur_dans_perimetre
        pour l'un de ses rôles), OU
      - il relève de la HIÉRARCHIE du user (N+1/N+2/responsable d'UO), c.-à-d.
        le user (via son collaborateur) est manager du demandeur.
    """
    # RG : l'administrateur a accès à l'intégralité des demandes, sans restriction
    est_admin = db.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM user_roles WHERE user_id = :u AND role = 'administrateur'
        )
    """), {"u": str(user_id)}).scalar()

    if est_admin:
        sql = _BASE_SELECT + " WHERE d.archive = false"
        params: dict[str, Any] = {}
        if type_demande:
            sql += " AND d.type_demande = :t"; params["t"] = type_demande
        if statut:
            sql += " AND d.statut = :s"; params["s"] = statut
        sql += " ORDER BY d.created_at DESC"
        rows = db.execute(text(sql), params).mappings().all()
        return _enrichir(db, [dict(r) for r in rows])

    # collaborateur lié au compte (pour la branche hiérarchie)
    moi = db.execute(text("""
        SELECT collaborateur_id FROM profiles
        WHERE user_id = :u AND collaborateur_id IS NOT NULL LIMIT 1
    """), {"u": str(user_id)}).scalar()

    sql = _BASE_SELECT + """
        WHERE d.archive = false
          AND (
            -- périmètre de gestion (un des rôles du user couvre le demandeur)
            EXISTS (
              SELECT 1 FROM user_roles ur
              WHERE ur.user_id = :u
                AND wf_collaborateur_dans_perimetre(:u, ur.role, d.demandeur_id)
            )
            -- OU hiérarchie : le user est manager du demandeur
            OR (:moi IS NOT NULL AND EXISTS (
                SELECT 1 FROM wf_responsable_remontee(
                    wf_get_uo_collaborateur(d.demandeur_id), ARRAY[d.demandeur_id]
                ) r WHERE r.resp_id = :moi
            ))
            OR (:moi IS NOT NULL AND EXISTS (
                SELECT 1 FROM wf_responsable_remontee(
                    wf_get_uo_ancestor(wf_get_uo_collaborateur(d.demandeur_id), 1),
                    ARRAY[d.demandeur_id]
                ) r WHERE r.resp_id = :moi
            ))
          )
    """
    params: dict[str, Any] = {"u": str(user_id), "moi": str(moi) if moi else None}
    if type_demande:
        sql += " AND d.type_demande = :t"; params["t"] = type_demande
    if statut:
        sql += " AND d.statut = :s"; params["s"] = statut
    sql += " ORDER BY d.created_at DESC"
    rows = db.execute(text(sql), params).mappings().all()
    return _enrichir(db, [dict(r) for r in rows])
