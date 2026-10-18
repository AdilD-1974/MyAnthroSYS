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

from app.editions.definition import Page as PageDef
from app.editions.images import autorise
from app.editions.moteur import texte as tx
from app.editions.moteur.mise_en_page import Boite, Page

log = logging.getLogger(__name__)

COULEURS_NOMMEES = {"noir": "#000000", "blanc": "#FFFFFF", "gris": "#808080", "gris_clair": "#E8E8E8",
                    "rouge": "#C00000", "bleu": "#1F4E79", "vert": "#2E7D32", "orange": "#E07000"}


# RG-EDT-RENDU-03 (Adil DAIA) : style de trait des bordures, cadres et lignes (motif en points)
_MOTIFS = {"TIRETS": [4, 2], "POINTILLES": [1, 1.6], "TIRET_POINT": [4, 1.6, 1, 1.6]}


def _trait(c, s, epaisseur: float):
    motif = _MOTIFS.get(getattr(s, "style_trait", None) or "") if s else None
    if motif:
        c.setDash([m * max(epaisseur, 0.5) for m in motif], 0)
        c.setLineCap(1 if getattr(s, "style_trait", "") == "POINTILLES" else 0)
    else:
        c.setDash([], 0)
        c.setLineCap(0)


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
        l, h = page_def.dimensions()                     # orientation et format personnalisé compris
        self.l_pt, self.h_pt = tx.mm(l), tx.mm(h)
        self.fond_page = page_def.couleur_fond
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
        fond = _couleur(self.fond_page, self.charte) if self.fond_page else None
        for page in pages:
            if fond is not None:                              # RG-EDT-PAGE-01 : couleur de fond de page
                c.setFillColor(fond)
                c.rect(0, 0, self.l_pt, self.h_pt, stroke=0, fill=1)
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
            if b.arrondi:
                c.roundRect(x, y, l, h, tx.mm(b.arrondi), stroke=0, fill=1)
            else:
                c.rect(x, y, l, h, stroke=0, fill=1)
        bordures = (getattr(s, "bordures", None) or "") if s else ""
        epaisseur = (getattr(s, "epaisseur_bordure", None) or 0.5) if s else 0.5
        couleur = _couleur(getattr(s, "couleur_bordure", None) or getattr(s, "couleur", None), self.charte) if s else None
        c.setStrokeColor(couleur or black)
        c.setLineWidth(epaisseur)
        _trait(c, s, epaisseur)
        if force_bordure or bordures.upper() in ("TOUT", "H,B,G,D"):
            if b.arrondi:
                c.roundRect(x, y, l, h, tx.mm(b.arrondi), stroke=1, fill=0)
            else:
                c.rect(x, y, l, h, stroke=1, fill=0)
            c.setDash([], 0)
            return
        cotes = {p.strip().upper() for p in bordures.split(",") if p.strip()}
        if "H" in cotes: c.line(x, y + h, x + l, y + h)
        if "B" in cotes: c.line(x, y, x + l, y)
        if "G" in cotes: c.line(x, y, x, y + h)
        if "D" in cotes: c.line(x + l, y, x + l, y + h)
        c.setDash([], 0)

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
        souligne = bool(getattr(s, "souligne", False))
        if souligne:
            c.setStrokeColor(couleur or black)
            c.setLineWidth(max(0.4, b.taille / 16))
            c.setDash([], 0)
        petites = getattr(s, "casse", None) == "PETITES_MAJUSCULES" and b.police != tx.POLICE_ARABE
        for i, ligne in enumerate(b.lignes):
            y = y0 - i * pas
            w = tx.largeur_petites_capitales(ligne, b.police, b.taille) if petites else tx.largeur_pt(ligne, b.police, b.taille)
            if alignement == "DROITE":
                x1 = x + l - marge - w
            elif alignement == "CENTRE":
                x1 = x + l / 2 - w / 2
            else:
                x1 = x + marge
            if petites:                                       # RG-EDT-RENDU-05 : petites capitales
                xc = x1
                for ch in ligne:
                    t = b.taille * (tx.PETITES_CAPITALES if ch.islower() else 1)
                    c.setFont(b.police, t)
                    c.drawString(xc, y, ch.upper())
                    xc += tx.largeur_pt(ch.upper(), b.police, t)
                c.setFont(b.police, b.taille)
            else:
                c.drawString(x1, y, ligne)
            if souligne and ligne.strip():                   # RG-EDT-RENDU-04 : souligné imprimé
                c.line(x1, y - b.taille * 0.12, x1 + w, y - b.taille * 0.12)

    def _ligne(self, c, b: Boite):
        s = b.style
        couleur = _couleur(getattr(s, "couleur", None), self.charte) if s else None
        c.setStrokeColor(couleur or black)
        epaisseur = (getattr(s, "epaisseur_bordure", None) or 0.5) if s else 0.5
        c.setLineWidth(epaisseur)
        _trait(c, s, epaisseur)
        if b.l >= b.h:
            y = self._y(b.y + b.h / 2)
            c.line(tx.mm(b.x), y, tx.mm(b.x + b.l), y)
        else:
            x = tx.mm(b.x + b.l / 2)
            c.line(x, self._y(b.y), x, self._y(b.y + b.h))
        c.setDash([], 0)

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
        # RG-EDT-IMAGE-04/05 (Adil DAIA) : rognage, puis ajustement dans le cadre
        from PIL import Image as ImagePIL
        try:
            img = ImagePIL.open(chemin)
            img.load()
        except Exception as e:
            log.info("Image illisible %s : %s", chemin, e)
            return
        iw, ih = img.size
        r = b.rognage
        if r is not None and (r.haut or r.droite or r.bas or r.gauche):
            img = img.crop((round(iw * r.gauche / 100), round(ih * r.haut / 100),
                            round(iw * (1 - r.droite / 100)), round(ih * (1 - r.bas / 100))))
            iw, ih = img.size
        l, h = tx.mm(b.l), tx.mm(b.h)
        x, haut = tx.mm(b.x), self._y(b.y)                    # haut du cadre, en points depuis le bas
        if b.ajustement == "ETIRER":
            w, hh, x0, y0 = l, h, x, haut - h
        elif b.ajustement == "REMPLIR":
            # on coupe l'excédent, centré, pour que l'image remplisse exactement le cadre
            rapport = l / h
            if iw / ih > rapport:
                nw = round(ih * rapport)
                img = img.crop(((iw - nw) // 2, 0, (iw - nw) // 2 + nw, ih))
            else:
                nh = round(iw / rapport)
                img = img.crop((0, (ih - nh) // 2, iw, (ih - nh) // 2 + nh))
            w, hh, x0, y0 = l, h, x, haut - h
        else:
            echelle = min(l / iw, h / ih)
            w, hh = iw * echelle, ih * echelle
            x0, y0 = x + (l - w) / 2, haut - h + (h - hh) / 2      # centrée dans le cadre
        c.drawImage(ImageReader(img), x0, y0, w, hh, mask="auto")

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
