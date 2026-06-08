"""
contrats_admin.py — Administration et auto-clôture des contrats
─────────────────────────────────────────────────────────────────────────────
Endpoints :
  • GET  /api/v1/admin/contrats/cloturer-echus/preview
      → Liste les contrats qui SERAIENT clôturés. Sans effet de bord.
  • POST /api/v1/admin/contrats/cloturer-echus
      → Exécute la clôture immédiatement, retourne le compte.

Scheduler :
  • start_scheduler()  → démarre un cron in-process à 01:00 (Africa/Casablanca)
  • stop_scheduler()   → arrêt propre

À intégrer dans app/main.py — voir le bas du fichier pour les 4 lignes exactes.
"""
from datetime import date
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.security import require_roles


# require_roles est une factory : on lui passe le rôle requis et il renvoie
# une dépendance utilisable avec Depends(). Ajuste "ADMIN" si tes rôles
# applicatifs s'appellent autrement (ADMINISTRATEUR, SUPER_ADMIN, etc.).
admin_required = require_roles("ADMIN")


router = APIRouter(prefix="/admin/contrats", tags=["admin-contrats"])


# ──────────────────────────────────────────────────────────────────────────
# Logique métier — partagée entre endpoint sync et job scheduler
# ──────────────────────────────────────────────────────────────────────────
def _run_cloture_with_own_session() -> int:
    """
    Exécute la clôture en ouvrant sa propre session SQLAlchemy.
    Utilisée par le scheduler (qui n'a pas de Session de requête à disposition).
    """
    db = SessionLocal()
    try:
        count = db.execute(text("SELECT cloturer_contrats_echus()")).scalar()
        db.commit()
        return int(count or 0)
    finally:
        db.close()


def _list_a_cloturer(db: Session) -> list[dict[str, Any]]:
    """Liste les contrats arrivés à échéance, prêts à être clôturés."""
    rows = db.execute(
        text("""
            SELECT
                c.id,
                c.collaborateur_id,
                c.code_type_contrat,
                c.date_debut,
                c.date_fin,
                c.code_statut_contrat,
                col.matricule,
                col.nom,
                col.prenom
            FROM collaborateur_contrats c
            JOIN ref_type_contrat r ON r.code = c.code_type_contrat
            LEFT JOIN collaborateurs col ON col.id = c.collaborateur_id
            WHERE r.auto_cloture = true
              AND c.code_statut_contrat IN ('ACTIF', 'EN_COURS')
              AND c.date_fin IS NOT NULL
              AND c.date_fin <= CURRENT_DATE
              AND COALESCE(c.archive, false) = false
            ORDER BY c.date_fin
        """)
    ).mappings().all()
    return [dict(r) for r in rows]


# ──────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────
@router.get("/cloturer-echus/preview")
def preview_cloture_echus(
    db: Session = Depends(get_db),
    _user=Depends(admin_required),
):
    """
    Liste les contrats qui seraient clôturés si la fonction tournait maintenant.
    Sans effet de bord.
    """
    contrats = _list_a_cloturer(db)
    return {
        "date_reference": date.today().isoformat(),
        "count": len(contrats),
        "contrats": contrats,
    }


@router.post("/cloturer-echus")
def cloturer_echus(
    db: Session = Depends(get_db),
    _user=Depends(admin_required),
):
    """
    Exécute la clôture immédiatement et retourne le nombre de contrats traités.
    """
    try:
        count = db.execute(text("SELECT cloturer_contrats_echus()")).scalar()
        db.commit()
        return {
            "date_execution": date.today().isoformat(),
            "contrats_clotures": int(count or 0),
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur de clôture : {e}")


# ──────────────────────────────────────────────────────────────────────────
# Scheduler — cron in-process à 01:00 Africa/Casablanca
# ──────────────────────────────────────────────────────────────────────────
_scheduler: BackgroundScheduler | None = None


def _scheduled_job():
    """Job exécuté automatiquement chaque jour à 01:00."""
    try:
        count = _run_cloture_with_own_session()
        print(f"[scheduler 01:00] cloturer_contrats_echus → {count} contrat(s) basculé(s) en ECHU")
    except Exception as exc:  # noqa: BLE001
        print(f"[scheduler 01:00] ERREUR : {exc}")


def start_scheduler() -> None:
    """
    Démarre le scheduler in-process. À appeler depuis le lifespan de main.py
    (côté startup, avant `yield`).
    """
    global _scheduler
    if _scheduler is not None:
        return  # déjà démarré (idempotent)

    _scheduler = BackgroundScheduler(timezone="Africa/Casablanca")
    _scheduler.add_job(
        _scheduled_job,
        trigger=CronTrigger(hour=1, minute=0),
        id="contrat-auto-cloture",
        replace_existing=True,
        misfire_grace_time=3600,  # tolère 1h de retard si redémarrage tardif
    )
    _scheduler.start()
    print("[scheduler] Auto-clôture contrats programmée à 01:00 (Africa/Casablanca)")


def stop_scheduler() -> None:
    """
    Arrête proprement le scheduler. À appeler depuis le lifespan de main.py
    (côté shutdown, après `yield`).
    """
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        print("[scheduler] Arrêt propre")
