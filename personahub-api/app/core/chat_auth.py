"""
Couche d'authentification du module Chat.
Cible : app/core/chat_auth.py

Branchée sur TON auth existant (app/core/security.py) :
  - REST  : réutilise get_current_user_payload (HTTPBearer).
  - WS     : décode le token passé en query string via decode_token.

L'identité chat = la FICHE COLLABORATEUR liée au compte, retrouvée via
profiles.collaborateur_id. Un compte sans fiche (ex : administrateur)
n'a pas accès au chat (cohérent avec son mode « consultation seule »).
Les rôles sont lus directement dans le token (claim all_roles).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload, decode_token


@dataclass
class IdentiteChat:
    collaborateur_id: str          # UUID de la fiche collaborateur (sous forme de str)
    nom_complet: str
    roles: list[str] = field(default_factory=list)


def _resoudre_identite(payload: dict, db: Session) -> IdentiteChat | None:
    user_id = payload.get("sub")
    if not user_id:
        return None
    roles = payload.get("all_roles") or []

    row = db.execute(
        text(
            """
            SELECT p.collaborateur_id,
                   COALESCE(p.prenom, c.prenom) AS prenom,
                   COALESCE(p.nom,    c.nom)    AS nom
            FROM profiles p
            LEFT JOIN collaborateurs c ON c.id = p.collaborateur_id
            WHERE p.user_id = CAST(:uid AS uuid)
            """
        ),
        {"uid": str(user_id)},
    ).mappings().first()

    # Pas de fiche collaborateur (ex : administrateur) → pas d'accès au chat
    if not row or not row["collaborateur_id"]:
        return None

    nom_complet = f"{row['prenom'] or ''} {row['nom'] or ''}".strip() or "Collaborateur"
    return IdentiteChat(
        collaborateur_id=str(row["collaborateur_id"]),
        nom_complet=nom_complet,
        roles=list(roles),
    )


# --- Dépendance REST --------------------------------------------------------
def collaborateur_courant(
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db),
) -> IdentiteChat:
    ident = _resoudre_identite(payload, db)
    if ident is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès au chat refusé (compte sans fiche collaborateur).",
        )
    return ident


# --- Variante WebSocket (token en query string) -----------------------------
def collaborateur_depuis_token_ws(token: str, db: Session) -> IdentiteChat | None:
    try:
        payload = decode_token(token)
    except HTTPException:
        return None
    return _resoudre_identite(payload, db)
