"""
Service de génération de la Déclaration IR — État 9421 (DTS).

⚠️ HYPOTHÈSES DE SCHÉMA À VÉRIFIER AU DÉPLOIEMENT (même principe que
rapport_cnss_bordereau_engine.py en son temps — Adil doit confronter ces
noms de table/colonne à la base réelle et corriger les requêtes ci-dessous
si besoin, avant mise en production) :

  - `collaborateurs` : id, nom, prenom, cin, num_cnss (⚠️ pas
    `adresse` ni `numero_cnss`, confirmés absents le 20/08),
    statut_collaborateur
  - `collaborateur_contrats` : id, collaborateur_id, code_type_contrat
    (FK ref_type_contrat.code), date_debut, date_fin (nullable),
    code_statut_contrat — ✅ nom de table confirmé le 20/08 (visible
    dans les requêtes /db/collaborateur_contrats du frontend), pas
    `contrats`. `date_debut` suppose la même colonne que celle
    utilisée pour `date_fin`/`code_type_contrat` déjà confirmées ;
    non vérifiée individuellement.
    -> utilisé pour déterminer le type_personnel via
       ref_type_contrat.code_categorie_dts_ir
  - `calendrier_paie` : id, annee, mois, periode_id... (idem module CNSS)
  - `bulletin` : id, periode_id, collaborateur_id, statut
    (CALCULE/VALIDE/CLOTURE)
  - `bulletin_ligne` : bulletin_id, code_rubrique, montant
  - `societes` : id, raison_sociale, identifiant_fiscal (à confirmer —
    nom de colonne possiblement différent, ex. `if_fiscal`, `ice`...)
  - `ref_constante_paie` : code, valeur (texte)
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from xml.dom import minidom
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


# ------------------------------------------------------------------
# Paramétrage
# ------------------------------------------------------------------

def get_rubrique_mappings_ir(db: Session) -> dict[str, list[dict[str, str]]]:
    """Charge la composition (N rubriques, avec attribut et signe)
    depuis `ir_parametrage_rubrique_lignes` pour les 5 agrégats requis
    par l'État 9421. Chaque agrégat peut être la somme/différence de
    plusieurs rubriques (ex. cotisations = CNSS_SAL + AMO_SAL + CIMR_SAL)."""
    rows = db.execute(
        text(
            "SELECT code_constante, code_rubrique_paie, attribut, signe "
            "FROM ir_parametrage_rubrique_lignes ORDER BY code_constante, ordre"
        )
    ).fetchall()
    mapping: dict[str, list[dict[str, str]]] = {}
    for r in rows:
        mapping.setdefault(r.code_constante, []).append(
            {"code_rubrique_paie": r.code_rubrique_paie, "attribut": r.attribut, "signe": r.signe}
        )

    required = [
        "IR_RUBRIQUE_SALAIRE_BRUT",
        "IR_RUBRIQUE_BRUT_IMPOSABLE",
        "IR_RUBRIQUE_FRAIS_PRO",
        "IR_RUBRIQUE_COTISATION_ASSURANCE",
        "IR_RUBRIQUE_IR_PRELEVE",
    ]
    manquants = [k for k in required if not mapping.get(k)]
    if manquants:
        raise ValueError(
            f"Composition rubrique IR incomplète pour : {manquants}. "
            "Renseigner au moins une rubrique par agrégat à l'étape 1 du Paramétrage."
        )
    return mapping


def get_parametres_ir(db: Session) -> dict[str, str]:
    """Charge les constantes générales réutilisées telles quelles :
    NET_IMPOSABLE_RUBRIQUE (déjà en place, ex. 'REV_NET_IMP' — rubrique
    où le moteur de paie calcule déjà le revenu net imposable mensuel,
    Article 74 CGI) et MAX_DEDUCTION (plafond légal du nombre de
    déductions, déjà en place). Le mapping des 5 rubriques IR_RUBRIQUE_*
    est désormais dans `ir_parametrage_rubriques` (cf.
    get_rubrique_mappings_ir), plus dans ref_constante_paie."""
    rows = db.execute(
        text(
            "SELECT code, valeur FROM ref_constante_paie "
            "WHERE code IN ('NET_IMPOSABLE_RUBRIQUE', 'MAX_DEDUCTION') "
            "AND actif = true"
        )
    ).fetchall()
    params = {r.code: r.valeur for r in rows}

    if "NET_IMPOSABLE_RUBRIQUE" not in params:
        raise ValueError(
            "Constante NET_IMPOSABLE_RUBRIQUE manquante ou inactive dans "
            "ref_constante_paie."
        )
    return params


def get_societe_info(db: Session, societe_id: str) -> dict[str, Any]:
    # RG-MULTISOCIETE-07 (migration 057) : même bug que CNSS -- l'ancienne
    # version faisait `LIMIT 1` (toujours la première société de la table,
    # indépendamment de la société active). societe_id désormais obligatoire.
    # Migration 058 (ir_declarations.societe_id) a depuis complété le
    # cloisonnement : voir alimenter_declaration_ir/generer_xml_declaration_ir.
    row = db.execute(
        text(
            "SELECT raison_sociale, identifiant_fiscal, adresse "
            "FROM societes WHERE id = :sid"
        ),
        {"sid": societe_id},
    ).fetchone()
    if not row:
        raise ValueError("Société active introuvable dans la table `societes`.")
    return {
        "raison_sociale": row.raison_sociale,
        "identifiant_fiscal": row.identifiant_fiscal,
        "adresse": row.adresse,
    }


# ------------------------------------------------------------------
# Classification PERMANENT / OCCASIONNEL / STAGIAIRE_ANAPEC
# ------------------------------------------------------------------

def _type_personnel_pour_collaborateur(db: Session, collaborateur_id: UUID, annee: int) -> str | None:
    """
    Détermine la catégorie DTS/9421 du collaborateur à partir du type de
    contrat actif sur l'exercice (priorité au contrat couvrant le plus
    de jours sur l'année en cas de changement de contrat en cours
    d'exercice).
    """
    row = db.execute(
        text(
            """
            SELECT rtc.code_categorie_dts_ir
            FROM collaborateur_contrats c
            JOIN ref_type_contrat rtc ON rtc.code = c.code_type_contrat
            WHERE c.collaborateur_id = :collaborateur_id
              AND c.date_debut <= make_date(:annee, 12, 31)
              AND (c.date_fin IS NULL OR c.date_fin >= make_date(:annee, 1, 1))
            ORDER BY
                LEAST(c.date_fin, make_date(:annee, 12, 31))
                - GREATEST(c.date_debut, make_date(:annee, 1, 1)) DESC NULLS FIRST
            LIMIT 1
            """
        ),
        {"collaborateur_id": str(collaborateur_id), "annee": annee},
    ).fetchone()
    return row.code_categorie_dts_ir if row else None


# ------------------------------------------------------------------
# Alimentation automatique
# ------------------------------------------------------------------

def alimenter_declaration_ir(db: Session, annee: int, created_by: UUID, societe_id: str) -> dict[str, Any]:
    """
    Recalcule intégralement les lignes de la déclaration IR pour l'année
    donnée à partir des bulletins réels (Option A, même principe que la
    CNSS). Stratégie table-rase : les lignes précédentes de la
    déclaration sont supprimées puis réinsérées.

    RG-MULTISOCIETE-07 (migration 058) : `societe_id` obligatoire --
    périodes ET collaborateurs filtrés à cette société, déclaration
    recherchée/créée par (annee, societe_id) et non plus (annee) seule.
    """
    params = get_parametres_ir(db)
    rubriques = get_rubrique_mappings_ir(db)
    rub_net_imposable = params["NET_IMPOSABLE_RUBRIQUE"]
    max_deduction = int(float(params.get("MAX_DEDUCTION", 6)))

    def _valeur(lb, attribut: str) -> float:
        val = getattr(lb, attribut, None)
        return float(val) if val is not None else 0.0

    # Index inversé : code_rubrique_paie -> liste de contributions
    # (une même rubrique peut alimenter plusieurs constantes)
    index_contributions: dict[str, list[tuple[str, str, str]]] = {}
    for code_constante, compo_lignes in rubriques.items():
        for cl in compo_lignes:
            index_contributions.setdefault(cl["code_rubrique_paie"], []).append(
                (code_constante, cl["attribut"], cl["signe"])
            )

    # Périodes de l'exercice, bornées à la société active (migration 058).
    # ⚠️ `calendrier_paie` peut contenir plusieurs lignes pour un même
    # mois (une par plan_paie / population de paie) — confirmé le 20/08
    # (nb de requêtes bulletin générées largement supérieur à 12 pour un
    # seul collaborateur). On regroupe donc par mois pour obtenir le
    # vrai nombre de mois calendaires (12), et on essaie chaque
    # periode_id candidate du mois jusqu'à trouver un bulletin —
    # le collaborateur n'appartient qu'à un seul plan, donc une seule
    # candidate matchera réellement par mois.
    periodes = db.execute(
        text(
            "SELECT id, mois FROM calendrier_paie WHERE annee = :annee AND societe_id = :sid ORDER BY mois"
        ),
        {"annee": annee, "sid": societe_id},
    ).fetchall()
    periode_ids_par_mois: dict[int, list] = {}
    for p in periodes:
        periode_ids_par_mois.setdefault(p.mois, []).append(p.id)
    nb_periodes_annee = len(periode_ids_par_mois)  # nombre de mois distincts
    periode_ids = [p.id for p in periodes]  # liste à plat, pour la requête collaborateurs

    if not periode_ids:
        raise ValueError(f"Aucune période trouvée dans calendrier_paie pour l'année {annee} (société active).")

    # Collaborateurs ayant au moins un bulletin sur l'exercice, bornés à la
    # société active (migration 058 : le filtre periode_ids ci-dessus suffit
    # déjà en théorie puisque les périodes sont société-scopées, mais le
    # filtre explicite via collaborateur_contrats reste une défense en
    # profondeur cohérente avec le reste du cloisonnement).
    # ⚠️ `collaborateurs` n'a pas de colonne `adresse` (confirmé en
    # erreur le 20/08) — l'adresse est probablement dans une table
    # séparée (`collaborateur_adresses`, visible dans main.py). Non
    # récupérée ici pour l'instant ; le champ XML `<adresse>` sera vide
    # tant que le join réel n'est pas branché.
    collaborateurs = db.execute(
        text(
            """
            SELECT DISTINCT col.id, col.nom, col.prenom,
                   col.cin, col.num_cnss
            FROM collaborateurs col
            JOIN bulletin b ON b.collaborateur_id = col.id
            WHERE b.periode_id = ANY(:periode_ids)
              AND b.statut IN ('CLOTURE', 'VALIDE', 'CALCULE')
              AND EXISTS (
                  SELECT 1 FROM collaborateur_contrats cc
                   WHERE cc.collaborateur_id = col.id AND cc.societe_id = :sid AND cc.archive = false
              )
            """
        ),
        {"periode_ids": periode_ids, "sid": societe_id},
    ).fetchall()

    lignes: list[dict[str, Any]] = []
    elements_exoneres_totaux: dict[str, float] = {}
    avertissements: list[str] = []
    bulletins_par_plan: dict[str, int] = {}

    for col in collaborateurs:
        cumuls = {
            "IR_RUBRIQUE_SALAIRE_BRUT": 0.0,
            "IR_RUBRIQUE_BRUT_IMPOSABLE": 0.0,
            "IR_RUBRIQUE_FRAIS_PRO": 0.0,
            "IR_RUBRIQUE_COTISATION_ASSURANCE": 0.0,
            "IR_RUBRIQUE_IR_PRELEVE": 0.0,
        }
        cumul_exoneres = 0.0
        cumul_net_imposable = 0.0
        nb_mois_avec_bulletin = 0
        # ⚠️ nombre de déductions (charges de famille) — colonne
        # `bulletin.nombre_deductions_ir` invalidée (confirmée absente
        # le 20/08). Neutralisé à 0 en attendant la vraie source
        # (probablement côté `collaborateurs` : situation familiale /
        # nombre d'enfants à charge, plutôt que sur le bulletin).
        deductions = None

        for mois, candidats_periode_ids in sorted(periode_ids_par_mois.items()):
            bulletin = None
            for periode_id in candidats_periode_ids:
                bulletin = db.execute(
                    text(
                        """
                        SELECT id, code_plan FROM bulletin
                        WHERE collaborateur_id = :collaborateur_id
                          AND periode_id = :periode_id
                        ORDER BY
                            CASE statut WHEN 'CLOTURE' THEN 1 WHEN 'VALIDE' THEN 2 WHEN 'CALCULE' THEN 3 ELSE 4 END
                        LIMIT 1
                        """
                    ),
                    {"collaborateur_id": str(col.id), "periode_id": periode_id},
                ).fetchone()
                if bulletin:
                    break  # trouvé le bulletin du bon plan pour ce mois

            if not bulletin:
                continue

            nb_mois_avec_bulletin += 1
            code_plan = getattr(bulletin, "code_plan", None) or "(plan non renseigné)"
            bulletins_par_plan[code_plan] = bulletins_par_plan.get(code_plan, 0) + 1

            lignes_bulletin = db.execute(
                text(
                    "SELECT code_rubrique, montant, nombre, taux FROM bulletin_ligne "
                    "WHERE bulletin_id = :bulletin_id"
                ),
                {"bulletin_id": bulletin.id},
            ).fetchall()

            for lb in lignes_bulletin:
                for code_constante, attribut, signe in index_contributions.get(lb.code_rubrique, []):
                    v = _valeur(lb, attribut)
                    cumuls[code_constante] += v if signe == "+" else -v

                if lb.code_rubrique == rub_net_imposable:
                    cumul_net_imposable += _valeur(lb, "montant")

                # Éléments exonérés — détail par code DGI via mapping rubrique
                mapping = db.execute(
                    text(
                        "SELECT code_dgi, signe FROM ir_mapping_rubrique_exoneration "
                        "WHERE code_rubrique_paie = :code AND actif = true"
                    ),
                    {"code": lb.code_rubrique},
                ).fetchone()
                if mapping:
                    v_exonere = _valeur(lb, "montant")
                    v_exonere = v_exonere if mapping.signe == "+" else -v_exonere
                    elements_exoneres_totaux[mapping.code_dgi] = (
                        elements_exoneres_totaux.get(mapping.code_dgi, 0.0) + v_exonere
                    )

        if nb_mois_avec_bulletin == 0:
            continue  # collaborateur sans aucun bulletin sur l'exercice -> exclu

        nb_mois_manquants = nb_periodes_annee - nb_mois_avec_bulletin
        if nb_mois_manquants > 0:
            avertissements.append(
                f"{col.nom} {col.prenom} : {nb_mois_manquants} mois sans bulletin trouvé sur {annee}."
            )

        type_personnel = _type_personnel_pour_collaborateur(db, col.id, annee)
        if not type_personnel:
            avertissements.append(
                f"{col.nom} {col.prenom} : type de contrat non mappé vers une catégorie "
                "DTS/9421 (ref_type_contrat.code_categorie_dts_ir manquant) — collaborateur "
                "exclu de la génération XML tant que non corrigé."
            )

        nombre_deductions = deductions or 0
        if nombre_deductions > max_deduction:
            avertissements.append(
                f"{col.nom} {col.prenom} : nombre de déductions ({nombre_deductions}) "
                f"supérieur au plafond légal MAX_DEDUCTION ({max_deduction}) — à vérifier."
            )

        # Brut imposable lu directement depuis la composition
        # IR_RUBRIQUE_BRUT_IMPOSABLE (déjà calculée par le moteur de
        # paie), plutôt que recalculé.
        salaire_brut = cumuls["IR_RUBRIQUE_SALAIRE_BRUT"]
        salaire_brut_imposable = cumuls["IR_RUBRIQUE_BRUT_IMPOSABLE"]
        cumul_frais_pro = cumuls["IR_RUBRIQUE_FRAIS_PRO"]
        cumul_cotis = cumuls["IR_RUBRIQUE_COTISATION_ASSURANCE"]
        cumul_ir = cumuls["IR_RUBRIQUE_IR_PRELEVE"]
        # Total des éléments exonérés déduit par différence (fiable, ne
        # dépend pas d'un mapping exhaustif) ; le détail par code DGI
        # (bloc justificatif) reste, lui, basé sur ir_mapping_rubrique_exoneration.
        cumul_exoneres = max(0.0, salaire_brut - salaire_brut_imposable)

        # Revenu net imposable NON recalculé ici : cumul de la rubrique
        # NET_IMPOSABLE_RUBRIQUE (REV_NET_IMP), déjà produite mensuellement
        # par le moteur de paie (Article 74 CGI). Repli sur un calcul
        # simplifié uniquement si la rubrique est absente du bulletin
        # (alerte associée).
        if cumul_net_imposable > 0:
            revenu_net_imposable = cumul_net_imposable
        else:
            revenu_net_imposable = max(0.0, salaire_brut_imposable - cumul_frais_pro - cumul_cotis)
            avertissements.append(
                f"{col.nom} {col.prenom} : rubrique {rub_net_imposable} absente des bulletins — "
                "revenu net imposable recalculé par repli (brut imposable − frais pro − "
                "cotisations), à vérifier."
            )

        lignes.append(
            {
                "collaborateur_id": col.id,
                "type_personnel": type_personnel,
                "nom": col.nom,
                "prenom": col.prenom,
                "adresse": None,  # ⚠️ non récupérée — voir note ci-dessus
                "cin": col.cin,
                "cnss": col.num_cnss,
                "nb_mois_travailles": nb_mois_avec_bulletin,
                "salaire_brut": round(salaire_brut, 2),
                "elements_exoneres": round(cumul_exoneres, 2),
                "salaire_brut_imposable": round(salaire_brut_imposable, 2),
                "frais_professionnels": round(cumul_frais_pro, 2),
                "cotisation_assurance": round(cumul_cotis, 2),
                "revenu_net_imposable": round(revenu_net_imposable, 2),
                "ir_preleve": round(cumul_ir, 2),
                "nombre_deductions": nombre_deductions,
                "nb_mois_bulletin_manquant": nb_mois_manquants,
            }
        )

    # ---- Persistance table-rase ----
    declaration = db.execute(
        text("SELECT id FROM ir_declarations WHERE annee = :annee AND societe_id = :sid"),
        {"annee": annee, "sid": societe_id},
    ).fetchone()

    if declaration:
        declaration_id = declaration.id
        db.execute(
            text("DELETE FROM ir_declaration_lignes WHERE declaration_id = :id"),
            {"id": declaration_id},
        )
        db.execute(
            text("DELETE FROM ir_declaration_elements_exoneres WHERE declaration_id = :id"),
            {"id": declaration_id},
        )
        db.execute(
            text(
                """
                UPDATE ir_declarations
                SET nombre_total_salaries = :n, montant_total_ir = :total_ir,
                    updated_at = now()
                WHERE id = :id
                """
            ),
            {
                "id": declaration_id,
                "n": len(lignes),
                "total_ir": sum(l["ir_preleve"] for l in lignes),
            },
        )
    else:
        result = db.execute(
            text(
                """
                INSERT INTO ir_declarations
                    (annee, nombre_total_salaries, montant_total_ir, created_by, societe_id)
                VALUES (:annee, :n, :total_ir, :created_by, :societe_id)
                RETURNING id
                """
            ),
            {
                "annee": annee,
                "n": len(lignes),
                "total_ir": sum(l["ir_preleve"] for l in lignes),
                "created_by": str(created_by),
                "societe_id": societe_id,
            },
        )
        declaration_id = result.fetchone().id

    for ligne in lignes:
        db.execute(
            text(
                """
                INSERT INTO ir_declaration_lignes
                    (declaration_id, collaborateur_id, type_personnel, nom, prenom,
                     adresse, cin, cnss, nb_mois_travailles, salaire_brut,
                     elements_exoneres, salaire_brut_imposable, frais_professionnels,
                     cotisation_assurance, revenu_net_imposable, ir_preleve,
                     nombre_deductions, nb_mois_bulletin_manquant)
                VALUES
                    (:declaration_id, :collaborateur_id, :type_personnel, :nom, :prenom,
                     :adresse, :cin, :cnss, :nb_mois_travailles, :salaire_brut,
                     :elements_exoneres, :salaire_brut_imposable, :frais_professionnels,
                     :cotisation_assurance, :revenu_net_imposable, :ir_preleve,
                     :nombre_deductions, :nb_mois_bulletin_manquant)
                """
            ),
            {**ligne, "declaration_id": declaration_id},
        )

    for code_dgi, montant in elements_exoneres_totaux.items():
        db.execute(
            text(
                """
                INSERT INTO ir_declaration_elements_exoneres (declaration_id, code_dgi, montant)
                VALUES (:declaration_id, :code_dgi, :montant)
                """
            ),
            {"declaration_id": declaration_id, "code_dgi": code_dgi, "montant": round(montant, 2)},
        )

    db.commit()

    return {
        "declaration_id": declaration_id,
        "nombre_lignes": len(lignes),
        "avertissements": avertissements,
        "bulletins_par_plan": bulletins_par_plan,
    }


# ------------------------------------------------------------------
# Contrôle — KPIs
# ------------------------------------------------------------------

def calculer_kpis_ir(db: Session, declaration_id: UUID) -> dict[str, Any]:
    lignes = db.execute(
        text("SELECT * FROM ir_declaration_lignes WHERE declaration_id = :id"),
        {"id": declaration_id},
    ).fetchall()

    total = len(lignes)
    sans_cin = sum(1 for l in lignes if not l.cin)
    sans_cnss = sum(1 for l in lignes if not l.cnss)
    sans_categorie = sum(1 for l in lignes if not l.type_personnel)
    mois_manquants = sum(1 for l in lignes if l.nb_mois_bulletin_manquant > 0)

    return {
        "total_lignes": total,
        "sans_cin": sans_cin,
        "sans_cnss": sans_cnss,
        "sans_categorie_dts": sans_categorie,
        "lignes_avec_mois_manquants": mois_manquants,
        "total_salaire_brut": sum(float(l.salaire_brut) for l in lignes),
        "total_brut_imposable": sum(float(l.salaire_brut_imposable) for l in lignes),
        "total_ir_preleve": sum(float(l.ir_preleve) for l in lignes),
        "total_cotisation_assurance": sum(float(l.cotisation_assurance) for l in lignes),
        "bloquant": sans_cin > 0 or sans_cnss > 0 or sans_categorie > 0,
    }


# ------------------------------------------------------------------
# Génération XML (structure DTS/État 9421 confirmée)
# ------------------------------------------------------------------

def generer_xml_declaration_ir(db: Session, annee: int, societe_id: str) -> bytes:
    declaration = db.execute(
        text("SELECT * FROM ir_declarations WHERE annee = :annee AND societe_id = :sid"),
        {"annee": annee, "sid": societe_id},
    ).fetchone()
    if not declaration:
        raise ValueError(f"Aucune déclaration IR trouvée pour l'année {annee}.")

    lignes = db.execute(
        text(
            "SELECT * FROM ir_declaration_lignes WHERE declaration_id = :id ORDER BY nom, prenom"
        ),
        {"id": declaration.id},
    ).fetchall()

    lignes_bloquantes = [
        l for l in lignes if not l.type_personnel or not l.cin or not l.cnss
    ]
    if lignes_bloquantes:
        noms = ", ".join(f"{l.nom} {l.prenom}" for l in lignes_bloquantes[:5])
        raise ValueError(
            f"{len(lignes_bloquantes)} collaborateur(s) bloquant(s) (CIN, CNSS ou "
            f"catégorie DTS/9421 manquants), ex. : {noms}. Corriger avant génération."
        )

    elements_exoneres = db.execute(
        text(
            "SELECT code_dgi, montant FROM ir_declaration_elements_exoneres WHERE declaration_id = :id"
        ),
        {"id": declaration.id},
    ).fetchall()

    societe = get_societe_info(db, societe_id)

    root = ET.Element(
        "DeclarationTraitementsSalaires",
        attrib={"xmlns:xsi": "http://w3.org"},
    )
    ET.SubElement(root, "identifiantFiscal").text = str(societe["identifiant_fiscal"] or "")
    ET.SubElement(root, "annee").text = str(annee)
    ET.SubElement(root, "periode").text = str(declaration.code_periode_declaration)
    ET.SubElement(root, "regime").text = str(declaration.code_regime)

    list_permanent = ET.SubElement(root, "listPersonnelPermanent")
    list_occasionnel = ET.SubElement(root, "listPersonnelOccasionnel")
    list_stagiaires = ET.SubElement(root, "listStagiaires")

    liste_par_type = {
        "PERMANENT": (list_permanent, "PersonnelPermanent"),
        "OCCASIONNEL": (list_occasionnel, "PersonnelOccasionnel"),
        "STAGIAIRE_ANAPEC": (list_stagiaires, "Stagiaire"),
    }

    for l in lignes:
        parent, tag = liste_par_type.get(l.type_personnel, (list_permanent, "PersonnelPermanent"))
        node = ET.SubElement(parent, tag)
        ET.SubElement(node, "nom").text = l.nom or ""
        ET.SubElement(node, "prenom").text = l.prenom or ""
        ET.SubElement(node, "adresse").text = l.adresse or ""
        ET.SubElement(node, "cin").text = l.cin or ""
        ET.SubElement(node, "cnss").text = l.cnss or ""
        ET.SubElement(node, "periode").text = str(l.nb_mois_travailles)
        ET.SubElement(node, "salaireBrut").text = f"{float(l.salaire_brut):.2f}"
        ET.SubElement(node, "elementsExoneres").text = f"{float(l.elements_exoneres):.2f}"
        ET.SubElement(node, "salaireBrutImposable").text = f"{float(l.salaire_brut_imposable):.2f}"
        ET.SubElement(node, "fraisProfessionnels").text = f"{float(l.frais_professionnels):.2f}"
        ET.SubElement(node, "cotisationAssurance").text = f"{float(l.cotisation_assurance):.2f}"
        ET.SubElement(node, "revenuNetImposable").text = f"{float(l.revenu_net_imposable):.2f}"
        ET.SubElement(node, "irPreleve").text = f"{float(l.ir_preleve):.2f}"
        ET.SubElement(node, "nombreDeductions").text = str(l.nombre_deductions)

    list_exoneres = ET.SubElement(root, "listElementsExoneres")
    for e in elements_exoneres:
        node = ET.SubElement(list_exoneres, "ElementExonere")
        ET.SubElement(node, "code").text = e.code_dgi
        ET.SubElement(node, "montant").text = f"{float(e.montant):.2f}"

    ET.SubElement(root, "montantTotalIr").text = f"{float(declaration.montant_total_ir):.2f}"
    ET.SubElement(root, "nombreTotalSalaries").text = str(declaration.nombre_total_salaries)

    rough_xml = ET.tostring(root, encoding="utf-8")
    pretty_xml = minidom.parseString(rough_xml).toprettyxml(indent="    ", encoding="UTF-8")

    # Mémoriser le chemin/état après génération réussie
    db.execute(
        text(
            "UPDATE ir_declarations SET fichier_xml_path = :path, statut = 'CONTROLEE', "
            "updated_at = now() WHERE id = :id"
        ),
        {
            "id": declaration.id,
            "path": f"ir_9421_{annee}.xml",
        },
    )
    db.commit()

    return pretty_xml


# ------------------------------------------------------------------
# Paramétrage — lecture/écriture interactive depuis l'écran
# ------------------------------------------------------------------

def get_parametrage_ir(db: Session) -> dict[str, Any]:
    """Regroupe tout ce qu'il faut pour l'écran Paramétrage : pour
    chaque agrégat IR_RUBRIQUE_*, sa liste de rubriques composantes
    (rubrique + attribut montant/nombre/taux + signe +/-), les
    rubriques de paie disponibles (pour les listes déroulantes), les
    types de contrat avec leur catégorie DTS/9421 actuelle, les
    catégories disponibles, et le mapping rubrique -> code DGI
    d'exonération."""
    definitions = db.execute(
        text("SELECT code_constante, libelle FROM ir_constante_agregat ORDER BY ordre")
    ).fetchall()

    lignes_composition = db.execute(
        text(
            """
            SELECT l.code_constante, l.code_rubrique_paie, rp.libelle AS libelle_rubrique_paie,
                   l.attribut, l.signe
            FROM ir_parametrage_rubrique_lignes l
            JOIN rubrique_paie rp ON rp.code = l.code_rubrique_paie
            ORDER BY l.code_constante, l.ordre
            """
        )
    ).fetchall()
    lignes_par_constante: dict[str, list[dict[str, Any]]] = {}
    for l in lignes_composition:
        lignes_par_constante.setdefault(l.code_constante, []).append(
            {
                "code_rubrique_paie": l.code_rubrique_paie,
                "libelle_rubrique_paie": l.libelle_rubrique_paie,
                "attribut": l.attribut,
                "signe": l.signe,
            }
        )

    constantes = [
        {
            "code_constante": d.code_constante,
            "libelle": d.libelle,
            "lignes": lignes_par_constante.get(d.code_constante, []),
        }
        for d in definitions
    ]

    rubriques_disponibles = db.execute(
        text("SELECT code, libelle FROM rubrique_paie ORDER BY libelle")
    ).fetchall()

    # NB : le mapping type de contrat -> catégorie DTS/9421 n'est plus
    # géré ici. Il se fait désormais directement sur l'écran
    # Référentiels (ref_type_contrat.code_categorie_dts_ir), pour
    # éviter la duplication d'un même paramétrage à deux endroits.
    # `_type_personnel_pour_collaborateur` continue de le lire tel quel
    # pendant l'alimentation.

    mappings_exoneration = db.execute(
        text(
            """
            SELECT m.code_rubrique_paie, rp.libelle AS libelle_rubrique,
                   m.code_dgi, c.libelle AS libelle_dgi, m.signe
            FROM ir_mapping_rubrique_exoneration m
            JOIN rubrique_paie rp ON rp.code = m.code_rubrique_paie
            JOIN ref_code_exoneration_ir c ON c.code = m.code_dgi
            WHERE m.actif = true
            ORDER BY rp.libelle
            """
        )
    ).fetchall()

    codes_dgi = db.execute(
        text(
            "SELECT code, libelle FROM ref_code_exoneration_ir WHERE actif = true ORDER BY ordre"
        )
    ).fetchall()

    return {
        "constantes": constantes,
        "rubriques_disponibles": [dict(r._mapping) for r in rubriques_disponibles],
        "mappings_exoneration": [dict(r._mapping) for r in mappings_exoneration],
        "codes_dgi": [dict(r._mapping) for r in codes_dgi],
    }


def upsert_rubrique_ligne_ir(
    db: Session, code_constante: str, code_rubrique_paie: str, attribut: str, signe: str
) -> None:
    if attribut not in ("montant", "nombre", "taux"):
        raise ValueError(f"Attribut invalide : {attribut} (attendu montant/nombre/taux).")
    if signe not in ("+", "-"):
        raise ValueError(f"Signe invalide : {signe} (attendu + ou -).")
    db.execute(
        text(
            """
            INSERT INTO ir_parametrage_rubrique_lignes
                (code_constante, code_rubrique_paie, attribut, signe)
            VALUES (:code_constante, :code_rubrique_paie, :attribut, :signe)
            ON CONFLICT (code_constante, code_rubrique_paie)
            DO UPDATE SET attribut = EXCLUDED.attribut, signe = EXCLUDED.signe
            """
        ),
        {
            "code_constante": code_constante,
            "code_rubrique_paie": code_rubrique_paie,
            "attribut": attribut,
            "signe": signe,
        },
    )
    db.commit()


def delete_rubrique_ligne_ir(db: Session, code_constante: str, code_rubrique_paie: str) -> None:
    db.execute(
        text(
            "DELETE FROM ir_parametrage_rubrique_lignes "
            "WHERE code_constante = :code_constante AND code_rubrique_paie = :code_rubrique_paie"
        ),
        {"code_constante": code_constante, "code_rubrique_paie": code_rubrique_paie},
    )
    db.commit()


def upsert_mapping_exoneration(db: Session, code_rubrique_paie: str, code_dgi: str, signe: str = "+") -> None:
    if signe not in ("+", "-"):
        raise ValueError(f"Signe invalide : {signe} (attendu + ou -).")
    db.execute(
        text(
            """
            INSERT INTO ir_mapping_rubrique_exoneration (code_rubrique_paie, code_dgi, signe, actif)
            VALUES (:code_rubrique_paie, :code_dgi, :signe, true)
            ON CONFLICT (code_rubrique_paie)
            DO UPDATE SET code_dgi = EXCLUDED.code_dgi, signe = EXCLUDED.signe, actif = true
            """
        ),
        {"code_rubrique_paie": code_rubrique_paie, "code_dgi": code_dgi, "signe": signe},
    )
    db.commit()


def delete_mapping_exoneration(db: Session, code_rubrique_paie: str) -> None:
    db.execute(
        text("DELETE FROM ir_mapping_rubrique_exoneration WHERE code_rubrique_paie = :code"),
        {"code": code_rubrique_paie},
    )
    db.commit()


# ------------------------------------------------------------------
# Archivage automatique (délai légal : 1er mars N+1, cf. IR_DEADLINE_*)
# ------------------------------------------------------------------

def archiver_declarations_ir_echues(db: Session) -> int:
    params = get_parametres_ir(db)
    mois_limite = int(params.get("IR_DEADLINE_MOIS", 3))
    jour_limite = int(params.get("IR_DEADLINE_JOUR", 1))

    result = db.execute(
        text(
            """
            UPDATE ir_declarations
            SET statut = 'ARCHIVEE', updated_at = now()
            WHERE statut != 'ARCHIVEE'
              AND make_date(annee + 1, :mois, :jour) < now()::date
            """
        ),
        {"mois": mois_limite, "jour": jour_limite},
    )
    db.commit()
    return result.rowcount
