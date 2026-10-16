# app/services/tache_assign_email.py
# ------------------------------------------------------------
# Service : envoi d'email lors de l'assignation d'une tâche
# Appelé depuis tache_service.py après create_tache / update_tache
# ------------------------------------------------------------
from __future__ import annotations

import logging
from datetime import date
from typing import Optional
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def envoyer_email_assignation(
    db: Session,
    tache_id: str,
    tache_titre: str,
    tache_description: Optional[str],
    tache_priorite: str,
    tache_echeance: Optional[date],
    manager_nom: str,
    manager_prenom: str,
    assignataires_ids: list[str],
) -> None:
    """
    Envoie un email à chaque collaborateur assigné à une tâche.
    Utilise la table profiles + users pour récupérer les emails.
    """
    if not assignataires_ids:
        return

    # Récupérer les emails + noms des assignataires
    try:
        rows = db.execute(text("""
            SELECT
                c.id            AS collaborateur_id,
                c.prenom        AS prenom,
                c.nom           AS nom,
                u.email         AS email
            FROM collaborateurs c
            JOIN profiles p ON p.collaborateur_id = c.id
            JOIN users     u ON u.id = p.user_id
            WHERE c.id = ANY(:ids)
              AND c.archive = FALSE
        """), {"ids": assignataires_ids}).fetchall()
    except Exception as e:
        logger.error(f"[tache_assign_email] Erreur récupération emails: {e}")
        return

    if not rows:
        logger.warning(f"[tache_assign_email] Aucun email trouvé pour {assignataires_ids}")
        return

    # Import dynamique pour ne pas bloquer si email_service absent
    try:
        from app.services.email_service import send_email_sync
    except ImportError:
        logger.warning("[tache_assign_email] email_service non disponible — emails ignorés")
        return

    echeance_str = tache_echeance.strftime("%d/%m/%Y") if tache_echeance else "Non définie"
    priorite_label = {
        "urgente": "🔴 Urgente",
        "haute":   "🟠 Haute",
        "normale": "🟡 Normale",
        "basse":   "🟢 Basse",
    }.get(tache_priorite, tache_priorite)

    for row in rows:
        try:
            sujet = f"[PersonaHub HR] Nouvelle tâche assignée : {tache_titre}"
            corps = _build_email(
                prenom_dest=row["prenom"],
                manager_nom=f"{manager_prenom} {manager_nom}",
                titre=tache_titre,
                description=tache_description,
                priorite=priorite_label,
                echeance=echeance_str,
                tache_id=tache_id,
            )
            send_email_sync(to=row["email"], subject=sujet, body=corps)
            logger.info(f"[tache_assign_email] Email envoyé à {row['email']} pour tâche {tache_id}")
        except Exception as e:
            logger.warning(f"[tache_assign_email] Échec envoi à {row['email']}: {e}")


def _build_email(
    prenom_dest: str,
    manager_nom: str,
    titre: str,
    description: Optional[str],
    priorite: str,
    echeance: str,
    tache_id: str,
) -> str:
    # Nettoyer le HTML de la description si présent
    desc_texte = ""
    if description:
        import re
        desc_texte = re.sub(r"<[^>]+>", " ", description).strip()
        desc_texte = re.sub(r"\s+", " ", desc_texte)

    return f"""
Bonjour {prenom_dest},

{manager_nom} vous a assigné(e) une nouvelle tâche dans PersonaHub HR.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TÂCHE : {titre}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Priorité  : {priorite}
  Échéance  : {echeance}
{f"  Détails   : {desc_texte[:300]}{'...' if len(desc_texte) > 300 else ''}" if desc_texte else ""}

Pour accéder à cette tâche :
  → http://localhost:8080/taches/{tache_id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ce message est généré automatiquement par PersonaHub HR.
    """.strip()
