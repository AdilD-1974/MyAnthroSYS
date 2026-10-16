"""
app/core/licence_verify.py — Vérification de la licence signée (côté application).
Auteur : Adil DAIA

Lit le fichier licence.lic, vérifie sa signature Ed25519 avec la CLÉ PUBLIQUE
embarquée ci-dessous, et expose l'état réel de la licence.

La clé PUBLIQUE ne permet QUE de vérifier une signature : un client ne peut pas
forger ni modifier une licence sans la clé privée (détenue uniquement par l'éditeur).

⚠️  Remplace LICENCE_PUBLIC_KEY_PEM par TA vraie clé publique (sortie de
    licence_keygen.py : le contenu de licence_public.pem).
"""
from __future__ import annotations

import os
import json
import base64
from datetime import date, timedelta
from functools import lru_cache

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature

# ─── CLÉ PUBLIQUE EMBARQUÉE (exemple — remplace par la tienne) ───────────────
LICENCE_PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAW/ZLUKuroqBMgGN9IAVRs3VAQ6J+HUly8WRfyK73YaE=
-----END PUBLIC KEY-----

"""

# Emplacement du fichier .lic (déposé par le client). Surcouchable par variable d'env.
LICENCE_FILE = os.environ.get("LICENCE_FILE", "storage/licence.lic")


def _canonical(data: dict) -> bytes:
    """DOIT être identique à licence_sign.canonical (sinon la vérif échoue)."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


@lru_cache(maxsize=1)
def _public_key() -> Ed25519PublicKey:
    return serialization.load_pem_public_key(LICENCE_PUBLIC_KEY_PEM)


def lire_licence() -> dict:
    """Lit et vérifie le fichier licence. Retourne un état structuré :

    {
      valide: bool,            # signature correcte et fichier lisible
      raison: str|None,        # si invalide : 'absente' | 'illisible' | 'falsifiee'
      data: dict|None,         # le contenu (si lisible, même si falsifié)
      etat_echeance: str|None, # 'active' | 'grace' | 'expiree' | None (perpétuel)
      jours_restants: int|None,
      bloquee: bool,           # True si l'app doit bloquer (invalide OU expirée)
    }
    """
    # 1) Fichier présent ?
    if not os.path.exists(LICENCE_FILE):
        return {"valide": False, "raison": "absente", "data": None,
                "etat_echeance": None, "jours_restants": None, "bloquee": True, "empreinte": None}

    # 2) Lisible ?
    try:
        with open(LICENCE_FILE, "r", encoding="utf-8") as f:
            lic = json.load(f)
        data = lic["data"]
        signature = base64.b64decode(lic["signature"])
        # Empreinte = hash de la signature (identifie de façon unique cette licence)
        import hashlib
        empreinte = hashlib.sha256(lic["signature"].encode("ascii")).hexdigest()
    except Exception:
        return {"valide": False, "raison": "illisible", "data": None,
                "etat_echeance": None, "jours_restants": None, "bloquee": True, "empreinte": None}

    # 3) Signature valide ? (intégrité — détecte toute modification)
    try:
        _public_key().verify(signature, _canonical(data))
    except InvalidSignature:
        return {"valide": False, "raison": "falsifiee", "data": data,
                "etat_echeance": None, "jours_restants": None, "bloquee": True, "empreinte": None}
    except Exception:
        return {"valide": False, "raison": "falsifiee", "data": data,
                "etat_echeance": None, "jours_restants": None, "bloquee": True, "empreinte": None}

    # 4) Signature OK → calcul de l'état d'échéance
    etat = None
    jours_restants = None
    bloquee = False
    date_fin = data.get("date_fin")
    if date_fin:
        try:
            df = date.fromisoformat(date_fin)
            grace = int(data.get("grace_jours") or 0)
            today = date.today()
            jours_restants = (df - today).days
            if today <= df:
                etat = "active"
            elif today <= df + timedelta(days=grace):
                etat = "grace"          # tolérée : pas encore bloquée
            else:
                etat = "expiree"
                bloquee = True          # au-delà de la grâce → blocage
        except Exception:
            pass

    return {"valide": True, "raison": None, "data": data,
            "etat_echeance": etat, "jours_restants": jours_restants, "bloquee": bloquee,
            "empreinte": empreinte}


def module_autorise(code_module: str) -> bool:
    """True si le module est couvert par une licence valide et non bloquée.

    Si la licence est 'full', TOUT module est autorisé (présent ou futur) —
    sans avoir à régénérer la licence à chaque nouveau module.
    La limite de collaborateurs, elle, reste toujours appliquée par ailleurs.
    """
    etat = lire_licence()
    if not etat["valide"] or etat["bloquee"]:
        return False
    data = etat["data"] or {}
    if data.get("full") is True:
        return True
    return code_module in (data.get("modules") or [])


def limite_collaborateurs() -> int | None:
    """Limite licenciée (None si licence invalide)."""
    etat = lire_licence()
    if not etat["valide"]:
        return None
    return etat["data"].get("max_collaborateurs")
