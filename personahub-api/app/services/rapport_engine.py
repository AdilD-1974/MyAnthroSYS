"""
Moteur de rapports de paie — Phase 1.

Deux responsabilités strictement séparées :

1. `capturer_snapshot_collaborateur()` — à appeler DEPUIS `paie_engine.py`,
   juste après la persistance d'un bulletin (`persister=True`), qu'il
   s'agisse d'un premier calcul ou d'un recalcul. C'est le SEUL point
   d'écriture de `bulletin_snapshot_collaborateur`.

2. `construire_journal()` / `exporter_journal_excel()` — lecture SEULE du
   snapshot (jamais de jointure live vers collaborateurs/affectations/
   collaborateur_contrats) pour produire le Journal de paie.

Schéma confirmé par introspection réelle (voir DEPLOIEMENT_RAPPORTS_PAIE.md
pour l'historique des vérifications) :
  - `collaborateur_affectations` est la SOURCE UNIQUE pour organisation ET
    poste (confirmé par inspection réseau de l'écran RH réel). La table
    `affectations` (sans préfixe) existe dans le schéma mais n'est jamais
    utilisée par cet écran — piège à ne pas reproduire.
  - Hiérarchie poste -> emploi -> métier : collaborateur_affectations.
    code_poste -> ref_poste_instances.code_instance ->
    ref_poste_instances.code_poste -> ref_poste.code -> ref_poste.
    code_emploi -> ref_emploi.code -> ref_emploi.code_metier ->
    ref_metier.code.
  - Pas de RIB/coordonnées bancaires dans `collaborateurs` (la table
    porteuse est `collaborateur_paiements`, déjà lue ci-dessous).
  - RG-ETAT-PERIODE (26/08/2026, MODULE_ETATS_PAIE.md §14) : la
    classification/qualification RÉELLE du collaborateur, portée par
    `collaborateur_qualifications` (historisée via `date_evolution`),
    n'était pas captée — seule la classification REQUISE par le poste
    (`ref_poste.code_classification`) l'était, sous la clé
    `affectation`. Les deux notions sont désormais distinctes dans le
    snapshot : `affectation.code_classification` reste la classification
    requise par le poste ; `qualification.*` porte la qualification
    réelle du collaborateur à la date de référence.
  - `situation_familiale.code` (confirmé référencer `ref_situation_familiale
    .code`, table déjà utilisée par FicheCollaborateur.tsx) est désormais
    accompagné de `situation_familiale.libelle` (LEFT JOIN au moment de la
    capture). `contrat.code_type_contrat`/`code_statut_contrat` restent
    bruts : leurs valeurs ("CDI", "ACTIF"…) sont déjà lisibles telles
    quelles, aucune table de référence identifiée à ce jour pour elles.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.rapport_paie import (
    JournalApercuResponse,
    JournalColonne,
    JournalLigne,
    PerimetreAnnee,
    PerimetreCollaborateur,
    PerimetrePeriodePlan,
    RapportJournalConfig,
)


# =============================================================================
# 1. Snapshot — écriture au calcul (appelé depuis paie_engine.py)
# =============================================================================

def capturer_snapshot_collaborateur(
    session: Session, collaborateur_id: UUID, bulletin_id: UUID, date_reference: str, recalcul: bool = False
) -> None:
    """
    Fige les données collaborateur au moment du calcul dans
    `bulletin_snapshot_collaborateur`. Upsert : un recalcul écrase le
    snapshot précédent du même bulletin (il ne s'accumule pas).

    `date_reference` = date de la période calculée, pour lire les tables
    RH à la bonne date (affectation/contrat actifs à cette date, comme le
    fait déjà le moteur pour les alimentations TABLE — cf. §2.4
    MODULE_PAIE.md).

    Colonnes confirmées par introspection réelle (information_schema +
    inspection réseau de l'écran RH « Affectation & Classification ») :
      - collaborateurs : matricule, civilite, nom, prenom, date_naissance,
        cin, code_situation_familiale, nb_enfants_a_charge,
        nb_personnes_a_charge, nb_deductions_fiscales. Pas de RIB/coordonnées
        bancaires dans ce SIRH — champ volontairement absent du snapshot.
      - collaborateur_affectations : SOURCE UNIQUE pour organisation ET
        poste (unite_id, code_poste, dates dédiées date_debut_uo/
        date_fin_uo et date_debut_poste/date_fin_poste, archive). La table
        `affectations` (sans préfixe) existe dans le schéma mais n'est
        JAMAIS utilisée par l'écran RH réel — ne pas s'y fier.
      - collaborateur_contrats : code_type_contrat, code_statut_contrat,
        code_temps, date_debut, archive (booléen).
      - collaborateur_qualifications : historisée via `date_evolution`
        (pas de date_fin — le dernier enregistrement dont
        date_evolution <= date_reference fait foi, même logique que le
        contrat/affectation). Libellés résolus via `ref_classification`
        et `ref_qualification` (seules tables de référence confirmées à
        ce jour pour ce bloc — les autres codes, ex. code_grade,
        code_echelle, code_fonction, sont conservés bruts tant que leurs
        tables de référence éventuelles n'ont pas été vérifiées).
    """
    # LEFT JOIN ref_situation_familiale (code, libelle) : table confirmée
    # via FicheCollaborateur.tsx (`.from("ref_situation_familiale").select
    # ("code, libelle")`). LEFT JOIN plutôt que JOIN : un code manquant ou
    # orphelin ne doit jamais faire échouer la capture du snapshot — le
    # libellé retombe simplement à NULL, comme le code lui-même peut déjà
    # l'être.
    collab = session.execute(
        text(
            """
            SELECT c.matricule, c.civilite, c.nom, c.prenom, c.date_naissance, c.cin,
                   c.num_cnss, c.num_amo,
                   c.code_situation_familiale, c.nb_enfants_a_charge,
                   c.nb_personnes_a_charge, c.nb_deductions_fiscales,
                   sf.libelle AS situation_familiale_libelle
            FROM public.collaborateurs c
            LEFT JOIN public.ref_situation_familiale sf ON sf.code = c.code_situation_familiale
            WHERE c.id = :cid
            """
        ),
        {"cid": str(collaborateur_id)},
    ).mappings().first()
    if collab is None:
        raise ValueError(f"Collaborateur {collaborateur_id} introuvable pour la capture du snapshot")

    # ⚠️ CORRECTIF MAJEUR confirmé par inspection réseau (DevTools) de
    # l'écran RH réel « Affectation & Classification » : le rattachement
    # organisation + poste d'un collaborateur passe par UNE SEULE table,
    # `collaborateur_affectations` — pas par `affectations` (jamais utilisée
    # par cet écran) ni par une jointure séparée vers `ref_poste_instances`.
    #
    # Colonnes confirmées : id, collaborateur_id, unite_id,
    # date_debut_uo, date_fin_uo, code_poste, date_debut_poste,
    # date_fin_poste, motif_affectation, commentaire, archive,
    # responsable_id, forcage_manager, manager_n1_id, manager_n2_id.
    #
    # `code_poste` ici (ex. "DIRG0001-001") correspond au format
    # `ref_poste_instances.code_instance` (code de poste + suffixe
    # d'instance), PAS directement à `ref_poste.code` — confirmé par un cas
    # réel (Directeur Général, poste "DIRG0001", instance "DIRG0001-001").
    #
    # Hiérarchie complète : collaborateur_affectations.code_poste ->
    # ref_poste_instances.code_instance -> ref_poste_instances.code_poste ->
    # ref_poste.code -> ref_poste.code_emploi -> ref_emploi.code ->
    # ref_emploi.code_metier -> ref_metier.code.
    affectation_row = session.execute(
        text(
            """
            SELECT ca.unite_id AS organisation_id, o.libelle AS organisation_libelle,
                   ca.code_poste AS poste_instance_code, rpi.id AS poste_instance_id,
                   rp.code AS poste_reference_code, rp.libelle AS poste_reference_libelle,
                   rp.code_classification, rp.qualifications_requises,
                   re.code AS emploi_code, re.libelle AS emploi_libelle,
                   rm.code AS metier_code, rm.libelle AS metier_libelle, rm.code_famille AS metier_famille
            FROM public.collaborateur_affectations ca
            LEFT JOIN public.unites_organisationnelles o ON o.id = ca.unite_id
            LEFT JOIN public.ref_poste_instances rpi ON rpi.code_instance = ca.code_poste
            LEFT JOIN public.ref_poste rp ON rp.code = rpi.code_poste
            LEFT JOIN public.ref_emploi re ON re.code = rp.code_emploi
            LEFT JOIN public.ref_metier rm ON rm.code = re.code_metier
            WHERE ca.collaborateur_id = :cid AND ca.archive = false
              AND ca.date_debut_uo <= :date_ref
              AND (ca.date_fin_uo IS NULL OR ca.date_fin_uo >= :date_ref)
            ORDER BY ca.date_debut_uo DESC LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id), "date_ref": date_reference},
    ).mappings().first() or {}

    contrat = session.execute(
        text(
            """
            SELECT code_type_contrat, code_statut_contrat, code_temps, date_debut AS date_embauche
            FROM public.collaborateur_contrats
            WHERE collaborateur_id = :cid AND archive = false
              AND date_debut <= :date_ref
              AND (date_fin IS NULL OR date_fin >= :date_ref)
            ORDER BY date_debut DESC LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id), "date_ref": date_reference},
    ).mappings().first() or {}

    # Adresse principale (pas de bornes de dates sur cette table — juste
    # is_adresse_principale + archive).
    adresse = session.execute(
        text(
            """
            SELECT adresse, complement_adresse, code_postal, code_ville, code_region,
                   code_pays, telephone, telephone_bis, email
            FROM public.collaborateur_adresses
            WHERE collaborateur_id = :cid AND archive = false AND is_adresse_principale = true
            LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id)},
    ).mappings().first() or {}

    # Coordonnées bancaires principales (RIB) + libellés banque et mode de
    # paiement résolus via les référentiels ref_banque / ref_mode_paiement.
    paiement = session.execute(
        text(
            """
            SELECT cp.code_mode, mp.libelle AS mode_libelle,
                   cp.code_banque, rb.libelle AS banque_libelle,
                   cp.code_agence, cp.nom_agence, cp.numero_compte,
                   cp.code_iban, cp.code_bic, cp.intitule_compte
            FROM public.collaborateur_paiements cp
            LEFT JOIN public.ref_mode_paiement mp ON mp.code = cp.code_mode
            LEFT JOIN public.ref_banque rb ON rb.code = cp.code_banque
            WHERE cp.collaborateur_id = :cid AND cp.archive = false AND cp.actif = true
              AND cp.principal = true
              AND cp.date_debut <= :date_ref
              AND (cp.date_fin IS NULL OR cp.date_fin >= :date_ref)
            ORDER BY cp.date_debut DESC LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id), "date_ref": date_reference},
    ).mappings().first() or {}

    # Qualification réelle du collaborateur (grade/échelon/classification
    # obtenus), à distinguer de la classification REQUISE par le poste déjà
    # lue dans affectation_row (rp.code_classification). Historisée via
    # date_evolution uniquement (pas de date_fin) : le dernier enregistrement
    # dont date_evolution <= date_reference fait foi.
    qualification = session.execute(
        text(
            """
            SELECT cq.code_motif, cq.date_evolution, cq.code_fonction,
                   cq.code_responsabilite, cq.code_niveau, cq.code_grade,
                   cq.code_echelle, cq.echelon_actuel, cq.indice_reference,
                   cq.indice_saisi, cq.code_filiere, cq.code_activite,
                   cq.code_classification, rcl.libelle AS classification_libelle,
                   cq.code_emploi, cq.code_qualification, rq.libelle AS qualification_libelle,
                   cq.code_categorie, cq.dominante_metier, cq.code_secteur,
                   cq.code_retraite, cq.points_attribues,
                   cq.code_categorie_professionnelle, cq.code_college, cq.code_classe
            FROM public.collaborateur_qualifications cq
            LEFT JOIN public.ref_classification rcl ON rcl.code = cq.code_classification
            LEFT JOIN public.ref_qualification rq ON rq.code = cq.code_qualification
            WHERE cq.collaborateur_id = :cid AND cq.archive = false
              AND cq.date_evolution <= :date_ref
            ORDER BY cq.date_evolution DESC LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id), "date_ref": date_reference},
    ).mappings().first() or {}

    # Régimes / affiliations (CNSS, AMO, CIMR…) : plusieurs lignes possibles
    # simultanément, contrairement au contrat ou au paiement principal.
    regimes = session.execute(
        text(
            """
            SELECT cr.code_regime, rc.libelle AS regime_libelle, cr.matricule_organisme,
                   cr.date_affiliation, cr.date_radiation
            FROM public.collaborateur_regime cr
            LEFT JOIN public.ref_regime_cotisation rc ON rc.code = cr.code_regime
            WHERE cr.collaborateur_id = :cid AND cr.actif = true
              AND cr.date_affiliation <= :date_ref
              AND (cr.date_radiation IS NULL OR cr.date_radiation >= :date_ref)
            ORDER BY cr.date_affiliation
            """
        ),
        {"cid": str(collaborateur_id), "date_ref": date_reference},
    ).mappings().all()

    donnees: dict[str, Any] = {
        "identite": {
            "collaborateur_id": str(collaborateur_id),
            "matricule": collab["matricule"],
            "civilite": collab["civilite"],
            "nom": collab["nom"],
            "prenom": collab["prenom"],
            "cin": collab["cin"],
            "date_naissance": str(collab["date_naissance"]) if collab["date_naissance"] else None,
            "num_cnss": collab["num_cnss"],
            "num_amo": collab["num_amo"],
        },
        "affectation": {
            "organisation_id": str(affectation_row["organisation_id"]) if affectation_row.get("organisation_id") else None,
            "organisation_libelle": affectation_row.get("organisation_libelle"),
            "poste_instance_id": str(affectation_row["poste_instance_id"]) if affectation_row.get("poste_instance_id") else None,
            "poste_instance_code": affectation_row.get("poste_instance_code"),
            "poste_reference_code": affectation_row.get("poste_reference_code"),
            "poste_reference_libelle": affectation_row.get("poste_reference_libelle"),
            "code_classification": affectation_row.get("code_classification"),
            "qualifications_requises": affectation_row.get("qualifications_requises"),
            "emploi_code": affectation_row.get("emploi_code"),
            "emploi_libelle": affectation_row.get("emploi_libelle"),
            "metier_code": affectation_row.get("metier_code"),
            "metier_libelle": affectation_row.get("metier_libelle"),
            "metier_famille": affectation_row.get("metier_famille"),
        },
        "qualification": {
            "code_motif": qualification.get("code_motif"),
            "date_evolution": str(qualification["date_evolution"]) if qualification.get("date_evolution") else None,
            "code_fonction": qualification.get("code_fonction"),
            "code_responsabilite": qualification.get("code_responsabilite"),
            "code_niveau": qualification.get("code_niveau"),
            "code_grade": qualification.get("code_grade"),
            "code_echelle": qualification.get("code_echelle"),
            "echelon_actuel": qualification.get("echelon_actuel"),
            "indice_reference": qualification.get("indice_reference"),
            "indice_saisi": qualification.get("indice_saisi"),
            "code_filiere": qualification.get("code_filiere"),
            "code_activite": qualification.get("code_activite"),
            "code_classification": qualification.get("code_classification"),
            "classification_libelle": qualification.get("classification_libelle"),
            "code_emploi": qualification.get("code_emploi"),
            "code_qualification": qualification.get("code_qualification"),
            "qualification_libelle": qualification.get("qualification_libelle"),
            "code_categorie": qualification.get("code_categorie"),
            "dominante_metier": qualification.get("dominante_metier"),
            "code_secteur": qualification.get("code_secteur"),
            "code_retraite": qualification.get("code_retraite"),
            "points_attribues": qualification.get("points_attribues"),
            "code_categorie_professionnelle": qualification.get("code_categorie_professionnelle"),
            "code_college": qualification.get("code_college"),
            "code_classe": qualification.get("code_classe"),
        },
        "contrat": {
            "code_type_contrat": contrat.get("code_type_contrat"),
            "code_statut_contrat": contrat.get("code_statut_contrat"),
            "code_temps": contrat.get("code_temps"),
            "date_embauche": str(contrat["date_embauche"]) if contrat.get("date_embauche") else None,
        },
        "situation_familiale": {
            "code": collab["code_situation_familiale"],
            "libelle": collab["situation_familiale_libelle"],
            "nb_enfants_a_charge": collab["nb_enfants_a_charge"],
            "nb_personnes_a_charge": collab["nb_personnes_a_charge"],
            "nb_deductions_fiscales": collab["nb_deductions_fiscales"],
        },
        "adresse": {
            "adresse": adresse.get("adresse"),
            "complement_adresse": adresse.get("complement_adresse"),
            "code_postal": adresse.get("code_postal"),
            "code_ville": adresse.get("code_ville"),
            "code_region": adresse.get("code_region"),
            "code_pays": adresse.get("code_pays"),
            "telephone": adresse.get("telephone"),
            "telephone_bis": adresse.get("telephone_bis"),
            "email": adresse.get("email"),
        },
        "paiement": {
            "code_mode": paiement.get("code_mode"),
            "mode_libelle": paiement.get("mode_libelle"),
            "code_banque": paiement.get("code_banque"),
            "banque_libelle": paiement.get("banque_libelle"),
            "code_agence": paiement.get("code_agence"),
            "nom_agence": paiement.get("nom_agence"),
            "numero_compte": paiement.get("numero_compte"),
            "code_iban": paiement.get("code_iban"),
            "code_bic": paiement.get("code_bic"),
            "intitule_compte": paiement.get("intitule_compte"),
        },
        "regimes": [
            {
                "code_regime": r["code_regime"],
                "regime_libelle": r["regime_libelle"],
                "matricule_organisme": r["matricule_organisme"],
                "date_affiliation": str(r["date_affiliation"]) if r["date_affiliation"] else None,
                "date_radiation": str(r["date_radiation"]) if r["date_radiation"] else None,
            }
            for r in regimes
        ],
    }

    session.execute(
        text(
            """
            INSERT INTO bulletin_snapshot_collaborateur (bulletin_id, donnees, calcul_origine)
            VALUES (:bulletin_id, CAST(:donnees AS JSONB), :origine)
            ON CONFLICT (bulletin_id)
            DO UPDATE SET donnees = EXCLUDED.donnees,
                          date_capture = now(),
                          calcul_origine = EXCLUDED.calcul_origine
            """
        ),
        {
            "bulletin_id": str(bulletin_id),
            "donnees": _to_json(donnees),
            "origine": "RECALCUL" if recalcul else "CALCUL",
        },
    )
    # Pas de commit ici : la transaction est portée par l'appelant
    # (même unité de travail que la persistance du bulletin/bulletin_ligne).


def _to_json(d: dict) -> str:
    import json

    return json.dumps(d, default=str)


# =============================================================================
# 2. Journal de paie — lecture seule du snapshot
# =============================================================================

def _resoudre_bulletins(session: Session, perimetre, societe_id: str | None = None) -> list[dict]:
    """
    Retourne les bulletins concernés par le périmètre choisi, avec leurs
    totaux d'en-tête déjà lus (total_gains, total_retenues, net_a_payer,
    matricule — colonnes de `bulletin`/`bulletin_historique`, PAS de
    `bulletin_ligne`, cf. _COLS_BULLETIN dans paie_calcul.py).

    Union de `bulletin` (validé) et `bulletin_historique` (clôturé) — ce
    sont deux tables PHYSIQUES distinctes, pas un statut à filtrer sur une
    table unique (cf. cycle de vie bulletin_temp → bulletin →
    bulletin_historique dans paie_calcul.py). `bulletin_temp` (précalculs
    non validés) est volontairement exclu : un rapport officiel ne doit
    montrer que du définitif, même règle que `officiel=True` dans
    `_sql_bulletins_tous()`.

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` optionnel -- choke
    point réutilisé par le Journal (rapport_engine) ET la Grille
    (rapport_grille_engine) -- filtré ici une seule fois pour les deux.
    None (par défaut) = comportement inchangé pour les rares appelants pas
    encore mis à jour (aucun rapport officiel ne devrait rester sans ce
    filtre en usage réel).
    """
    cols = """id, collaborateur_id, periode_id, plan_paie_id, matricule,
              total_gains, total_retenues, net_a_payer"""

    if isinstance(perimetre, PerimetrePeriodePlan):
        # RG-MULTISOCIETE-07 : PerimetrePeriodePlan ne joignait PAS
        # calendrier_paie (filtre direct sur plan_paie_id/periode_id) --
        # join ajouté uniquement pour porter le filtre société, sans
        # changer les colonnes sélectionnées (cols reste identique).
        soc_cond = "AND cal.societe_id = :societe_id" if societe_id else ""
        soc_join = "JOIN public.calendrier_paie cal ON cal.id = b.periode_id" if societe_id else ""
        cols_b = ", ".join(f"b.{c.strip()}" for c in cols.split(","))
        sql = f"""
            SELECT {cols_b} FROM public.bulletin b
            {soc_join}
             WHERE b.plan_paie_id = :plan_id AND b.periode_id = :periode_id {soc_cond}
            UNION ALL
            SELECT {cols_b} FROM public.bulletin_historique b
            {soc_join}
             WHERE b.plan_paie_id = :plan_id AND b.periode_id = :periode_id {soc_cond}
        """
        params: dict[str, Any] = {"plan_id": str(perimetre.plan_paie_id), "periode_id": str(perimetre.periode_id)}
        if societe_id:
            params["societe_id"] = societe_id
        if perimetre.organisation_ids:
            sql = f"""
                SELECT b.* FROM ({sql}) b
                WHERE EXISTS (
                    SELECT 1 FROM bulletin_snapshot_collaborateur s
                    WHERE s.bulletin_id = b.id
                      AND s.donnees->'affectation'->>'organisation_id' = ANY(:orgs)
                )
            """
            params["orgs"] = [str(o) for o in perimetre.organisation_ids]
        rows = session.execute(text(sql), params).mappings().all()

    elif isinstance(perimetre, PerimetreCollaborateur):
        soc_cond = "AND cal.societe_id = :societe_id" if societe_id else ""
        sql = f"""
            SELECT {cols} FROM public.bulletin b
            JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE b.collaborateur_id = :collab_id
              AND cal.date_debut >= (SELECT date_debut FROM public.calendrier_paie WHERE id = :periode_debut)
              AND cal.date_fin   <= (SELECT date_fin   FROM public.calendrier_paie WHERE id = :periode_fin)
              {soc_cond}
            UNION ALL
            SELECT {cols} FROM public.bulletin_historique b
            JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE b.collaborateur_id = :collab_id
              AND cal.date_debut >= (SELECT date_debut FROM public.calendrier_paie WHERE id = :periode_debut)
              AND cal.date_fin   <= (SELECT date_fin   FROM public.calendrier_paie WHERE id = :periode_fin)
              {soc_cond}
        """
        p: dict[str, Any] = {
            "collab_id": str(perimetre.collaborateur_id),
            "periode_debut": str(perimetre.periode_id_debut),
            "periode_fin": str(perimetre.periode_id_fin),
        }
        if societe_id:
            p["societe_id"] = societe_id
        rows = session.execute(text(sql), p).mappings().all()

    elif isinstance(perimetre, PerimetreAnnee):
        soc_cond = "AND cal.societe_id = :societe_id" if societe_id else ""
        sql = f"""
            SELECT {cols} FROM public.bulletin b
            JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE cal.annee = :annee {"AND cal.plan_paie_id = :plan_id" if perimetre.plan_paie_id else ""} {soc_cond}
            UNION ALL
            SELECT {cols} FROM public.bulletin_historique b
            JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE cal.annee = :annee {"AND cal.plan_paie_id = :plan_id" if perimetre.plan_paie_id else ""} {soc_cond}
        """
        params = {"annee": perimetre.annee}
        if perimetre.plan_paie_id:
            params["plan_id"] = str(perimetre.plan_paie_id)
        if societe_id:
            params["societe_id"] = societe_id
        rows = session.execute(text(sql), params).mappings().all()

    else:
        raise ValueError(f"Type de périmètre non géré : {type(perimetre)}")

    # Dédoublonnage : un bulletin clôturé peut exister SIMULTANÉMENT dans
    # `bulletin` et `bulletin_historique` (copié à la clôture, sans
    # suppression de la ligne source dans `bulletin`) — chaque UNION ALL
    # ci-dessus le retourne alors deux fois, avec des valeurs identiques
    # (constaté : mêmes total_gains/total_retenues/net_a_payer dans les
    # deux occurrences). On ne garde qu'une ligne par id, en conservant la
    # DERNIÈRE rencontrée : comme `bulletin_historique` est toujours
    # interrogé APRÈS `bulletin` dans chaque UNION ALL ci-dessus, c'est
    # naturellement sa version qui l'emporte ici — la version définitive
    # d'un bulletin clôturé, cohérent avec "un rapport officiel ne doit
    # montrer que du définitif" déjà noté plus haut dans ce docstring.
    bulletins_par_id: dict[Any, Any] = {}
    for r in rows:
        bulletins_par_id[r["id"]] = r
    return [dict(r) for r in bulletins_par_id.values()]


def construire_journal(
    session: Session, config: RapportJournalConfig, perimetre, societe_id: str | None = None
) -> JournalApercuResponse:
    bulletins = _resoudre_bulletins(session, perimetre, societe_id)
    if not bulletins:
        return JournalApercuResponse(
            colonnes=config.colonnes, lignes=[], sous_totaux_par_groupe={}, total_general={}, nb_bulletins=0
        )

    bulletin_ids = [b["id"] for b in bulletins]
    snapshots = session.execute(
        text(
            """
            SELECT bulletin_id, donnees FROM bulletin_snapshot_collaborateur
            WHERE bulletin_id = ANY(CAST(:ids AS uuid[]))
            """
        ),
        {"ids": [str(i) for i in bulletin_ids]},
    ).mappings().all()
    snapshot_par_bulletin = {row["bulletin_id"]: row["donnees"] for row in snapshots}

    # Totaux d'en-tête, tels que persistés par _persister() dans paie_calcul.py
    # (colonnes total_gains / total_retenues / net_a_payer de bulletin/bulletin_historique)
    _CLES_TOTAUX_HEADER = {"total_gains", "total_retenues", "net_a_payer"}

    lignes: list[JournalLigne] = []
    sous_totaux_par_groupe: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    total_general: dict[str, float] = defaultdict(float)

    for b in bulletins:
        snap = snapshot_par_bulletin.get(b["id"], {})
        valeurs: dict[str, Any] = {}
        for col in config.colonnes:
            if col.type == "champ" and col.cle:
                # `identite.matricule` peut aussi être lu directement sur l'en-tête
                # (colonne `matricule` déjà présente sur bulletin/bulletin_historique) ;
                # on privilégie le snapshot pour rester sur une seule source de vérité.
                valeurs[col.libelle] = _lire_cle(snap, col.cle)
            elif col.type == "total" and col.cle:
                if col.cle in _CLES_TOTAUX_HEADER:
                    valeurs[col.libelle] = float(b.get(col.cle) or 0)
                else:
                    valeurs[col.libelle] = None  # clé de total non reconnue
            elif col.type == "rubrique":
                valeurs[col.libelle] = None  # TODO Phase 1.1 : lecture bulletin_ligne par code_rubrique/attribut

        groupe = None
        if "organisation" in config.groupements:
            cle_groupe = _lire_cle(snap, "affectation.organisation_libelle") or "Non affecté"
            groupe = {"organisation": cle_groupe}
            for col in config.colonnes:
                if col.cle in config.sous_totaux:
                    val = valeurs.get(col.libelle)
                    if isinstance(val, (int, float)):
                        sous_totaux_par_groupe[cle_groupe][col.cle] += val

        for col in config.colonnes:
            if col.cle in config.sous_totaux:
                val = valeurs.get(col.libelle)
                if isinstance(val, (int, float)):
                    total_general[col.cle] += val

        lignes.append(JournalLigne(valeurs=valeurs, groupe=groupe))

    if config.tri:
        for critere in reversed(config.tri):
            lignes.sort(key=lambda l: (l.valeurs.get(critere.colonne) or ""), reverse=(critere.sens == "desc"))

    return JournalApercuResponse(
        colonnes=config.colonnes,
        lignes=lignes,
        sous_totaux_par_groupe={k: dict(v) for k, v in sous_totaux_par_groupe.items()},
        total_general=dict(total_general),
        nb_bulletins=len(bulletins),
    )


def _lire_cle(d: dict, cle_pointee: str) -> Any:
    """Lit une clé en notation pointée dans un dict (ex: 'affectation.organisation_libelle')."""
    courant: Any = d
    for part in cle_pointee.split("."):
        if not isinstance(courant, dict):
            return None
        courant = courant.get(part)
    return courant


# =============================================================================
# 3. Export Excel
# =============================================================================

def exporter_journal_excel(reponse: JournalApercuResponse) -> bytes:
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "Journal de paie"

    entetes = [c.libelle for c in reponse.colonnes]
    ws.append(entetes)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for ligne in reponse.lignes:
        ws.append([ligne.valeurs.get(lib) for lib in entetes])

    if reponse.total_general:
        ws.append([])
        ws.append(["TOTAL GÉNÉRAL"] + [reponse.total_general.get(lib, "") for lib in entetes[1:]])

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# =============================================================================
# 4. Export PDF (même HTML que l'aperçu écran — un seul moteur de rendu)
# =============================================================================

def rendre_journal_html(reponse: JournalApercuResponse, titre: str) -> str:
    entetes = "".join(f"<th>{c.libelle}</th>" for c in reponse.colonnes)
    lignes_html = ""
    for ligne in reponse.lignes:
        cellules = "".join(f"<td>{ligne.valeurs.get(c.libelle, '')}</td>" for c in reponse.colonnes)
        lignes_html += f"<tr>{cellules}</tr>"

    return f"""
    <html><head><meta charset="utf-8"><style>
      body {{ font-family: Arial, sans-serif; font-size: 11px; }}
      table {{ width: 100%; border-collapse: collapse; }}
      th, td {{ border: 1px solid #ccc; padding: 4px 6px; text-align: left; }}
      th {{ background: #f0f0f0; }}
      h1 {{ font-size: 16px; }}
    </style></head><body>
      <h1>{titre}</h1>
      <p>{reponse.nb_bulletins} bulletin(s)</p>
      <table><thead><tr>{entetes}</tr></thead><tbody>{lignes_html}</tbody></table>
    </body></html>
    """


def exporter_journal_pdf(reponse: JournalApercuResponse, titre: str) -> bytes:
    """
    xhtml2pdf plutôt que weasyprint : ce dernier dépend de bibliothèques
    système C (Pango/Cairo/GLib via GTK) absentes par défaut sous Windows,
    ce qui casse l'export en environnement de déploiement réel
    (OSError: cannot load library 'libgobject-2.0-0'). xhtml2pdf est
    pip-only, aucune dépendance native.
    """
    from io import BytesIO

    from xhtml2pdf import pisa

    html = rendre_journal_html(reponse, titre)
    buffer = BytesIO()
    resultat = pisa.CreatePDF(html, dest=buffer)
    if resultat.err:
        raise RuntimeError("Échec de la génération du PDF (xhtml2pdf)")
    return buffer.getvalue()
