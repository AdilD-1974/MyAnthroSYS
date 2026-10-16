# ============================================================
# sms_service.py — app/services/sms_service.py
# Envoi SMS via un agrégateur HTTP générique (configurable : URL, méthode,
# noms des paramètres). Lu par le moteur de workflow ET le routeur /sms.
# ============================================================
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def charger_config_db(db: Session) -> dict | None:
    try:
        row = db.execute(text("""
            SELECT actif, base_url, methode, format, cle_destinataire, cle_message,
                   params_statiques, ok_si_contient, indicatif, champ_telephone
            FROM param_sms WHERE id = 1
        """)).mappings().first()
    except Exception as exc:
        logger.warning("Lecture param_sms impossible : %s", exc)
        return None
    if not row or not row["actif"] or not row["base_url"]:
        return None
    cfg = dict(row)
    ps = cfg.get("params_statiques")
    if isinstance(ps, str):
        try:
            cfg["params_statiques"] = json.loads(ps) if ps else {}
        except Exception:
            cfg["params_statiques"] = {}
    elif ps is None:
        cfg["params_statiques"] = {}
    return cfg


def config_effective(db: Session) -> dict | None:
    return charger_config_db(db)


def normaliser_numero(num: str, indicatif: str = "212") -> str:
    n = "".join(ch for ch in str(num) if ch.isdigit() or ch == "+")
    if not n:
        return ""
    if n.startswith("+"):
        n = n[1:]
    elif n.startswith("00"):
        n = n[2:]
    elif n.startswith("0"):
        n = indicatif + n[1:]
    elif not n.startswith(indicatif):
        n = indicatif + n
    return n


def envoyer_sms(cfg: dict | None, numeros: list[str], message: str) -> dict:
    if not cfg or not cfg.get("base_url"):
        return {"status": "SKIP", "reason": "SMS non configuré"}
    indicatif = cfg.get("indicatif") or "212"
    nums = []
    for n in numeros:
        nn = normaliser_numero(n, indicatif)
        if nn:
            nums.append(nn)
    nums = list(dict.fromkeys(nums))
    if not nums:
        return {"status": "SKIP", "reason": "aucun numéro résolu"}

    methode = (cfg.get("methode") or "GET").upper()
    fmt = (cfg.get("format") or "query").lower()
    cle_to = cfg.get("cle_destinataire") or "to"
    cle_msg = cfg.get("cle_message") or "message"
    marqueur = cfg.get("ok_si_contient")

    envoyes, erreurs = [], []
    for num in nums:
        params = dict(cfg.get("params_statiques") or {})
        params[cle_to] = num
        params[cle_msg] = message or ""
        try:
            if methode == "GET":
                sep = "&" if "?" in cfg["base_url"] else "?"
                url = cfg["base_url"] + sep + urllib.parse.urlencode(params)
                req = urllib.request.Request(url, method="GET")
            elif fmt == "json":
                req = urllib.request.Request(
                    cfg["base_url"], data=json.dumps(params).encode("utf-8"), method="POST")
                req.add_header("Content-Type", "application/json")
            else:  # form
                req = urllib.request.Request(
                    cfg["base_url"], data=urllib.parse.urlencode(params).encode("utf-8"), method="POST")
                req.add_header("Content-Type", "application/x-www-form-urlencoded")

            with urllib.request.urlopen(req, timeout=20) as resp:
                code = getattr(resp, "status", 200)
                body = resp.read().decode("utf-8", "ignore")
            ok = (200 <= code < 300) and (not marqueur or marqueur in body)
            if ok:
                envoyes.append(num)
            else:
                erreurs.append({"num": num, "code": code, "reponse": body[:200]})
        except Exception as exc:
            erreurs.append({"num": num, "error": str(exc)})

    if envoyes and not erreurs:
        return {"status": "SENT", "to": envoyes}
    if envoyes and erreurs:
        return {"status": "PARTIEL", "to": envoyes, "erreurs": erreurs}
    return {"status": "ERROR", "erreurs": erreurs}
