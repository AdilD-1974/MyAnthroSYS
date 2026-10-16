# ============================================================
# smtp_config.py — app/routers/smtp_config.py
# Configuration SMTP éditable par l'administrateur (+ test d'envoi).
# À enregistrer dans main.py :  app.include_router(smtp_config.router, prefix="/api/v1")
# ============================================================
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.services.email_service import config_effective, envoyer_email

router = APIRouter(prefix="/smtp", tags=["smtp"])


class SmtpIn(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = 587
    securite: Optional[str] = "starttls"
    utilisateur: Optional[str] = None
    mot_de_passe: Optional[str] = None   # vide => mot de passe inchangé
    expediteur: Optional[str] = None
    actif: Optional[bool] = False


class TestIn(BaseModel):
    destinataire: str


@router.get("")
def get_config(payload: dict = Depends(require_roles("administrateur")),
               db: Session = Depends(get_db)):
    """Lit la config SMTP. Le mot de passe n'est jamais renvoyé : on indique
    seulement s'il est défini (mot_de_passe_defini)."""
    row = db.execute(text("""
        SELECT host, port, securite, utilisateur, expediteur, actif,
               (mot_de_passe IS NOT NULL AND mot_de_passe <> '') AS mot_de_passe_defini
        FROM param_smtp WHERE id = 1
    """)).mappings().first()
    if not row:
        return {"host": None, "port": 587, "securite": "starttls",
                "utilisateur": None, "expediteur": None, "actif": False,
                "mot_de_passe_defini": False}
    return dict(row)


@router.put("")
def put_config(body: SmtpIn,
               payload: dict = Depends(require_roles("administrateur")),
               db: Session = Depends(get_db)):
    """Enregistre la config. Le mot de passe n'est réécrit que s'il est fourni."""
    db.execute(text("INSERT INTO param_smtp (id) VALUES (1) ON CONFLICT (id) DO NOTHING"))
    sets = ["host=:host", "port=:port", "securite=:securite",
            "utilisateur=:utilisateur", "expediteur=:expediteur",
            "actif=:actif", "updated_at=now()"]
    params = {
        "host": body.host,
        "port": body.port or 587,
        "securite": (body.securite or "starttls").lower(),
        "utilisateur": body.utilisateur,
        "expediteur": body.expediteur,
        "actif": bool(body.actif),
    }
    if body.mot_de_passe:
        sets.append("mot_de_passe=:mdp")
        params["mdp"] = body.mot_de_passe
    db.execute(text(f"UPDATE param_smtp SET {', '.join(sets)} WHERE id = 1"), params)
    db.commit()
    return {"ok": True}


@router.post("/test")
def test_config(body: TestIn,
                payload: dict = Depends(require_roles("administrateur")),
                db: Session = Depends(get_db)):
    """Envoie un e-mail de test avec la configuration effective."""
    cfg = config_effective(db)
    if not cfg:
        raise HTTPException(status_code=400, detail="SMTP non configuré (ni base, ni environnement).")
    rep = envoyer_email(
        cfg, [body.destinataire],
        "Test ANTHRO-SYS",
        "Ceci est un e-mail de test envoyé depuis ANTHRO-SYS.\n"
        "Si vous le recevez, la configuration SMTP est correcte.",
    )
    if rep.get("status") != "SENT":
        raise HTTPException(status_code=400,
                            detail=f"Échec : {rep.get('error') or rep.get('reason')}")
    return {"ok": True, "to": rep.get("to")}
