"""
app/editions/moteur/texte.py — Polices, mesure et découpage du texte.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

RG-EDT-RENDU-01 (Adil DAIA) : un texte contenant de l'arabe est mis en forme
(arabic_reshaper) et réordonné (python-bidi) AVANT d'être mesuré, ligne par
ligne : les retours à la ligne tombent juste et le PDF n'a plus rien à faire.
Toutes les mesures utilisent les métriques ReportLab : ce qui est mesuré ici
est exactement ce qui sera dessiné.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

log = logging.getLogger(__name__)

PT_PAR_MM = 72 / 25.4
TAILLE_DEFAUT = 9.0
INTERLIGNE = 1.2
_ARABE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")

DOSSIER_POLICES = Path(__file__).resolve().parents[2] / "assets" / "fonts"
POLICE_ARABE = "NotoNaskhArabic"
_POLICES_STANDARD = {
    "Helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "Times": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "Courier": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
}
_arabe_disponible: Optional[bool] = None


def mm(v: float) -> float:
    return v * PT_PAR_MM


def arabe_disponible() -> bool:
    """Enregistre la police arabe une fois. Fichier attendu dans app/assets/fonts :
    NotoNaskhArabic-Regular.ttf, sinon toute police « NotoNaskhArabic*.ttf ».
    Une police variable (…VariableFont_wght.ttf) peut être refusée par ReportLab :
    l'échec est journalisé et le texte arabe sort alors en Helvetica."""
    global _arabe_disponible
    if _arabe_disponible is None:
        _arabe_disponible = False
        candidats = sorted(DOSSIER_POLICES.glob("NotoNaskhArabic*.ttf"),
                           key=lambda p: ("Variable" in p.name, p.name))
        for fichier in candidats:
            try:
                pdfmetrics.registerFont(TTFont(POLICE_ARABE, str(fichier)))
                _arabe_disponible = True
                break
            except Exception as e:  # police illisible : on essaie la suivante
                log.warning("Police arabe %s refusée par ReportLab : %s", fichier.name, e)
        if not _arabe_disponible:
            log.warning("Aucune police arabe utilisable dans %s", DOSSIER_POLICES)
    return _arabe_disponible


def contient_arabe(t: str) -> bool:
    return bool(_ARABE.search(t or ""))


def preparer_arabe(t: str) -> str:
    import arabic_reshaper
    from bidi.algorithm import get_display
    return get_display(arabic_reshaper.reshape(t))


# ---------------------------------------------------------------- polices TrueType
# RG-EDT-RENDU-02 (Adil DAIA) : en plus des 3 polices PDF standard, toute police TrueType
# présente sur le serveur est utilisable : polices Windows (Arial, Calibri, Verdana…),
# polices Linux, app/assets/fonts, et le répertoire des polices de l'entreprise
# (variable EDITIONS_POLICES, défaut donnees_privees/editions_polices) où l'on dépose
# « Famille-Regular.ttf », « Famille-Bold.ttf », « Famille-Italic.ttf », « Famille-BoldItalic.ttf ».
# La police est incorporée (sous-ensemble) dans le PDF : il s'imprime pareil partout.
# Police inconnue sur ce serveur : Helvetica, sans erreur.
FAMILLES_CONNUES: dict[str, tuple[Optional[str], ...]] = {
    # nom : fichiers (sans extension, casse indifférente) normal, gras, italique, gras italique
    "Arial": ("arial", "arialbd", "ariali", "arialbi"),
    "Arial Narrow": ("arialn", "arialnb", "arialni", "arialnbi"),
    "Calibri": ("calibri", "calibrib", "calibrii", "calibriz"),
    "Candara": ("candara", "candarab", "candarai", "candaraz"),
    "Century Gothic": ("gothic", "gothicb", "gothici", "gothicbi"),
    "Consolas": ("consola", "consolab", "consolai", "consolaz"),
    "Corbel": ("corbel", "corbelb", "corbeli", "corbelz"),
    "Courier New": ("cour", "courbd", "couri", "courbi"),
    "Garamond": ("gara", "garabd", "garait", None),
    "Georgia": ("georgia", "georgiab", "georgiai", "georgiaz"),
    "Book Antiqua": ("bkant", "antquab", "antquai", "antquabi"),
    "Segoe UI": ("segoeui", "segoeuib", "segoeuii", "segoeuiz"),
    "Tahoma": ("tahoma", "tahomabd", None, None),
    "Times New Roman": ("times", "timesbd", "timesi", "timesbi"),
    "Trebuchet MS": ("trebuc", "trebucbd", "trebucit", "trebucbi"),
    "Verdana": ("verdana", "verdanab", "verdanai", "verdanaz"),
    "DejaVu Sans": ("dejavusans", "dejavusans-bold", "dejavusans-oblique", "dejavusans-boldoblique"),
    "DejaVu Serif": ("dejavuserif", "dejavuserif-bold", "dejavuserif-italic", "dejavuserif-bolditalic"),
    "Liberation Sans": ("liberationsans-regular", "liberationsans-bold", "liberationsans-italic", "liberationsans-bolditalic"),
    "Liberation Serif": ("liberationserif-regular", "liberationserif-bold", "liberationserif-italic", "liberationserif-bolditalic"),
}
_VARIANTES = ("regular", "bold", "italic", "bolditalic")


def dossier_polices_entreprise() -> Path:
    import os
    return Path(os.environ.get("EDITIONS_POLICES", "donnees_privees/editions_polices"))


def _dossiers_systeme() -> list[Path]:
    import os
    d = [DOSSIER_POLICES, dossier_polices_entreprise()]
    if os.environ.get("WINDIR"):
        d.append(Path(os.environ["WINDIR"]) / "Fonts")
    if os.environ.get("LOCALAPPDATA"):
        d.append(Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "Windows" / "Fonts")
    d += [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts"]
    return [x for x in d if x.is_dir()]


@lru_cache(maxsize=1)
def _index_polices() -> dict[str, tuple[Optional[Path], ...]]:
    """{famille: (normal, gras, italique, gras italique)} des polices TrueType trouvées."""
    fichiers: dict[str, Path] = {}
    for d in _dossiers_systeme():
        for f in d.rglob("*"):
            if f.suffix.lower() == ".ttf" and f.is_file():
                fichiers.setdefault(f.stem.lower(), f)
    familles: dict[str, tuple[Optional[Path], ...]] = {}
    for nom, noms in FAMILLES_CONNUES.items():
        v = tuple(fichiers.get(n) if n else None for n in noms)
        if v[0]:
            familles[nom] = v
    # répertoire de l'entreprise et assets : convention Famille-Regular / -Bold / -Italic / -BoldItalic
    for d in (DOSSIER_POLICES, dossier_polices_entreprise()):
        if not d.is_dir():
            continue
        for f in d.glob("*-Regular.ttf"):
            famille = f.stem[: -len("-Regular")]
            if famille.startswith("NotoNaskhArabic"):
                continue
            nom = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", famille)          # OpenSans → Open Sans
            v = [f] + [d / f"{famille}-{s}.ttf" for s in ("Bold", "Italic", "BoldItalic")]
            familles[nom] = tuple(x if x.is_file() else None for x in v)
    return familles


def rafraichir_polices() -> None:
    _index_polices.cache_clear()


def polices_disponibles() -> list[dict]:
    std = [{"nom": n, "origine": "PDF", "gras": True, "italique": True} for n in _POLICES_STANDARD]
    ttf = [{"nom": n, "origine": "TrueType", "gras": bool(v[1]), "italique": bool(v[2])}
           for n, v in sorted(_index_polices().items())]
    return std + ttf


def _enregistrer_ttf(famille: str, i: int) -> Optional[str]:
    v = _index_polices().get(famille)
    if not v:
        return None
    fichier = v[i] or (v[1] if i == 3 and v[1] else None) or v[0]   # gras italique absent : gras, sinon normal
    nom = f"{famille}-{_VARIANTES[v.index(fichier)]}"
    if nom not in pdfmetrics.getRegisteredFontNames():
        try:
            pdfmetrics.registerFont(TTFont(nom, str(fichier)))
        except Exception as e:                       # police refusée (ex. contours CFF) : on se replie
            log.warning("Police %s refusée par ReportLab : %s", fichier, e)
            return None
    return nom


def nom_police(police: Optional[str], gras: bool, italique: bool, arabe: bool = False) -> str:
    if arabe and arabe_disponible():
        return POLICE_ARABE
    i = (1 if gras else 0) + (2 if italique else 0)
    if police and police not in _POLICES_STANDARD:
        nom = _enregistrer_ttf(police, i)
        if nom:
            return nom
    famille = _POLICES_STANDARD.get(police or "Helvetica", _POLICES_STANDARD["Helvetica"])
    return famille[i]


def largeur_pt(texte: str, police: str, taille: float) -> float:
    return pdfmetrics.stringWidth(texte, police, taille)


@lru_cache(maxsize=20000)
def _decouper_paragraphe(paragraphe: str, police: str, taille: float, largeur: float) -> tuple[str, ...]:
    if paragraphe == "":
        return ("",)
    mots = paragraphe.split(" ")
    lignes, courante = [], ""
    for mot in mots:
        essai = mot if not courante else f"{courante} {mot}"
        if largeur_pt(essai, police, taille) <= largeur or not courante:
            courante = essai
            # mot plus large que la colonne : coupé au caractère
            while largeur_pt(courante, police, taille) > largeur and len(courante) > 1:
                n = len(courante)
                while n > 1 and largeur_pt(courante[:n], police, taille) > largeur:
                    n -= 1
                lignes.append(courante[:n])
                courante = courante[n:]
        else:
            lignes.append(courante)
            courante = mot
    lignes.append(courante)
    return tuple(lignes)


def decouper(texte: str, police: str, taille: float, largeur_mm: float, multiligne: bool = True) -> list[str]:
    """Texte → lignes tenant dans largeur_mm. Sans `multiligne`, une seule ligne,
    tronquée avec « … » si elle déborde."""
    largeur = mm(largeur_mm)
    arabe = contient_arabe(texte)
    if not multiligne:
        ligne = texte.replace("\n", " ")
        if largeur_pt(ligne, police, taille) > largeur:
            while ligne and largeur_pt(ligne + "…", police, taille) > largeur:
                ligne = ligne[:-1]
            ligne += "…"
        return [preparer_arabe(ligne) if arabe else ligne]
    lignes: list[str] = []
    for paragraphe in str(texte).split("\n"):
        lignes += list(_decouper_paragraphe(paragraphe, police, taille, largeur))
    return [preparer_arabe(l) if arabe else l for l in lignes]


def hauteur_lignes_mm(nb: int, taille: float) -> float:
    return nb * taille * INTERLIGNE / PT_PAR_MM
