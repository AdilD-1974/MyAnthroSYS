"""
Génération du PDF d'un bulletin de paie.

Contrairement à la 1ère version, ce service NE RE-QUERY PAS la base : il
reçoit en entrée le même objet que celui renvoyé par GET /paie/bulletins/{id}
(le schéma Pydantic qui correspond à `BulletinRead` côté frontend, cf.
paieApi.ts). Deux avantages :
  - zéro divergence possible avec ce que l'écran affiche (mêmes totaux,
    mêmes lignes, calculés une seule fois par le moteur) ;
  - pas besoin de connaître les noms de tables/colonnes réels : on retape
    juste la lecture depuis le schéma déjà stabilisé et typé.

Dépendances : pip install weasyprint jinja2 num2words
"""

from __future__ import annotations

import io
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
)

# RG-MULTISOCIETE-07 (correctif 24/08) : ce dictionnaire ne sert plus que de
# REPLI si l'appelant ne fournit pas `bulletin["_societe_detail"]` -- il ne
# doit plus jamais être la source réelle une fois paie_edition.py mis à jour
# pour peupler `_societe_detail` depuis la vraie société du bulletin (table
# `societes` + `societe_affiliations` pour le n° CNSS employeur). Gardé tel
# quel comme filet de sécurité minimal (mieux vaut un PDF avec un placeholder
# visible qu'un PDF qui plante), pas comme donnée à corriger ici.
SOCIETE_REPLI = {
    "raison_sociale": "SOLGEIS",
    "activite": "PersonaHub HR — Solutions RH & Paie",
    "adresse": "Casablanca, Maroc",
    "rc": "xxxxx",
    "if_fiscal": "xxxxxxx",
    "patente": "xxxxxxx",
    "cnss": "xxxxxxx",
}

SECTIONS = [
    {"key": "gains", "titre": "GAINS"},
    {"key": "cotisations", "titre": "COTISATIONS"},
    {"key": "retenues", "titre": "RETENUES ET IMPÔTS"},
]


def _fmt(montant: Any) -> str:
    """'x xxx,xx' — séparateur espace, virgule décimale. '—' si None/0 pertinent."""
    if montant is None:
        return "—"
    q = Decimal(str(montant)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    s = f"{q:,.2f}".replace(",", " ").replace(".", ",")
    return s


def _fmt_ou_tiret(montant: Any) -> str:
    if montant in (None, 0):
        return "—"
    return _fmt(montant)


def _fmt_taux(taux: Any) -> str:
    if taux in (None, 0):
        return "—"
    q = Decimal(str(taux)).quantize(Decimal("0.01"))
    return f"{q} %"


def _fmt_nb(nb: Any) -> str:
    if nb in (None, 0):
        return "—"
    return _fmt(nb)


def _montant_en_lettres(montant: float) -> str:
    try:
        from num2words import num2words
    except ImportError:
        return f"{_fmt(montant)} dirhams"
    montant = Decimal(str(montant)).quantize(Decimal("0.01"))
    entier = int(montant)
    centimes = int((montant - entier) * 100)
    texte = f"{num2words(entier, lang='fr').capitalize()} dirhams"
    if centimes:
        texte += f" et {num2words(centimes, lang='fr')} centimes"
    return texte


def _categoriser(ligne: dict) -> Optional[str]:
    """
    Même règle que `categoriser()` dans TraitementPaiePage.tsx, pour que le
    PDF montre EXACTEMENT les mêmes lignes que l'écran (pas de divergence
    de classement) :
        code_type === 'ASS'  -> masqué sur le bulletin imprimé (assiette interne)
        est_cotisation        -> COTISATIONS
        sens === 'GAIN'       -> GAINS
        sens === 'RETENUE'    -> RETENUES
        sinon ('elements')    -> masqué sur le bulletin imprimé (base/EV interne)
    """
    if ligne.get("code_type") == "ASS":
        return None
    if ligne.get("est_cotisation"):
        return "cotisations"
    if ligne.get("sens") == "GAIN":
        return "gains"
    if ligne.get("sens") == "RETENUE":
        return "retenues"
    return None


def construire_contexte(bulletin: dict) -> dict:
    """
    `bulletin` = exactement la forme de BulletinRead (voir paieApi.ts) :
    id, origine, periode_id, plan_paie_id, code_plan, collaborateur_id,
    matricule, total_brut, total_gains, total_retenues, total_cot_salariale,
    total_cot_patronale, net_imposable, net_a_payer, cout_employeur, statut,
    a_erreur, messages, calcule_le, lignes[].

    S'il vous manque des champs collaborateur (nom, CIN, poste...), passez-les
    en plus dans `bulletin["_collaborateur_detail"]` (dict) avant l'appel, ou
    adaptez `identite_rows` ci-dessous à ce que vous avez réellement sous la main.
    """
    sections_data = {s["key"]: {"titre": s["titre"], "lignes": [], "sous_total": Decimal("0"), "sous_total_patronal": Decimal("0")} for s in SECTIONS}

    for l in bulletin.get("lignes", []):
        cat = _categoriser(l)
        if cat is None:
            continue
        montant = Decimal(str(l.get("montant") or 0))
        montant_pat = Decimal(str(l.get("montant_patronal") or 0))
        sections_data[cat]["sous_total"] += montant
        sections_data[cat]["sous_total_patronal"] += montant_pat
        sections_data[cat]["lignes"].append({
            "code": l.get("code_rubrique"),
            "libelle": l.get("libelle"),
            "base": _fmt_ou_tiret(l.get("base")),
            "nombre": _fmt_nb(l.get("nombre")),
            "taux": _fmt_taux(l.get("taux")),
            "montant": _fmt_ou_tiret(l.get("montant")),
            "montant_patronal": _fmt_ou_tiret(l.get("montant_patronal")),
            "montant_cumul": _fmt_ou_tiret(l.get("montant_cumul")),
            "observation": l.get("observation"),
        })

    sections = []
    for s in SECTIONS:
        d = sections_data[s["key"]]
        sections.append({
            "titre": d["titre"],
            "lignes": d["lignes"],
            "sous_total": _fmt(d["sous_total"]),
            "sous_total_patronal": _fmt_ou_tiret(d["sous_total_patronal"]),
        })

    collab = bulletin.get("_collaborateur_detail", {})
    identite_rows = [
        [("Matricule", bulletin.get("matricule") or "—"),
         ("Nom & Prénom", f"{collab.get('nom', '')} {collab.get('prenom', '')}".strip() or "—")],
        [("CIN", collab.get("cin", "—")), ("N° CNSS", collab.get("num_cnss", "—"))],
        [("Poste occupé", collab.get("poste", "—")), ("Département / UO", collab.get("organisation", "—"))],
        [("Date d'embauche", collab.get("date_embauche", "—")), ("Type de contrat", collab.get("type_contrat", "—"))],
        [("Situation familiale", collab.get("code_situation_familiale", "—")), ("Régime de cotisation", collab.get("regime_cotisation", "—"))],
    ]

    net_a_payer = bulletin.get("net_a_payer") or 0

    return {
        # RG-MULTISOCIETE-07 : société RÉELLE du bulletin si fournie par
        # l'appelant (voir paie_edition.py, _charger_societe_bulletin) --
        # repli sur le placeholder uniquement si absente.
        "societe": bulletin.get("_societe_detail") or SOCIETE_REPLI,
        "bulletin": {
            "numero": bulletin.get("id"),
            "statut": bulletin.get("statut") or "CALCULE",
            "mode_reglement": bulletin.get("mode_reglement") or "Virement bancaire",
        },
        "periode": {
            "libelle": bulletin.get("_periode_libelle") or bulletin.get("periode_id"),
            "code_plan": bulletin.get("code_plan"),
        },
        "collaborateur": {"matricule": bulletin.get("matricule")},
        "identite_rows": identite_rows,
        "sections": sections,
        "totaux": {
            "total_gains": _fmt(bulletin.get("total_gains")),
            "total_cot_salariale": _fmt(bulletin.get("total_cot_salariale")),
            "total_retenues": _fmt(bulletin.get("total_retenues")),
            "net_imposable": _fmt(bulletin.get("net_imposable")),
            "net_a_payer": _fmt(net_a_payer),
            "net_a_payer_lettres": _montant_en_lettres(net_a_payer),
            "total_cot_patronale": _fmt(bulletin.get("total_cot_patronale")),
            "cout_employeur": _fmt(bulletin.get("cout_employeur")),
        },
        "date_generation": datetime.now().strftime("%d/%m/%Y %H:%M"),
    }


def generer_pdf_bulletin(bulletin: dict) -> bytes:
    contexte = construire_contexte(bulletin)
    template = _env.get_template("bulletin_paie.html")
    html_str = template.render(**contexte)
    buf = io.BytesIO()
    HTML(string=html_str, base_url=str(TEMPLATES_DIR)).write_pdf(buf)
    return buf.getvalue()
