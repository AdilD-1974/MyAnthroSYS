"""
app/editions/moteur/rendu_pdf.py — Dessin des pages abstraites en PDF (ReportLab).
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Ne fait AUCUN calcul de mise en page : toutes les positions, tailles et lignes
de texte viennent de mise_en_page.py. Seule conversion : millimètres depuis le
haut de la page → points depuis le bas (repère ReportLab), dans _y().

Décision du 16/10/2026 : ReportLab est le moteur de rendu de référence (pas de
dépendance système, mesure exacte, rapide en lot). Pas de HTML intermédiaire :
les défauts connus de xhtml2pdf (cellule vide qui écrase une colonne,
colgroup ignoré) n'existent plus.
"""
from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Optional

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import code128
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, black
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.editions.definition import FORMATS_PAGE_MM, Page as PageDef
from app.editions.images import autorise
from app.editions.moteur import texte as tx
from app.editions.moteur.mise_en_page import Boite, Page

log = logging.getLogger(__name__)

COULEURS_NOMMEES = {"noir": "#000000", "blanc": "#FFFFFF", "gris": "#808080", "gris_clair": "#E8E8E8",
                    "rouge": "#C00000", "bleu": "#1F4E79", "vert": "#2E7D32", "orange": "#E07000"}


def _couleur(c: Optional[str], charte: dict):
    if not c:
        return None
    c = charte.get(c, c)
    c = COULEURS_NOMMEES.get(c, c)
    try:
        return HexColor(c)
    except Exception:
        return None


class RenduPDF:
    def __init__(self, page_def: PageDef, metadonnees: Optional[dict] = None,
                 racine_fichiers: str = "storage", charte_couleurs: Optional[dict] = None,
                 filigrane: Optional[str] = None):
        l, h = FORMATS_PAGE_MM[page_def.format]
        if page_def.orientation == "PAYSAGE":
            l, h = h, l
        self.l_pt, self.h_pt = tx.mm(l), tx.mm(h)
        self.meta = metadonnees or {}
        self.racine = Path(racine_fichiers)
        self.charte = charte_couleurs or {}
        self.filigrane = filigrane

    def _y(self, y_mm: float, h_mm: float = 0) -> float:
        return self.h_pt - tx.mm(y_mm + h_mm)

    def rendre(self, pages: list[Page]) -> bytes:
        tampon = io.BytesIO()
        c = canvas.Canvas(tampon, pagesize=(self.l_pt, self.h_pt), pageCompression=1)
        c.setTitle(self.meta.get("titre", "Édition"))
        c.setAuthor(self.meta.get("auteur", "PersonaHub HR"))
        c.setSubject(self.meta.get("sujet", ""))
        c.setCreator("PersonaHub HR — plateforme d'éditions")
        c.setKeywords(" ".join(f"{k}={v}" for k, v in self.meta.items() if k not in ("titre", "auteur", "sujet")))
        for page in pages:
            if self.filigrane:
                self._filigrane(c)
            for b in page.boites:
                try:
                    getattr(self, f"_{b.genre.lower()}")(c, b)
                except Exception as e:      # une boîte fautive n'empêche pas le document
                    log.warning("Boîte %s non dessinée : %s", b.source_id, e)
            c.showPage()
        c.save()
        return tampon.getvalue()

    # ---- fond et bordures communs
    def _cadre_style(self, c, b: Boite, force_bordure: bool = False):
        s = b.style
        x, y, l, h = tx.mm(b.x), self._y(b.y, b.h), tx.mm(b.l), tx.mm(b.h)
        fond = _couleur(getattr(s, "fond", None), self.charte) if s else None
        if fond is not None:
            c.setFillColor(fond)
            c.rect(x, y, l, h, stroke=0, fill=1)
        bordures = (getattr(s, "bordures", None) or "") if s else ""
        epaisseur = (getattr(s, "epaisseur_bordure", None) or 0.5) if s else 0.5
        couleur = _couleur(getattr(s, "couleur_bordure", None) or getattr(s, "couleur", None), self.charte) if s else None
        c.setStrokeColor(couleur or black)
        c.setLineWidth(epaisseur)
        if force_bordure or bordures.upper() in ("TOUT", "H,B,G,D"):
            c.rect(x, y, l, h, stroke=1, fill=0)
            return
        cotes = {p.strip().upper() for p in bordures.split(",") if p.strip()}
        if "H" in cotes: c.line(x, y + h, x + l, y + h)
        if "B" in cotes: c.line(x, y, x + l, y)
        if "G" in cotes: c.line(x, y, x, y + h)
        if "D" in cotes: c.line(x + l, y, x + l, y + h)

    def _texte(self, c, b: Boite):
        s = b.style
        self._cadre_style(c, b)
        if not b.lignes or b.lignes == [""]:
            return
        couleur = _couleur(getattr(s, "couleur", None), self.charte) if s else None
        c.setFillColor(couleur or black)
        c.setFont(b.police, b.taille)
        pas = b.taille * tx.INTERLIGNE
        bloc = pas * len(b.lignes)
        x, l = tx.mm(b.x), tx.mm(b.l)
        haut, h = self._y(b.y), tx.mm(b.h)
        vertical = getattr(s, "alignement_vertical", None) or "MILIEU"
        if vertical == "HAUT":
            y0 = haut - b.taille
        elif vertical == "BAS":
            y0 = haut - h + bloc - b.taille + 0.2 * b.taille
        else:
            y0 = haut - (h - bloc) / 2 - b.taille
        alignement = getattr(s, "alignement", None) or ("DROITE" if b.police == tx.POLICE_ARABE else "GAUCHE")
        marge = tx.mm(0.8)
        for i, ligne in enumerate(b.lignes):
            y = y0 - i * pas
            if alignement == "DROITE":
                c.drawRightString(x + l - marge, y, ligne)
            elif alignement == "CENTRE":
                c.drawCentredString(x + l / 2, y, ligne)
            else:
                c.drawString(x + marge, y, ligne)
        if getattr(s, "souligne", False):
            pass  # lot 2

    def _ligne(self, c, b: Boite):
        s = b.style
        couleur = _couleur(getattr(s, "couleur", None), self.charte) if s else None
        c.setStrokeColor(couleur or black)
        c.setLineWidth((getattr(s, "epaisseur_bordure", None) or 0.5) if s else 0.5)
        if b.l >= b.h:
            y = self._y(b.y + b.h / 2)
            c.line(tx.mm(b.x), y, tx.mm(b.x + b.l), y)
        else:
            x = tx.mm(b.x + b.l / 2)
            c.line(x, self._y(b.y), x, self._y(b.y + b.h))

    def _cadre(self, c, b: Boite):
        self._cadre_style(c, b, force_bordure=True)

    def _image(self, c, b: Boite):
        chemin = Path(b.valeur)
        if not chemin.is_absolute():
            chemin = self.racine / b.valeur
        if not chemin.exists():
            log.info("Image introuvable : %s", chemin)
            return
        if not autorise(chemin, self.racine):               # RG-EDT-SECU-06
            log.warning("Image hors des dossiers autorisés, ignorée : %s", chemin)
            return
        img = ImageReader(str(chemin))
        iw, ih = img.getSize()
        l, h = tx.mm(b.l), tx.mm(b.h)
        echelle = min(l / iw, h / ih)
        w, hh = iw * echelle, ih * echelle
        c.drawImage(img, tx.mm(b.x), self._y(b.y) - hh, w, hh, mask="auto")

    def _code_barre(self, c, b: Boite):
        l, h = tx.mm(b.l), tx.mm(b.h)
        if b.style is not None and getattr(b, "symbologie", "QR") == "CODE128":
            bc = code128.Code128(b.valeur, barHeight=h * 0.8)
            bc.drawOn(c, tx.mm(b.x), self._y(b.y, b.h))
            return
        w = QrCodeWidget(b.valeur)
        x1, y1, x2, y2 = w.getBounds()
        cote = min(l, h)
        d = Drawing(cote, cote, transform=[cote / (x2 - x1), 0, 0, cote / (y2 - y1), 0, 0])
        d.add(w)
        renderPDF.draw(d, c, tx.mm(b.x), self._y(b.y) - cote)

    def _filigrane(self, c):
        c.saveState()
        c.setFont("Helvetica-Bold", 60)
        c.setFillColor(HexColor("#DDDDDD"))
        c.translate(self.l_pt / 2, self.h_pt / 2)
        c.rotate(45)
        c.drawCentredString(0, 0, self.filigrane)
        c.restoreState()
