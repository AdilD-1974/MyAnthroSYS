# app/routers/taches.py
# ------------------------------------------------------------
# Routes REST — Module tâches PersonaHub HR
# Préfixe : /api/v1/taches  (enregistré dans main.py)
# Adapté à security.py : get_current_user_payload → payload JWT
#   payload["user_id"]   = id de l'utilisateur
#   payload["role"]      = rôle principal  (ex: "manager")
#   payload["all_roles"] = liste des rôles (ex: ["manager","collaborateur"])
# ------------------------------------------------------------
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload
from app.services import tache_service as svc

router = APIRouter(prefix="/taches", tags=["taches"])


# ─── Helper : extraire user_id + roles du payload JWT ────────

def _user(payload: dict) -> tuple[str, list[str]]:
    """Retourne (user_id, roles) depuis le payload JWT."""
    user_id   = payload.get("user_id") or payload.get("sub", "")
    all_roles = payload.get("all_roles") or [payload.get("role", "collaborateur")]
    return user_id, all_roles


# ─── Schémas Pydantic ─────────────────────────────────────────

class AssignationIn(BaseModel):
    collaborateur_id: str
    role: str = "responsable"


class TacheCreate(BaseModel):
    titre: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    type_tache: str = "personnelle"
    statut: str = "a_faire"
    priorite: str = "normale"
    date_echeance: Optional[date] = None
    date_debut: Optional[date] = None
    proprietaire_id: Optional[str] = None
    demande_id: Optional[str] = None
    wf_instance_id: Optional[str] = None
    wf_etape_id: Optional[str] = None
    etiquettes: list[str] = []
    metadata: dict = {}
    assignations: list[AssignationIn] = []


class TachePatch(BaseModel):
    titre: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    statut: Optional[str] = None
    priorite: Optional[str] = None
    date_echeance: Optional[date] = None
    date_debut: Optional[date] = None
    etiquettes: Optional[list[str]] = None
    metadata: Optional[dict] = None
    proprietaire_id: Optional[str] = None
    demande_id: Optional[str] = None
    assignations: Optional[list[AssignationIn]] = None


# ─── Endpoints ────────────────────────────────────────────────

@router.get("")
def list_taches(
    statut:            Optional[str]  = Query(None),
    priorite:          Optional[str]  = Query(None),
    type_tache:        Optional[str]  = Query(None),
    date_debut:        Optional[date] = Query(None),
    date_fin:          Optional[date] = Query(None),
    assignataire_id:   Optional[str]  = Query(None),
    etiquette:         Optional[str]  = Query(None),
    search:            Optional[str]  = Query(None),
    include_terminees: bool           = Query(False),
    db:      Session = Depends(get_db),
    payload: dict    = Depends(get_current_user_payload),
):
    user_id, roles = _user(payload)
    return svc.get_taches_perimetre(
        db, user_id=user_id, roles=roles,
        statut=statut, priorite=priorite, type_tache=type_tache,
        date_debut=date_debut, date_fin=date_fin,
        assignataire_id=assignataire_id, etiquette=etiquette,
        search=search, include_terminees=include_terminees,
    )


@router.get("/compteurs")
def compteurs(
    db:      Session = Depends(get_db),
    payload: dict    = Depends(get_current_user_payload),
):
    user_id, _ = _user(payload)
    return svc.get_compteurs(db, user_id=user_id)


@router.get("/{tache_id}")
def get_tache(
    tache_id: str,
    db:      Session = Depends(get_db),
    payload: dict    = Depends(get_current_user_payload),
):
    user_id, roles = _user(payload)
    t = svc.get_tache_by_id(db, tache_id, user_id, roles)
    if not t:
        raise HTTPException(status_code=404, detail="Tâche introuvable ou accès refusé.")
    return t


@router.post("", status_code=status.HTTP_201_CREATED)
def create_tache(
    body:    TacheCreate,
    db:      Session = Depends(get_db),
    payload: dict    = Depends(get_current_user_payload),
):
    user_id, _ = _user(payload)
    return svc.create_tache(db, body.model_dump(), createur_id=user_id)


@router.patch("/{tache_id}")
def update_tache(
    tache_id: str,
    body:    TachePatch,
    db:      Session = Depends(get_db),
    payload: dict    = Depends(get_current_user_payload),
):
    user_id, _ = _user(payload)
    updated = svc.update_tache(
        db, tache_id,
        body.model_dump(exclude_none=True),
        user_id=user_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    return updated


@router.delete("/{tache_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tache(
    tache_id: str,
    db:      Session = Depends(get_db),
    payload: dict    = Depends(get_current_user_payload),
):
    user_id, roles = _user(payload)
    ok = svc.delete_tache(db, tache_id, user_id, roles)
    if not ok:
        raise HTTPException(status_code=404, detail="Tâche introuvable ou droits insuffisants.")


# ─── Endpoint interne : création depuis workflow ──────────────

class TacheWfCreate(BaseModel):
    titre: str
    description: Optional[str] = None
    proprietaire_id: str
    instance_id: str
    etape_id: Optional[str] = None
    date_echeance: Optional[date] = None
    priorite: str = "normale"
    assignations: list[AssignationIn] = []
    demande_id: Optional[str] = None


@router.post("/interne/depuis-workflow", status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_depuis_workflow(
    body:    TacheWfCreate,
    db:      Session = Depends(get_db),
    payload: dict    = Depends(get_current_user_payload),
):
    """Endpoint interne appelé par workflow_engine (action TACHE_SYSTEME)."""
    _, roles = _user(payload)
    if not any(r in roles for r in ("administrateur", "systeme")):
        raise HTTPException(status_code=403, detail="Accès réservé au système.")
    return svc.create_tache_depuis_workflow(
        db,
        titre=body.titre,
        description=body.description,
        proprietaire_id=body.proprietaire_id,
        instance_id=body.instance_id,
        etape_id=body.etape_id,
        date_echeance=body.date_echeance,
        priorite=body.priorite,
        assignations=[a.model_dump() for a in body.assignations],
        demande_id=body.demande_id,
    )
