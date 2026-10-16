"""
Router : storage des documents de depart.

- POST   /api/v1/storage/depart-documents             -> upload (inchange)
- DELETE /api/v1/storage/depart-documents/{filename}  -> suppression (inchange)
- GET    /api/v1/storage/depart-documents/{depart_id}/{doc_key}?mode=view|download
         -> lecture SECURISEE d'un document de depart :
            * controle de ROLE :
                view     -> manager / gestionnaire_rh / administrateur
                download -> gestionnaire_rh / administrateur uniquement
            * controle de PERIMETRE pour le manager (RG-MGR-POP-01,
              identique a conges.py / "Mon equipe") : un manager ne voit que
              les departs des collaborateurs de sa population.
            * anti path-traversal (le fichier doit rester sous STORAGE_ROOT).

A placer dans : app/routers/departs_storage.py
"""
from __future__ import annotations

import os
import uuid
import mimetypes
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status, Query
from fastapi.responses import JSONResponse, FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import get_current_user_payload
from app.core.database import get_db

router = APIRouter(tags=["storage"])

# -- Configuration ----------------------------------------------------------
STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "storage")).resolve()
DEPART_DIR = STORAGE_ROOT / "depart_documents"
DEPART_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx"}

# Liste blanche des documents de depart -> colonne *_path en base
DOC_KEYS = {
    "attestation_travail": "doc_attestation_travail_path",
    "recu_stc": "doc_recu_stc_path",
    "radiation_cnss": "doc_radiation_cnss_path",
    "attestation_amo": "doc_attestation_amo_path",
    "certificat_conges": "doc_certificat_conges_path",
    "lettre_notification": "doc_lettre_notification_path",
    "accord_amiable": "doc_accord_amiable_path",
    "pv_entretien": "doc_pv_entretien_path",
    "recu_materiel": "doc_recu_materiel_path",
}

ROLES_VIEW = {"manager", "gestionnaire_rh", "gestionnaire_paie", "administrateur"}
ROLES_DOWNLOAD = {"gestionnaire_rh", "administrateur"}

# CTE population manager (RG-MGR-POP-01) -- identique a conges.py
_POP_CTE = """
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
    SELECT DISTINCT a.collaborateur_id AS cid
    FROM collaborateur_affectations a
    WHERE a.archive = false AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= CURRENT_DATE)
      AND a.unite_id IN (SELECT id FROM uo_tree)
    UNION
    SELECT DISTINCT a.collaborateur_id
    FROM collaborateur_affectations a, manager m
    WHERE a.archive = false AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= CURRENT_DATE)
      AND (a.manager_n1_id = m.cid OR a.manager_n2_id = m.cid)
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
    return role in ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


def _moi(db: Session, user_id):
    return db.execute(text("""
        SELECT collaborateur_id FROM profiles
        WHERE user_id = :u AND collaborateur_id IS NOT NULL LIMIT 1
    """), {"u": str(user_id)}).scalar()


def _depart_dans_perimetre(db: Session, moi, collaborateur_id) -> bool:
    """Le collaborateur du depart appartient-il a la population du manager ?"""
    if not moi:
        return False
    row = db.execute(
        text(_POP_CTE + " SELECT 1 FROM collab_pop WHERE cid = CAST(:cid AS uuid) LIMIT 1"),
        {"moi": str(moi), "cid": str(collaborateur_id)},
    ).scalar()
    return bool(row)


# -- Upload (inchange) ------------------------------------------------------
@router.post(
    "/storage/depart-documents",
    status_code=status.HTTP_201_CREATED,
    summary="Upload d'un document de depart (attestation, recu, etc.)",
)
async def upload_depart_document(
    file: UploadFile = File(...),
    _user: dict = Depends(get_current_user_payload),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Extension '{suffix}' non autorisee. "
                   f"Extensions acceptees : {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Fichier trop volumineux ({len(content)} octets). Max autorise : {MAX_FILE_SIZE} octets.",
        )
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fichier vide.")

    target_name = f"{uuid.uuid4().hex}{suffix}"
    target_path = DEPART_DIR / target_name
    try:
        with open(target_path, "wb") as f:
            f.write(content)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur d'ecriture sur disque : {exc}",
        ) from exc

    rel_path = f"depart_documents/{target_name}"
    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content={
            "path": rel_path,
            "url": f"/api/v1/storage/{rel_path}",
            "filename": file.filename,
            "size": len(content),
            "content_type": file.content_type,
        },
    )


# -- Lecture securisee (role + perimetre) -----------------------------------
@router.get(
    "/storage/depart-documents/{depart_id}/{doc_key}",
    summary="Lecture securisee d'un document de depart (view / download selon role)",
)
def get_depart_document(
    depart_id: str,
    doc_key: str,
    mode: str = Query("view", pattern="^(view|download)$"),
    role_actif: Optional[str] = Query(None),
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db),
):
    user_id = payload.get("sub")
    role = _effective_role(db, user_id, payload, role_actif)

    # 1) Controle de role selon le mode
    if mode == "download":
        if role not in ROLES_DOWNLOAD:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Telechargement reserve au gestionnaire RH et a l'administrateur.",
            )
    else:  # view
        if role not in ROLES_VIEW:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acces non autorise.")

    # 2) doc_key dans la liste blanche
    col = DOC_KEYS.get(doc_key)
    if not col:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document inconnu.")

    # 3) Lire le depart (chemin + collaborateur) en base
    try:
        row = db.execute(
            text(f"SELECT {col} AS p, collaborateur_id AS cid "
                 f"FROM collaborateur_departs WHERE id = :id"),
            {"id": depart_id},
        ).first()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur base : {exc}") from exc

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Depart introuvable.")

    # 4) Controle de PERIMETRE pour le manager (admin/RH voient tout)
    if not _voit_tout(role):
        moi = _moi(db, user_id)
        if not _depart_dans_perimetre(db, moi, row.cid):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ce depart n'appartient pas a votre perimetre.",
            )

    if not row.p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document non renseigne.")

    # 5) Resolution + anti path-traversal
    rel = str(row.p).lstrip("/").replace("\\", "/")
    if rel.startswith("storage/"):
        rel = rel[len("storage/"):]
    candidate = (STORAGE_ROOT / rel).resolve()
    try:
        candidate.relative_to(STORAGE_ROOT)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chemin invalide.")
    if not candidate.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fichier introuvable sur le serveur.")

    # 6) Reponse fichier
    media_type, _ = mimetypes.guess_type(str(candidate))
    media_type = media_type or "application/octet-stream"
    disposition = "attachment" if mode == "download" else "inline"
    headers = {"Content-Disposition": f'{disposition}; filename="{candidate.name}"'}
    return FileResponse(path=str(candidate), media_type=media_type, headers=headers)


# -- Suppression (inchange) -------------------------------------------------
@router.delete(
    "/storage/depart-documents/{filename}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer un document de depart uploade",
)
async def delete_depart_document(
    filename: str,
    _user: dict = Depends(get_current_user_payload),
):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide.")
    target_path = DEPART_DIR / filename
    if not target_path.exists():
        return JSONResponse(status_code=204, content=None)
    try:
        target_path.unlink()
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur suppression : {exc}",
        ) from exc
    return JSONResponse(status_code=204, content=None)
