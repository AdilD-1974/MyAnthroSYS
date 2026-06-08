"""
Router : storage des documents de départ.
Endpoint POST /api/v1/storage/depart-documents qui :
  - Accepte un fichier (multipart/form-data, champ "file")
  - Le sauve dans storage/depart_documents/{uuid}.{ext}
  - Retourne { "path": "depart_documents/abc.pdf", "filename": "...", "size": 123 }

À placer dans : app/routers/departs_storage.py
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse

from app.core.security import get_current_user_payload

router = APIRouter(tags=["storage"])

# ── Configuration ───────────────────────────────────────────────────────────
STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "storage"))
DEPART_DIR = STORAGE_ROOT / "depart_documents"
DEPART_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx"}


@router.post(
    "/storage/depart-documents",
    status_code=status.HTTP_201_CREATED,
    summary="Upload d'un document de départ (attestation, reçu, etc.)",
)
async def upload_depart_document(
    file: UploadFile = File(...),
    _user: dict = Depends(get_current_user_payload),
):
    # 1) Validation extension
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Extension '{suffix}' non autorisée. "
                   f"Extensions acceptées : {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # 2) Lecture + validation taille
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Fichier trop volumineux ({len(content)} octets). Max autorisé : {MAX_FILE_SIZE} octets.",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Fichier vide.",
        )

    # 3) Nom unique pour éviter les collisions
    target_name = f"{uuid.uuid4().hex}{suffix}"
    target_path = DEPART_DIR / target_name

    # 4) Écriture sur disque
    try:
        with open(target_path, "wb") as f:
            f.write(content)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur d'écriture sur disque : {exc}",
        ) from exc

    # 5) Réponse — le path retourné est relatif à STORAGE_ROOT, conforme au
    #    mount StaticFiles de main.py qui sert /api/v1/storage/* depuis ce dossier.
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


@router.delete(
    "/storage/depart-documents/{filename}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer un document de départ uploadé",
)
async def delete_depart_document(
    filename: str,
    _user: dict = Depends(get_current_user_payload),
):
    # Sécurité : refuser tout chemin avec slash, .. ou autre chose suspect
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide.")

    target_path = DEPART_DIR / filename
    if not target_path.exists():
        # Idempotent : pas d'erreur si déjà supprimé
        return JSONResponse(status_code=204, content=None)

    try:
        target_path.unlink()
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur suppression : {exc}",
        ) from exc

    return JSONResponse(status_code=204, content=None)
