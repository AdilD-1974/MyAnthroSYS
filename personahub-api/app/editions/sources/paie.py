"""
app/editions/sources/paie.py — Sources de paie : BULLETIN, BULLETIN_LIGNE, index des rubriques, constantes.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Colonnes confirmées en base le 16/10/2026 (script lot0_inventaire_editions.sql).

RG-EDT-SOURCE-01 (Adil DAIA) : seuls les bulletins définitifs sont lus —
    `bulletin` ∪ `bulletin_historique` ; `bulletin_temp` est exclu. Un bulletin
    présent dans les deux tables (clôture de période) n'est lu qu'une fois :
    la ligne live fait foi (anti-join NOT EXISTS sur la branche historique),
    même règle que _lire_bulletins() de paie_calcul.py.
RG-EDT-SOURCE-02 (Adil DAIA) : les données collaborateur viennent du snapshot
    figé au calcul (bulletin_snapshot_collaborateur), jamais des tables RH vivantes.
RG-EDT-SOURCE-03 (Adil DAIA) : société active via calendrier_paie.societe_id
    (RG-MULTISOCIETE-07).
RG-EDT-SOURCE-05 (Adil DAIA) : une requête par jeu ; les lignes de tous les
    bulletins sont lues en bloc, par paquets de LOT_IDS identifiants.
RG-EDT-SOURCE-06 (Adil DAIA) : les lignes NEUTRE (intermédiaires de calcul) ne
    sont jamais imprimées ; elles restent lisibles par [CODE].MT. Une ligne à
    zéro dont la rubrique porte ne_editer_si_mt_zero (resp. nb, taux) n'est pas
    imprimée.

SQL standard uniquement (pas d'ANY(CAST…), d'ILIKE ni de LATERAL) : listes
d'identifiants par bindparam(expanding=True), choix société/générique en Python.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Iterable, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.editions.sources.base import (
    ChampDecl, ContexteSecurite, ErreurSource, Fournisseur, Ligne, RelationDecl,
    enregistrer, ligne_propre, propre,
)

LOT_IDS = 1000
SENS_IMPRIMES = ("GAIN", "RETENUE")
# Rubriques lues sur l'en-tête du bulletin et non dans ses lignes (repris de
# rapport_grille_engine._CODES_RUBRIQUE_HEADER) : [NET_A_PAYER].MT fonctionne.
RUBRIQUES_EN_TETE = {
    "NET_A_PAYER": "net_a_payer", "TOTAL_GAINS": "total_gains", "TOTAL_RETENUES": "total_retenues",
    "TOTAL_BRUT": "total_brut", "BRUT_IMPOSABLE": "total_brut_imposable",
    "NET_IMPOSABLE": "net_imposable", "COUT_EMPLOYEUR": "cout_employeur",
    "COT_SALARIALES": "total_cot_salariale", "COT_PATRONALES": "total_cot_patronale",
}


def _paquets(ids: list, taille: int = LOT_IDS) -> Iterable[list]:
    for i in range(0, len(ids), taille):
        yield ids[i:i + taille]


def _id(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    if isinstance(v, dict):
        return _id(v.get("id"))
    return str(v)


def _ids(v: Any) -> list[str]:
    if v is None or v == "":
        return []
    if isinstance(v, (list, tuple, set)):
        return [x for x in (_id(e) for e in v) if x]
    return [x for x in [_id(v)] if x]


# =============================================================================
# BULLETIN — jeu principal des éditions de paie
# =============================================================================
_COLS_BULLETIN = ("id", "collaborateur_id", "periode_id", "plan_paie_id", "matricule", "statut",
                  "total_brut", "total_brut_imposable", "total_gains", "total_retenues",
                  "total_cot_salariale", "total_cot_patronale", "net_imposable", "net_a_payer",
                  "cout_employeur")


def _m(code, libelle, groupe="Bulletin", **kw):
    return ChampDecl(code, libelle, "MONTANT", groupe, masque_defaut="MONTANT", **kw)


def _t(code, libelle, groupe, **kw):
    return ChampDecl(code, libelle, "TEXTE", groupe, **kw)


def _d(code, libelle, groupe, **kw):
    return ChampDecl(code, libelle, "DATE", groupe, masque_defaut="DATE_FR", **kw)


def _n(code, libelle, groupe, **kw):
    return ChampDecl(code, libelle, "NOMBRE", groupe, **kw)


CHAMPS_BULLETIN = [
    _t("id", "Identifiant du bulletin", "Bulletin"),
    _t("collaborateur_id", "Identifiant du collaborateur", "Bulletin"),
    _t("periode_id", "Identifiant de la période", "Bulletin"),
    _t("matricule", "Matricule", "Bulletin"),
    _t("statut", "Statut du bulletin", "Bulletin"),
    _t("origine", "Origine (LIVE ou HISTORIQUE)", "Bulletin"),
    _m("total_brut", "Salaire brut"), _m("total_brut_imposable", "Brut imposable"),
    _m("total_gains", "Total des gains"), _m("total_retenues", "Total des retenues"),
    _m("total_cot_salariale", "Cotisations salariales"), _m("total_cot_patronale", "Cotisations patronales"),
    _m("net_imposable", "Net imposable"), _m("net_a_payer", "Net à payer"),
    _m("cout_employeur", "Coût employeur"),
    _t("periode.intitule", "Intitulé de la période", "Période"),
    _n("periode.annee", "Année", "Période"), _n("periode.mois", "Mois", "Période"),
    _d("periode.date_debut", "Début de période", "Période"),
    _d("periode.date_fin", "Fin de période", "Période"),
    _t("plan.code", "Code du plan de paie", "Période"), _t("plan.libelle", "Plan de paie", "Période"),
    # snapshot (clés de rapport_engine.capturer_snapshot_collaborateur)
    _t("identite.matricule", "Matricule", "Identité"), _t("identite.civilite", "Civilité", "Identité"),
    _t("identite.nom", "Nom", "Identité"), _t("identite.prenom", "Prénom", "Identité"),
    _t("identite.cin", "CIN", "Identité", sensible=True),
    _d("identite.date_naissance", "Date de naissance", "Identité"),
    _t("identite.num_cnss", "N° CNSS", "Identité"), _t("identite.num_amo", "N° AMO", "Identité"),
    _t("affectation.organisation_libelle", "Organisation", "Affectation"),
    _t("affectation.poste_reference_libelle", "Poste", "Affectation"),
    _t("affectation.emploi_libelle", "Emploi", "Affectation"),
    _t("affectation.metier_libelle", "Métier", "Affectation"),
    _t("affectation.code_classification", "Classification requise", "Affectation"),
    _t("qualification.classification_libelle", "Classification", "Qualification"),
    _t("qualification.qualification_libelle", "Qualification", "Qualification"),
    _t("qualification.code_grade", "Grade", "Qualification"),
    _t("qualification.code_echelle", "Échelle", "Qualification"),
    _t("qualification.echelon_actuel", "Échelon", "Qualification"),
    _t("qualification.code_categorie_professionnelle", "Catégorie professionnelle", "Qualification"),
    _t("contrat.code_type_contrat", "Type de contrat", "Contrat"),
    _t("contrat.code_statut_contrat", "Statut du contrat", "Contrat"),
    _t("contrat.code_temps", "Temps de travail", "Contrat"),
    _d("contrat.date_embauche", "Date d'embauche", "Contrat"),
    _t("situation_familiale.libelle", "Situation familiale", "Famille"),
    _n("situation_familiale.nb_enfants_a_charge", "Enfants à charge", "Famille"),
    _n("situation_familiale.nb_personnes_a_charge", "Personnes à charge", "Famille"),
    _n("situation_familiale.nb_deductions_fiscales", "Déductions fiscales", "Famille"),
    _t("adresse.adresse", "Adresse", "Adresse", sensible=True),
    _t("adresse.complement_adresse", "Complément d'adresse", "Adresse", sensible=True),
    _t("adresse.code_ville", "Ville", "Adresse"), _t("adresse.code_postal", "Code postal", "Adresse"),
    _t("adresse.telephone", "Téléphone", "Adresse", sensible=True),
    _t("adresse.email", "E-mail", "Adresse", sensible=True),
    _t("paiement.mode_libelle", "Mode de paiement", "Paiement"),
    _t("paiement.banque_libelle", "Banque", "Paiement"),
    _t("paiement.nom_agence", "Agence", "Paiement"),
    _t("paiement.numero_compte", "N° de compte (RIB)", "Paiement", sensible=True),
    _t("paiement.code_iban", "IBAN", "Paiement", sensible=True),
    _t("paiement.code_bic", "BIC", "Paiement", sensible=True),
    _t("paiement.intitule_compte", "Intitulé du compte", "Paiement", sensible=True),
    # cumuls annuels à date (RG-EDT-CUMUL-01)
    _m("cumul.total_brut", "Cumul : salaire brut", "Cumuls de l'année"),
    _m("cumul.total_brut_imposable", "Cumul : brut imposable", "Cumuls de l'année"),
    _m("cumul.total_gains", "Cumul : gains", "Cumuls de l'année"),
    _m("cumul.total_retenues", "Cumul : retenues", "Cumuls de l'année"),
    _m("cumul.total_cot_salariale", "Cumul : cotisations salariales", "Cumuls de l'année"),
    _m("cumul.total_cot_patronale", "Cumul : cotisations patronales", "Cumuls de l'année"),
    _m("cumul.net_imposable", "Cumul : net imposable", "Cumuls de l'année"),
    _m("cumul.net_a_payer", "Cumul : net à payer", "Cumuls de l'année"),
    _m("cumul.cout_employeur", "Cumul : coût employeur", "Cumuls de l'année"),
    _n("cumul.nb_bulletins", "Cumul : nombre de bulletins", "Cumuls de l'année"),
    # régimes : regimes.CNSS.matricule_organisme, regimes.CIMR.date_affiliation…
    _t("regimes.*.regime_libelle", "Régime : libellé", "Régimes"),
    _t("regimes.*.matricule_organisme", "Régime : matricule à l'organisme", "Régimes"),
    _d("regimes.*.date_affiliation", "Régime : date d'affiliation", "Régimes"),
    _d("regimes.*.date_radiation", "Régime : date de radiation", "Régimes"),
]


class FournisseurBulletin(Fournisseur):
    code = "BULLETIN"
    libelle = "Bulletins de paie (définitifs)"
    nature = "PAIE_SNAPSHOT"
    # une période, une année ou un bulletin précis
    contexte_requis = ("periode|annee|bulletin",)

    def champs(self) -> list[ChampDecl]:
        return CHAMPS_BULLETIN

    def relations(self) -> list[RelationDecl]:
        return [RelationDecl("lignes", "BULLETIN_LIGNE", "PLUSIEURS", "id", "bulletin_id")]

    # ---- périmètre ----
    def _perimetre(self, p: dict) -> tuple[str, dict, list[str]]:
        conds, binds, expanding = [], {}, []
        bulletin = _id(p.get("bulletin"))
        periode = _id(p.get("periode"))
        annee = p.get("annee")
        if not (bulletin or periode or annee):
            raise ErreurSource("Paramètre requis : une période, une année ou un bulletin")
        if bulletin:
            conds.append("b.id = :bulletin")
            binds["bulletin"] = bulletin
        if periode:
            conds.append("b.periode_id = :periode")
            binds["periode"] = periode
        if annee and not periode:
            conds.append("cal.annee = :annee")
            binds["annee"] = int(annee)
        collabs = _ids(p.get("collaborateurs")) or _ids(p.get("collaborateur"))
        if collabs:
            conds.append("b.collaborateur_id IN :collabs")
            binds["collabs"] = collabs
            expanding.append("collabs")
        plans = _ids(p.get("plan_paie"))               # un plan, ou plusieurs (paramètre « multiple »)
        if plans:
            conds.append("b.plan_paie_id IN :plans")
            binds["plans"] = plans
            expanding.append("plans")
        return " AND ".join(conds), binds, expanding

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        where, binds, expanding = self._perimetre(parametres)
        cols = ", ".join(f"b.{c}" for c in _COLS_BULLETIN)
        select = f"""
            SELECT {cols}, cal.intitule AS p_intitule, cal.annee AS p_annee, cal.mois AS p_mois,
                   cal.date_debut AS p_date_debut, cal.date_fin AS p_date_fin,
                   pp.code AS pl_code, pp.libelle AS pl_libelle"""
        jointures = """
            JOIN calendrier_paie cal ON cal.id = b.periode_id
            LEFT JOIN plan_paie pp ON pp.id = b.plan_paie_id"""
        sql = f"""
            {select}, 'LIVE' AS origine
            FROM bulletin b {jointures}
            WHERE cal.societe_id = :societe AND {where}
            UNION ALL
            {select}, 'HISTORIQUE' AS origine
            FROM bulletin_historique b {jointures}
            WHERE cal.societe_id = :societe AND {where}
              AND NOT EXISTS (SELECT 1 FROM bulletin live WHERE live.id = b.id)
        """
        q = text(sql)
        for nom in expanding:
            q = q.bindparams(bindparam(nom, expanding=True))
        rows = db.execute(q, {**binds, "societe": sec.societe_id}).mappings().all()

        lignes: list[Ligne] = []
        for r in rows:
            r = ligne_propre(r)
            ligne = {c: r[c] for c in _COLS_BULLETIN}
            ligne["origine"] = r["origine"]
            ligne["periode"] = {"id": r["periode_id"], "intitule": r["p_intitule"], "annee": r["p_annee"],
                                "mois": r["p_mois"], "date_debut": r["p_date_debut"], "date_fin": r["p_date_fin"]}
            ligne["plan"] = {"code": r["pl_code"], "libelle": r["pl_libelle"]}
            lignes.append(ligne)

        # organisations : filtre sur le snapshot (affectation figée au calcul)
        snaps = self._snapshots(db, [l["id"] for l in lignes])
        orgs = set(_ids(parametres.get("organisations")))
        resultat = []
        for l in lignes:
            snap = snaps.get(l["id"], {})
            if orgs and str((snap.get("affectation") or {}).get("organisation_id")) not in orgs:
                continue
            for cle, valeur in snap.items():
                if cle not in l:
                    l[cle] = valeur
            resultat.append(l)
        _ajouter_cumuls(db, resultat, sec)
        return resultat

    def _snapshots(self, db: Session, ids: list[str]) -> dict[str, dict]:
        res: dict[str, dict] = {}
        q = text("SELECT bulletin_id, donnees FROM bulletin_snapshot_collaborateur WHERE bulletin_id IN :ids") \
            .bindparams(bindparam("ids", expanding=True))
        for paquet in _paquets(ids):
            for r in db.execute(q, {"ids": paquet}).mappings():
                d = r["donnees"]
                res[str(r["bulletin_id"])] = json.loads(d) if isinstance(d, str) else (d or {})
        return res


# =============================================================================
# Cumuls annuels à date des totaux du bulletin — RG-EDT-CUMUL-01 (Adil DAIA)
#   Somme des bulletins définitifs du collaborateur dans la société, même année,
#   jusqu'au mois du bulletin INCLUS (comme les cumuls du bulletin AGIRH).
# =============================================================================
TOTAUX_CUMULES = ("total_brut", "total_brut_imposable", "total_gains", "total_retenues",
                  "total_cot_salariale", "total_cot_patronale", "net_imposable", "net_a_payer",
                  "cout_employeur")


def _ajouter_cumuls(db: Session, bulletins: list[Ligne], sec: ContexteSecurite) -> None:
    if not bulletins:
        return
    collabs = sorted({str(b["collaborateur_id"]) for b in bulletins if b.get("collaborateur_id")})
    annees = sorted({int(b["periode"]["annee"]) for b in bulletins if (b.get("periode") or {}).get("annee")})
    if not collabs or not annees:
        return
    cols = ", ".join(f"b.{c}" for c in TOTAUX_CUMULES)
    corps = f"""
        SELECT b.collaborateur_id, cal.annee, cal.mois, {cols} FROM {{table}} b
        JOIN calendrier_paie cal ON cal.id = b.periode_id
        WHERE cal.societe_id = :societe AND b.collaborateur_id IN :collabs AND cal.annee IN :annees"""
    q = text(corps.format(table="bulletin") + " UNION ALL " + corps.format(table="bulletin_historique")
             + " AND NOT EXISTS (SELECT 1 FROM bulletin live WHERE live.id = b.id)") \
        .bindparams(bindparam("collabs", expanding=True), bindparam("annees", expanding=True))
    par_collab: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for paquet in _paquets(collabs):
        for r in db.execute(q, {"societe": sec.societe_id, "collabs": paquet, "annees": annees}).mappings():
            par_collab[(str(r["collaborateur_id"]), int(r["annee"]))].append(dict(r))
    for b in bulletins:
        per = b.get("periode") or {}
        if per.get("annee") is None or per.get("mois") is None:
            continue
        retenus = [r for r in par_collab.get((str(b["collaborateur_id"]), int(per["annee"])), [])
                   if int(r["mois"]) <= int(per["mois"])]
        cumul = {c: sum((Decimal(str(r[c])) for r in retenus if r[c] is not None), Decimal(0)) for c in TOTAUX_CUMULES}
        cumul["nb_bulletins"] = len(retenus)
        b["cumul"] = cumul


def _cumuls_rubriques(db: Session, bulletins: list[Ligne]) -> dict[str, dict[str, dict[str, Decimal]]]:
    """{bulletin_id: {code: {CMT, CNB, CBASE}}} depuis la table cumul (une ligne
    MENSUEL par rubrique et par mois, écrite au calcul) : même année, mois ≤ mois
    du bulletin, même plan de paie que le bulletin (comme paie_engine)."""
    res: dict[str, dict[str, dict[str, Decimal]]] = defaultdict(dict)
    collabs = sorted({str(b["collaborateur_id"]) for b in bulletins if b.get("collaborateur_id")})
    annees = sorted({int(b["periode"]["annee"]) for b in bulletins if (b.get("periode") or {}).get("annee")})
    if not collabs or not annees:
        return res
    pat = "SUM(montant_patronal)" if colonne_existe(db, "cumul", "montant_patronal") else "0"
    q = text(f"""
        SELECT collaborateur_id, annee, mois, code_plan, code_rubrique,
               SUM(montant) AS mt, SUM(nombre) AS nb, SUM(base) AS base, {pat} AS pat
        FROM cumul
        WHERE collaborateur_id IN :collabs AND annee IN :annees AND type_cumul = 'MENSUEL'
        GROUP BY collaborateur_id, annee, mois, code_plan, code_rubrique
    """).bindparams(bindparam("collabs", expanding=True), bindparam("annees", expanding=True))
    lignes: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for paquet in _paquets(collabs):
        for r in db.execute(q, {"collabs": paquet, "annees": annees}).mappings():
            lignes[(str(r["collaborateur_id"]), int(r["annee"]))].append(dict(r))
    for b in bulletins:
        per = b.get("periode") or {}
        if per.get("annee") is None or per.get("mois") is None:
            continue
        plan = (b.get("plan") or {}).get("code")
        for r in lignes.get((str(b["collaborateur_id"]), int(per["annee"])), []):
            if r["mois"] is not None and int(r["mois"]) > int(per["mois"]):
                continue
            if plan and r["code_plan"] and r["code_plan"] != plan:
                continue
            c = res[b["id"]].setdefault(r["code_rubrique"].strip(),
                                        {"CMT": Decimal(0), "CNB": Decimal(0), "CBASE": Decimal(0), "CPAT": Decimal(0)})
            c["CPAT"] += Decimal(str(r["pat"] or 0))           # RG-PAIE-PATRONAL-02
            c["CMT"] += Decimal(str(r["mt"] or 0))
            c["CNB"] += Decimal(str(r["nb"] or 0))
            c["CBASE"] += Decimal(str(r["base"] or 0))
    return res


# =============================================================================
# BULLETIN_LIGNE — lignes imprimables, jeu secondaire des tableaux
# =============================================================================
_COLS_LIGNE = ("bulletin_id", "code_rubrique", "libelle", "code_type", "base", "nombre", "taux",
               "montant", "montant_patronal", "sens", "ordre_affichage", "est_cotisation", "texte",
               "date_valeur")

CHAMPS_LIGNE = [
    _t("bulletin_id", "Bulletin", "Ligne"), _t("code_rubrique", "Code rubrique", "Ligne"),
    _t("libelle", "Libellé", "Ligne"), _t("code_type", "Type de rubrique", "Ligne"),
    _n("base", "Base", "Ligne", masque_defaut="MONTANT"), _n("nombre", "Nombre", "Ligne"),
    _n("taux", "Taux", "Ligne"), _n("taux_patronal", "Taux patronal", "Ligne"), _m("montant", "Montant", "Ligne"),
    _m("montant_patronal", "Montant patronal", "Ligne"), _t("sens", "Sens (GAIN, RETENUE)", "Ligne"),
    _n("ordre_affichage", "Ordre d'affichage", "Ligne"),
    ChampDecl("est_cotisation", "Est une cotisation", "BOOLEEN", "Ligne"),
    _t("texte", "Texte", "Ligne"), _d("date_valeur", "Date de valeur", "Ligne"),
]


_COLONNES_PRESENTES: dict[tuple[str, str], bool] = {}


def colonne_existe(db: Session, table: str, colonne: str) -> bool:
    """Migration 076 appliquée ? (taux_patronal, cumul.montant_patronal) — mémorisé par processus."""
    cle = (table, colonne)
    if cle not in _COLONNES_PRESENTES:
        _COLONNES_PRESENTES[cle] = bool(db.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
            "AND table_name = :t AND column_name = :c"), {"t": table, "c": colonne}).first())
    return _COLONNES_PRESENTES[cle]


def _lignes_brutes(db: Session, bulletin_ids: list[str], sens: Optional[tuple] = None) -> list[Ligne]:
    """Lignes live ∪ historique ; les lignes historiques d'un bulletin encore
    présent dans `bulletin` sont ignorées (la ligne live fait foi)."""
    # RG-PAIE-PATRONAL-01 : taux patronal de la ligne (migration 076), NULL avant
    extra = (", l.taux_patronal" if colonne_existe(db, "bulletin_ligne", "taux_patronal")
             and colonne_existe(db, "bulletin_historique_ligne", "taux_patronal") else ", NULL::numeric AS taux_patronal")
    cols = ", ".join(f"l.{c}" for c in _COLS_LIGNE) + extra
    filtre_sens = "AND l.sens IN :sens" if sens else ""
    q = text(f"""
        SELECT {cols} FROM bulletin_ligne l
        WHERE l.bulletin_id IN :ids {filtre_sens}
        UNION ALL
        SELECT {cols} FROM bulletin_historique_ligne l
        WHERE l.bulletin_id IN :ids {filtre_sens}
          AND NOT EXISTS (SELECT 1 FROM bulletin live WHERE live.id = l.bulletin_id)
    """).bindparams(bindparam("ids", expanding=True))
    binds: dict = {}
    if sens:
        q = q.bindparams(bindparam("sens", expanding=True))
        binds["sens"] = list(sens)
    lignes: list[Ligne] = []
    for paquet in _paquets(bulletin_ids):
        lignes += [ligne_propre(r) for r in db.execute(q, {**binds, "ids": paquet}).mappings()]
    return lignes


def _rubriques_paie(db: Session, codes: set[str], societe_id: str) -> dict[str, dict]:
    """Paramétrage des rubriques : la version propre à la société prime sur la
    générique (societe_id NULL)."""
    if not codes:
        return {}
    q = text("""
        SELECT code, libelle, libelle_edition, ne_editer_si_mt_zero, ne_editer_si_nb_zero,
               ne_editer_si_ty_zero, societe_id
        FROM rubrique_paie
        WHERE code IN :codes AND (societe_id = :societe OR societe_id IS NULL)
    """).bindparams(bindparam("codes", expanding=True))
    res: dict[str, dict] = {}
    for paquet in _paquets(sorted(codes)):
        for r in db.execute(q, {"codes": paquet, "societe": societe_id}).mappings():
            r = dict(r)
            if r["code"] not in res or r["societe_id"] is not None:
                res[r["code"]] = r
    return res


def _zero(v: Any) -> bool:
    return v is None or Decimal(str(v)) == 0


class FournisseurBulletinLigne(Fournisseur):
    code = "BULLETIN_LIGNE"
    libelle = "Lignes de bulletin imprimables"
    nature = "PAIE_SNAPSHOT"

    def champs(self) -> list[ChampDecl]:
        return CHAMPS_LIGNE

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        raise ErreurSource("BULLETIN_LIGNE se lit comme jeu secondaire d'un jeu BULLETIN")

    def lire_enfants(self, db: Session, cles: list[Any], sec: ContexteSecurite,
                     parametres: Optional[dict] = None) -> dict[Any, list[Ligne]]:
        # RG-EDT-SOURCE-03 : les clés viennent d'un jeu BULLETIN déjà filtré par société.
        lignes = _lignes_brutes(db, [str(c) for c in cles], SENS_IMPRIMES)
        params = _rubriques_paie(db, {l["code_rubrique"] for l in lignes}, sec.societe_id)
        groupes: dict[Any, list[Ligne]] = defaultdict(list)
        for l in lignes:
            rub = params.get(l["code_rubrique"], {})
            # RG-EDT-SOURCE-06
            if (rub.get("ne_editer_si_mt_zero") and _zero(l["montant"])) \
                    or (rub.get("ne_editer_si_nb_zero") and _zero(l["nombre"])) \
                    or (rub.get("ne_editer_si_ty_zero") and _zero(l["taux"])):
                continue
            l["libelle"] = rub.get("libelle_edition") or l.get("libelle") or rub.get("libelle")
            groupes[l["bulletin_id"]].append(l)
        for g in groupes.values():
            g.sort(key=lambda x: (x["ordre_affichage"] is None, x["ordre_affichage"] or 0, x["code_rubrique"]))
        return dict(groupes)


# =============================================================================
# Index des rubriques : [CODE].MT / NB / TX / BASE / PAT de chaque bulletin
# =============================================================================
def index_rubriques(db: Session, bulletins: list[Ligne]) -> dict[str, dict[str, dict[str, Decimal]]]:
    """{bulletin_id: {code: {MT, NB, TX, BASE, PAT}}}, toutes lignes confondues
    (NEUTRE compris : un calcul intermédiaire reste lisible). Une rubrique
    présente sur plusieurs lignes cumule MT, NB et PAT ; BASE et TX gardent la
    dernière valeur. Les totaux d'en-tête sont exposés comme des rubriques.
    CMT / CNB / CBASE : cumuls annuels à date (RG-EDT-CUMUL-01)."""
    idx: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for l in _lignes_brutes(db, [b["id"] for b in bulletins]):
        r = idx[l["bulletin_id"]].setdefault(l["code_rubrique"], {"MT": Decimal(0), "NB": Decimal(0), "PAT": Decimal(0)})
        for attr, col in (("MT", "montant"), ("NB", "nombre"), ("PAT", "montant_patronal")):
            if l[col] is not None:
                r[attr] += Decimal(str(l[col]))
        if l["base"] is not None:
            r["BASE"] = Decimal(str(l["base"]))
        if l["taux"] is not None:
            r["TX"] = Decimal(str(l["taux"]))
        if l.get("taux_patronal") is not None:
            r["TXP"] = Decimal(str(l["taux_patronal"]))
        if l.get("ordre_affichage") is not None:
            r["ORDRE"] = min(r.get("ORDRE", l["ordre_affichage"]), l["ordre_affichage"])
    for b in bulletins:
        for code, col in RUBRIQUES_EN_TETE.items():
            if b.get(col) is not None:
                e = idx[b["id"]].setdefault(code, {"MT": Decimal(str(b[col]))})
                cumul = (b.get("cumul") or {}).get(col)
                if cumul is not None:
                    e.setdefault("CMT", cumul)
    # RG-EDT-CUMUL-01 : cumuls par rubrique, y compris d'une rubrique absente du mois
    for bid, codes in _cumuls_rubriques(db, bulletins).items():
        for code, valeurs in codes.items():
            idx[bid].setdefault(code, {}).update(valeurs)
    return dict(idx)


# =============================================================================
# Constantes de paie à une date (#CODE)
# =============================================================================
def constantes_a_date(db: Session, societe_id: str, a_date: date) -> dict[str, Any]:
    """ref_constante_paie en vigueur à `a_date` : version de la société d'abord,
    sinon générique ; la plus récente (date_debut) l'emporte."""
    rows = db.execute(text("""
        SELECT code, valeur, societe_id, date_debut FROM ref_constante_paie
        WHERE actif = true
          AND (societe_id = :societe OR societe_id IS NULL)
          AND (date_debut IS NULL OR date_debut <= :d)
          AND (date_fin IS NULL OR date_fin >= :d)
    """), {"societe": societe_id, "d": a_date}).mappings().all()
    choisies: dict[str, dict] = {}
    for r in rows:
        actuelle = choisies.get(r["code"])
        cle = (r["societe_id"] is not None, r["date_debut"] or date.min)
        if actuelle is None or cle > (actuelle["societe_id"] is not None, actuelle["date_debut"] or date.min):
            choisies[r["code"]] = dict(r)
    res: dict[str, Any] = {}
    for code, r in choisies.items():
        v = r["valeur"]
        try:
            res[code] = Decimal(str(v).replace(",", ".")) if v is not None else None
        except Exception:
            res[code] = propre(v)
    return res


enregistrer(FournisseurBulletin())
enregistrer(FournisseurBulletinLigne())
