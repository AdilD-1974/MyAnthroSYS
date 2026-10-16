"""
Router : documents rattaches a un pret (recu de cheque, justificatifs...).

- POST   /api/v1/prets/{pret_id}/documents            -> upload (multipart: file + libelle)
- GET    /api/v1/prets/{pret_id}/documents             -> liste des documents du pret
- GET    /api/v1/prets/documents/{document_id}/fichier?mode=view|download
         -> lecture SECURISEE du fichier (RH_ROLES uniquement, comme le
            reste du module Prets ; anti path-traversal comme departs_storage.py)
- DELETE /api/v1/prets/documents/{document_id}         -> suppression (ligne + fichier disque)

A placer dans : app/routers/pret_documents.py
Meme convention de stockage que departs_storage.py (STORAGE_ROOT/pret_documents/<uuid>.<ext>).
"""
from __future__ import annotations

import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles, get_societe_active_id

router = APIRouter(prefix="/prets", tags=["prets-documents"])

RH_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "storage")).resolve()
PRET_DOC_DIR = STORAGE_ROOT / "pret_documents"
PRET_DOC_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 Mo
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"}


def _pret_ou_404(db: Session, pret_id: str, societe_id: str | None = None) -> None:
    # RG-MULTISOCIETE-08 (migration 057) : prets n'a pas de societe_id en
    # propre (catégorie A) -- société déduite via collaborateur_id ->
    # collaborateur_contrats.societe_id. societe_id=None (jamais fourni) ->
    # ancien comportement (aucun filtre), pour ne pas casser un appelant qui
    # n'aurait pas encore été mis à jour vers require_roles+payload.
    if societe_id:
        existe = db.execute(text("""
            SELECT 1 FROM public.prets p
             WHERE p.id = :id AND p.deleted_date IS NULL
               AND EXISTS (
                   SELECT 1 FROM public.collaborateur_contrats cc
                    WHERE cc.collaborateur_id = p.collaborateur_id
                      AND cc.societe_id = :sid AND cc.archive = false
               )
        """), {"id": pret_id, "sid": societe_id}).scalar()
    else:
        existe = db.execute(text(
            "SELECT 1 FROM public.prets WHERE id = :id AND deleted_date IS NULL"
        ), {"id": pret_id}).scalar()
    if not existe:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prêt introuvable.")


@router.post("/{pret_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document_pret(
    pret_id: str,
    file: UploadFile = File(...),
    libelle: str = Form(...),
    db: Session = Depends(get_db),
    payload: dict = Depends(require_roles(*RH_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    _pret_ou_404(db, pret_id, societe_id)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Extension '{suffix}' non autorisée. Extensions acceptées : {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fichier vide.")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Fichier trop volumineux. Max : {MAX_FILE_SIZE} octets.")

    nom_fichier = f"{uuid.uuid4().hex}{suffix}"
    chemin_disque = PRET_DOC_DIR / nom_fichier
    try:
        with open(chemin_disque, "wb") as f:
            f.write(content)
    except OSError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Erreur d'écriture sur disque : {exc}") from exc

    chemin_relatif = f"pret_documents/{nom_fichier}"
    operateur = payload.get("matricule") or payload.get("email") or payload.get("sub") or "SYSTEME"

    row = db.execute(text("""
        INSERT INTO public.pret_documents (pret_id, libelle, chemin, type_mime, taille_ko, uploade_par)
        VALUES (:pret_id, :libelle, :chemin, :type_mime, :taille_ko, :uploade_par)
        RETURNING id, pret_id, libelle, chemin, type_mime, taille_ko, uploade_par, uploade_le
    """), {
        "pret_id": pret_id, "libelle": libelle, "chemin": chemin_relatif,
        "type_mime": file.content_type, "taille_ko": len(content) // 1024,
        "uploade_par": operateur,
    }).mappings().first()
    db.commit()
    return dict(row)


@router.get("/{pret_id}/documents")
def lister_documents_pret(pret_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES)),
                          societe_id: str = Depends(get_societe_active_id)):
    _pret_ou_404(db, pret_id, societe_id)
    rows = db.execute(text("""
        SELECT id, pret_id, libelle, type_mime, taille_ko, uploade_par, uploade_le
        FROM public.pret_documents WHERE pret_id = :id ORDER BY uploade_le DESC
    """), {"id": pret_id}).mappings().all()
    return [dict(r) for r in rows]


@router.get("/documents/{document_id}/fichier")
def lire_document_pret(
    document_id: str,
    mode: str = Query("view", pattern="^(view|download)$"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*RH_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    row = db.execute(text("""
        SELECT pd.chemin, pd.libelle FROM public.pret_documents pd
        JOIN public.prets p ON p.id = pd.pret_id
        WHERE pd.id = :id
          AND EXISTS (
              SELECT 1 FROM public.collaborateur_contrats cc
               WHERE cc.collaborateur_id = p.collaborateur_id
                 AND cc.societe_id = :sid AND cc.archive = false
          )
    """), {"id": document_id, "sid": societe_id}).mappings().first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document introuvable.")

    # Anti path-traversal — le fichier doit rester sous STORAGE_ROOT.
    rel = str(row["chemin"]).lstrip("/").replace("\\", "/")
    if rel.startswith("storage/"):
        rel = rel[len("storage/"):]
    candidate = (STORAGE_ROOT / rel).resolve()
    try:
        candidate.relative_to(STORAGE_ROOT)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chemin invalide.")
    if not candidate.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fichier introuvable sur le serveur.")

    media_type, _ = mimetypes.guess_type(str(candidate))
    media_type = media_type or "application/octet-stream"
    disposition = "attachment" if mode == "download" else "inline"
    headers = {"Content-Disposition": f'{disposition}; filename="{row["libelle"]}{candidate.suffix}"'}
    return FileResponse(path=str(candidate), media_type=media_type, headers=headers)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_document_pret(document_id: str, db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES)),
                            societe_id: str = Depends(get_societe_active_id)):
    row = db.execute(text("""
        SELECT pd.chemin FROM public.pret_documents pd
        JOIN public.prets p ON p.id = pd.pret_id
        WHERE pd.id = :id
          AND EXISTS (
              SELECT 1 FROM public.collaborateur_contrats cc
               WHERE cc.collaborateur_id = p.collaborateur_id
                 AND cc.societe_id = :sid AND cc.archive = false
          )
    """), {"id": document_id, "sid": societe_id}).mappings().first()
    if not row:
        return None
    db.execute(text("DELETE FROM public.pret_documents WHERE id = :id"), {"id": document_id})
    db.commit()
    rel = str(row["chemin"]).lstrip("/").replace("\\", "/")
    if rel.startswith("storage/"):
        rel = rel[len("storage/"):]
    candidate = (STORAGE_ROOT / rel).resolve()
    try:
        candidate.relative_to(STORAGE_ROOT)
        if candidate.is_file():
            candidate.unlink()
    except (ValueError, OSError):
        pass  # la ligne est supprimée même si le fichier physique ne l'est pas
    return None
