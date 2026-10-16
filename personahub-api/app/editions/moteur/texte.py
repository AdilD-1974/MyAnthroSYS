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


def nom_police(police: Optional[str], gras: bool, italique: bool, arabe: bool = False) -> str:
    if arabe and arabe_disponible():
        return POLICE_ARABE
    famille = _POLICES_STANDARD.get(police or "Helvetica", _POLICES_STANDARD["Helvetica"])
    return famille[(1 if gras else 0) + (2 if italique else 0)]


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
