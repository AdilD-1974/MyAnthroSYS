"""
app/services/population_paie.py — Populations de collaborateurs et
attribution des rubriques (RG-POPULATION-RUBRIQUE-01).
Auteur : Adil DAIA

Module PARTAGÉ entre app/routers/paie_calcul.py (écran de gestion des
populations, aperçu avant enregistrement) et app/services/paie_engine.py
(éligibilité au calcul) — délibérément isolé des deux pour éviter tout
import circulaire (paie_calcul importe déjà paie_engine pour calculer_bulletin).

Deux modes de définition d'une population (table `population_paie`) :
  - CRITERES : mêmes champs que PopulationFiltres (lancement en masse),
    réutilisés tels quels — pas de référentiel de filtrage parallèle.
  - SQL      : une expression booléenne UNIQUEMENT, jamais une requête libre
    (voir _valider_condition_sql), insérée dans un gabarit fermé.

Comportement : une rubrique sans AUCUNE population attribuée (directement ou
via la cascade rubrique_paie_dependance_acces) n'est calculée pour PERSONNE —
opt-in strict. Toutes les rubriques déjà en production ont été rattachées à
la population "TOUS" par la migration 24_population_paie.sql, donc rien ne
change tant qu'on ne restreint pas explicitement une rubrique.
"""
from __future__ import annotations

import re
from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session


# ── Mode SQL : validation à l'enregistrement ────────────────────────────────
# Liste blanche volontairement stricte : on rejette tout ce qui ressemble de
# près ou de loin à une instruction de modification, de DDL, ou à une
# tentative d'échapper au gabarit (point-virgule, commentaires SQL, DO $$...).
_MOTS_INTERDITS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|EXEC|EXECUTE|"
    r"CALL|COPY|MERGE|VACUUM|SET|BEGIN|COMMIT|ROLLBACK|DO)\b",
    re.IGNORECASE,
)
_CARACTERES_INTERDITS = re.compile(r";|--|/\*|\*/|\$\$")


def valider_condition_sql(condition_sql: str) -> None:
    """
    Lève HTTPException(400) si l'expression n'est pas une simple condition
    booléenne acceptable. Ne garantit pas l'absence de requête coûteuse
    (voir le timeout appliqué à l'exécution), seulement l'absence de
    modification/DDL et de tentative d'échapper au gabarit fermé.
    """
    if not condition_sql or not condition_sql.strip():
        raise HTTPException(400, "Condition SQL vide")
    if len(condition_sql) > 2000:
        raise HTTPException(400, "Condition SQL trop longue (2000 caractères max)")
    if _MOTS_INTERDITS.search(condition_sql):
        raise HTTPException(400, "Condition SQL : mot-clé non autorisé (lecture seule, une expression booléenne uniquement)")
    if _CARACTERES_INTERDITS.search(condition_sql):
        raise HTTPException(400, "Condition SQL : caractère non autorisé (';', '--', '/*' ou '$$')")


def _tester_condition_sql(db: Session, collaborateur_id: UUID, condition_sql: str) -> bool:
    """
    Exécute la condition dans le gabarit fermé, timeout court (2s) pour
    qu'une expression malheureuse ne bloque jamais un lancement en masse.
    Une erreur d'exécution (colonne inexistante, etc.) est traitée comme
    "ne correspond pas" plutôt que de faire échouer tout le calcul — à
    signaler par ailleurs (l'écran de gestion propose un bouton "tester").
    """
    try:
        db.execute(text("SET LOCAL statement_timeout = '2s'"))
        row = db.execute(
            text(f"SELECT ({condition_sql}) FROM public.collaborateurs c WHERE c.id = :cid"),
            {"cid": str(collaborateur_id)},
        ).scalar()
        return bool(row)
    except Exception:
        return False


# ── Mode CRITERES : mêmes conditions que _resoudre_population, réduites à un
#    seul collaborateur déjà connu (pas de jointure plan_paie ici — le
#    contexte de calcul a déjà validé le plan actif du collaborateur). ───────
# ── Construction des conditions CRITERES, PARTAGÉE entre le test "ce
#    collaborateur appartient-il à cette population ?" (une évaluation par
#    calcul de bulletin réel/simulé) et la résolution en masse "quels
#    collaborateurs appartiennent à cette population ?" (lancement en masse,
#    RG-SIM-POPULATION-01) — pour ne jamais faire diverger les deux logiques.
#    Ne contient NI `c.id = :cid` NI `c.archive = false` : à ajouter par
#    l'appelant selon son besoin (test ciblé vs résolution en masse). ───────
def _construire_conditions_criteres(ref_date: date, pop: dict) -> tuple[list[str], dict]:
    params: dict = {"ref": ref_date}
    conds: list[str] = []

    if pop.get("statuts_collaborateur"):
        params["sc"] = list(pop["statuts_collaborateur"])
        conds.append("c.statut_collaborateur = ANY(CAST(:sc AS text[]))")
    if pop.get("nationalites"):
        params["nat"] = list(pop["nationalites"])
        conds.append("c.code_nationalite = ANY(CAST(:nat AS text[]))")

    if pop.get("unite_ids"):
        params["uo"] = [str(x) for x in pop["unite_ids"]]
        # Correspondance DIRECTE uniquement — PAS de descente récursive dans
        # les sous-unités (changement de règle confirmé par Adil DAIA le
        # 2026-08-09 : une population sur "Direction Générale" remontait à
        # tort les collaborateurs de ses sous-unités). Sélectionner une
        # unité ne prend que les collaborateurs qui y sont affectés
        # directement — il faut explicitement lister aussi les sous-unités
        # voulues (unite_ids) si on veut les inclure.
        #
        # ⚠️ Cette fonction est PARTAGÉE avec le calcul réel de paie
        # (populations_du_collaborateur / rubriques_eligibles, attribution
        # des rubriques par population) — ce changement modifie donc aussi
        # le périmètre réel d'attribution, pas seulement l'aperçu de
        # simulation. Toute population existante qui comptait sur
        # l'inclusion implicite des sous-unités change de périmètre.
        conds.append("""
            EXISTS (
                SELECT 1 FROM public.collaborateur_affectations a
                 WHERE a.collaborateur_id = c.id AND a.archive = false
                   AND a.unite_id = ANY(CAST(:uo AS uuid[]))
                   AND (a.date_debut_uo IS NULL OR a.date_debut_uo <= :ref)
                   AND (a.date_fin_uo   IS NULL OR a.date_fin_uo   >= :ref)
            )""")

    # RG-POPULATION-EMPLOI-01 (Adil DAIA, décision explicite) : critère sur
    # l'EMPLOI d'affiliation, pas sur l'instance de poste exacte. Chaîne
    # confirmée par lecture de AffectationForm.tsx (RG-AFF-CLASSIF) :
    # collaborateur_affectations.code_poste est au format "PARENT-NNN"
    # (l'instance) — le poste PARENT réel est tout ce qui précède le
    # DERNIER tiret (regexp_replace ci-dessous, équivalent exact du
    # split("-").slice(0,-1).join("-") utilisé côté frontend), et c'est CE
    # poste parent qui porte code_emploi dans ref_poste. PAS de passage par
    # ref_poste_instances pour cette résolution (confirmé par le code réel,
    # qui interroge ref_poste directement avec le code parent).
    if pop.get("codes_emploi"):
        params["emp"] = list(pop["codes_emploi"])
        conds.append("""
            EXISTS (
                SELECT 1 FROM public.collaborateur_affectations a
                JOIN public.ref_poste rp ON rp.code = regexp_replace(a.code_poste, '-[^-]*$', '')
                 WHERE a.collaborateur_id = c.id AND a.archive = false
                   AND rp.code_emploi = ANY(CAST(:emp AS text[]))
                   AND (a.date_debut_poste IS NULL OR a.date_debut_poste <= :ref)
                   AND (a.date_fin_poste   IS NULL OR a.date_fin_poste   >= :ref)
            )""")

    ctr = []
    if pop.get("types_contrat"):
        params["tc"] = list(pop["types_contrat"])
        ctr.append("k.code_type_contrat = ANY(CAST(:tc AS text[]))")
    if pop.get("temps"):
        params["tmp"] = list(pop["temps"])
        ctr.append("k.code_temps = ANY(CAST(:tmp AS text[]))")
    if ctr:
        conds.append(
            "EXISTS (SELECT 1 FROM public.collaborateur_contrats k WHERE k.collaborateur_id = c.id "
            "AND k.archive = false AND k.date_debut <= :ref AND (k.date_fin IS NULL OR k.date_fin >= :ref) AND "
            + " AND ".join(ctr) + ")"
        )

    if pop.get("regimes"):
        params["reg"] = list(pop["regimes"])
        conds.append(
            "EXISTS (SELECT 1 FROM public.collaborateur_regime r WHERE r.collaborateur_id = c.id "
            "AND r.actif = true AND r.code_regime = ANY(CAST(:reg AS text[])))"
        )

    # RG-POPULATION-RUBRIQUE-03 (Adil DAIA) : classification.
    # ⚠️ Ne PAS prendre "la ligne la plus récente" (bug rencontré et corrigé) :
    # collaborateur_qualifications journalise des évolutions PARTIELLES par
    # motif (ex. REC01 "recrutement" ne renseigne que code_categorie_
    # professionnelle, AFF "affectation" ne renseigne que code_classe — à la
    # MÊME date_evolution). Prendre la ligne la plus récente perd les
    # colonnes renseignées par une autre ligne de la même date. Le profil
    # réel est reconstruit colonne par colonne : dernière valeur NON NULLE de
    # chaque colonne (date_evolution puis created_at en départage).
    qual = []
    champs_qualif = {
        "codes_fonction": "code_fonction", "codes_categorie_professionnelle": "code_categorie_professionnelle",
        "codes_college": "code_college", "codes_responsabilite": "code_responsabilite",
        "codes_niveau": "code_niveau", "codes_grade": "code_grade", "codes_echelle": "code_echelle",
        "codes_classe": "code_classe", "echelons": "echelon_actuel",
        "codes_filiere": "code_filiere", "codes_activite": "code_activite",
    }
    for cle_pop, colonne in champs_qualif.items():
        if pop.get(cle_pop):
            p = f"q_{colonne}"
            params[p] = list(pop[cle_pop])
            qual.append(f"qc.{colonne} = ANY(CAST(:{p} AS text[]))")
    if qual:
        colonnes_agg = ", ".join(
            f"(array_agg({col} ORDER BY date_evolution DESC, created_at DESC) "
            f"FILTER (WHERE {col} IS NOT NULL))[1] AS {col}"
            for col in champs_qualif.values()
        )
        conds.append(f"""
            EXISTS (
                SELECT 1 FROM (
                    SELECT {colonnes_agg}
                    FROM public.collaborateur_qualifications q
                    WHERE q.collaborateur_id = c.id AND q.archive = false AND q.date_evolution <= :ref
                ) qc
                WHERE {" AND ".join(qual)}
            )""")

    return conds, params


def _collaborateur_correspond_criteres(db: Session, collaborateur_id: UUID, ref_date: date, pop: dict) -> bool:
    conds, params = _construire_conditions_criteres(ref_date, pop)
    conds = ["c.id = :cid", "c.archive = false"] + conds
    params["cid"] = str(collaborateur_id)
    sql = "SELECT 1 FROM public.collaborateurs c WHERE " + " AND ".join(conds) + " LIMIT 1"
    return db.execute(text(sql), params).first() is not None


def populations_du_collaborateur(db: Session, collaborateur_id: UUID, ref_date: date, societe_id: str) -> set[UUID]:
    """Populations actives auxquelles CE collaborateur appartient, à cette date.

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` obligatoire --
    population_paie.societe_id est NOT NULL. Bug corrigé : sans ce filtre,
    un collaborateur était testé contre les populations de TOUTES les
    sociétés, ce qui pouvait lui attribuer ou lui retirer des rubriques
    définies par une population d'une AUTRE société -- appelée directement
    par ContexteCalcul (via rubriques_eligibles) pendant le calcul réel
    d'un bulletin, donc un vrai risque de mauvais calcul, pas juste
    d'affichage."""
    pops = db.execute(text("""
        SELECT id, mode, unite_ids, codes_emploi, types_contrat,
               temps, statuts_collaborateur, regimes, nationalites, condition_sql
          FROM public.population_paie
         WHERE actif = true AND archive = false AND societe_id = :societe_id
    """), {"societe_id": societe_id}).mappings().all()

    resultat: set[UUID] = set()
    for pop in pops:
        if pop["mode"] == "SQL":
            if pop["condition_sql"] and _tester_condition_sql(db, collaborateur_id, pop["condition_sql"]):
                resultat.add(pop["id"])
        else:
            if _collaborateur_correspond_criteres(db, collaborateur_id, ref_date, dict(pop)):
                resultat.add(pop["id"])
    return resultat


def rubriques_eligibles(db: Session, collaborateur_id: UUID, ref_date: date, societe_id: str) -> set[str]:
    """
    Ensemble des codes de rubriques calculables pour CE collaborateur, à
    cette date.

    RG-POPULATION-RUBRIQUE-04 (Adil DAIA) : une population peut ATTRIBUER ou
    RETIRER une rubrique (population_paie_rubrique.type_attribution). Si le
    collaborateur appartient à plusieurs populations et que l'une accorde une
    rubrique tandis qu'une autre la retire, LE RETRAIT PRIME — quelle que soit
    l'autre population qui l'accorderait, y compris via la cascade de
    déclencheurs (une rubrique retirée n'est pas non plus un déclencheur
    effectif : elle ne propage pas d'accès à ce qu'elle débloquerait).

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` obligatoire, propagé
    à populations_du_collaborateur().
    """
    pop_ids = populations_du_collaborateur(db, collaborateur_id, ref_date, societe_id)
    if not pop_ids:
        return set()

    lignes = db.execute(text("""
        SELECT code_rubrique, type_attribution FROM public.population_paie_rubrique
         WHERE population_id = ANY(CAST(:pids AS uuid[]))
    """), {"pids": [str(p) for p in pop_ids]}).all()

    retirees = {code for code, type_ in lignes if type_ == "RETIREE"}
    # Les rubriques retirées sortent du seed de la cascade : ni calculées,
    # ni "déclencheurs" effectifs pour ce collaborateur.
    directes = {code for code, type_ in lignes if type_ == "ATTRIBUEE"} - retirees

    # Arêtes de cascade, chargées une fois (petite table) plutôt qu'en boucle.
    aretes = db.execute(text("""
        SELECT code_rubrique, code_rubrique_declencheur FROM public.rubrique_paie_dependance_acces
    """)).all()
    par_declencheur: dict[str, list[str]] = {}
    for cible, declencheur in aretes:
        par_declencheur.setdefault(declencheur, []).append(cible)

    eligibles = set(directes)
    a_traiter = list(directes)
    while a_traiter:
        code = a_traiter.pop()
        for cible in par_declencheur.get(code, []):
            if cible not in eligibles and cible not in retirees:
                eligibles.add(cible)
                a_traiter.append(cible)

    # Filet de sécurité final : même si une rubrique retirée avait été
    # réintroduite par un autre chemin de cascade, le retrait reste prioritaire.
    return eligibles - retirees


# ── Résolution en masse (RG-SIM-POPULATION-01, module Simulation — Adil DAIA)
#    Sens INVERSE de populations_du_collaborateur() : ici on part d'UNE
#    population et on cherche TOUS les collaborateurs qui lui correspondent,
#    pour un lancement de simulation en masse. Réutilise EXACTEMENT la même
#    construction de conditions que _collaborateur_correspond_criteres (via
#    _construire_conditions_criteres) — aucune logique de correspondance
#    dupliquée ou réinventée. ─────────────────────────────────────────────
def _collaborateurs_correspondant_sql(db: Session, ref_date: date, condition_sql: str, societe_id: str) -> set[UUID]:
    """
    Variante en masse de _tester_condition_sql — même gabarit fermé, timeout
    plus large (5s, on scanne toute la table plutôt qu'une ligne) puisque
    c'est un lancement explicite (bouton "Lancer"), pas un calcul de bulletin
    unitaire où chaque milliseconde compte. Une erreur d'exécution renvoie un
    ensemble vide plutôt que de faire échouer tout le lancement — mêmes
    garanties que la version unitaire.

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` obligatoire -- même
    validée comme appartenant à la bonne société, une condition_sql libre
    (ex. "statut_collaborateur = 'ACTIF'") ne se limite pas d'elle-même à
    une société -- filtre ajouté sur les candidats scannés.
    """
    try:
        db.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = db.execute(
            text(f"""
                SELECT c.id FROM public.collaborateurs c
                 WHERE ({condition_sql}) AND c.archive = false
                   AND EXISTS (
                       SELECT 1 FROM public.collaborateur_contrats cc
                        WHERE cc.collaborateur_id = c.id AND cc.societe_id = :societe_id AND cc.archive = false
                   )
            """),
            {"societe_id": societe_id},
        ).all()
        return {row[0] for row in rows}
    except Exception:
        return set()


def resoudre_population(db: Session, population_id: UUID, ref_date: date, societe_id: str) -> set[UUID]:
    """
    Tous les collaborateurs correspondant à CETTE population, à cette date.
    La population doit être active et non archivée — mêmes conditions
    d'éligibilité que populations_du_collaborateur(), pour qu'un lancement en
    masse ne puisse jamais cibler une population désactivée par erreur.

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` obligatoire -- une
    population_id d'une autre société renvoie un ensemble vide (comme une
    population introuvable), jamais ses membres.
    """
    pop = db.execute(text("""
        SELECT id, mode, unite_ids, codes_emploi, types_contrat,
               temps, statuts_collaborateur, regimes, nationalites, condition_sql
          FROM public.population_paie
         WHERE id = :pid AND actif = true AND archive = false AND societe_id = :societe_id
    """), {"pid": str(population_id), "societe_id": societe_id}).mappings().first()
    if not pop:
        return set()

    if pop["mode"] == "SQL":
        if not pop["condition_sql"]:
            return set()
        return _collaborateurs_correspondant_sql(db, ref_date, pop["condition_sql"], societe_id)

    conds, params = _construire_conditions_criteres(ref_date, dict(pop))
    conds = ["c.archive = false"] + conds
    # RG-MULTISOCIETE-07 : même filtre société que la branche SQL ci-dessus,
    # pour la cohérence -- les critères (unité, emploi, contrat...) ne sont
    # pas eux-mêmes garantis société-exclusifs.
    conds.append("""
        EXISTS (
            SELECT 1 FROM public.collaborateur_contrats cc
             WHERE cc.collaborateur_id = c.id AND cc.societe_id = :societe_id_pop AND cc.archive = false
        )""")
    params["societe_id_pop"] = societe_id
    sql = "SELECT c.id FROM public.collaborateurs c WHERE " + " AND ".join(conds)
    rows = db.execute(text(sql), params).all()
    return {row[0] for row in rows}


def resoudre_toutes_populations_actives(db: Session, ref_date: date, societe_id: str) -> set[UUID]:
    """
    Union des collaborateurs de TOUTES les populations actives, à cette date
    — l'équivalent en masse de "ensemble des populations" pour le lancement
    de simulation. Respecte le même principe d'opt-in strict que le reste du
    module (docstring en tête de fichier) : un collaborateur qui n'appartient
    à AUCUNE population active n'est simplement jamais inclus, plutôt que de
    traiter "toutes les populations" comme "tous les collaborateurs de
    l'entreprise" — ce ne serait pas la même sémantique.

    RG-MULTISOCIETE-07 (migration 057) : "TOUTES les populations actives"
    s'entend TOUJOURS pour la société active de la session -- jamais
    littéralement toutes les populations de toutes les sociétés.
    """
    pops = db.execute(text("""
        SELECT id FROM public.population_paie WHERE actif = true AND archive = false AND societe_id = :societe_id
    """), {"societe_id": societe_id}).all()
    resultat: set[UUID] = set()
    for (pid,) in pops:
        resultat |= resoudre_population(db, pid, ref_date, societe_id)
    return resultat
