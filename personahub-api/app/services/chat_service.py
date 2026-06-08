"""
Service du module Chat :
  - ConnectionManager : suit les WebSockets actifs par collaborateur.
  - Helpers métier : autorisations par rôle, conversations, messages, non-lus.

Cible : app/services/chat_service.py

Schéma réel pris en compte :
  - collaborateurs(id UUID, nom, prenom, matricule, ...)
  - profiles(user_id, collaborateur_id, ...)  ← lien compte ↔ fiche
  - user_roles(user_id, role)
Les identifiants collaborateur sont des UUID manipulés sous forme de str
et castés en SQL via CAST(:x AS uuid).
"""

from __future__ import annotations

import asyncio
from typing import Iterable

from fastapi import WebSocket
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.chat_auth import IdentiteChat


# =====================================================================
#  1. Gestionnaire de connexions temps réel  (en mémoire, mono-worker)
# =====================================================================
class ConnectionManager:
    def __init__(self) -> None:
        self._connexions: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connecter(self, collaborateur_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connexions.setdefault(collaborateur_id, set()).add(ws)

    async def deconnecter(self, collaborateur_id: str, ws: WebSocket) -> None:
        async with self._lock:
            sockets = self._connexions.get(collaborateur_id)
            if sockets:
                sockets.discard(ws)
                if not sockets:
                    self._connexions.pop(collaborateur_id, None)

    def est_en_ligne(self, collaborateur_id: str) -> bool:
        return bool(self._connexions.get(collaborateur_id))

    async def envoyer_a(self, collaborateur_ids: Iterable[str], message: dict) -> None:
        for cid in set(collaborateur_ids):
            for ws in list(self._connexions.get(cid, ())):
                try:
                    await ws.send_json(message)
                except Exception:
                    pass


manager = ConnectionManager()


# =====================================================================
#  2. Autorisations par rôle
# =====================================================================
def roles_collaborateur(db: Session, collaborateur_id: str) -> list[str]:
    """Rôles d'un collaborateur, via son compte (profiles → user_roles)."""
    rows = db.execute(
        text(
            """
            SELECT ur.role
            FROM user_roles ur
            JOIN profiles p ON p.user_id = ur.user_id
            WHERE p.collaborateur_id = CAST(:cid AS uuid)
            """
        ),
        {"cid": collaborateur_id},
    ).all()
    return [r[0] for r in rows]


def peut_contacter(db: Session, roles_source: list[str], roles_cible: list[str]) -> bool:
    if not roles_source or not roles_cible:
        return False
    found = db.execute(
        text(
            """
            SELECT 1 FROM chat_role_autorisation
            WHERE autorise = TRUE
              AND role_source = ANY(:src)
              AND role_cible  = ANY(:dst)
            LIMIT 1
            """
        ),
        {"src": roles_source, "dst": roles_cible},
    ).first()
    return found is not None


def destinataires_autorises(db: Session, identite: IdentiteChat, q: str) -> list[dict]:
    """
    Collaborateurs (ayant un compte) que l'utilisateur courant a le droit de
    contacter d'après la matrice de rôles. Recherche par nom/prénom/matricule.
    """
    motif = f"%{q.strip()}%"
    candidats = db.execute(
        text(
            """
            SELECT c.id AS collaborateur_id,
                   c.prenom || ' ' || c.nom AS nom_complet,
                   c.matricule AS matricule,
                   c.photo_path AS photo_path
            FROM collaborateurs c
            JOIN profiles p ON p.collaborateur_id = c.id   -- uniquement ceux ayant un compte
            WHERE c.id <> CAST(:moi AS uuid)
              AND COALESCE(c.archive, FALSE) = FALSE
              AND (c.nom ILIKE :motif OR c.prenom ILIKE :motif OR c.matricule ILIKE :motif)
            ORDER BY c.nom, c.prenom
            LIMIT 50
            """
        ),
        {"moi": identite.collaborateur_id, "motif": motif},
    ).mappings().all()

    out: list[dict] = []
    vus: set[str] = set()
    for c in candidats:
        cid = str(c["collaborateur_id"])
        if cid in vus:
            continue
        vus.add(cid)
        if peut_contacter(db, identite.roles, roles_collaborateur(db, cid)):
            out.append(
                {
                    "collaborateur_id": cid,
                    "nom_complet": c["nom_complet"],
                    "matricule": c["matricule"],
                    "photo_path": c["photo_path"],
                }
            )
    return out


# =====================================================================
#  3. Conversations & messages
# =====================================================================
def _cle_directe(a: str, b: str) -> str:
    lo, hi = sorted((a, b))
    return f"{lo}-{hi}"


def est_participant(db: Session, conversation_id: int, collaborateur_id: str) -> bool:
    row = db.execute(
        text(
            "SELECT 1 FROM chat_participant "
            "WHERE conversation_id = :cv AND collaborateur_id = CAST(:c AS uuid) LIMIT 1"
        ),
        {"cv": conversation_id, "c": collaborateur_id},
    ).first()
    return row is not None


def participants_ids(db: Session, conversation_id: int) -> list[str]:
    rows = db.execute(
        text("SELECT collaborateur_id FROM chat_participant WHERE conversation_id = :cv"),
        {"cv": conversation_id},
    ).all()
    return [str(r[0]) for r in rows]


def creer_conversation(
    db: Session, identite: IdentiteChat, type_conv: str, membres_ids: list[str], titre: str | None
) -> int:
    membres = sorted(set(membres_ids) - {identite.collaborateur_id})
    if not membres:
        raise ValueError("Aucun destinataire valide.")

    for m in membres:
        if not peut_contacter(db, identite.roles, roles_collaborateur(db, m)):
            raise ValueError("Vous n'êtes pas autorisé à contacter l'un des destinataires.")

    if type_conv == "direct":
        if len(membres) != 1:
            raise ValueError("Une conversation directe doit avoir exactement un destinataire.")
        cle = _cle_directe(identite.collaborateur_id, membres[0])
        existante = db.execute(
            text("SELECT id FROM chat_conversation WHERE type='direct' AND cle_directe = :k"),
            {"k": cle},
        ).first()
        if existante:
            return existante[0]
        conv_id = db.execute(
            text(
                "INSERT INTO chat_conversation (type, titre, cle_directe, cree_par) "
                "VALUES ('direct', NULL, :k, CAST(:par AS uuid)) RETURNING id"
            ),
            {"k": cle, "par": identite.collaborateur_id},
        ).scalar_one()

    elif type_conv == "groupe":
        if not titre or not titre.strip():
            raise ValueError("Un groupe doit avoir un titre.")
        conv_id = db.execute(
            text(
                "INSERT INTO chat_conversation (type, titre, cree_par) "
                "VALUES ('groupe', :t, CAST(:par AS uuid)) RETURNING id"
            ),
            {"t": titre.strip(), "par": identite.collaborateur_id},
        ).scalar_one()
    else:
        raise ValueError("Type de conversation inconnu.")

    tous = [(identite.collaborateur_id, "admin")] + [(m, "membre") for m in membres]
    for cid, role_conv in tous:
        db.execute(
            text(
                "INSERT INTO chat_participant (conversation_id, collaborateur_id, role_conv) "
                "VALUES (:cv, CAST(:c AS uuid), :r) "
                "ON CONFLICT (conversation_id, collaborateur_id) DO NOTHING"
            ),
            {"cv": conv_id, "c": cid, "r": role_conv},
        )
    db.commit()
    return conv_id


def enregistrer_message(db: Session, conversation_id: int, expediteur_id: str, contenu: str) -> dict:
    contenu = (contenu or "").strip()
    if not contenu:
        raise ValueError("Message vide.")
    if not est_participant(db, conversation_id, expediteur_id):
        raise PermissionError("Vous ne faites pas partie de cette conversation.")

    row = db.execute(
        text(
            "INSERT INTO chat_message (conversation_id, expediteur_id, contenu) "
            "VALUES (:cv, CAST(:e AS uuid), :txt) RETURNING id, cree_le"
        ),
        {"cv": conversation_id, "e": expediteur_id, "txt": contenu},
    ).mappings().one()
    db.commit()

    return {
        "id": row["id"],
        "conversation_id": conversation_id,
        "expediteur_id": expediteur_id,
        "contenu": contenu,
        "cree_le": row["cree_le"].isoformat(),
        "fichier_nom": None,
        "fichier_type": None,
        "fichier_taille": None,
    }


def enregistrer_message_fichier(
    db: Session,
    conversation_id: int,
    expediteur_id: str,
    contenu: str,
    nom: str,
    chemin: str,
    type_mime: str | None,
    taille: int,
) -> dict:
    """Enregistre un message porteur d'une pièce jointe (texte facultatif)."""
    if not est_participant(db, conversation_id, expediteur_id):
        raise PermissionError("Vous ne faites pas partie de cette conversation.")

    row = db.execute(
        text(
            "INSERT INTO chat_message "
            "(conversation_id, expediteur_id, contenu, fichier_nom, fichier_chemin, fichier_type, fichier_taille) "
            "VALUES (:cv, CAST(:e AS uuid), :txt, :fn, :fc, :ft, :fs) RETURNING id, cree_le"
        ),
        {
            "cv": conversation_id,
            "e": expediteur_id,
            "txt": (contenu or "").strip(),
            "fn": nom,
            "fc": chemin,
            "ft": type_mime,
            "fs": taille,
        },
    ).mappings().one()
    db.commit()

    return {
        "id": row["id"],
        "conversation_id": conversation_id,
        "expediteur_id": expediteur_id,
        "contenu": (contenu or "").strip(),
        "cree_le": row["cree_le"].isoformat(),
        "fichier_nom": nom,
        "fichier_type": type_mime,
        "fichier_taille": taille,
    }


def fichier_message(db: Session, message_id: int) -> dict | None:
    """Métadonnées de la pièce jointe d'un message (pour le téléchargement)."""
    row = db.execute(
        text(
            "SELECT conversation_id, fichier_nom, fichier_chemin, fichier_type "
            "FROM chat_message WHERE id = :id AND supprime_le IS NULL"
        ),
        {"id": message_id},
    ).mappings().first()
    if not row or not row["fichier_chemin"]:
        return None
    return {
        "conversation_id": row["conversation_id"],
        "nom": row["fichier_nom"],
        "chemin": row["fichier_chemin"],
        "type": row["fichier_type"],
    }


def lister_conversations(db: Session, collaborateur_id: str) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT
                cv.id AS conversation_id, cv.type, cv.titre,
                dm.contenu AS dernier_contenu, dm.cree_le AS dernier_le,
                COALESCE((
                    SELECT count(*) FROM chat_message m
                    WHERE m.conversation_id = cv.id
                      AND m.supprime_le IS NULL
                      AND m.id > COALESCE(p.dernier_message_lu_id, 0)
                      AND m.expediteur_id <> CAST(:moi AS uuid)
                ), 0) AS non_lus
            FROM chat_participant p
            JOIN chat_conversation cv ON cv.id = p.conversation_id
            LEFT JOIN LATERAL (
                SELECT contenu, cree_le FROM chat_message
                WHERE conversation_id = cv.id AND supprime_le IS NULL
                ORDER BY cree_le DESC LIMIT 1
            ) dm ON TRUE
            WHERE p.collaborateur_id = CAST(:moi AS uuid)
            ORDER BY COALESCE(dm.cree_le, cv.cree_le) DESC
            """
        ),
        {"moi": collaborateur_id},
    ).mappings().all()

    resultats: list[dict] = []
    for r in rows:
        titre = r["titre"]
        photo_path = None
        if r["type"] == "direct":
            autre = db.execute(
                text(
                    """
                    SELECT c.prenom || ' ' || c.nom AS nom, c.photo_path AS photo
                    FROM chat_participant pp
                    JOIN collaborateurs c ON c.id = pp.collaborateur_id
                    WHERE pp.conversation_id = :cv
                      AND pp.collaborateur_id <> CAST(:moi AS uuid)
                    LIMIT 1
                    """
                ),
                {"cv": r["conversation_id"], "moi": collaborateur_id},
            ).mappings().first()
            if autre:
                titre = autre["nom"]
                photo_path = autre["photo"]
            else:
                titre = "Conversation"

        resultats.append(
            {
                "conversation_id": r["conversation_id"],
                "type": r["type"],
                "titre": titre,
                "photo_path": photo_path,
                "dernier_message": r["dernier_contenu"],
                "dernier_le": r["dernier_le"].isoformat() if r["dernier_le"] else None,
                "non_lus": r["non_lus"],
            }
        )
    return resultats


def lister_messages(
    db: Session, conversation_id: int, collaborateur_id: str, avant_id: int | None, limite: int
) -> list[dict]:
    if not est_participant(db, conversation_id, collaborateur_id):
        raise PermissionError("Accès refusé à cette conversation.")

    rows = db.execute(
        text(
            """
            SELECT m.id, m.conversation_id, m.expediteur_id, m.contenu, m.cree_le,
                   m.fichier_nom, m.fichier_type, m.fichier_taille,
                   c.prenom || ' ' || c.nom AS expediteur_nom
            FROM chat_message m
            JOIN collaborateurs c ON c.id = m.expediteur_id
            WHERE m.conversation_id = :cv
              AND m.supprime_le IS NULL
              AND (:avant IS NULL OR m.id < :avant)
            ORDER BY m.id DESC
            LIMIT :lim
            """
        ),
        {"cv": conversation_id, "avant": avant_id, "lim": limite},
    ).mappings().all()

    out = [
        {
            "id": r["id"],
            "conversation_id": r["conversation_id"],
            "expediteur_id": str(r["expediteur_id"]),
            "expediteur_nom": r["expediteur_nom"],
            "contenu": r["contenu"],
            "cree_le": r["cree_le"].isoformat(),
            "fichier_nom": r["fichier_nom"],
            "fichier_type": r["fichier_type"],
            "fichier_taille": r["fichier_taille"],
        }
        for r in rows
    ]
    out.reverse()
    return out


def marquer_lu(db: Session, conversation_id: int, collaborateur_id: str, message_id: int) -> None:
    db.execute(
        text(
            "UPDATE chat_participant SET dernier_message_lu_id = :mid "
            "WHERE conversation_id = :cv AND collaborateur_id = CAST(:c AS uuid) "
            "AND COALESCE(dernier_message_lu_id, 0) < :mid"
        ),
        {"mid": message_id, "cv": conversation_id, "c": collaborateur_id},
    )
    db.commit()


# =====================================================================
#  Note multi-workers : le ConnectionManager est en mémoire → OK en
#  uvicorn mono-worker (dev). En multi-workers/prod, prévoir un pub/sub
#  Redis pour partager la diffusion entre workers. La logique métier
#  ci-dessus ne change pas.
# =====================================================================
