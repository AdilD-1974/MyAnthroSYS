"""
Moteur de comptabilisation de la paie.

Responsabilités :
1. Contrôle d'effectif bloquant (RG-COMPTA-EFFECTIF-01).
2. Génération du détail nominatif des écritures depuis les bulletins validés.
3. Agrégation en écritures par (compte, axe, sens) si mode GLOBAL.
4. Contrôle d'équilibre débit = crédit.

Ce module ne connaît PAS le format de sortie (Sage, FEC, ...) : voir
export_compta.py pour les adaptateurs. Il produit un modèle interne normalisé
et le persiste (ecriture_ligne_detail / ecriture_ligne).

NOTE D'INTÉGRATION : les requêtes SQLAlchemy ci-dessous sont écrites contre le
schéma décrit dans MODULE_PAIE.md (tables bulletin, bulletin_ligne,
collaborateur_plan_paie, affectations, rubrique_paie). Adapter les noms de
colonnes exacts au modèle réel (`app/models/paie_resultat.py`) avant mise en
production — ce fichier est un squelette de conception, pas un import direct.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Structures internes
# ---------------------------------------------------------------------------
@dataclass
class EcartEffectif:
    collaborateur_id: UUID
    matricule: str
    nom_complet: str
    motif: str


@dataclass
class ControleEffectif:
    effectif_attendu: int
    effectif_valide: int
    ok: bool
    ecarts: list[EcartEffectif] = field(default_factory=list)


@dataclass
class LigneDetail:
    bulletin_id: UUID
    collaborateur_id: UUID
    rubrique_paie_code: str
    part: str
    compte: str
    sens: str  # 'D' / 'C'
    montant: Decimal
    axe_analytique: Optional[str]


@dataclass
class EcartCollaborateur:
    collaborateur_id: UUID
    matricule: str
    nom_complet: str
    total_debit: Decimal
    total_credit: Decimal


@dataclass
class EcartAxe:
    axe_analytique: Optional[str]
    total_debit: Decimal
    total_credit: Decimal
    collaborateurs: list[EcartCollaborateur]
    libelle_uo: Optional[str] = None
    code_uo: Optional[str] = None
    niveau: Optional[int] = None
    # Chemin racine -> feuille, ex. ["DGL — Direction Générale", "SUP-CLT — Service Support Client"]
    chemin_hierarchique: list[str] = field(default_factory=list)


class ControleEffectifKO(Exception):
    """Levée quand le contrôle d'effectif échoue et qu'aucun forçage n'est fourni."""
    def __init__(self, controle: ControleEffectif):
        self.controle = controle
        super().__init__(
            f"Effectif attendu={controle.effectif_attendu} "
            f"≠ effectif validé={controle.effectif_valide}"
        )


# ---------------------------------------------------------------------------
# 1. Contrôle d'effectif — RG-COMPTA-EFFECTIF-01
# ---------------------------------------------------------------------------
def controler_effectif(db: Session, plan_paie_id: UUID, periode_id: UUID) -> ControleEffectif:
    """
    Réutilise la même population que /paie/synthese?detail_periodes=true :
    collaborateurs rattachés au plan, actifs à la date de la période.
    """
    attendus = db.execute(
        text("""
            SELECT c.id, c.matricule, c.nom || ' ' || c.prenom AS nom_complet
            FROM collaborateur_plan_paie cpp
            JOIN collaborateurs c ON c.id = cpp.collaborateur_id
            WHERE cpp.plan_paie_id = :plan_id
              AND cpp.archive = false
              AND c.archive = false
              AND c.statut_collaborateur != 'SORTI'
              AND (cpp.date_fin IS NULL OR cpp.date_fin >= :date_ref)
              AND cpp.date_debut <= :date_ref
        """),
        {"plan_id": str(plan_paie_id), "date_ref": _date_reference(db, periode_id)},
    ).mappings().all()

    valides = db.execute(
        text("""
            SELECT collaborateur_id
            FROM bulletin
            WHERE plan_paie_id = :plan_id
              AND periode_id = :periode_id
              AND statut IN ('VALIDE', 'CLOTURE')
            UNION
            SELECT collaborateur_id
            FROM bulletin_historique
            WHERE plan_paie_id = :plan_id
              AND periode_id = :periode_id
              AND statut IN ('VALIDE', 'CLOTURE')
        """),
        {"plan_id": str(plan_paie_id), "periode_id": str(periode_id)},
    ).scalars().all()
    ids_valides = set(valides)

    ecarts = [
        EcartEffectif(
            collaborateur_id=row["id"],
            matricule=row["matricule"],
            nom_complet=row["nom_complet"],
            motif="Aucun bulletin validé ou clôturé pour cette période",
        )
        for row in attendus
        if row["id"] not in ids_valides
    ]

    return ControleEffectif(
        effectif_attendu=len(attendus),
        effectif_valide=len(ids_valides),
        ok=(len(ecarts) == 0),
        ecarts=ecarts,
    )


def _date_reference(db: Session, periode_id: UUID) -> date:
    row = db.execute(
        text("SELECT date_reference FROM calendrier_paie WHERE id = :id"),
        {"id": str(periode_id)},
    ).mappings().first()
    if not row:
        raise ValueError(f"Période introuvable: {periode_id}")
    return row["date_reference"]


def _date_fin_periode(db: Session, periode_id: UUID) -> date:
    """Fin de période — utilisée spécifiquement pour résoudre l'affectation
    (UO) du collaborateur, à la demande explicite du 24/07 : l'appartenance
    à une UO doit être vérifiée à la date de fin de période, pas à
    date_reference (qui sert au paramétrage des imputations/rubriques)."""
    row = db.execute(
        text("SELECT date_fin FROM calendrier_paie WHERE id = :id"),
        {"id": str(periode_id)},
    ).mappings().first()
    if not row:
        raise ValueError(f"Période introuvable: {periode_id}")
    return row["date_fin"]


# ---------------------------------------------------------------------------
# 2. Génération du détail nominatif
# ---------------------------------------------------------------------------
def generer_detail(
    db: Session, plan_paie_id: UUID, periode_id: UUID
) -> tuple[list[LigneDetail], list[dict], list[dict]]:
    """
    Retourne (lignes générées, lignes exclues faute d'imputation, anomalies
    de cohérence axe/nature de compte). Les anomalies (01/08) ne bloquent
    jamais la génération — contrairement aux lignes exclues, ce ne sont que
    des signaux de mauvais paramétrage à corriger a posteriori (ex. un compte
    de tiers qui porte un axe analytique par erreur).
    Ne persiste rien : à faire par l'appelant dans la transaction du lot.

    ⚠️ SCHÉMA CONFIRMÉ (colonnes vérifiées le 21-22/07) :
    - rubrique_paie_imputation : compte_debit/compte_credit/axe_debit/
      axe_credit en texte libre (§1 de 23_comptabilite_paie.sql).
    - bulletin_ligne : colonne `code_rubrique` (pas `rubrique_paie_code` —
      ce nom-là n'existe que sur rubrique_paie_imputation). Le montant
      salarial et le montant patronal d'une cotisation sont DEUX COLONNES
      de la MÊME ligne (`montant` et `montant_patronal`), pas deux lignes
      séparées.
    - Un bulletin CLOTURE est déplacé de `bulletin` vers `bulletin_historique`
      (même schéma, colonnes vérifiées) — il faut interroger LES DEUX
      tables, sinon les bulletins déjà clôturés sont invisibles (incident
      du 22/07 : contrôle d'effectif à 0/5 alors que 5 bulletins clôturés
      existaient, tous dans bulletin_historique).
    - `bulletin.date_periode` N'EXISTE PAS (autre hypothèse jamais vérifiée,
      corrigée précédemment).
    - L'affectation (UO) du collaborateur est résolue à la DATE DE FIN DE
      PÉRIODE (`calendrier_paie.date_fin`), pas à date_reference — demandé
      explicitement le 24/07, car un collaborateur peut avoir changé d'UO
      en cours de période.
    - Le lien vers l'UO du collaborateur (pour HERITE_UO) se fait via
      `collaborateur_affectations.unite_id` -> `unites_organisationnelles.id`
      (⚠️ 05/08 : PAS `affectations.organisation_id` comme indiqué ici avant
      correctif — cette dernière n'était pas la bonne table, résultat
      confirmé vide en pratique). Si aucune imputation ne porte
      `axe_debit`/`axe_credit = 'HERITE_UO'` (ou aucun axe du tout), toutes
      les lignes remontent "Sans axe" — ce n'est pas un bug de cette
      jointure, c'est un paramétrage manquant en amont (onglet Comptabilité
      de la rubrique).
    - Répartition centre de coût : DÉSACTIVÉE (05/08, demande explicite) —
      voir _resoudre_axes, qui ne consulte plus repartitions/collaborateur_centre_cout.
      Un axe HERITE_UO résout toujours vers l'UO d'affectation seule.
    """
    date_ref = _date_reference(db, periode_id)
    date_fin_uo = _date_fin_periode(db, periode_id)

    bulletins = db.execute(
        text("""
            SELECT bl.bulletin_id, b.collaborateur_id, bl.code_rubrique,
                   bl.montant, bl.montant_patronal, bl.est_cotisation,
                   a.unite_id AS organisation_id
            FROM bulletin_ligne bl
            JOIN bulletin b ON b.id = bl.bulletin_id
            LEFT JOIN collaborateur_affectations a
                   ON a.collaborateur_id = b.collaborateur_id
                  AND COALESCE(a.archive, false) = false
                  AND a.date_debut_uo <= :date_fin_uo
                  AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= :date_fin_uo)
            WHERE b.plan_paie_id = :plan_id
              AND b.periode_id = :periode_id
              AND b.statut IN ('VALIDE', 'CLOTURE')
              AND (COALESCE(bl.montant, 0) != 0 OR COALESCE(bl.montant_patronal, 0) != 0)

            UNION ALL

            -- 01/08 : bulletin_historique.id == bulletin.id pour un même
            -- bulletin (confirmé par requête de diagnostic) — ce n'est donc
            -- PAS une copie archivée sous un nouvel id, mais une trace qui
            -- coexiste avec le bulletin actif. Sans le NOT EXISTS ci-dessous,
            -- tout bulletin CLOTURE présent dans les deux tables était compté
            -- deux fois (cause exacte du total exporté en double, alors
            -- qu'aucune ligne n'était dupliquée en base : deux bulletin_id
            -- identiques provenant de deux tables différentes ne remontent
            -- jamais comme "doublon" dans un contrôle groupé par bulletin_id).
            SELECT bhl.bulletin_id, bh.collaborateur_id, bhl.code_rubrique,
                   bhl.montant, bhl.montant_patronal, bhl.est_cotisation,
                   a.unite_id AS organisation_id
            FROM bulletin_historique_ligne bhl
            JOIN bulletin_historique bh ON bh.id = bhl.bulletin_id
            LEFT JOIN collaborateur_affectations a
                   ON a.collaborateur_id = bh.collaborateur_id
                  AND COALESCE(a.archive, false) = false
                  AND a.date_debut_uo <= :date_fin_uo
                  AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= :date_fin_uo)
            WHERE bh.plan_paie_id = :plan_id
              AND bh.periode_id = :periode_id
              AND bh.statut IN ('VALIDE', 'CLOTURE')
              AND (COALESCE(bhl.montant, 0) != 0 OR COALESCE(bhl.montant_patronal, 0) != 0)
              AND NOT EXISTS (SELECT 1 FROM bulletin b2 WHERE b2.id = bh.id)
        """),
        {"plan_id": str(plan_paie_id), "periode_id": str(periode_id), "date_fin_uo": date_fin_uo},
    ).mappings().all()
    # ⚠️ 05/08 : la table réelle est collaborateur_affectations (PAS
    # affectations, qui n'est pas la bonne source — confirmée par requête de
    # diagnostic sur M00001/M0005/M10006), colonnes : id, collaborateur_id,
    # unite_id (PAS organisation_id), date_debut_uo, date_fin_uo, code_poste,
    # date_debut_poste, date_fin_poste, motif_affectation, commentaire,
    # archive (PAS est_active), responsable_id, forcage_manager,
    # manager_n1_id, manager_n2_id. unite_id référence bien
    # unites_organisationnelles.id (confirmé exact match sur DGL/PCH) — c'est
    # CETTE table qui manquait, pas un problème de résolution côté
    # _chemin_uo (déjà corrigé par ailleurs, mais inopérant tant que la
    # jointure source ne remontait jamais rien).

    imputations = _charger_imputations_actives(db, date_ref)
    repartitions = _charger_repartition_centres_cout(db, date_ref)
    regles_comptes = _charger_regles_comptes(db)

    lignes: list[LigneDetail] = []
    exclues: list[dict] = []
    anomalies: list[dict] = []

    for b in bulletins:
        lignes_imputation = imputations.get(b["code_rubrique"], [])
        if not lignes_imputation:
            exclues.append({
                "bulletin_id": b["bulletin_id"],
                "rubrique_paie_code": b["code_rubrique"],
                "montant": b["montant"],
                "motif": "Aucune imputation paramétrée pour cette rubrique "
                         "(onglet Comptabilité de la rubrique)",
            })
            continue

        for imp in lignes_imputation:
            # Résolution du montant selon la part : PATRONALE -> colonne
            # montant_patronal ; SALARIALE/NEUTRE -> colonne montant.
            montant = b["montant_patronal"] if imp["part"] == "PATRONALE" else b["montant"]
            if not montant:
                continue  # rien à comptabiliser pour cette part sur cette ligne

            if imp["compte_debit"]:
                for axe, m in _resoudre_axes(
                    b["collaborateur_id"], b["organisation_id"], imp["axe_debit"], montant, repartitions
                ):
                    if not m:
                        continue
                    motif = _verifier_coherence_axe(imp["compte_debit"], axe, regles_comptes)
                    if motif:
                        anomalies.append({
                            "bulletin_id": b["bulletin_id"], "rubrique_paie_code": b["code_rubrique"],
                            "compte": imp["compte_debit"], "sens": "D", "axe_analytique": axe,
                            "motif": motif,
                        })
                    lignes.append(LigneDetail(
                        bulletin_id=b["bulletin_id"], collaborateur_id=b["collaborateur_id"],
                        rubrique_paie_code=b["code_rubrique"], part=imp["part"],
                        compte=imp["compte_debit"], sens="D", montant=m,
                        axe_analytique=axe,
                    ))
            if imp["compte_credit"]:
                for axe, m in _resoudre_axes(
                    b["collaborateur_id"], b["organisation_id"], imp["axe_credit"], montant, repartitions
                ):
                    if not m:
                        continue
                    motif = _verifier_coherence_axe(imp["compte_credit"], axe, regles_comptes)
                    if motif:
                        anomalies.append({
                            "bulletin_id": b["bulletin_id"], "rubrique_paie_code": b["code_rubrique"],
                            "compte": imp["compte_credit"], "sens": "C", "axe_analytique": axe,
                            "motif": motif,
                        })
                    lignes.append(LigneDetail(
                        bulletin_id=b["bulletin_id"], collaborateur_id=b["collaborateur_id"],
                        rubrique_paie_code=b["code_rubrique"], part=imp["part"],
                        compte=imp["compte_credit"], sens="C", montant=m,
                        axe_analytique=axe,
                    ))

    return lignes, exclues, anomalies


def _charger_regles_comptes(db: Session) -> dict[str, dict]:
    """
    Règles de qualification par compte (ref_imputation_comptable, 01/08) —
    utilisées uniquement pour un contrôle non bloquant de cohérence
    axe/nature de compte (cf. _verifier_coherence_axe). Un compte absent de
    ce référentiel, ou sans nature_compte renseignée, n'est pas contrôlé
    (pas de règle paramétrée = pas d'anomalie levée).
    """
    rows = db.execute(
        text("""
            SELECT code_compte, nature_compte, necessite_axe_analytique
            FROM ref_imputation_comptable
            WHERE actif = true
        """)
    ).mappings().all()
    return {r["code_compte"]: dict(r) for r in rows}


def _verifier_coherence_axe(compte: str, axe: Optional[str], regles: dict[str, dict]) -> Optional[str]:
    """
    Un axe analytique (UO/centre de coût) n'a de sens que sur un compte de
    charge, jamais sur un compte de tiers — cf. discussion du 01/08. Ne
    bloque jamais la génération (contrairement au contrôle d'équilibre) :
    retourne un motif à remonter en anomalie, ou None si tout est cohérent
    ou si aucune règle n'est paramétrée pour ce compte.
    """
    regle = regles.get(compte)
    if not regle or not regle.get("nature_compte"):
        return None
    requiert_axe = bool(regle["necessite_axe_analytique"])
    a_un_axe = axe is not None
    if requiert_axe and not a_un_axe:
        return f"Compte {compte} ({regle['nature_compte']}) : axe analytique requis mais aucun axe résolu"
    if not requiert_axe and a_un_axe:
        return f"Compte {compte} ({regle['nature_compte']}) : ne devrait pas porter d'axe analytique"
    return None


def _charger_imputations_actives(db: Session, date_ref: date) -> dict[str, list[dict]]:
    rows = db.execute(
        text("""
            SELECT rubrique_paie_code, part, compte_debit, compte_credit, axe_debit, axe_credit
            FROM rubrique_paie_imputation
            WHERE actif = true
              AND date_debut <= :date_ref
              AND (date_fin IS NULL OR date_fin >= :date_ref)
        """),
        {"date_ref": date_ref},
    ).mappings().all()

    par_rubrique: dict[str, list[dict]] = {}
    for r in rows:
        par_rubrique.setdefault(r["rubrique_paie_code"], []).append(dict(r))
    return par_rubrique


def _charger_repartition_centres_cout(db: Session, date_ref: date) -> dict[UUID, list[tuple[str, Decimal]]]:
    """
    Répartition centre de coût par collaborateur, active à date_ref (même date
    de référence que le paramétrage des imputations — voir _charger_imputations_actives).
    Ordonnée par code de centre de coût pour un résultat déterministe (important
    pour la répartition de l'écart d'arrondi, cf. _resoudre_axes).
    """
    rows = db.execute(
        text("""
            SELECT ccc.collaborateur_id, cc.code AS centre_cout_code, ccc.pourcentage
            FROM collaborateur_centre_cout ccc
            JOIN centres_cout cc ON cc.id = ccc.centre_cout_id
            WHERE ccc.actif = true AND cc.actif = true
              AND ccc.date_debut <= :date_ref
              AND (ccc.date_fin IS NULL OR ccc.date_fin >= :date_ref)
            ORDER BY ccc.collaborateur_id, cc.code
        """),
        {"date_ref": date_ref},
    ).mappings().all()

    par_collab: dict[UUID, list[tuple[str, Decimal]]] = {}
    for r in rows:
        par_collab.setdefault(r["collaborateur_id"], []).append((r["centre_cout_code"], r["pourcentage"]))
    return par_collab


def _resoudre_axes(
    collaborateur_id: UUID,
    organisation_id: Optional[UUID],
    axe_marqueur: Optional[str],
    montant: Decimal,
    repartitions: dict[UUID, list[tuple[str, Decimal]]],
) -> list[tuple[Optional[str], Decimal]]:
    """
    Résout un axe d'imputation en une ou plusieurs paires (axe, montant).

    - Si l'axe paramétré n'est pas HERITE_UO : inchangé, une seule paire.
    - Si HERITE_UO : repli sur l'UO d'affectation (organisation_id), une
      seule paire — TOUJOURS, plus d'éclatement par centre de coût.

    ⚠️ 05/08 : l'éclatement par centre de coût (répartition au prorata,
    ci-dessous en commentaire) est VOLONTAIREMENT désactivé sur demande
    explicite — l'axe UO du contrôle d'équilibre doit rester l'unité
    d'affectation, un seul axe par collaborateur. La ventilation par centre
    de coût est prévue pour plus tard (écritures analytiques), pas
    maintenant. `repartitions` (paramètre et `_charger_repartition_centres_cout`)
    sont conservés tels quels pour cette réactivation future, mais ignorés ici.
    """
    if axe_marqueur != "HERITE_UO":
        return [(axe_marqueur, montant)]
    return [(organisation_id, montant)]

    # --- Ancien comportement (centre de coût), conservé pour réactivation
    # future — ne pas supprimer, juste inatteignable tant que le `return`
    # ci-dessus reste en place :
    #
    # repartition = repartitions.get(collaborateur_id)
    # if not repartition:
    #     return [(organisation_id, montant)]
    #
    # parts: list[tuple[str, Decimal]] = []
    # cumul = Decimal("0")
    # for i, (code_cc, pourcentage) in enumerate(repartition):
    #     if i == len(repartition) - 1:
    #         m = montant - cumul  # dernière part : absorbe l'écart d'arrondi
    #     else:
    #         m = (montant * pourcentage / Decimal("100")).quantize(Decimal("0.01"))
    #         cumul += m
    #     parts.append((code_cc, m))
    # return parts


# ---------------------------------------------------------------------------
# 3. Agrégation (mode GLOBAL)
# ---------------------------------------------------------------------------
def agreger(lignes: list[LigneDetail]) -> list[dict]:
    """Agrège par (compte, axe_analytique, sens)."""
    cles: dict[tuple[str, Optional[str], str], Decimal] = {}
    for l in lignes:
        cle = (l.compte, l.axe_analytique, l.sens)
        cles[cle] = cles.get(cle, Decimal("0")) + l.montant

    return [
        {"compte": compte, "axe_analytique": axe, "sens": sens, "montant": montant}
        for (compte, axe, sens), montant in cles.items()
    ]


# ---------------------------------------------------------------------------
# 4. Contrôle d'équilibre
# ---------------------------------------------------------------------------
def controler_equilibre(lignes: list[LigneDetail]) -> tuple[Decimal, Decimal, bool]:
    total_debit = sum((l.montant for l in lignes if l.sens == "D"), Decimal("0"))
    total_credit = sum((l.montant for l in lignes if l.sens == "C"), Decimal("0"))
    return total_debit, total_credit, (total_debit == total_credit)


# ---------------------------------------------------------------------------
# 4bis. Ventilation du déséquilibre — par axe (UO) puis par collaborateur
# ---------------------------------------------------------------------------
def analyser_desequilibre(db: Session, lignes: list[LigneDetail]) -> list[EcartAxe]:
    """
    Un déséquilibre global (débit ≠ crédit) n'est pas exploitable tel quel :
    on ventile par axe analytique pour identifier LESQUELS posent problème,
    puis, au sein de chaque axe en écart, par collaborateur — pour pointer
    précisément qui est concerné plutôt que de laisser deviner. Un
    collaborateur individuellement équilibré au sein d'un axe déséquilibré
    n'est pas remonté (il n'est pas la cause du problème).
    """
    par_axe: dict[Optional[str], dict[str, Decimal]] = {}
    for l in lignes:
        acc = par_axe.setdefault(l.axe_analytique, {"D": Decimal("0"), "C": Decimal("0")})
        acc[l.sens] += l.montant

    axes_en_ecart = [axe for axe, tot in par_axe.items() if tot["D"] != tot["C"]]
    if not axes_en_ecart:
        return []

    ids_concernes = {l.collaborateur_id for l in lignes if l.axe_analytique in axes_en_ecart}
    infos_collab: dict[UUID, dict] = {}
    if ids_concernes:
        rows = db.execute(
            text("""
                SELECT id, matricule, nom || ' ' || prenom AS nom_complet
                FROM collaborateurs WHERE id IN :ids
            """).bindparams(bindparam("ids", expanding=True)),
            {"ids": [str(i) for i in ids_concernes]},
        ).mappings().all()
        infos_collab = {r["id"]: r for r in rows}

    resultat: list[EcartAxe] = []

    # Résolution de la hiérarchie des UO : une seule lecture de toute la table
    # (généralement quelques dizaines de lignes), puis remontée du parent_id
    # en Python — plus simple et plus sûr qu'une CTE récursive ici.
    toutes_uo = db.execute(
        text("SELECT id, code, libelle, parent_id, niveau FROM unites_organisationnelles")
    ).mappings().all()
    uo_par_id: dict[str, dict] = {str(u["id"]): u for u in toutes_uo}
    # ⚠️ 05/08 : la vraie cause du "Sans axe" systématique était que
    # generer_detail() interrogeait la mauvaise table (`affectations` au lieu
    # de `collaborateur_affectations`, cf. correctif plus haut) — organisation_id
    # (aliasé depuis collaborateur_affectations.unite_id, un vrai UUID
    # référençant unites_organisationnelles.id) était donc toujours NULL. Ce
    # n'était PAS un problème id/code comme supposé initialement. On garde
    # malgré tout la résolution par id ET par code ci-dessous, en défense —
    # elle est correcte et sans coût dans les deux cas.
    uo_par_code: dict[str, dict] = {u["code"]: u for u in toutes_uo if u["code"]}

    def _chemin_uo(uo_id: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[int], list[str]]:
        """Retourne (libelle, code, niveau, chemin racine->feuille) pour une UO,
        identifiée par id OU par code (cf. note ci-dessus)."""
        if not uo_id:
            return (None, None, None, [])
        depart = uo_par_id.get(uo_id) or uo_par_code.get(uo_id)
        if not depart:
            return (None, None, None, [])
        chemin: list[str] = []
        curseur, deja_vus = str(depart["id"]), set()
        while curseur and curseur in uo_par_id and curseur not in deja_vus:
            deja_vus.add(curseur)
            u = uo_par_id[curseur]
            chemin.append(f"{u['code']} — {u['libelle']}")
            curseur = str(u["parent_id"]) if u["parent_id"] else None
        chemin.reverse()  # racine -> feuille
        return (depart["libelle"], depart["code"], depart["niveau"], chemin)

    for axe in axes_en_ecart:
        lignes_axe = [l for l in lignes if l.axe_analytique == axe]
        par_collab: dict[UUID, dict[str, Decimal]] = {}
        for l in lignes_axe:
            acc = par_collab.setdefault(l.collaborateur_id, {"D": Decimal("0"), "C": Decimal("0")})
            acc[l.sens] += l.montant

        collaborateurs = [
            EcartCollaborateur(
                collaborateur_id=cid,
                matricule=infos_collab.get(cid, {}).get("matricule", "?"),
                nom_complet=infos_collab.get(cid, {}).get("nom_complet", "?"),
                total_debit=tot["D"], total_credit=tot["C"],
            )
            for cid, tot in par_collab.items()
            if tot["D"] != tot["C"]
        ]

        libelle_uo, code_uo, niveau, chemin = _chemin_uo(str(axe) if axe else None)

        resultat.append(EcartAxe(
            axe_analytique=axe,
            total_debit=par_axe[axe]["D"], total_credit=par_axe[axe]["C"],
            collaborateurs=collaborateurs,
            libelle_uo=libelle_uo, code_uo=code_uo, niveau=niveau,
            chemin_hierarchique=chemin,
        ))

    # Tri par chemin hiérarchique (racine -> feuille) : les UO d'une même
    # branche se retrouvent groupées à la suite, dans l'ordre de l'organigramme.
    resultat.sort(key=lambda e: e.chemin_hierarchique or ["\uffff"])  # "Sans axe" en dernier
    return resultat


# ---------------------------------------------------------------------------
# 5. Orchestration (appelée par le routeur)
# ---------------------------------------------------------------------------
def generer_lot(
    db: Session,
    plan_paie_id: UUID,
    periode_id: UUID,
    mode_generation: str,
    forcer: bool = False,
    motif_forcage: Optional[str] = None,
) -> dict:
    controle = controler_effectif(db, plan_paie_id, periode_id)
    if not controle.ok and not forcer:
        raise ControleEffectifKO(controle)
    if not controle.ok and forcer and not motif_forcage:
        raise ValueError("Un motif de forçage est obligatoire quand le contrôle d'effectif échoue.")

    lignes, exclues, anomalies = generer_detail(db, plan_paie_id, periode_id)
    total_debit, total_credit, equilibre = controler_equilibre(lignes)
    if not equilibre:
        # Ventilé par axe/collaborateur plutôt qu'un message générique — cf.
        # analyser_desequilibre. Retourné comme donnée (pas une exception) :
        # l'appelant (routeur) doit pouvoir l'afficher, pas juste l'afficher
        # comme texte d'erreur.
        return {
            "controle": controle,
            "desequilibre": analyser_desequilibre(db, lignes),
            # 05/08 : lignes brutes en plus de la ventilation par axe — pour
            # que l'écran puisse aussi grouper compte -> rubrique -> matricule
            # même quand rien n'est persisté (lot resté en BROUILLON).
            "lignes_detail": lignes,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "lignes_exclues": exclues,
            "anomalies_parametrage": anomalies,
        }

    ecritures_globales = agreger(lignes) if mode_generation == "GLOBAL" else None

    return {
        "controle": controle,
        "lignes_detail": lignes,
        "lignes_exclues": exclues,
        "anomalies_parametrage": anomalies,
        "ecritures_globales": ecritures_globales,
        "total_debit": total_debit,
        "total_credit": total_credit,
    }
    # La persistance (lot_ecriture_paie, ecriture_ligne_detail, ecriture_ligne,
    # paie_historique) est à faire par l'appelant dans une transaction unique,
    # même pattern que /paie/bulletins/{id}/valider.
