# ============================================================
# nav.py — app/routers/nav.py
# ------------------------------------------------------------
# /menu accepte ?role=... (RÔLE ACTIF de la sidebar) :
#   • role fourni → utilisé SEULEMENT s'il est dans les rôles
#     réels du JWT (sinon 403). Un collaborateur ne peut pas
#     réclamer le menu administrateur.
#   • role absent → repli sur le rôle principal du JWT.
# ============================================================
from __future__ import annotations
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.services.nav_service import (
    get_menu_pour_role, get_tous_items, get_toutes_sections,
    creer_item, modifier_item, supprimer_item,
    reordonner_items, set_roles_item,
    creer_section, modifier_section, reordonner_sections,
)

router = APIRouter(prefix="/navigation", tags=["navigation"])

TOUS_ROLES = ("collaborateur", "manager", "gestionnaire_rh", "gestionnaire_paie", "administrateur")
ROLES_VALIDES = set(TOUS_ROLES)


def _roles_du_jwt(payload: dict) -> list[str]:
    """Tous les rôles portés par le token, quelle que soit la forme."""
    for cle in ("roles", "all_roles"):
        v = payload.get(cle)
        if isinstance(v, (list, tuple)) and v:
            return list(v)
    r = payload.get("role")
    return [r] if r else []


# ──────────────────────────────────────────────────────────────
# LECTURE
# ──────────────────────────────────────────────────────────────

@router.get("/menu")
def get_menu(
    role: Optional[str] = Query(None, description="Rôle actif choisi dans la sidebar"),
    payload: dict = Depends(require_roles(*TOUS_ROLES)),
    db: Session = Depends(get_db),
):
    """Menu filtré pour le RÔLE ACTIF, validé contre le JWT."""
    roles_jwt = _roles_du_jwt(payload)

    if role:
        if role not in ROLES_VALIDES:
            raise HTTPException(400, f"Rôle inconnu : {role}")
        if role not in roles_jwt:
            raise HTTPException(403, "Rôle actif non autorisé pour cet utilisateur")
        role_effectif = role
    else:
        role_effectif = payload.get("role") or (roles_jwt[0] if roles_jwt else "collaborateur")

    return get_menu_pour_role(db, role_effectif)


@router.get("/items")
def get_items(
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    """Tous les items — admin uniquement."""
    return get_tous_items(db)


@router.get("/sections")
def get_sections(
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    """Toutes les sections — admin uniquement."""
    return get_toutes_sections(db)


# ──────────────────────────────────────────────────────────────
# ITEMS — CRUD
# ──────────────────────────────────────────────────────────────

class ItemCreate(BaseModel):
    code: str
    label: str
    icone: Optional[str] = None
    chemin: Optional[str] = None
    section_id: Optional[str] = None
    parent_id: Optional[str] = None
    ordre: int = 0
    roles: List[str] = []


class ItemUpdate(BaseModel):
    label: Optional[str] = None
    icone: Optional[str] = None
    chemin: Optional[str] = None
    section_id: Optional[str] = None
    parent_id: Optional[str] = None
    ordre: Optional[int] = None
    actif: Optional[bool] = None
    roles: Optional[List[str]] = None


class OrdreEntry(BaseModel):
    id: str
    ordre: int


@router.post("/items", status_code=201)
def post_item(
    body: ItemCreate,
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    for r in body.roles:
        if r not in ROLES_VALIDES:
            raise HTTPException(400, f"Rôle inconnu : {r}")
    item = creer_item(
        db, code=body.code, label=body.label, icone=body.icone,
        chemin=body.chemin, section_id=body.section_id,
        parent_id=body.parent_id, ordre=body.ordre,
    )
    if body.roles:
        set_roles_item(db, item["id"], body.roles)
    db.commit()
    return item


@router.patch("/items/{item_id}")
def patch_item(
    item_id: str,
    body: ItemUpdate,
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    champs = {k: v for k, v in body.model_dump().items()
              if v is not None and k != "roles"}
    item = modifier_item(db, item_id, **champs)
    if item is None:
        raise HTTPException(404, "Item introuvable")
    if body.roles is not None:
        for r in body.roles:
            if r not in ROLES_VALIDES:
                raise HTTPException(400, f"Rôle inconnu : {r}")
        set_roles_item(db, item_id, body.roles)
    db.commit()
    return item


@router.delete("/items/{item_id}", status_code=204)
def delete_item(
    item_id: str,
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    if not supprimer_item(db, item_id):
        raise HTTPException(404, "Item introuvable")
    db.commit()


@router.put("/items/ordre")
def put_ordre_items(
    body: List[OrdreEntry],
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    reordonner_items(db, [e.model_dump() for e in body])
    db.commit()
    return {"ok": True}


@router.put("/items/{item_id}/roles")
def put_roles_item(
    item_id: str,
    roles: List[str],
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    for r in roles:
        if r not in ROLES_VALIDES:
            raise HTTPException(400, f"Rôle inconnu : {r}")
    set_roles_item(db, item_id, roles)
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────────
# SECTIONS — CRUD
# ──────────────────────────────────────────────────────────────

class SectionCreate(BaseModel):
    code: str
    label: str
    ordre: int = 0


class SectionUpdate(BaseModel):
    label: Optional[str] = None
    ordre: Optional[int] = None
    actif: Optional[bool] = None


@router.post("/sections", status_code=201)
def post_section(
    body: SectionCreate,
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    sec = creer_section(db, code=body.code, label=body.label, ordre=body.ordre)
    db.commit()
    return sec


@router.patch("/sections/{sec_id}")
def patch_section(
    sec_id: str,
    body: SectionUpdate,
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    champs = {k: v for k, v in body.model_dump().items() if v is not None}
    sec = modifier_section(db, sec_id, **champs)
    if sec is None:
        raise HTTPException(404, "Section introuvable")
    db.commit()
    return sec


@router.put("/sections/ordre")
def put_ordre_sections(
    body: List[OrdreEntry],
    payload: dict = Depends(require_roles("administrateur")),
    db: Session = Depends(get_db),
):
    reordonner_sections(db, [e.model_dump() for e in body])
    db.commit()
    return {"ok": True}
