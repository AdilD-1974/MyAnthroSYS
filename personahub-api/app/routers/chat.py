"""
Routeur du module Chat : REST + WebSocket.
Cible : app/routers/chat.py

Enregistrement dans main.py (avec le préfixe /api/v1 comme les autres) :
    from app.routers import chat as chat_router
    app.include_router(chat_router.router, prefix=PREFIX)

→ endpoints REST : /api/v1/chat/...      WebSocket : /api/v1/chat/ws
Redémarrer uvicorn après ajout.
"""

from __future__ import annotations

import os
import uuid

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, UploadFile,
    WebSocket, WebSocketDisconnect, status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.chat_auth import (
    IdentiteChat, collaborateur_courant, collaborateur_depuis_token_ws,
)
from app.core.database import SessionLocal, get_db
from app.services import chat_service as svc
from app.services.chat_service import manager

router = APIRouter(prefix="/chat", tags=["Chat"])

# Pièces jointes
STORAGE_CHAT = "storage/chat"
TAILLE_MAX = 10 * 1024 * 1024  # 10 Mo


class CreerConversationIn(BaseModel):
    type: str = Field(..., pattern="^(direct|groupe)$")
    membres_ids: list[str]
    titre: str | None = None


class MarquerLuIn(BaseModel):
    message_id: int


# ----------------------------- REST ----------------------------------
@router.get("/moi")
def get_moi(identite: IdentiteChat = Depends(collaborateur_courant)):
    return {
        "collaborateur_id": identite.collaborateur_id,
        "nom_complet": identite.nom_complet,
        "roles": identite.roles,
    }


@router.get("/conversations")
def get_conversations(
    identite: IdentiteChat = Depends(collaborateur_courant),
    db: Session = Depends(get_db),
):
    return svc.lister_conversations(db, identite.collaborateur_id)


@router.get("/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: int,
    avant_id: int | None = Query(default=None),
    limite: int = Query(default=30, le=100),
    identite: IdentiteChat = Depends(collaborateur_courant),
    db: Session = Depends(get_db),
):
    try:
        return svc.lister_messages(db, conversation_id, identite.collaborateur_id, avant_id, limite)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def post_conversation(
    body: CreerConversationIn,
    identite: IdentiteChat = Depends(collaborateur_courant),
    db: Session = Depends(get_db),
):
    try:
        conv_id = svc.creer_conversation(db, identite, body.type, body.membres_ids, body.titre)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"conversation_id": conv_id}


@router.post("/conversations/{conversation_id}/lu")
def post_lu(
    conversation_id: int,
    body: MarquerLuIn,
    identite: IdentiteChat = Depends(collaborateur_courant),
    db: Session = Depends(get_db),
):
    svc.marquer_lu(db, conversation_id, identite.collaborateur_id, body.message_id)
    return {"ok": True}


@router.get("/destinataires")
def get_destinataires(
    q: str = Query(default=""),
    identite: IdentiteChat = Depends(collaborateur_courant),
    db: Session = Depends(get_db),
):
    return svc.destinataires_autorises(db, identite, q)


# ------------------------- Pièces jointes ----------------------------
@router.post("/conversations/{conversation_id}/fichier", status_code=status.HTTP_201_CREATED)
async def post_fichier(
    conversation_id: int,
    fichier: UploadFile = File(...),
    contenu: str = Form(default=""),
    identite: IdentiteChat = Depends(collaborateur_courant),
    db: Session = Depends(get_db),
):
    if not svc.est_participant(db, conversation_id, identite.collaborateur_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Conversation non autorisée.")

    data = await fichier.read()
    if len(data) > TAILLE_MAX:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fichier trop volumineux (max 10 Mo).")
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fichier vide.")

    os.makedirs(STORAGE_CHAT, exist_ok=True)
    nom_origine = fichier.filename or "fichier"
    # Nom stocké préfixé d'un UUID, sans séparateur de chemin
    stored = f"{uuid.uuid4().hex}_{nom_origine}".replace("/", "_").replace("\\", "_")
    with open(os.path.join(STORAGE_CHAT, stored), "wb") as f:
        f.write(data)

    dto = svc.enregistrer_message_fichier(
        db, conversation_id, identite.collaborateur_id, contenu,
        nom=nom_origine, chemin=stored, type_mime=fichier.content_type, taille=len(data),
    )
    dto["expediteur_nom"] = identite.nom_complet
    destinataires = svc.participants_ids(db, conversation_id)
    await manager.envoyer_a(destinataires, {"type": "message", "message": dto})
    return dto


@router.get("/messages/{message_id}/fichier")
def get_fichier(
    message_id: int,
    identite: IdentiteChat = Depends(collaborateur_courant),
    db: Session = Depends(get_db),
):
    meta = svc.fichier_message(db, message_id)
    if not meta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pièce jointe introuvable.")
    if not svc.est_participant(db, meta["conversation_id"], identite.collaborateur_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé.")

    chemin = os.path.join(STORAGE_CHAT, meta["chemin"])
    if not os.path.isfile(chemin):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fichier absent du stockage.")

    return FileResponse(
        chemin,
        filename=meta["nom"],                              # conserve le nom d'origine au téléchargement
        media_type=meta["type"] or "application/octet-stream",
    )


# --------------------------- WebSocket --------------------------------
@router.websocket("/ws")
async def ws_chat(websocket: WebSocket, token: str = Query(...)):
    db = SessionLocal()
    try:
        identite = collaborateur_depuis_token_ws(token, db)
    finally:
        db.close()

    if identite is None:
        await websocket.close(code=4401)
        return

    moi = identite.collaborateur_id
    await manager.connecter(moi, websocket)

    try:
        while True:
            data = await websocket.receive_json()
            type_msg = data.get("type")
            if type_msg == "message":
                await _traiter_message(websocket, identite, data)
            elif type_msg == "marquer_lu":
                _traiter_lu(identite, data)
            else:
                await websocket.send_json({"type": "erreur", "detail": "Type inconnu."})
    except WebSocketDisconnect:
        await manager.deconnecter(moi, websocket)
    except Exception:
        await manager.deconnecter(moi, websocket)


async def _traiter_message(websocket: WebSocket, identite: IdentiteChat, data: dict) -> None:
    conversation_id = data.get("conversation_id")
    contenu = data.get("contenu", "")
    db = SessionLocal()
    try:
        dto = svc.enregistrer_message(db, conversation_id, identite.collaborateur_id, contenu)
        dto["expediteur_nom"] = identite.nom_complet
        destinataires = svc.participants_ids(db, conversation_id)
        # (optionnel) Notifier les hors-ligne via ton NotificationBell ici.
    except (PermissionError, ValueError) as e:
        await websocket.send_json({"type": "erreur", "detail": str(e)})
        db.close()
        return
    finally:
        db.close()

    await manager.envoyer_a(destinataires, {"type": "message", "message": dto})


def _traiter_lu(identite: IdentiteChat, data: dict) -> None:
    db = SessionLocal()
    try:
        svc.marquer_lu(db, data.get("conversation_id"), identite.collaborateur_id, data.get("message_id"))
    finally:
        db.close()
