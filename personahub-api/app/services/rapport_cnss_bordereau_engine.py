"""
Moteur du Bordereau de paiement CNSS (Régime Général + AMO) — bilingue FR/AR,
même pattern que rapport_bulletin_engine.py (xhtml2pdf).

Le texte arabe doit être pré-façonné (arabic_reshaper) puis réordonné en
lecture visuelle (python-bidi) AVANT d'être injecté dans le HTML : xhtml2pdf
(reportlab) ne fait aucune mise en forme contextuelle de l'arabe tout seul.

Dépendances à installer (en plus de xhtml2pdf déjà présent) :
    pip install arabic-reshaper python-bidi --break-system-packages

Police à déposer (SIL OFL, gratuite) :
    app/assets/fonts/NotoNaskhArabic-Regular.ttf
"""
from __future__ import annotations

import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

MOIS_NOMS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
             "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]

# Chemin de la police arabe — ajuster si l'arborescence de assets diffère
_FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "fonts")
_FONT_ARABE = os.path.join(_FONT_DIR, "NotoNaskhArabic-Regular.ttf")

_BANQUES = [
    ("BMCE BANK", "البنك المغربي للتجارة الخارجية", "011 780 0000 63210 00601 36 57"),
    ("BCP", "البنك الشعبي", "190 780 2121 21995 00200 04 26"),
    ("AWB", "التجاري وفا بنك", "007 780 0002 00800 00004 00 75"),
    ("SGMB", "الشركة العامة المغربية للأبناك", "022 780 0001 60000 79420 86 74"),
    ("BMCI", "البنك المغربي للتجارة و الصناعة", "013 780 0100 11971 09001 71 48"),
    ("CITI BANK", "سيتي بنك", "028 780 0000 00040 06300 03 93"),
    ("CDM", "بنك مصرف المغرب", "021 780 0000 02704 49412 82 33"),
    ("CAM", "بنك القرض الفلاحي", "225 780 0108 13107 65101 24 75"),
    ("ABB", "البريد بنك", "350 810 0000 00000 00404 31 33"),
    ("CIH", "القرض العقاري و السياحي", "230 780 5072 69922 10095 00 69"),
]


def _shape_ar(txt: str) -> str:
    """Pré-façonne + réordonne un texte arabe pour un rendu correct en PDF."""
    import arabic_reshaper
    from bidi.algorithm import get_display

    return get_display(arabic_reshaper.reshape(txt))


def _charger_societe_cnss(session: Session, societe_id: str) -> dict:
    # RG-MULTISOCIETE-07 (migration 057) : bug corrigé -- l'ancienne version
    # faisait `SELECT ... FROM societes LIMIT 1` (TOUJOURS la première
    # société de la table, indépendamment de la société active de la
    # session). Avec plusieurs sociétés en base (SOLGES CONSULTING, AD2S...),
    # ça générait potentiellement le bordereau CNSS d'une société pour une
    # autre. societe_id désormais obligatoire, fourni par l'appelant.
    societe = session.execute(
        text("SELECT id, raison_sociale FROM societes WHERE id = :sid"),
        {"sid": societe_id},
    ).mappings().first()
    if not societe:
        raise ValueError("Société active introuvable (table societes)")

    type_cnss = session.execute(
        text("SELECT code FROM ref_type_affiliation WHERE libelle ILIKE '%CNSS%' LIMIT 1")
    ).mappings().first()

    affiliation = None
    if type_cnss:
        affiliation = session.execute(
            text(
                "SELECT numero_affiliation FROM societe_affiliations "
                "WHERE societe_id = :sid AND code_type_affiliation = :code LIMIT 1"
            ),
            {"sid": societe["id"], "code": type_cnss["code"]},
        ).mappings().first()

    if not affiliation or not affiliation.get("numero_affiliation"):
        raise ValueError("N° d'affilié CNSS introuvable — configure-le dans Organisations")

    return {
        "raison_sociale": societe["raison_sociale"] or "",
        "numero_affilie": affiliation["numero_affiliation"],
    }


def _charger_taux_cnss(session: Session, societe_id: str | None = None) -> dict[str, float]:
    # RG-MULTISOCIETE-03/07 : ref_constante_paie.societe_id (migration 057,
    # nullable) -- même logique générique/surcharge que ContexteCalcul :
    # valeur spécifique à la société active prévaut sur la générique.
    codes = [
        "CNSS_TAUX_SALARIAL", "CNSS_TAUX_PATRONAL", "CNSS_TAUX_AF", "CNSS_TAUX_TFP",
        "CNSS_TAUX_AMO_SALARIAL", "CNSS_TAUX_AMO_PATRONAL", "CNSS_DEADLINE_JOUR",
    ]
    rows = session.execute(
        text("""
            SELECT code, valeur FROM ref_constante_paie
             WHERE code = ANY(:codes)
               AND (societe_id IS NULL OR societe_id = :societe_id)
             ORDER BY (societe_id IS NULL) DESC
        """),
        {"codes": codes, "societe_id": societe_id},
    ).mappings().all()
    valeurs = {r["code"]: float(r["valeur"]) for r in rows}
    return {
        "taux_salarial": valeurs.get("CNSS_TAUX_SALARIAL", 4.48),
        "taux_patronal": valeurs.get("CNSS_TAUX_PATRONAL", 8.98),
        "taux_af": valeurs.get("CNSS_TAUX_AF", 6.40),
        "taux_tfp": valeurs.get("CNSS_TAUX_TFP", 1.60),
        "taux_amo_sal": valeurs.get("CNSS_TAUX_AMO_SALARIAL", 1.85),
        "taux_amo_pat": valeurs.get("CNSS_TAUX_AMO_PATRONAL", 4.52),
        "deadline_jour": int(valeurs.get("CNSS_DEADLINE_JOUR", 10)),
    }


def _fmt(v: float) -> str:
    return f"{v:,.2f}".replace(",", " ").replace(".", ",")


def _entete_html(titre_fr: str, titre_ar: str, societe: dict, mois: int, annee: int, deadline_jour: int) -> str:
    from datetime import date

    date_emission = date.today()
    mois_limite = 1 if mois == 12 else mois + 1
    annee_limite = annee + 1 if mois == 12 else annee
    date_limite = date(annee_limite, mois_limite, deadline_jour)

    return f"""
    <table style="width:100%;border:none;margin-bottom:10px;">
      <tr>
        <td style="border:none;width:60%;">
          <div style="font-size:15px;font-weight:bold;">Bordereau de paiement</div>
          <div style="font-size:11px;color:#444;">{titre_fr}</div>
        </td>
        <td style="border:none;width:40%;text-align:right;direction:rtl;font-family:'NotoNaskhArabic';font-size:13px;">
          {_shape_ar('ورقة الأداء')}<br/>
          <span style="font-size:11px;color:#444;">{_shape_ar(titre_ar)}</span>
        </td>
      </tr>
    </table>
    <table style="width:100%;border:1px solid #999;margin-bottom:10px;">
      <tr>
        <td style="border:none;padding:6px 10px;width:50%;">
          <b>Raison sociale :</b> {societe['raison_sociale']}<br/>
          <b>N° d'affilié :</b> {societe['numero_affilie']}<br/>
          <b>Référence structurée :</b> ______________________
        </td>
        <td style="border:none;padding:6px 10px;width:50%;">
          <b>Date d'émission :</b> {date_emission.strftime('%d/%m/%Y')}<br/>
          <b>Versement du mois de :</b> {mois:02d}/{annee}<br/>
          <b>À régulariser avant le :</b> {date_limite.strftime('%d/%m/%Y')}
        </td>
      </tr>
    </table>
    """


def _tableau_html(lignes: list[tuple[str, str, str, float, float, float]]) -> str:
    """lignes: (code, libelle_fr, libelle_ar, masse, taux, montant)"""
    rows = ""
    for code, fr, ar, masse, taux, montant in lignes:
        masse_s = _fmt(masse) if masse else ""
        taux_s = f"{taux:.2f}" if taux else ""
        rows += f"""
        <tr>
          <td style="text-align:center;width:6%;">{code}</td>
          <td style="width:38%;">{fr}<br/>
            <span style="direction:rtl;font-family:'NotoNaskhArabic';font-size:9px;color:#666;">{_shape_ar(ar)}</span>
          </td>
          <td style="text-align:right;width:20%;">{masse_s}</td>
          <td style="text-align:center;width:12%;">{taux_s}</td>
          <td style="text-align:right;width:24%;font-weight:bold;">{_fmt(montant)}</td>
        </tr>
        """
    return f"""
    <table style="width:100%;border-collapse:collapse;border:1px solid #333;margin-bottom:12px;">
      <thead>
        <tr style="background:#1f4e79;color:#fff;">
          <th style="width:6%;">C</th>
          <th style="width:38%;text-align:left;">Nature des prestations</th>
          <th style="width:20%;">Masse des salaires (MAD)</th>
          <th style="width:12%;">Taux (%)</th>
          <th style="width:24%;">Montant (MAD)</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
    """


def _banques_html() -> str:
    rows = "".join(
        f"<tr><td style='width:15%;font-weight:bold;'>{code}</td>"
        f"<td style='width:35%;direction:rtl;font-family:\"NotoNaskhArabic\";font-size:9px;'>{_shape_ar(nom_ar)}</td>"
        f"<td style='width:50%;font-family:monospace;'>{rib}</td></tr>"
        for code, nom_ar, rib in _BANQUES
    )
    return f"""
    <div style="font-size:10px;font-weight:bold;margin-bottom:4px;">
      Veuillez créditer le compte de la Caisse Nationale de Sécurité Sociale chez :
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #999;font-size:8.5px;">
      <thead><tr style="background:#666;color:#fff;">
        <th>Banque</th><th>البنك</th><th>RIB</th>
      </tr></thead>
      <tbody>{rows}</tbody>
    </table>
    """


def rendre_bordereau_html(
    societe: dict, taux: dict, mois: int, annee: int,
    assiette_plafonnee: float, assiette_non_plafonnee: float,
) -> str:
    total_af = taux["taux_af"] * assiette_non_plafonnee / 100
    total_prestations = (taux["taux_salarial"] + taux["taux_patronal"]) * assiette_plafonnee / 100
    total_tfp = taux["taux_tfp"] * assiette_non_plafonnee / 100
    total_rg = total_af + total_prestations
    total_amo_part = taux["taux_amo_sal"] * assiette_non_plafonnee / 100
    total_amo_cot = taux["taux_amo_pat"] * assiette_non_plafonnee / 100
    total_amo = total_amo_part + total_amo_cot

    page_rg = _entete_html(
        "Assurances Sociales — Régime Général", "الاشتراكات - النظام العام",
        societe, mois, annee, taux["deadline_jour"],
    ) + _tableau_html([
        ("1", "Allocations Familiales", "المنح العائلية", assiette_non_plafonnee, taux["taux_af"], total_af),
        ("2", "Prestations sociales", "الاعانات الاجتماعية", assiette_plafonnee, taux["taux_salarial"] + taux["taux_patronal"], total_prestations),
        ("3", "Total des cotisations versées", "مجموع واجبات الاشتراك المؤداة", 0, 0, total_rg),
        ("4", "Pénalités sur cotisations", "ذعائر الاشتراك", 0, 0, 0),
        ("8", "Taxe de Formation Professionnelle", "ضريبة التكوين المهني", assiette_non_plafonnee, taux["taux_tfp"], total_tfp),
        ("9", "Pénalités TFP", "ذعائر التكوين المهني", 0, 0, 0),
        ("10", "Montant global du versement", "المبلغ الاجمالي للأداء", 0, 0, total_rg + total_tfp),
    ]) + _banques_html()

    page_amo = _entete_html(
        "Assurance Maladie Obligatoire (AMO)", "التأمين الصحي الاجباري",
        societe, mois, annee, taux["deadline_jour"],
    ) + _tableau_html([
        ("1", "Participation AMO (salariale)", "مساهمة ت.ص.إ", assiette_non_plafonnee, taux["taux_amo_sal"], total_amo_part),
        ("2", "Cotisation AMO (patronale)", "واجبات الاشتراك ت.ص.إ", assiette_non_plafonnee, taux["taux_amo_pat"], total_amo_cot),
        ("3", "Total des cotisations versées AMO", "مجموع واجبات الاشتراكات ت.ص.إ", 0, 0, total_amo),
        ("4", "Pénalités sur cotisations AMO", "ذعائر الاشتراكات ت.ص.إ", 0, 0, 0),
        ("10", "Montant global du versement", "المبلغ الاجمالي للأداء", 0, 0, total_amo),
    ]) + _banques_html()

    return f"""
    <html><head><meta charset="utf-8">
    <style>
      @font-face {{ font-family: 'NotoNaskhArabic'; src: url('{_FONT_ARABE}'); }}
      body {{ font-family: Arial, sans-serif; font-size: 9.5px; color: #1a1a1a; }}
      table {{ border-collapse: collapse; }}
      th, td {{ border: 1px solid #999; padding: 4px 6px; }}
    </style></head><body>
      {page_rg}
      <pdf:nextpage />
      {page_amo}
    </body></html>
    """


def exporter_bordereau_cnss_pdf(
    session: Session, societe_id: str, mois: int, annee: int,
    assiette_plafonnee: float, assiette_non_plafonnee: float,
) -> bytes:
    from io import BytesIO

    from xhtml2pdf import pisa

    societe = _charger_societe_cnss(session, societe_id)
    taux = _charger_taux_cnss(session, societe_id)
    html = rendre_bordereau_html(societe, taux, mois, annee, assiette_plafonnee, assiette_non_plafonnee)

    buffer = BytesIO()
    resultat = pisa.CreatePDF(html, dest=buffer)
    if resultat.err:
        raise RuntimeError("Échec de la génération du bordereau CNSS (xhtml2pdf)")
    return buffer.getvalue()
