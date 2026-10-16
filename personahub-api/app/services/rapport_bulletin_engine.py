"""
Moteur du Bulletin de paie — 5 modèles de présentation, contenu identique.

Contrairement au Journal (grille fixe multi-collaborateurs), le Bulletin
est un document plein page pour UN collaborateur avec un nombre VARIABLE
de lignes de paie (lues directement depuis bulletin_ligne / bulletin_historique_ligne,
groupées par `sens` GAIN/RETENUE) — pas de mapping ligne-par-ligne comme
la grille du Journal.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.rapport_bulletin import (
    BulletinApercuResponse,
    BulletinConfig,
    CorpsConfig,
    EnteteChamp,
    LigneBulletinAffichee,
    PiedConfig,
)
from app.services.rapport_grille_engine import _charger_entete_societe, _valeur_identite


def charger_config_bulletin(session: Session, template_id: UUID) -> BulletinConfig:
    row = session.execute(
        text("SELECT * FROM rapport_bulletin_config WHERE template_id = :tid"),
        {"tid": str(template_id)},
    ).mappings().first()
    if row is None:
        raise ValueError(f"Aucune config de bulletin pour le template {template_id}")
    return BulletinConfig(
        template_id=template_id,
        style=row["style"],
        entete_config=[EnteteChamp(**c) for c in row["entete_config"]],
        corps_config=CorpsConfig(**row["corps_config"]) if row["corps_config"] else CorpsConfig(),
        pied_config=PiedConfig(**row["pied_config"]) if row["pied_config"] else PiedConfig(),
    )


def sauvegarder_config_bulletin(
    session: Session, template_id: UUID, style: str, entete: list[EnteteChamp],
    corps: CorpsConfig, pied: PiedConfig,
) -> None:
    import json

    session.execute(
        text(
            """
            INSERT INTO rapport_bulletin_config (template_id, style, entete_config, corps_config, pied_config)
            VALUES (:tid, :style, CAST(:entete AS JSONB), CAST(:corps AS JSONB), CAST(:pied AS JSONB))
            ON CONFLICT (template_id)
            DO UPDATE SET style = EXCLUDED.style, entete_config = EXCLUDED.entete_config,
                          corps_config = EXCLUDED.corps_config, pied_config = EXCLUDED.pied_config
            """
        ),
        {
            "tid": str(template_id),
            "style": style,
            "entete": json.dumps([c.model_dump() for c in entete]),
            "corps": corps.model_dump_json(),
            "pied": pied.model_dump_json(),
        },
    )
    session.commit()


def _localiser_bulletin(session: Session, bulletin_id: UUID, societe_id: str | None = None) -> tuple[dict, str]:
    """Cherche le bulletin dans les 3 tables physiques (validé/historique/temp),
    même logique de cycle de vie que paie_calcul.py. Retourne (ligne, nom_table).

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` optionnel -- sans lui,
    N'IMPORTE QUEL bulletin_id était résoluble ici (aperçu/impression d'un
    bulletin d'une autre société), aucune vérification d'appartenance
    n'existait auparavant. None = comportement inchangé (transition)."""
    for table in ("bulletin", "bulletin_historique", "bulletin_temp"):
        if societe_id:
            row = session.execute(
                text(f"""
                    SELECT b.* FROM public.{table} b
                    JOIN public.calendrier_paie cal ON cal.id = b.periode_id
                    WHERE b.id = :bid AND cal.societe_id = :sid
                """), {"bid": str(bulletin_id), "sid": societe_id}
            ).mappings().first()
        else:
            row = session.execute(
                text(f"SELECT * FROM public.{table} WHERE id = :bid"), {"bid": str(bulletin_id)}
            ).mappings().first()
        if row:
            return dict(row), table
    raise ValueError(f"Bulletin {bulletin_id} introuvable")


def construire_bulletin(session: Session, template_id: UUID, bulletin_id: UUID, societe_id: str | None = None) -> BulletinApercuResponse:
    config = charger_config_bulletin(session, template_id)
    bulletin, origine = _localiser_bulletin(session, bulletin_id, societe_id)
    entete_societe = _charger_entete_societe(session, template_id)

    snap_row = session.execute(
        text("SELECT donnees FROM bulletin_snapshot_collaborateur WHERE bulletin_id = :bid"),
        {"bid": str(bulletin_id)},
    ).mappings().first()
    snap = snap_row["donnees"] if snap_row else {}

    entete_collaborateur = [
        {"libelle": champ.libelle, "valeur": _valeur_identite(snap, champ.cle_identite)}
        for champ in config.entete_config
    ]

    # Lignes de paie : table déterminée par où vit physiquement le bulletin
    # (bulletin_ligne / bulletin_historique_ligne / bulletin_temp_ligne).
    table_lignes = {
        "bulletin": "bulletin_ligne",
        "bulletin_historique": "bulletin_historique_ligne",
        "bulletin_temp": "bulletin_temp_ligne",
    }[origine]
    lignes_rows = session.execute(
        text(f"SELECT * FROM public.{table_lignes} WHERE bulletin_id = :bid ORDER BY ordre_affichage"),
        {"bid": str(bulletin_id)},
    ).mappings().all()

    lignes: list[LigneBulletinAffichee] = []
    for l in lignes_rows:
        sens = l.get("sens")
        # N'imprimer que les lignes GAIN/RETENUE — les lignes de calcul
        # interne (bases, cumuls intermédiaires, compteurs de jours…) ont un
        # `sens` NULL ou différent et ne doivent jamais apparaître sur le
        # bulletin imprimé, même si elles existent dans bulletin_ligne.
        if sens not in ("GAIN", "RETENUE"):
            continue
        valeurs = {}
        for col in config.corps_config.colonnes:
            if col.cle == "libelle":
                continue  # géré séparément (champ `libelle` de LigneBulletinAffichee)
            valeurs[col.cle] = l.get(col.cle)
        lignes.append(
            LigneBulletinAffichee(
                libelle=l.get("libelle") or l.get("code_rubrique"),
                sens=sens,
                valeurs=valeurs,
            )
        )

    totaux = {
        "total_brut": float(bulletin.get("total_brut") or 0),
        "total_gains": float(bulletin.get("total_gains") or 0),
        "total_retenues": float(bulletin.get("total_retenues") or 0),
        "total_cot_salariale": float(bulletin.get("total_cot_salariale") or 0),
        "total_cot_patronale": float(bulletin.get("total_cot_patronale") or 0),
        "net_imposable": float(bulletin.get("net_imposable") or 0),
        "net_a_payer": float(bulletin.get("net_a_payer") or 0),
        "cout_employeur": float(bulletin.get("cout_employeur") or 0),
    }

    # Cumuls annuels (table `cumul`, confirmée dans paie_engine.py)
    cumuls: list[dict[str, Any]] = []
    periode = session.execute(
        text("SELECT annee, mois FROM public.calendrier_paie WHERE id = :pid"),
        {"pid": str(bulletin.get("periode_id"))},
    ).mappings().first()
    if periode:
        for c in config.pied_config.cumuls:
            total = session.execute(
                text(
                    """
                    SELECT COALESCE(SUM(montant), 0) AS mt
                    FROM public.cumul
                    WHERE collaborateur_id = :cid AND annee = :annee AND code_rubrique = :code
                    """
                ),
                {"cid": str(bulletin.get("collaborateur_id")), "annee": periode["annee"], "code": c.code_rubrique},
            ).scalar()
            cumuls.append({"libelle": c.libelle, "valeur": float(total or 0)})

    mois_noms = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                 "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
    periode_libelle = f"{mois_noms[periode['mois']]} {periode['annee']}" if periode else ""

    entete_societe_dict = (
        entete_societe.model_dump() if hasattr(entete_societe, "model_dump") else dict(entete_societe)
    )

    return BulletinApercuResponse(
        entete_societe=entete_societe_dict,
        entete_collaborateur=entete_collaborateur,
        lignes=lignes,
        totaux=totaux,
        cumuls=cumuls,
        mentions_legales=config.pied_config.mentions_legales,
        afficher_signature=config.pied_config.afficher_signature,
        texte_signature=config.pied_config.texte_signature,
        periode_libelle=periode_libelle,
    )


_STYLES = {
    "classique": {
        "font": "'Times New Roman', Georgia, serif",
        "accent_bg": "#1a1a1a", "accent_text": "#ffffff",
        "border": "#333333", "alt_row": "#f6f6f4",
        "title_size": "17px", "base_size": "10.5px",
        "net_bg": "#1a1a1a", "net_text": "#ffffff", "radius": "0px",
        "header_border_width": "2px",
    },
    "moderne": {
        "font": "Arial, 'Helvetica Neue', sans-serif",
        "accent_bg": "#0f6e56", "accent_text": "#ffffff",
        "border": "#d7e4e0", "alt_row": "#eef7f4",
        "title_size": "19px", "base_size": "10px",
        "net_bg": "#0f6e56", "net_text": "#ffffff", "radius": "6px",
        "header_border_width": "0px",
    },
    "compact": {
        "font": "Arial, sans-serif",
        "accent_bg": "#3c3c3c", "accent_text": "#ffffff",
        "border": "#999999", "alt_row": "#f2f2f2",
        "title_size": "12px", "base_size": "8px",
        "net_bg": "#3c3c3c", "net_text": "#ffffff", "radius": "0px",
        "header_border_width": "1px",
    },
    "detaille": {
        "font": "Georgia, serif",
        "accent_bg": "#712b13", "accent_text": "#ffffff",
        "border": "#c9b8ae", "alt_row": "#faf6f3",
        "title_size": "16px", "base_size": "9.5px",
        "net_bg": "#712b13", "net_text": "#ffffff", "radius": "0px",
        "header_border_width": "1px",
    },
    "minimaliste": {
        "font": "'Helvetica Neue', Arial, sans-serif",
        "accent_bg": "#ffffff", "accent_text": "#555555",
        "border": "#e0e0e0", "alt_row": "#ffffff",
        "title_size": "15px", "base_size": "10px",
        "net_bg": "#ffffff", "net_text": "#111111", "radius": "0px",
        "header_border_width": "0px",
    },
}


def _fmt_nombre(v: Any) -> str:
    """Format français cohérent avec le reste de l'app (espace milliers,
    virgule décimale) — évite le format US (18750.0000, 1,371.36) vu dans
    le premier PDF de test."""
    if v is None or v == "":
        return ""
    try:
        return f"{float(v):,.2f}".replace(",", " ").replace(".", ",")
    except (TypeError, ValueError):
        return str(v)


def rendre_bulletin_html(reponse: BulletinApercuResponse, style: str) -> str:
    s = _STYLES.get(style, _STYLES["classique"])

    # ---- En-tête société + période ------------------------------------
    entete_html = f"""
    <table style="width:100%;border:none;margin-bottom:14px;">
      <tr>
        <td style="border:none;vertical-align:top;">
          <div style="font-size:{s['title_size']};font-weight:bold;letter-spacing:0.5px;">BULLETIN DE PAIE</div>
          <div style="font-size:{s['base_size']};color:#555;margin-top:3px;">
            {reponse.entete_societe.get('adresse') or ''}<br/>
            IF : {reponse.entete_societe.get('identifiant_fiscal') or '—'} &nbsp;•&nbsp;
            CNSS : {reponse.entete_societe.get('affiliation_cnss') or '—'}
          </div>
        </td>
        <td style="border:none;text-align:right;vertical-align:top;">
          <div style="display:inline-block;background:{s['accent_bg']};color:{s['accent_text']};
                      padding:6px 14px;border-radius:{s['radius']};font-weight:bold;">
            {reponse.periode_libelle}
          </div>
        </td>
      </tr>
    </table>
    """

    # ---- Identité collaborateur : grille 2 colonnes ---------------------
    champs = reponse.entete_collaborateur
    moitie = (len(champs) + 1) // 2
    colonne_a, colonne_b = champs[:moitie], champs[moitie:]

    def _colonne_identite(items):
        lignes = "".join(
            f"<tr><td style='border:none;padding:2px 8px 2px 0;color:#666;width:42%;'>{c['libelle']}</td>"
            f"<td style='border:none;padding:2px 0;font-weight:bold;'>{c['valeur'] or '—'}</td></tr>"
            for c in items
        )
        return f"<table style='width:100%;border:none;'>{lignes}</table>"

    identite_html = f"""
    <table style="width:100%;border:{'1px' if s['header_border_width'] != '0px' else '0.5px'} solid {s['border']};
                  border-radius:{s['radius']};margin-bottom:14px;">
      <tr>
        <td style="border:none;padding:10px 14px;width:50%;vertical-align:top;">{_colonne_identite(colonne_a)}</td>
        <td style="border:none;padding:10px 14px;width:50%;vertical-align:top;border-left:1px solid {s['border']};">{_colonne_identite(colonne_b)}</td>
      </tr>
    </table>
    """

    # ---- Tableau unifié des rubriques : Désignation | Base | Nombre/Taux | Gain | Retenue | Part patronale ----
    # La colonne patronale reste toujours visible : mention obligatoire du
    # Code du Travail marocain (cotisations salariales ET patronales).
    colonnes_entete = "<th style='text-align:left;'>Désignation</th><th>Base</th><th>Nombre/Taux</th><th>Gain</th><th>Retenue</th><th>Part patronale</th>"

    lignes_html = ""
    for i, l in enumerate(reponse.lignes):
        bg = s["alt_row"] if i % 2 == 1 else "transparent"
        gain = _fmt_nombre(l.valeurs.get("montant")) if l.sens == "GAIN" else ""
        retenue = _fmt_nombre(l.valeurs.get("montant")) if l.sens == "RETENUE" else ""
        patronal = _fmt_nombre(l.valeurs.get("montant_patronal"))
        base = _fmt_nombre(l.valeurs.get("base"))
        nombre = _fmt_nombre(l.valeurs.get("nombre") if l.valeurs.get("nombre") is not None else l.valeurs.get("taux"))
        lignes_html += (
            f"<tr style='background:{bg};'>"
            f"<td style='text-align:left;word-wrap:break-word;'>{l.libelle}</td>"
            f"<td style='text-align:center;white-space:nowrap;'>{base}</td>"
            f"<td style='text-align:center;white-space:nowrap;'>{nombre}</td>"
            f"<td style='text-align:right;white-space:nowrap;'>{gain}</td>"
            f"<td style='text-align:right;white-space:nowrap;'>{retenue}</td>"
            f"<td style='text-align:right;white-space:nowrap;color:#888;'>{patronal}</td>"
            f"</tr>"
        )

    corps_html = f"""
    <table style="width:495pt;table-layout:fixed;border-collapse:collapse;border:1px solid {s['border']};margin-bottom:14px;">
      <colgroup>
        <col style="width:165pt;"/><col style="width:66pt;"/><col style="width:66pt;"/>
        <col style="width:66pt;"/><col style="width:66pt;"/><col style="width:66pt;"/>
      </colgroup>
      <thead><tr style="background:{s['accent_bg']};color:{s['accent_text']};">{colonnes_entete}</tr></thead>
      <tbody>{lignes_html}</tbody>
    </table>
    """

    # ---- Totaux + encart Net à payer -------------------------------------
    totaux_html = f"""
    <table style="width:60%;border:none;margin-left:40%;margin-bottom:10px;">
      <tr><td style="border:none;padding:2px 0;color:#555;">Total brut</td><td style="border:none;text-align:right;">{_fmt_nombre(reponse.totaux['total_brut'])}</td></tr>
      <tr><td style="border:none;padding:2px 0;color:#555;">Cotisations salariales</td><td style="border:none;text-align:right;">-{_fmt_nombre(reponse.totaux['total_cot_salariale'])}</td></tr>
      <tr><td style="border:none;padding:2px 0;color:#555;">Cotisations patronales</td><td style="border:none;text-align:right;color:#888;">{_fmt_nombre(reponse.totaux['total_cot_patronale'])}</td></tr>
      <tr><td style="border:none;padding:2px 0;color:#555;">Net imposable</td><td style="border:none;text-align:right;">{_fmt_nombre(reponse.totaux['net_imposable'])}</td></tr>
    </table>
    <table style="width:60%;margin-left:40%;background:{s['net_bg']};color:{s['net_text']};border-radius:{s['radius']};margin-bottom:14px;">
      <tr><td style="border:none;padding:10px 14px;font-weight:bold;font-size:13px;">NET À PAYER</td>
          <td style="border:none;padding:10px 14px;text-align:right;font-weight:bold;font-size:15px;">{_fmt_nombre(reponse.totaux['net_a_payer'])}</td></tr>
    </table>
    """

    # ---- Cumuls annuels ----------------------------------------------------
    cumuls_html = ""
    if reponse.cumuls:
        lignes_cumul = "".join(
            f"<tr><td style='border:none;padding:2px 8px 2px 0;color:#666;'>{c['libelle']}</td>"
            f"<td style='border:none;text-align:right;'>{_fmt_nombre(c['valeur'])}</td></tr>"
            for c in reponse.cumuls
        )
        cumuls_html = f"""
        <div style="font-size:{s['base_size']};font-weight:bold;color:#555;margin-bottom:4px;">CUMULS ANNUELS</div>
        <table style="width:50%;border:none;margin-bottom:14px;">{lignes_cumul}</table>
        """

    signature_html = (
        f"<div style='text-align:right;margin-top:36px;padding-top:24px;'>"
        f"<div style='display:inline-block;border-top:1px solid #999;padding-top:4px;font-size:9px;color:#666;'>"
        f"{reponse.texte_signature}</div></div>"
        if reponse.afficher_signature else ""
    )

    return f"""
    <html><head><meta charset="utf-8"><style>
      body {{ font-family: {s['font']}; font-size: {s['base_size']}; color: #1a1a1a; }}
      table {{ border-collapse: collapse; }}
      th, td {{ border: 1px solid {s['border']}; padding: 5px 4px; font-size: {s['base_size']}; }}
      thead th {{ font-weight: bold; padding: 7px; }}
    </style></head><body>
      {entete_html}
      {identite_html}
      {corps_html}
      {totaux_html}
      {cumuls_html}
      <p style="font-size:8px;color:#888;font-style:italic;margin-top:16px;">{reponse.mentions_legales}</p>
      {signature_html}
    </body></html>
    """


def exporter_bulletin_pdf(reponse: BulletinApercuResponse, style: str) -> bytes:
    from io import BytesIO

    from xhtml2pdf import pisa

    html = rendre_bulletin_html(reponse, style)
    buffer = BytesIO()
    resultat = pisa.CreatePDF(html, dest=buffer)
    if resultat.err:
        raise RuntimeError("Échec de la génération du PDF (xhtml2pdf)")
    return buffer.getvalue()
