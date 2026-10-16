"""
app/services/rapport_generateur_engine.py

Moteur de rendu générique du générateur d'états (MODULE_ETATS_PAIE.md §13-14).
Lit la configuration paramétrée (etat_corps / etat_corps_colonne /
etat_corps_rubrique / etat_bloc / ...) et produit le document final (HTML
assemblé dynamiquement, converti en PDF via xhtml2pdf — cohérent avec le
reste du projet). Couvre uniquement la source BULLETIN à ce stade.

⚠️ HYPOTHÈSES NON CONFIRMÉES — à vérifier avant mise en production :

1. `etat_corps_ligne_speciale.code_constante` est interprété ici comme le
   NOM D'UNE COLONNE AGRÉGÉE de la table `bulletin` (ex.
   "total_brut_imposable", "net_a_payer", "total_cot_patronale" — toutes
   confirmées présentes sur `bulletin`). Ce n'est PAS une table de
   constantes séparée : son schéma n'a jamais été confirmé (cf. migration
   071, commentaire sur etat_corps_ligne_speciale). Si une vraie table de
   constantes existe et doit être utilisée à la place, cette fonction de
   résolution (`_resoudre_ligne_speciale`) est le seul endroit à changer.

2. Mode ACTUEL (etat_champ_selection.mode_donnee = 'ACTUEL', RG-ETAT-PERIODE
   §14) n'est PAS implémenté : il n'existe pas de variante "lecture seule,
   sans persistance" de capturer_snapshot_collaborateur() dans
   rapport_engine.py à ce jour. Un champ marqué ACTUEL retombe
   silencieusement sur sa valeur figée à la période (snapshot), avec un
   commentaire explicite dans le code -- PAS un TODO caché.

3. Un seul bulletin par (collaborateur_id, periode_id) est supposé. En cas
   de doublon (recalcul conservé), le plus récent (created_at DESC) est pris.

4. Le logo société n'est PAS encore inséré dans le HTML même si
   `afficher_logo` est vrai -- le nom de la colonne portant le chemin du
   logo sur la table société n'a jamais été confirmé (seul le dossier de
   stockage `storage/logos_societes` est connu, via main.py). Zone
   réservée dans le CSS (`.logo-societe`), balise à compléter une fois la
   colonne confirmée.

5. Pas de gestion de saut de page multi-collaborateurs ici -- cette
   fonction produit UN document pour UN collaborateur/UNE période. Un
   export en masse (plusieurs bulletins) sera une boucle appelant cette
   fonction, à construire séparément si besoin.
"""
from __future__ import annotations

import datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

# Champ bulletin_ligne correspondant à chaque attribut mappable
# (etat_corps_rubrique_colonne.attribut, migration 073).
ATTRIBUT_VERS_CHAMP_LIGNE = {
    "NOMBRE": "nombre",
    "BASE": "base",
    "MONTANT": "montant",
    "MONTANT_PATRONAL": "montant_patronal",
    "TAUX": "taux",
}


# =============================================================================
# 1. Résolution de la configuration paramétrée (etat_corps / etat_bloc / ...)
# =============================================================================

def _charger_configuration_etat(db: Session, etat_id: UUID) -> dict:
    etat = db.execute(
        text(
            """
            SELECT id, nom, description, afficher_logo, pied_de_page_html, societe_id, modele_code
            FROM public.etat_definition WHERE id = :id
            """
        ),
        {"id": str(etat_id)},
    ).mappings().first()
    if etat is None:
        raise ValueError(f"État introuvable : {etat_id}")

    champs = db.execute(
        text(
            """
            SELECT champ_code, mode_donnee, ordre_affichage
            FROM public.etat_champ_selection
            WHERE etat_id = :id AND visible = true
            ORDER BY ordre_affichage
            """
        ),
        {"id": str(etat_id)},
    ).mappings().all()

    corps_rows = db.execute(
        text(
            """
            SELECT id, corps_code, libelle, ordre_affichage, couleur_fond,
                   couleur_texte, police, taille_police, gras
            FROM public.etat_corps
            WHERE etat_id = :id AND visible = true
            ORDER BY ordre_affichage
            """
        ),
        {"id": str(etat_id)},
    ).mappings().all()

    corps_liste = []
    for c in corps_rows:
        colonnes = [
            dict(col)
            for col in db.execute(
                text(
                    """
                    SELECT id, code_colonne, libelle, format, ordre_affichage
                    FROM public.etat_corps_colonne WHERE etat_corps_id = :id
                    ORDER BY ordre_affichage
                    """
                ),
                {"id": c["id"]},
            ).mappings().all()
        ]

        rubriques_rows = db.execute(
            text(
                """
                SELECT id, rubrique_paie_code, ordre_affichage, libelle_personnalise
                FROM public.etat_corps_rubrique WHERE etat_corps_id = :id
                ORDER BY ordre_affichage
                """
            ),
            {"id": c["id"]},
        ).mappings().all()

        rubriques = []
        for r in rubriques_rows:
            mappings = db.execute(
                text(
                    """
                    SELECT m.attribut, col.code_colonne
                    FROM public.etat_corps_rubrique_colonne m
                    JOIN public.etat_corps_colonne col ON col.id = m.etat_corps_colonne_id
                    WHERE m.etat_corps_rubrique_id = :rid
                    """
                ),
                {"rid": r["id"]},
            ).mappings().all()
            rubriques.append(
                {
                    "rubrique_paie_code": r["rubrique_paie_code"],
                    "ordre_affichage": r["ordre_affichage"],
                    "libelle_personnalise": r["libelle_personnalise"],
                    "mappings": {m["attribut"]: m["code_colonne"] for m in mappings},
                }
            )

        lignes_speciales = [
            dict(l)
            for l in db.execute(
                text(
                    """
                    SELECT l.code_constante, l.libelle, col.code_colonne, l.ordre_affichage
                    FROM public.etat_corps_ligne_speciale l
                    LEFT JOIN public.etat_corps_colonne col ON col.id = l.etat_corps_colonne_id
                    WHERE l.etat_corps_id = :id ORDER BY l.ordre_affichage
                    """
                ),
                {"id": c["id"]},
            ).mappings().all()
        ]

        blocs_rows = db.execute(
            text(
                """
                SELECT id, libelle, ordre_affichage, couleur_fond, couleur_texte,
                       police, taille_police, gras, position_libelle, position_total
                FROM public.etat_bloc WHERE etat_corps_id = :id AND visible = true
                ORDER BY ordre_affichage
                """
            ),
            {"id": c["id"]},
        ).mappings().all()

        blocs = []
        rubriques_dans_un_bloc: set[str] = set()
        for b in blocs_rows:
            rubs_bloc = list(
                db.execute(
                    text(
                        """
                        SELECT cr.rubrique_paie_code
                        FROM public.etat_bloc_rubrique br
                        JOIN public.etat_corps_rubrique cr ON cr.id = br.etat_corps_rubrique_id
                        WHERE br.etat_bloc_id = :bid ORDER BY br.ordre_affichage
                        """
                    ),
                    {"bid": b["id"]},
                ).scalars().all()
            )
            cols_total = list(
                db.execute(
                    text(
                        """
                        SELECT col.code_colonne
                        FROM public.etat_bloc_colonne_total bct
                        JOIN public.etat_corps_colonne col ON col.id = bct.etat_corps_colonne_id
                        WHERE bct.etat_bloc_id = :bid
                        """
                    ),
                    {"bid": b["id"]},
                ).scalars().all()
            )
            rubriques_dans_un_bloc.update(rubs_bloc)
            blocs.append({**dict(b), "rubriques": rubs_bloc, "colonnes_total": cols_total})

        corps_liste.append(
            {
                **dict(c),
                "colonnes": colonnes,
                "rubriques": rubriques,
                "lignes_speciales": lignes_speciales,
                "blocs": blocs,
                "rubriques_hors_bloc": [
                    r for r in rubriques if r["rubrique_paie_code"] not in rubriques_dans_un_bloc
                ],
            }
        )

    return {"etat": dict(etat), "champs": [dict(ch) for ch in champs], "corps": corps_liste}


# =============================================================================
# 2. Résolution de la donnée réelle (bulletin, snapshot, lignes)
# =============================================================================

def _charger_bulletin(db: Session, collaborateur_id: UUID, periode_id: UUID) -> dict:
    bulletin = db.execute(
        text(
            """
            SELECT * FROM public.bulletin
            WHERE collaborateur_id = :cid AND periode_id = :pid
            ORDER BY created_at DESC LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id), "pid": str(periode_id)},
    ).mappings().first()
    if bulletin is None:
        raise ValueError("Aucun bulletin trouvé pour ce collaborateur sur cette période.")
    return dict(bulletin)


def _charger_lignes_bulletin(db: Session, bulletin_id) -> dict[str, dict]:
    """RG déjà établie ailleurs dans le projet (rapport_engine.py,
    construire_journal) : ne garder que sens IN ('GAIN','RETENUE') -- NULL =
    intermédiaire de calcul interne, jamais imprimé."""
    rows = db.execute(
        text(
            """
            SELECT code_rubrique, base, nombre, taux, montant, montant_patronal
            FROM public.bulletin_ligne
            WHERE bulletin_id = :bid AND sens IN ('GAIN', 'RETENUE')
            """
        ),
        {"bid": str(bulletin_id)},
    ).mappings().all()
    return {r["code_rubrique"]: dict(r) for r in rows}


def _charger_snapshot(db: Session, bulletin_id) -> dict:
    row = db.execute(
        text("SELECT donnees FROM public.bulletin_snapshot_collaborateur WHERE bulletin_id = :bid"),
        {"bid": str(bulletin_id)},
    ).mappings().first()
    if row is None:
        raise ValueError("Snapshot introuvable pour ce bulletin -- le bulletin a-t-il été calculé ?")
    return row["donnees"]


def _charger_libelles_rubriques(db: Session, codes: set[str]) -> dict[str, str]:
    if not codes:
        return {}
    rows = db.execute(
        text("SELECT code, libelle FROM public.rubrique_paie WHERE code = ANY(CAST(:codes AS text[]))"),
        {"codes": list(codes)},
    ).mappings().all()
    return {r["code"]: r["libelle"] for r in rows}


def _charger_libelles_champs(db: Session, type_source: str = "BULLETIN") -> dict[str, str]:
    """Libellés lisibles des champs d'en-tête (ex. 'identite.matricule' ->
    'Matricule'), depuis le même référentiel que le sélecteur de l'assistant
    (ref_champ_disponible_etat) -- pour ne jamais afficher une valeur brute
    sans étiquette sur le document final."""
    rows = db.execute(
        text("SELECT champ_code, libelle FROM public.ref_champ_disponible_etat WHERE type_source_code = :ts"),
        {"ts": type_source},
    ).mappings().all()
    return {r["champ_code"]: r["libelle"] for r in rows}


def _libelle_champ_repli(champ_code: str) -> str:
    """Si le champ n'est pas (ou plus) dans le référentiel, dérive un
    libellé lisible à partir du code plutôt que de n'afficher aucune
    étiquette du tout."""
    derniere_partie = champ_code.split(".")[-1]
    return derniere_partie.replace("_", " ").capitalize()


# =============================================================================
# 3. Résolution et formatage des valeurs
# =============================================================================

def _resoudre_champ_entete(donnees_snapshot: dict, champ_code: str, mode_donnee: str) -> Any:
    """champ_code au format 'bloc.cle' (ex. 'identite.matricule'), résolu
    dans le snapshot JSONB déjà figé à la période.

    mode_donnee == 'ACTUEL' : PAS IMPLÉMENTÉ (cf. hypothèse §2 en tête de
    fichier) -- retombe sur la valeur snapshot (PERIODE) en attendant une
    variante en lecture seule de capturer_snapshot_collaborateur()."""
    parties = champ_code.split(".", 1)
    if len(parties) != 2:
        return None
    bloc, cle = parties
    return (donnees_snapshot.get(bloc) or {}).get(cle)


def _formater_valeur(valeur: Any, format_colonne: str) -> str:
    if valeur is None or valeur == "":
        return ""
    try:
        if format_colonne in ("MONTANT_2DEC", "NOMBRE_DECIMAL"):
            return f"{float(valeur):,.2f}".replace(",", " ").replace(".", ",")
        if format_colonne == "NOMBRE_ENTIER":
            return str(int(float(valeur)))
        if format_colonne == "POURCENTAGE":
            return f"{float(valeur):.2f} %"
    except (ValueError, TypeError):
        return str(valeur)
    if format_colonne == "DATE":
        return valeur.strftime("%d/%m/%Y") if hasattr(valeur, "strftime") else str(valeur)
    return str(valeur)


def _calculer_total_bloc(rubriques_bloc: list[dict], lignes_par_rubrique: dict, code_colonne: str) -> Decimal:
    total = Decimal("0")
    for r in rubriques_bloc:
        for attribut, col in r["mappings"].items():
            if col != code_colonne:
                continue
            champ = ATTRIBUT_VERS_CHAMP_LIGNE.get(attribut)
            valeurs = lignes_par_rubrique.get(r["rubrique_paie_code"])
            if valeurs and champ and valeurs.get(champ) is not None:
                try:
                    total += Decimal(str(valeurs[champ]))
                except InvalidOperation:
                    pass
    return total


def _construire_cellules(rubrique_cfg: dict, valeurs_ligne: dict, colonnes: list[dict]) -> dict[str, str]:
    cellules = {col["code_colonne"]: "" for col in colonnes}
    for attribut, code_colonne in rubrique_cfg["mappings"].items():
        champ = ATTRIBUT_VERS_CHAMP_LIGNE.get(attribut)
        valeur_brute = valeurs_ligne.get(champ) if champ else None
        format_col = next((col["format"] for col in colonnes if col["code_colonne"] == code_colonne), "TEXTE")
        cellules[code_colonne] = _formater_valeur(valeur_brute, format_col)
    return cellules


def _style_bloc(bloc: dict, preset: dict) -> str:
    a_couleur_propre = bool(bloc.get("couleur_fond"))
    if a_couleur_propre:
        # L'utilisateur a explicitement choisi une couleur pour CE bloc --
        # toujours respectée en bandeau plein, quel que soit le modèle.
        fond, bordure = bloc["couleur_fond"], ""
    elif preset.get("titre_bloc_bandeau", True):
        fond, bordure = "transparent", ""
    else:
        # Modèles sans bandeau (Compact, Minimaliste) : un simple filet
        # coloré sous le titre plutôt qu'un fond plein.
        fond, bordure = "transparent", f'border-bottom:2px solid {preset["couleur_accent"]};'

    style = (
        f'background:{fond};'
        f'color:{bloc["couleur_texte"] or "inherit"};'
        f'font-weight:{"bold" if bloc["gras"] else "normal"};'
        f'{bordure}'
    )
    if bloc.get("police"):
        style += f'font-family:{bloc["police"]};'
    if bloc.get("taille_police"):
        style += f'font-size:{bloc["taille_police"]}px;'
    return style


# =============================================================================
# 4. Assemblage HTML
# =============================================================================

# =============================================================================
# Presets de présentation par modele_code (ref_modele_etat)
# =============================================================================
# ⚠️ CORRECTIF (28/08/2026) : `modele_code` existait dans le schéma
# (migration 071) sans jamais être lu par ce moteur -- incohérence détectée
# en appliquant le §4.1 du dossier de réflexion Odoo (séparer métadonnées et
# gabarit). Les 5 entrées seedées (bulletin_classique/moderne/compact/
# detaille/minimal) ne correspondent à AUCUN code préexistant (recherche
# confirmée infructueuse dans tout app/) -- il ne s'agit donc PAS de la
# préservation d'un système déjà éprouvé (contrairement au principe §4.2),
# mais d'une PREMIÈRE implémentation de ces 5 presets, définis ici pour la
# première fois. À ajuster librement si une identité visuelle différente
# est souhaitée pour chacun -- rien ici ne reproduit un standard existant.

MODELE_PRESET_DEFAUT = {
    "police": "Helvetica, Arial, sans-serif",
    "taille_base": 11,
    "couleur_accent": "#333333",
    "espacement_lignes": 4,
    "bordures_tableau": True,       # bordures visibles sur le tableau des rubriques
    "entete_encadre": True,         # en-tête avec cadre léger autour de chaque champ
    "titre_bloc_bandeau": True,     # bandeau plein (fond coloré) pour les titres de bloc SANS couleur propre
}

MODELE_PRESETS: dict[str, dict] = {
    # Classique -- présentation traditionnelle, encadrée, police serif.
    "bulletin_classique": {
        **MODELE_PRESET_DEFAUT,
        "police": "Times New Roman, serif",
        "couleur_accent": "#2b2b2b",
        "bordures_tableau": True,
        "entete_encadre": True,
        "titre_bloc_bandeau": True,
    },
    # Moderne -- sans-serif, accent bleu, en-tête épuré sans cadre.
    "bulletin_moderne": {
        **MODELE_PRESET_DEFAUT,
        "police": "Helvetica, Arial, sans-serif",
        "couleur_accent": "#1a5fb4",
        "bordures_tableau": True,
        "entete_encadre": False,
        "titre_bloc_bandeau": True,
    },
    # Compact -- dense, petite police, peu d'espacement, pas de bandeaux.
    "bulletin_compact": {
        **MODELE_PRESET_DEFAUT,
        "police": "Helvetica, Arial, sans-serif",
        "taille_base": 9,
        "espacement_lignes": 2,
        "couleur_accent": "#333333",
        "bordures_tableau": True,
        "entete_encadre": False,
        "titre_bloc_bandeau": False,
    },
    # Détaillé -- grande police, espacement généreux, tout encadré.
    "bulletin_detaille": {
        **MODELE_PRESET_DEFAUT,
        "police": "Helvetica, Arial, sans-serif",
        "taille_base": 12,
        "espacement_lignes": 7,
        "couleur_accent": "#1a5fb4",
        "bordures_tableau": True,
        "entete_encadre": True,
        "titre_bloc_bandeau": True,
    },
    # Minimaliste -- sans bordures ni bandeaux, tout en typographie et espace blanc.
    "bulletin_minimal": {
        **MODELE_PRESET_DEFAUT,
        "police": "Helvetica, Arial, sans-serif",
        "taille_base": 10,
        "espacement_lignes": 5,
        "couleur_accent": "#666666",
        "bordures_tableau": False,
        "entete_encadre": False,
        "titre_bloc_bandeau": False,
    },
}


def _resoudre_preset(modele_code: str | None) -> dict:
    """NULL ou code inconnu -> preset par défaut (comportement inchangé
    pour tout état créé avant ce correctif, qui n'avait pas de modele_code)."""
    if modele_code and modele_code in MODELE_PRESETS:
        return MODELE_PRESETS[modele_code]
    return MODELE_PRESET_DEFAUT


def generer_html_etat_bulletin(db: Session, etat_id: UUID, collaborateur_id: UUID, periode_id: UUID) -> str:
    config = _charger_configuration_etat(db, etat_id)
    preset = _resoudre_preset(config["etat"].get("modele_code"))
    bulletin = _charger_bulletin(db, collaborateur_id, periode_id)
    lignes_par_rubrique = _charger_lignes_bulletin(db, bulletin["id"])
    snapshot = _charger_snapshot(db, bulletin["id"])

    tous_codes = {r["rubrique_paie_code"] for c in config["corps"] for r in c["rubriques"]}
    libelles_rubriques = _charger_libelles_rubriques(db, tous_codes)
    libelles_champs = _charger_libelles_champs(db)

    # -- En-tête -- reconstruit en tableau (label + valeur), 3 paires par
    # ligne, JAMAIS de valeur brute affichée sans son étiquette (correctif :
    # la version précédente n'affichait que la valeur, concaténée sans aucun
    # séparateur ni libellé -- illisible, cf. retour utilisateur).
    paires_entete: list[tuple[str, str]] = []
    for champ in config["champs"]:
        valeur = _resoudre_champ_entete(snapshot, champ["champ_code"], champ["mode_donnee"])
        libelle_champ = libelles_champs.get(champ["champ_code"]) or _libelle_champ_repli(champ["champ_code"])
        paires_entete.append((libelle_champ, str(valeur) if valeur is not None else ""))

    lignes_entete_html = []
    for i in range(0, len(paires_entete), 2):
        groupe = paires_entete[i : i + 3]
        cellules = "".join(
            f'<td class="entete-label">{libelle}</td><td class="entete-valeur">{valeur}</td>'
            for libelle, valeur in groupe
        )
        lignes_entete_html.append(f"<tr>{cellules}</tr>")

    # -- Corps --
    html_corps_parties = []
    for corps in config["corps"]:
        style_corps_titre = ""
        if corps.get("police"):
            style_corps_titre += f'font-family:{corps["police"]};'
        if corps.get("taille_police"):
            style_corps_titre += f'font-size:{corps["taille_police"]}px;'
        if corps.get("gras"):
            style_corps_titre += "font-weight:bold;"

        lignes_html: list[str] = []

        def rendre_rubrique(r: dict) -> tuple[str, dict] | None:
            valeurs = lignes_par_rubrique.get(r["rubrique_paie_code"])
            if valeurs is None:
                return None  # rubrique non calculée sur ce bulletin -- pas de ligne vide affichée
            libelle = r.get("libelle_personnalise") or libelles_rubriques.get(r["rubrique_paie_code"], r["rubrique_paie_code"])
            return libelle, _construire_cellules(r, valeurs, corps["colonnes"])

        def ligne_html(libelle: str, cellules: dict, style: str = "") -> str:
            # ⚠️ CORRECTIF CONFIRMÉ PAR TEST ISOLÉ (28/08/2026) : xhtml2pdf
            # casse le calcul de largeur d'UNE colonne entière dès qu'une de
            # ses cellules est vide (<td></td>), même avec une largeur
            # explicite déclarée -- les colonnes suivantes se retrouvent
            # écrasées/superposées. `&nbsp;` au lieu d'une chaîne vide
            # élimine le problème (reproduit et vérifié avant/après).
            cellules_txt = "".join(
                f"<td>{cellules.get(col['code_colonne'], '') or '&nbsp;'}</td>" for col in corps["colonnes"]
            )
            return f'<tr style="{style}"><td>{libelle or "&nbsp;"}</td>{cellules_txt}</tr>'

        # Rubriques regroupées par bloc
        for bloc in corps["blocs"]:
            rubriques_bloc_cfg = [r for r in corps["rubriques"] if r["rubrique_paie_code"] in bloc["rubriques"]]
            rendues = [x for x in (rendre_rubrique(r) for r in rubriques_bloc_cfg) if x is not None]
            if not rendues:
                continue

            style = _style_bloc(bloc, preset)

            if bloc["position_libelle"] == "DEBUT":
                lignes_html.append(f'<tr style="{style}"><td colspan="{len(corps["colonnes"]) + 1}"><strong>{bloc["libelle"]}</strong></td></tr>')

            def construire_ligne_total() -> str:
                cellules_total = {}
                for col in corps["colonnes"]:
                    if col["code_colonne"] in bloc["colonnes_total"]:
                        total = _calculer_total_bloc(rubriques_bloc_cfg, lignes_par_rubrique, col["code_colonne"])
                        cellules_total[col["code_colonne"]] = _formater_valeur(total, col["format"])
                    else:
                        cellules_total[col["code_colonne"]] = ""
                return ligne_html(f'Total {bloc["libelle"]}', cellules_total, style + "font-weight:bold;")

            if bloc["position_total"] == "HAUT" and bloc["colonnes_total"]:
                lignes_html.append(construire_ligne_total())

            for libelle, cellules in rendues:
                lignes_html.append(ligne_html(libelle, cellules, style))

            if bloc["position_total"] == "BAS" and bloc["colonnes_total"]:
                lignes_html.append(construire_ligne_total())

            if bloc["position_libelle"] == "FIN":
                lignes_html.append(f'<tr style="{style}"><td colspan="{len(corps["colonnes"]) + 1}"><strong>{bloc["libelle"]}</strong></td></tr>')

        # Rubriques hors bloc
        for r in corps["rubriques_hors_bloc"]:
            rendu = rendre_rubrique(r)
            if rendu is None:
                continue
            libelle, cellules = rendu
            lignes_html.append(ligne_html(libelle, cellules))

        # Lignes spéciales -- ⚠️ hypothèse documentée en tête de fichier :
        # code_constante = nom de colonne agrégée sur `bulletin`.
        for ligne_sp in corps["lignes_speciales"]:
            valeur_brute = bulletin.get(ligne_sp["code_constante"])
            cellules = {}
            if ligne_sp["code_colonne"]:
                format_col = next(
                    (col["format"] for col in corps["colonnes"] if col["code_colonne"] == ligne_sp["code_colonne"]),
                    "MONTANT_2DEC",
                )
                cellules[ligne_sp["code_colonne"]] = _formater_valeur(valeur_brute, format_col)
            lignes_html.append(ligne_html(ligne_sp["libelle"], cellules, "font-weight:bold;"))

        # ⚠️ CORRECTIF CONFIRMÉ PAR TEST ISOLÉ (28/08/2026) : <colgroup> est
        # silencieusement IGNORÉ par xhtml2pdf (vérifié : rendu identique
        # avec ou sans, colonnes écrasées dans les deux cas). Les
        # pourcentages de largeur ne sont pas non plus fiables. Seule une
        # largeur explicite en cm posée directement sur chaque <th> a donné
        # un rendu correct lors des tests -- remplace complètement colgroup.
        nb_colonnes = len(corps["colonnes"]) or 1
        largeur_premiere_cm = 5.5  # colonne "libellé de la rubrique"
        largeur_autres_cm = round(12.0 / nb_colonnes, 2)  # ~12cm restants, répartis
        entetes_colonnes = "".join(
            f'<th style="width:{largeur_autres_cm}cm">{col["libelle"]}</th>' for col in corps["colonnes"]
        )

        html_corps_parties.append(
            f'''
            <h3 style="{style_corps_titre}">{corps["libelle"]}</h3>
            <table class="corps-table">
                <thead><tr><th style="width:{largeur_premiere_cm}cm">&nbsp;</th>{entetes_colonnes}</tr></thead>
                <tbody>{"".join(lignes_html)}</tbody>
            </table>
            '''
        )

    pied_de_page = (config["etat"]["pied_de_page_html"] or "").replace(
        "{date_generation}", datetime.date.today().strftime("%d/%m/%Y")
    )

    # Zone logo réservée mais non peuplée -- cf. hypothèse §4 en tête de fichier.
    logo_html = '<div class="logo-societe"></div>' if config["etat"]["afficher_logo"] else ""

    bordure_corps = "1px solid #ccc" if preset["bordures_tableau"] else "none"
    bordure_corps_bas = "1px solid #eee" if not preset["bordures_tableau"] else bordure_corps
    entete_bordure = "1px solid #ddd" if preset["entete_encadre"] else "none"
    entete_fond = "#fafafa" if preset["entete_encadre"] else "transparent"

    return f'''<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
    body {{ font-family: {preset["police"]}; font-size: {preset["taille_base"]}px; color: #222; }}
    h3 {{ color: {preset["couleur_accent"]}; }}
    table.entete-table {{ width: 100%; border-collapse: collapse; margin-bottom: 14px; }}
    table.entete-table td {{ padding: {preset["espacement_lignes"]}px 6px; vertical-align: top; border: {entete_bordure}; background: {entete_fond}; }}
    table.entete-table td.entete-label {{ font-weight: bold; color: #555; width: 110px; }}
    table.entete-table td.entete-valeur {{ padding-right: 24px; width: 150px; }}
    table.corps-table {{ border-collapse: collapse; margin-bottom: 16px; }}
    table.corps-table th, table.corps-table td {{ border: {bordure_corps}; border-bottom: {bordure_corps_bas}; padding: {preset["espacement_lignes"]}px 6px; text-align: right; word-wrap: break-word; }}
    table.corps-table th:first-child, table.corps-table td:first-child {{ text-align: left; }}
    .pied-de-page {{ margin-top: 20px; font-size: 9px; color: #666; }}
</style></head>
<body>
    {logo_html}
    <table class="entete-table">{"".join(lignes_entete_html)}</table>
    {"".join(html_corps_parties)}
    <div class="pied-de-page">{pied_de_page}</div>
</body></html>'''


# =============================================================================
# 5. Rendu PDF (xhtml2pdf, cohérent avec le reste du projet)
# =============================================================================

def generer_pdf_etat_bulletin(db: Session, etat_id: UUID, collaborateur_id: UUID, periode_id: UUID) -> bytes:
    from xhtml2pdf import pisa  # import local : dépendance déjà présente ailleurs dans le projet

    html = generer_html_etat_bulletin(db, etat_id, collaborateur_id, periode_id)
    buffer = BytesIO()
    resultat = pisa.CreatePDF(html, dest=buffer)
    if resultat.err:
        raise RuntimeError(f"Échec de génération PDF ({resultat.err} erreur(s) xhtml2pdf).")
    return buffer.getvalue()
