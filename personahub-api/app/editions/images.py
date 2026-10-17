"""
app/editions/images.py — Bibliothèque d'images des éditions (logos secondaires, cachets,
signatures, bandeaux, filigranes). Auteur : Adil DAIA — lot 2 bis (17/10/2026)

RG-EDT-IMAGE-01 (Adil DAIA) : une image est déposée UNE fois, sous un code, pour la société
active, puis utilisée dans n'importe quel modèle par la formule ASSET("CODE").
RG-EDT-IMAGE-02 : les images sont rangées HORS de storage (publié sans authentification) :
<racine_images>/<société>/<CODE>.<png|jpg>. Elles ne sortent que par l'API, droits contrôlés.
RG-EDT-IMAGE-03 : seuls PNG et JPEG, 2 Mo maximum, contenu vérifié (pas seulement l'extension).
RG-EDT-SECU-06 : à l'impression, une image ne peut venir que de storage ou de cette
bibliothèque — aucun autre fichier du serveur.
"""
from __future__ import annotations

import io
import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

TAILLE_MAX = 2 * 1024 * 1024
FORMATS = {"PNG": ".png", "JPEG": ".jpg"}
MOTIF_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,39}$")


class ImageInvalide(ValueError):
    pass


def racine_images() -> Path:
    """Réglable par la variable d'environnement EDITIONS_IMAGES."""
    return Path(os.environ.get("EDITIONS_IMAGES", "donnees_privees/editions_images"))


def _dossier(societe_id: str) -> Path:
    s = str(societe_id)
    if not re.fullmatch(r"[0-9a-fA-F-]{8,40}", s):
        raise ImageInvalide("Société invalide")
    return racine_images() / s


def normaliser_code(code: str) -> str:
    sans_accents = unicodedata.normalize("NFD", code or "").encode("ascii", "ignore").decode()
    c = re.sub(r"[^A-Z0-9_]+", "_", sans_accents.strip().upper()).strip("_")
    if c and c[0].isdigit():
        c = f"IMG_{c}"
    c = c[:40]
    if not MOTIF_CODE.match(c):
        raise ImageInvalide("Code d'image invalide : lettres, chiffres et _ (ex. CACHET, SIGNATURE_DG)")
    return c


def chemin(societe_id: str, code: str) -> Optional[Path]:
    d = _dossier(societe_id)
    for ext in set(FORMATS.values()):
        p = d / f"{code}{ext}"
        if p.is_file():
            return p
    return None


def lister(societe_id: str) -> list[dict]:
    d = _dossier(societe_id)
    if not d.is_dir():
        return []
    sortie = []
    for p in sorted(d.iterdir()):
        if p.suffix.lower() not in FORMATS.values() or not MOTIF_CODE.match(p.stem):
            continue
        st = p.stat()
        sortie.append({"code": p.stem, "format": p.suffix[1:].upper(), "taille": st.st_size,
                       "modifie_le": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                       "formule": f'ASSET("{p.stem}")'})
    return sortie


def chemins_assets(societe_id: str) -> dict[str, str]:
    """{"ASSET.CODE": chemin absolu} pour le contexte d'impression (fonction ASSET)."""
    try:
        return {f"ASSET.{i['code']}": str(chemin(societe_id, i["code"]).resolve()) for i in lister(societe_id)}
    except ImageInvalide:
        return {}


def enregistrer(societe_id: str, code: str, contenu: bytes, remplacer: bool = False) -> dict:
    code = normaliser_code(code)
    if not contenu:
        raise ImageInvalide("Fichier vide")
    if len(contenu) > TAILLE_MAX:
        raise ImageInvalide("Image trop lourde (2 Mo maximum)")
    from PIL import Image                                   # contenu réellement lu, pas seulement l'extension
    try:
        with Image.open(io.BytesIO(contenu)) as img:
            fmt = (img.format or "").upper()
            img.verify()
    except Exception:
        raise ImageInvalide("Le fichier n'est pas une image PNG ou JPEG lisible")
    if fmt not in FORMATS:
        raise ImageInvalide("Format accepté : PNG ou JPEG")
    existant = chemin(societe_id, code)
    if existant and not remplacer:
        raise ImageInvalide(f"L'image « {code} » existe déjà (cochez « Remplacer »)")
    d = _dossier(societe_id)
    d.mkdir(parents=True, exist_ok=True)
    if existant:
        existant.unlink()
    cible = d / f"{code}{FORMATS[fmt]}"
    tmp = cible.with_suffix(cible.suffix + ".tmp")
    tmp.write_bytes(contenu)
    tmp.replace(cible)
    return next(i for i in lister(societe_id) if i["code"] == code)


def supprimer(societe_id: str, code: str) -> bool:
    p = chemin(societe_id, normaliser_code(code))
    if not p:
        return False
    p.unlink()
    return True


def autorise(p: Path, racine_storage: Path) -> bool:
    """RG-EDT-SECU-06 : le fichier à imprimer est-il dans storage ou dans la bibliothèque ?"""
    try:
        r = p.resolve()
    except OSError:
        return False
    for base in (racine_storage, racine_images()):
        try:
            r.relative_to(base.resolve())
            return True
        except ValueError:
            continue
    return False
