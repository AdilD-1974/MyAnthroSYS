"""
Moteur du Journal de paie en grille (format réglementaire).

Réutilise `_resoudre_bulletins()` de rapport_engine.py (même logique de
périmètre libre, même union bulletin/bulletin_historique). Ce module ajoute
uniquement la lecture de la config de grille et le calcul des valeurs par
case, à partir du snapshot (identité) et de bulletin_ligne (rubriques).
"""
from __future__ import annotations

import datetime as _dt
import html
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.rapport_grille import (
    GrilleCondition,
    GrilleMasque,
    GrilleApercuResponse,
    GrilleBlocCollaborateur,
    GrilleCase,
    GrilleEnteteSociete,
)
from app.services.rapport_engine import _resoudre_bulletins, _lire_cle

# Rubriques dont la valeur ne vit PAS dans bulletin_ligne mais directement
# sur l'en-tête bulletin/bulletin_historique (cf. découverte paie_calcul.py :
# total_gains/total_retenues/net_a_payer sont des colonnes d'en-tête).
_CODES_RUBRIQUE_HEADER = {
    "NET_A_PAYER": "net_a_payer",
    "TOTAL_GAINS": "total_gains",
    "TOTAL_RETENUES": "total_retenues",
}


# -----------------------------------------------------------------------------
# Habillage du modèle de sortie : masques, texte avant/après, valeur si vide,
# condition d'affichage.
#
# Toute la mise en forme vit ICI (et nulle part ailleurs) : l'aperçu renvoyé
# à l'écran et le PDF utilisent les mêmes valeurs déjà formatées, donc ce
# qu'on voit dans la grille est exactement ce qui s'imprime. Toutes les
# options sont facultatives : une case sans masque/texte/condition sort comme
# avant (float -> "1 234,56", vide -> "-").
# -----------------------------------------------------------------------------

_MOIS_LONGS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet",
               "août", "septembre", "octobre", "novembre", "décembre"]


def _nombre(v: Any) -> float | None:
    """Convertit en float si la valeur est numérique ou ressemble à un nombre."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float, Decimal)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip().replace(" ", "").replace(",", "."))
        except ValueError:
            return None
    return None


def _est_vide(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def _vers_date(v: Any) -> _dt.date | None:
    if isinstance(v, _dt.datetime):
        return v.date()
    if isinstance(v, _dt.date):
        return v
    if isinstance(v, str):
        try:
            return _dt.date.fromisoformat(v.strip()[:10])
        except ValueError:
            return None
    return None


def _fmt_nombre(n: float, decimales: int = 2) -> str:
    return f"{n:,.{decimales}f}".replace(",", " ").replace(".", ",")


def _m_date_fr(v: Any) -> str:
    d = _vers_date(v)
    return d.strftime("%d/%m/%Y") if d else str(v)


def _m_date_longue(v: Any) -> str:
    d = _vers_date(v)
    return f"{d.day} {_MOIS_LONGS[d.month]} {d.year}" if d else str(v)


def _m_montant(v: Any) -> str:
    n = _nombre(v)
    return _fmt_nombre(n, 2) if n is not None else str(v)


def _m_montant_sans_zero(v: Any) -> str:
    n = _nombre(v)
    if n is None:
        return str(v)
    return "" if n == 0 else _fmt_nombre(n, 2)


def _m_entier(v: Any) -> str:
    n = _nombre(v)
    if n is None:
        return str(v)
    # Arrondi "commercial" (la moitié monte : 1234,5 -> 1235) — round() de
    # Python arrondirait à la moitié paire (1234), inattendu sur un document de paie.
    entier = int(Decimal(str(n)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return _fmt_nombre(entier, 0)


def _m_pourcentage(v: Any) -> str:
    n = _nombre(v)
    return f"{_fmt_nombre(n, 2)} %" if n is not None else str(v)


def _m_majuscules(v: Any) -> str:
    return str(v).upper()


# code -> (libellé affiché, fonction, valeur d'exemple brute pour l'aperçu du choix).
# Ajouter un masque = ajouter une ligne ici ; l'écran de configuration le
# découvre via GET /journal-grille/masques, sans modification côté frontend.
MASQUES: dict[str, tuple[str, Callable[[Any], str], Any]] = {
    "DATE_FR": ("Date JJ/MM/AAAA", _m_date_fr, "1974-10-06"),
    "DATE_LONGUE": ("Date longue", _m_date_longue, "1974-10-06"),
    "MONTANT": ("Montant 1 234,56", _m_montant, 1234.5),
    "MONTANT_SANS_ZERO": ("Montant, vide si zéro", _m_montant_sans_zero, 625.0),
    "ENTIER": ("Nombre entier", _m_entier, 1234.5),
    "POURCENTAGE": ("Pourcentage", _m_pourcentage, 4.48),
    "MAJUSCULES": ("Majuscules", _m_majuscules, "Direction Générale"),
}


def lister_masques() -> list[GrilleMasque]:
    return [GrilleMasque(code=c, libelle=l, exemple=f(ex)) for c, (l, f, ex) in MASQUES.items()]


_RE_VARIABLE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\}")


def _resoudre_variables(texte: str, snap: dict) -> str:
    """Remplace {identite.prenom}, {affectation.organisation_libelle}… par la
    valeur du snapshot du collaborateur (mêmes clés que le sélecteur de champs).
    Une variable inconnue ou vide est remplacée par une chaîne vide."""
    def _remplacer(m: re.Match) -> str:
        v = _valeur_identite(snap, m.group(1))
        return "" if v is None else str(v)
    return _RE_VARIABLE.sub(_remplacer, texte)


def _evaluer_condition(cond: GrilleCondition, brut_propre: Any, bruts: dict[str, Any]) -> bool:
    cible = brut_propre if cond.cible in (None, "", "SELF") else bruts.get(cond.cible)
    op = cond.operateur
    ref = cond.valeur or ""

    if op == "RENSEIGNEE":
        return not _est_vide(cible)
    if op == "NON_ZERO":
        if _est_vide(cible):
            return False
        n = _nombre(cible)
        return True if n is None else n != 0
    if op in ("EGAL", "DIFFERENT"):
        na, nb = _nombre(cible), _nombre(ref)
        if na is not None and nb is not None:
            egal = na == nb
        else:
            egal = ("" if cible is None else str(cible)).strip().lower() == ref.strip().lower()
        return egal if op == "EGAL" else not egal
    if op in ("SUPERIEUR", "INFERIEUR"):
        na, nb = _nombre(cible), _nombre(ref)
        if na is None or nb is None:
            return False
        return na > nb if op == "SUPERIEUR" else na < nb
    if op == "CONTIENT":
        return ref.strip().lower() in ("" if cible is None else str(cible)).lower()
    return True   # opérateur inconnu : on affiche plutôt que de cacher par erreur


def _formater_case(case: GrilleCase, brut: Any) -> str:
    """Valeur brute -> texte imprimé : valeur si vide, masque, texte avant/après."""
    if _est_vide(brut):
        return "-" if case.valeur_si_vide is None else case.valeur_si_vide

    masque = MASQUES.get(case.masque) if case.masque else None
    if masque:
        texte = masque[1](brut)
    elif isinstance(brut, float):
        texte = _fmt_nombre(brut, 2)          # comportement historique des montants
    else:
        texte = str(brut)

    if texte == "":                            # un masque a volontairement effacé la valeur
        return case.valeur_si_vide or ""
    return f"{case.texte_avant or ''}{texte}{case.texte_apres or ''}"


def charger_config_grille(session: Session, template_id: UUID) -> list[GrilleCase]:
    rows = session.execute(
        text(
            """
            SELECT id, ligne, colonne, rowspan, colspan, libelle, type_source,
                   cle_identite, code_rubrique, attribut, valeur_constante, ordre_affichage,
                   masque, texte_avant, texte_apres, valeur_si_vide, condition_affichage
            FROM rapport_grille_case
            WHERE template_id = :tid
            ORDER BY ordre_affichage
            """
        ),
        {"tid": str(template_id)},
    ).mappings().all()
    return [GrilleCase(**r) for r in rows]


def _charger_entete_societe(session: Session, template_id: UUID) -> GrilleEnteteSociete:
    """
    RG-MULTISOCIETE-07 (migration 057) : table réelle confirmée = `societes`
    (pluriel) -- le nom `public.societe` (singulier) ci-dessous était erroné,
    donc ce bloc tombait TOUJOURS dans le except (repli silencieux sur les
    valeurs manuelles), quel que soit societe_id. Corrigé.
    """
    row = session.execute(
        text("SELECT * FROM rapport_grille_entete WHERE template_id = :tid"),
        {"tid": str(template_id)},
    ).mappings().first()
    if row is None:
        return GrilleEnteteSociete()

    if row.get("societe_id"):
        try:
            soc = session.execute(
                text("SELECT * FROM public.societes WHERE id = :sid"),
                {"sid": str(row["societe_id"])},
            ).mappings().first()
            if soc:
                return GrilleEnteteSociete(
                    adresse=soc.get("adresse") or row.get("adresse_manuelle"),
                    identifiant_fiscal=soc.get("identifiant_fiscal") or row.get("identifiant_fiscal_manuel"),
                    affiliation_cnss=soc.get("affiliation_cnss") or row.get("affiliation_cnss_manuelle"),
                    logo_path=row.get("logo_path"),
                )
        except Exception:
            pass  # ligne d'en-tête présente mais societe_id orphelin — repli sur le manuel

    return GrilleEnteteSociete(
        adresse=row.get("adresse_manuelle"),
        identifiant_fiscal=row.get("identifiant_fiscal_manuel"),
        affiliation_cnss=row.get("affiliation_cnss_manuelle"),
        logo_path=row.get("logo_path"),
    )


def _valeur_identite(snap: dict, cle: str) -> Any:
    if cle == "identite.nom_complet":
        civ = _lire_cle(snap, "identite.civilite") or ""
        nom = _lire_cle(snap, "identite.nom") or ""
        prenom = _lire_cle(snap, "identite.prenom") or ""
        return f"{civ} {nom} {prenom}".strip()

    # `regimes` est une LISTE (CNSS + AMO + CIMR possibles simultanément),
    # pas un dict — syntaxe dédiée : "regimes.CODE.champ" pour cibler un
    # régime précis (ex. "regimes.CNSS.date_affiliation").
    if cle.startswith("regimes."):
        parts = cle.split(".", 2)
        if len(parts) == 3:
            _, code_cherche, champ = parts
            for r in snap.get("regimes", []):
                if r.get("code_regime") == code_cherche:
                    return r.get(champ)
        return None

    return _lire_cle(snap, cle)


def construire_grille_journal(
    session: Session, template_id: UUID, perimetre, societe_id: str | None = None
) -> GrilleApercuResponse:
    cases = charger_config_grille(session, template_id)
    entete = _charger_entete_societe(session, template_id)
    bulletins = _resoudre_bulletins(session, perimetre, societe_id)

    if not bulletins:
        return GrilleApercuResponse(entete=entete, cases=cases, blocs=[], nb_collaborateurs=0)

    bulletin_ids = [b["id"] for b in bulletins]

    snapshots = session.execute(
        text("SELECT bulletin_id, donnees FROM bulletin_snapshot_collaborateur WHERE bulletin_id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": [str(i) for i in bulletin_ids]},
    ).mappings().all()
    snapshot_par_bulletin = {row["bulletin_id"]: row["donnees"] for row in snapshots}

    # Une seule requête pour toutes les lignes de tous les bulletins du
    # périmètre (union bulletin_ligne / bulletin_historique_ligne), plutôt
    # qu'une requête par collaborateur — coût O(1) au lieu de O(n).
    lignes = session.execute(
        text(
            """
            SELECT bulletin_id, code_rubrique, montant, nombre, taux, base
            FROM public.bulletin_ligne WHERE bulletin_id = ANY(CAST(:ids AS uuid[]))
            UNION ALL
            SELECT bulletin_id, code_rubrique, montant, nombre, taux, base
            FROM public.bulletin_historique_ligne WHERE bulletin_id = ANY(CAST(:ids AS uuid[]))
            """
        ),
        {"ids": [str(i) for i in bulletin_ids]},
    ).mappings().all()
    lignes_par_bulletin: dict[Any, dict[str, dict]] = {}
    for l in lignes:
        lignes_par_bulletin.setdefault(l["bulletin_id"], {})[l["code_rubrique"]] = l

    _ATTR_COL = {"MT": "montant", "NB": "nombre", "TX": "taux", "BASE": "base"}

    blocs: list[GrilleBlocCollaborateur] = []
    for b in bulletins:
        bid = b["id"]
        snap = snapshot_par_bulletin.get(bid, {})
        lignes_b = lignes_par_bulletin.get(bid, {})
        # 1) Valeurs BRUTES de toutes les cases (une condition peut porter sur
        #    une autre case, il faut donc les avoir toutes avant d'habiller).
        bruts: dict[str, Any] = {}
        for case in cases:
            clef = f"{case.ligne}_{case.colonne}"
            if case.type_source == "IDENTITE" and case.cle_identite:
                bruts[clef] = _valeur_identite(snap, case.cle_identite)
            elif case.type_source == "CONSTANTE":
                # Texte fixe, avec variables optionnelles : "Bonjour {identite.prenom}"
                bruts[clef] = (
                    _resoudre_variables(case.valeur_constante, snap)
                    if case.valeur_constante is not None else None
                )
            elif case.type_source == "RUBRIQUE" and case.code_rubrique:
                if case.code_rubrique in _CODES_RUBRIQUE_HEADER:
                    bruts[clef] = float(b.get(_CODES_RUBRIQUE_HEADER[case.code_rubrique]) or 0)
                else:
                    ligne_rub = lignes_b.get(case.code_rubrique)
                    col = _ATTR_COL.get(case.attribut or "MT", "montant")
                    bruts[clef] = float(ligne_rub[col]) if ligne_rub and ligne_rub.get(col) is not None else None
            else:
                bruts[clef] = None

        # 2) Habillage : condition d'affichage, puis masque / texte / valeur si vide.
        valeurs: dict[str, Any] = {}
        masquees: list[str] = []
        for case in cases:
            clef = f"{case.ligne}_{case.colonne}"
            cond = case.condition_affichage
            if cond is not None and not _evaluer_condition(cond, bruts[clef], bruts):
                valeurs[clef] = ""
                if cond.sinon == "MASQUER":
                    masquees.append(clef)
                continue
            valeurs[clef] = _formater_case(case, bruts[clef])

        blocs.append(GrilleBlocCollaborateur(bulletin_id=bid, valeurs=valeurs, masquees=masquees))

    return GrilleApercuResponse(entete=entete, cases=cases, blocs=blocs, nb_collaborateurs=len(blocs))


def rendre_grille_html(reponse: GrilleApercuResponse, mois_libelle: str, periode_debut: str, periode_fin: str) -> str:
    """
    Rendu HTML fidèle au modèle papier : un bloc de `max(ligne)` lignes par
    collaborateur, cases positionnées par (ligne, colonne) avec fusion.
    """
    nb_lignes = max((c.ligne for c in reponse.cases), default=4)

    def _fmt(v: Any) -> str:
        if v is None:
            return "-"
        if isinstance(v, float):
            return f"{v:,.2f}".replace(",", " ").replace(".", ",")
        return str(v)

    blocs_html = ""
    for bloc in reponse.blocs:
        occupe = set()
        lignes_html = ""
        for ligne in range(1, nb_lignes + 1):
            cellules = ""
            cases_ligne = sorted([c for c in reponse.cases if c.ligne == ligne], key=lambda c: c.colonne)
            for case in cases_ligne:
                if (ligne, case.colonne) in occupe:
                    continue
                for dl in range(case.rowspan):
                    for dc in range(case.colspan):
                        occupe.add((ligne + dl, case.colonne + dc))
                clef = f"{case.ligne}_{case.colonne}"
                if clef in bloc.masquees:
                    # Condition d'affichage "MASQUER" : la case garde sa place
                    # (la mise en page ne bouge pas) mais n'imprime rien.
                    cellules += f'<td rowspan="{case.rowspan}" colspan="{case.colspan}" class="masquee"></td>'
                    continue
                val = bloc.valeurs.get(clef)
                # html.escape : le texte avant/après et les constantes sont
                # désormais saisis par les utilisateurs — un "<" ou un "&" ne
                # doit ni casser le PDF ni injecter du HTML.
                cellules += (
                    f'<td rowspan="{case.rowspan}" colspan="{case.colspan}">'
                    f'<div class="lbl">{html.escape(case.libelle)}</div>'
                    f'<div class="val">{html.escape(_fmt(val))}</div></td>'
                )
            lignes_html += f"<tr>{cellules}</tr>"
        blocs_html += f'<tbody class="bloc-collab">{lignes_html}</tbody>'

    import datetime
    date_edition = datetime.date.today().strftime("%d/%m/%Y")

    # xhtml2pdf ne supporte pas flexbox : en-tête en table 2 colonnes.
    return f"""
    <html><head><meta charset="utf-8"><style>
      body {{ font-family: Arial, sans-serif; font-size: 9px; }}
      h1 {{ font-size: 18px; text-align: center; }}
      .entete table {{ width: 100%; border: none; margin-bottom: 10px; font-size: 10px; }}
      .entete td {{ border: none; padding: 0; }}
      .entete .droite {{ text-align: right; }}
      table {{ width: 100%; border-collapse: collapse; }}
      td {{ border: 1px solid #333; padding: 3px 5px; vertical-align: top; }}
      .lbl {{ font-size: 7px; color: #555; }}
      .val {{ font-weight: bold; }}
      .bloc-collab {{ border-bottom: 2px solid #000; }}
      td.masquee {{ border: 1px solid #fff; }}
    </style></head><body>
      <div class="entete">
        <table><tr>
          <td>Adresse : {reponse.entete.adresse or ""}<br/>Identifiant Fiscal : {reponse.entete.identifiant_fiscal or ""}<br/>Affiliation CNSS : {reponse.entete.affiliation_cnss or ""}</td>
          <td class="droite">Date d'édition : {date_edition}</td>
        </tr></table>
      </div>
      <h1>JOURNAL DE PAIE</h1>
      <p style="text-align:center">Mois de Paie : <b>{mois_libelle}</b><br/>Période de Paie du <b>{periode_debut}</b> Au <b>{periode_fin}</b></p>
      <table>{blocs_html}</table>
    </body></html>
    """


def exporter_grille_pdf(reponse: GrilleApercuResponse, mois_libelle: str, periode_debut: str, periode_fin: str) -> bytes:
    """xhtml2pdf plutôt que weasyprint — voir le commentaire équivalent dans rapport_engine.exporter_journal_pdf."""
    from io import BytesIO

    from xhtml2pdf import pisa

    html = rendre_grille_html(reponse, mois_libelle, periode_debut, periode_fin)
    buffer = BytesIO()
    resultat = pisa.CreatePDF(html, dest=buffer)
    if resultat.err:
        raise RuntimeError("Échec de la génération du PDF (xhtml2pdf)")
    return buffer.getvalue()
