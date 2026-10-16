"""
app/routers/departs.py — Departs scopes par role + perimetre manager.

GET /api/v1/departs/equipe?role_actif=...
  - admin / gestionnaire_rh -> TOUS les departs.
  - manager                 -> departs des collaborateurs de son perimetre,
       en INCLUANT les personnes deja sorties : on retient toute affectation
       (active OU cloturee) dont l'UO est dans l'arbre du manager (RG-MGR-POP-01),
       + forcage manager_n1_id / manager_n2_id + le manager lui-meme.

Retourne les lignes brutes de collaborateur_departs (toutes colonnes), afin que
l'ecran Manager (modale dossier complet) fonctionne sans changement.

A placer dans : app/routers/departs.py
puis dans main.py :
    from app.routers import departs as departs_router
    app.include_router(departs_router.router, prefix=PREFIX)
"""
from __future__ import annotations

from typing import Optional, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload

router = APIRouter(prefix="/departs", tags=["departs"])

# Arbre d'UO du manager (identique a conges.py), MAIS collab_pop tient compte
# des affectations cloturees -> les collaborateurs deja sortis restent visibles
# tant que leur (derniere) affectation rattachait a l'arbre du manager.
_POP_CTE_DEPARTS = """
WITH RECURSIVE manager AS (SELECT CAST(:moi AS uuid) AS cid),
poste_codes AS (
    SELECT DISTINCT a.code_poste
    FROM collaborateur_affectations a, manager m
    WHERE a.collaborateur_id = m.cid AND a.archive = false
      AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= CURRENT_DATE)
      AND a.code_poste IS NOT NULL
),
direct_uo AS (
    SELECT u.id FROM unites_organisationnelles u, manager m
    WHERE u.actif IS NOT FALSE AND u.responsable_id = m.cid
    UNION
    SELECT u.id FROM unites_organisationnelles u
    WHERE u.actif IS NOT FALSE
      AND u.poste_responsable_code IN (SELECT code_poste FROM poste_codes)
),
uo_tree AS (
    SELECT id FROM direct_uo
    UNION
    SELECT u.id FROM unites_organisationnelles u
    JOIN uo_tree t ON u.parent_id = t.id
    WHERE u.actif IS NOT FALSE
),
collab_pop AS (
    -- Toute affectation (active OU cloturee) dont l'UO est dans l'arbre
    SELECT DISTINCT a.collaborateur_id AS cid
    FROM collaborateur_affectations a
    WHERE a.unite_id IN (SELECT id FROM uo_tree)
    UNION
    -- Forcage hierarchique (N+1 / N+2)
    SELECT DISTINCT a.collaborateur_id
    FROM collaborateur_affectations a, manager m
    WHERE (a.manager_n1_id = m.cid OR a.manager_n2_id = m.cid)
    UNION
    SELECT m.cid FROM manager m
)
"""


def _effective_role(db: Session, user_id, payload: dict, role_actif: Optional[str]) -> str:
    """Role ACTIF de l'appelant, valide contre ses roles reels (cf. conges.py)."""
    cand = (role_actif or payload.get("role") or "").strip()
    if cand:
        ok = db.execute(text(
            "SELECT 1 FROM user_roles WHERE user_id = :u AND role = :r LIMIT 1"
        ), {"u": str(user_id), "r": cand}).scalar()
        if ok:
            return cand
    return (payload.get("role") or "").strip()


def _voit_tout(role: str) -> bool:
    # RH, Paie et admin voient tous les departs (fonctions transverses).
    return role in ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


def _moi(db: Session, user_id):
    return db.execute(text("""
        SELECT collaborateur_id FROM profiles
        WHERE user_id = :u AND collaborateur_id IS NOT NULL LIMIT 1
    """), {"u": str(user_id)}).scalar()


@router.get("/equipe")
def departs_equipe(
    role_actif: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    user_id = payload.get("sub")
    role = _effective_role(db, user_id, payload, role_actif)
    voit_tout = _voit_tout(role)

    params: dict[str, Any] = {}
    if voit_tout:
        sql = "SELECT cd.* FROM collaborateur_departs cd"
        scope = "tous"
    else:
        moi = _moi(db, user_id)
        params["moi"] = str(moi) if moi else None
        sql = (
            _POP_CTE_DEPARTS
            + " SELECT cd.* FROM collaborateur_departs cd"
            + " WHERE cd.collaborateur_id IN (SELECT cid FROM collab_pop)"
        )
        scope = "equipe" if moi else "aucun"

    sql += " ORDER BY cd.date_depart ASC NULLS LAST"

    rows = db.execute(text(sql), params).mappings().all()
    # Retour : liste brute (le front gere l'affichage). On expose aussi le scope
    # via un entete implicite ? Non : on renvoie directement la liste pour rester
    # compatible avec le code existant (api.get -> tableau).
    return [dict(r) for r in rows]
