# ============================================================
# email_service.py — app/services/email_service.py
# Service d'envoi SMTP générique (Gmail / Microsoft 365 / OVH…).
# Source de configuration : table param_smtp (prioritaire) puis variables
# d'environnement (repli). Utilisé par le moteur de workflow ET le routeur /smtp.
# ============================================================
from __future__ import annotations

import os
import smtplib
import ssl
import logging
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def charger_config_db(db: Session) -> dict | None:
    """Configuration SMTP enregistrée en base (param_smtp), si active et complète."""
    try:
        row = db.execute(text("""
            SELECT host, port, securite, utilisateur, mot_de_passe, expediteur, actif
            FROM param_smtp WHERE id = 1
        """)).mappings().first()
    except Exception as exc:
        logger.warning("Lecture param_smtp impossible : %s", exc)
        return None
    if not row or not row["actif"] or not row["host"]:
        return None
    return {
        "host": row["host"],
        "port": row["port"] or 587,
        "securite": (row["securite"] or "starttls").lower(),
        "user": row["utilisateur"] or "",
        "password": row["mot_de_passe"] or "",
        "from": row["expediteur"] or row["utilisateur"] or "no-reply@anthro-sys.local",
        "source": "db",
    }


def config_effective(db: Session) -> dict | None:
    """Config base prioritaire, sinon variables d'environnement, sinon None."""
    cfg = charger_config_db(db)
    if cfg:
        return cfg
    host = os.getenv("SMTP_HOST")
    if not host:
        return None
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587")),
        "securite": (os.getenv("SMTP_SECURITY", "starttls") or "starttls").lower(),
        "user": os.getenv("SMTP_USER") or "",
        "password": os.getenv("SMTP_PASSWORD") or "",
        "from": os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "no-reply@anthro-sys.local",
        "source": "env",
    }


def envoyer_email(cfg: dict | None, destinataires: list[str], sujet: str, corps: str) -> dict:
    """Envoi SMTP. Retourne {status: SENT|SKIP|ERROR, ...}."""
    if not cfg or not cfg.get("host"):
        return {"status": "SKIP", "reason": "SMTP non configuré"}
    dests = [d for d in destinataires if d and "@" in d]
    if not dests:
        return {"status": "SKIP", "reason": "aucune adresse email résolue"}

    # Expéditeur : tolère un simple nom d'affichage (l'adresse réelle vient alors
    # de l'identifiant), et garantit une adresse avec domaine (sinon SMTP 501).
    brut = (cfg.get("from") or "").strip()
    nom, adresse = parseaddr(brut)
    if "@" not in (adresse or ""):
        nom = brut if ("@" not in brut and brut) else nom
        adresse = ""
    if not adresse and "@" in (cfg.get("user") or ""):
        adresse = (cfg.get("user") or "").strip()
    if not adresse:
        adresse = "no-reply@anthro-sys.local"

    msg = EmailMessage()
    msg["From"] = formataddr((nom, adresse))
    msg["To"] = ", ".join(dests)
    msg["Subject"] = sujet or "(sans objet)"
    msg.set_content(corps or "")

    secu = (cfg.get("securite") or "starttls").lower()
    host = cfg["host"]
    port = int(cfg.get("port") or 587)
    user = cfg.get("user") or ""
    pwd = cfg.get("password") or ""
    try:
        if secu == "ssl":
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as srv:
                if user:
                    srv.login(user, pwd)
                srv.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as srv:
                srv.ehlo()
                if secu == "starttls":
                    srv.starttls(context=ssl.create_default_context())
                    srv.ehlo()
                if user:
                    srv.login(user, pwd)
                srv.send_message(msg)
        logger.info("E-mail envoyé à %s (source=%s)", dests, cfg.get("source"))
        return {"status": "SENT", "to": dests}
    except Exception as exc:
        logger.error("Envoi e-mail échoué : %s", exc)
        return {"status": "ERROR", "error": str(exc), "to": dests}
