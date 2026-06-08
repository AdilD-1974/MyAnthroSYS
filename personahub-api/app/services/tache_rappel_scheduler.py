# app/services/tache_rappel_scheduler.py
# ------------------------------------------------------------
# Scheduler APScheduler — Rappels tâches (in-app + email)
# À démarrer dans main.py au lifespan de FastAPI
# ------------------------------------------------------------
from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text

from app.core.database import SessionLocal

# ── Services optionnels (brancher quand disponibles) ─────────
# notification_service et email_service sont importés dynamiquement
# dans le job pour ne pas bloquer le démarrage si absents.
_notification_service = None
_email_service = None

try:
    from app.services import notification_service as _notification_service
except ImportError:
    pass

try:
    from app.services import email_service as _email_service
except ImportError:
    pass

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


# ────────────────────────────────────────────────────────────
# Job principal — tourne toutes les 5 minutes
# ────────────────────────────────────────────────────────────

@scheduler.scheduled_job("interval", minutes=5, id="tache_rappels")
async def job_envoyer_rappels():
    """
    Recherche les rappels dont date_rappel <= maintenant et envoye = FALSE.
    Pour chacun : notification in-app + email selon type_rappel.
    """
    db = SessionLocal()
    try:
        rappels = db.execute(text("""
            SELECT
                tr.id,
                tr.tache_id,
                tr.type_rappel,
                tr.destinataire_id,
                t.titre            AS tache_titre,
                t.date_echeance,
                t.priorite,
                t.statut
            FROM tache_rappel tr
            JOIN tache t ON t.id = tr.tache_id
            WHERE tr.envoye = FALSE
              AND tr.date_rappel <= NOW()
              AND t.statut NOT IN ('terminee', 'annulee')
            ORDER BY tr.date_rappel
            LIMIT 200
        """)).fetchall()

        if not rappels:
            return

        logger.info(f"[tache_rappels] {len(rappels)} rappel(s) à traiter")

        for r in rappels:
            try:
                await _traiter_rappel(db, r)
            except Exception as e:
                logger.error(f"[tache_rappels] Erreur rappel {r['id']}: {e}")

        db.commit()

    except Exception as e:
        logger.error(f"[tache_rappels] Erreur job: {e}")
        db.rollback()
    finally:
        db.close()


async def _traiter_rappel(db, r):
    tache_id     = str(r["tache_id"])
    dest_id      = str(r["destinataire_id"])
    type_rappel  = r["type_rappel"]
    titre        = r["tache_titre"]
    echeance     = r["date_echeance"]

    echeance_str = echeance.strftime("%d/%m/%Y") if echeance else "sans échéance"
    message_court = f"Rappel : « {titre} » — échéance le {echeance_str}"

    # ── In-app via NotificationBell ──────────────────────────
    if type_rappel in ("inapp", "les_deux"):
        if _notification_service and hasattr(_notification_service, "creer_notification"):
            try:
                await _notification_service.creer_notification(
                    db=db,
                    destinataire_id=dest_id,
                    type_notif="rappel_tache",
                    titre="Rappel de tâche",
                    message=message_court,
                    lien=f"/taches/{tache_id}",
                    metadata={"tache_id": tache_id, "priorite": r["priorite"]},
                )
            except Exception as e:
                logger.warning(f"[tache_rappels] Notification in-app échouée pour {dest_id}: {e}")
        else:
            logger.debug(f"[tache_rappels] notification_service non disponible — rappel in-app ignoré pour {dest_id}")

    # ── Email ────────────────────────────────────────────────
    if type_rappel in ("email", "les_deux"):
        if _email_service and hasattr(_email_service, "send_email"):
            try:
                email_dest = await _get_email_collaborateur(db, dest_id)
                if email_dest:
                    await _email_service.send_email(
                        to=email_dest,
                        subject=f"[PersonaHub] Rappel : {titre}",
                        body=_build_email_body(titre, echeance_str, tache_id, r["priorite"]),
                    )
            except Exception as e:
                logger.warning(f"[tache_rappels] Email échoué pour {dest_id}: {e}")
        else:
            logger.debug(f"[tache_rappels] email_service non disponible — rappel email ignoré pour {dest_id}")

    # ── Marquer comme envoyé ─────────────────────────────────
    db.execute(text("""
        UPDATE tache_rappel
        SET envoye = TRUE, envoye_le = NOW()
        WHERE id = :rid
    """), {"rid": str(r["id"])})


async def _get_email_collaborateur(db, collab_id: str) -> str | None:
    """
    Récupère l'email depuis profiles ou users selon votre schéma.
    À adapter si votre table s'appelle différemment.
    """
    row = db.execute(text("""
        SELECT u.email
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        WHERE p.collaborateur_id = :cid
        LIMIT 1
    """), {"cid": collab_id}).fetchone()
    return row["email"] if row else None


def _build_email_body(titre: str, echeance_str: str, tache_id: str, priorite: str) -> str:
    priorite_label = {
        "urgente": "🔴 Urgente",
        "haute":   "🟠 Haute",
        "normale": "🟡 Normale",
        "basse":   "🟢 Basse",
    }.get(priorite, priorite)

    return f"""
Bonjour,

Ceci est un rappel automatique pour la tâche suivante :

  Tâche     : {titre}
  Échéance  : {echeance_str}
  Priorité  : {priorite_label}

Vous pouvez accéder à cette tâche directement dans PersonaHub HR :
  → http://localhost:8080/taches/{tache_id}

---
Ce message est généré automatiquement par PersonaHub HR.
Ne pas répondre à cet email.
    """.strip()


# ────────────────────────────────────────────────────────────
# Intégration dans main.py
# ────────────────────────────────────────────────────────────
#
# Dans votre main.py, ajoutez dans le lifespan :
#
#   from app.services.tache_rappel_scheduler import scheduler as tache_scheduler
#
#   @asynccontextmanager
#   async def lifespan(app: FastAPI):
#       tache_scheduler.start()
#       yield
#       tache_scheduler.shutdown()
#
#   app = FastAPI(lifespan=lifespan)
#
# Si vous avez déjà un lifespan, ajoutez simplement :
#   tache_scheduler.start()  au démarrage
#   tache_scheduler.shutdown()  à l'arrêt
#
# ────────────────────────────────────────────────────────────
