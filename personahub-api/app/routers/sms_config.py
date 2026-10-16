# ============================================================
# sms_config.py — app/routers/sms_config.py
# Configuration de la passerelle SMS par l'administrateur (+ test d'envoi).
# Enregistrer dans main.py :  app.include_router(sms_config.router, prefix="/api/v1")
# ============================================================
from __future__ import annotations

from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.services.sms_service import config_effective, envoyer_sms

router = APIRouter(prefix="/sms", tags=["sms"])


class SmsIn(BaseModel):
    actif: Optional[bool] = False
    base_url: Optional[str] = None
    methode: Optional[str] = "GET"
    format: Optional[str] = "query"
    cle_destinataire: Optional[str] = "to"
    cle_message: Optional[str] = "message"
    params_statiques: Optional[dict[str, Any]] = None
    ok_si_contient: Optional[str] = None
    indicatif: Optional[str] = "212"
    champ_telephone: Optional[str] = "telephone"


class TestIn(BaseModel):
    destinataire: str


@router.get("")
def get_config(payload: dict = Depends(require_roles("administrateur")),
               db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT actif, base_url, methode, format, cle_destinataire, cle_message,
               params_statiques, ok_si_contient, indicatif, champ_telephone
        FROM param_sms WHERE id = 1
    """)).mappings().first()
    if not row:
        return {"actif": False, "base_url": None, "methode": "GET", "format": "query",
                "cle_destinataire": "to", "cle_message": "message",
                "params_statiques": {}, "ok_si_contient": None,
                "indicatif": "212", "champ_telephone": "telephone"}
    return dict(row)


@router.put("")
def put_config(body: SmsIn,
               payload: dict = Depends(require_roles("administrateur")),
               db: Session = Depends(get_db)):
    import json as _json
    db.execute(text("INSERT INTO param_sms (id) VALUES (1) ON CONFLICT (id) DO NOTHING"))
    db.execute(text("""
        UPDATE param_sms SET
            actif = :actif, base_url = :base_url, methode = :methode, format = :format,
            cle_destinataire = :cle_to, cle_message = :cle_msg,
            params_statiques = CAST(:ps AS JSONB), ok_si_contient = :ok,
            indicatif = :ind, champ_telephone = :champ, updated_at = now()
        WHERE id = 1
    """), {
        "actif": bool(body.actif),
        "base_url": body.base_url,
        "methode": (body.methode or "GET").upper(),
        "format": (body.format or "query").lower(),
        "cle_to": body.cle_destinataire or "to",
        "cle_msg": body.cle_message or "message",
        "ps": _json.dumps(body.params_statiques or {}),
        "ok": body.ok_si_contient,
        "ind": body.indicatif or "212",
        "champ": body.champ_telephone or "telephone",
    })
    db.commit()
    return {"ok": True}


@router.post("/test")
def test_config(body: TestIn,
                payload: dict = Depends(require_roles("administrateur")),
                db: Session = Depends(get_db)):
    cfg = config_effective(db)
    if not cfg:
        raise HTTPException(status_code=400, detail="Passerelle SMS non configurée ou inactive.")
    rep = envoyer_sms(cfg, [body.destinataire],
                      "Test ANTHRO-SYS : votre passerelle SMS est correctement configurée.")
    if rep.get("status") not in ("SENT", "PARTIEL"):
        raise HTTPException(status_code=400, detail=f"Échec : {rep}")
    return {"ok": True, "resultat": rep}
