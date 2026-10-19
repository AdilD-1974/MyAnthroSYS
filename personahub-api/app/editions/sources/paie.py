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

RG-EDT-COMPARAISON-01 (Adil DAIA) : chaque bulletin est comparé au bulletin du même salarié
    dans la période de comparaison : le paramètre « periode_comparaison » s'il est renseigné,
    sinon le mois précédent (même plan de paie de préférence). « precedent.* » porte ses totaux.
RG-EDT-COMPARAISON-03 (Adil DAIA) : avec le paramètre « inclure_sortants », les salariés payés
    dans la période de comparaison et pas dans la période éditée sont ajoutés (mouvement SORTIE,
    totaux du mois à zéro, identifiant « SORTANT:<bulletin de comparaison> »).
RG-EDT-COMPARAISON-04 (Adil DAIA) : écarts rubrique par rubrique (lignes imprimables GAIN et
    RETENUE) : statut NOUVELLE, SUPPRIMEE, MODIFIEE ou IDENTIQUE ; lus seulement quand l'état
    les utilise (source BULLETIN_ECART_LIGNE, attributs P… / E…, affectations Comparaison / Écart).

SQL standard uniquement (pas d'ANY(CAST…), d'ILIKE ni de LATERAL) : listes
d'identifiants par bindparam(expanding=True), choix société/générique en Python.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Callable, Iterable, Optional

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
    _t("situation.completee", "Blocs complétés depuis la fiche RH (situation figée incomplète)", "Bulletin"),
    # RG-EDT-GROUPE-01 : axes de tri et de regroupement (app/editions/population.py)
    _t("affectation.organisation_id", "Identifiant de l'UO", "Affectation"),
    _t("affectation.uo_code", "Code de l'UO", "Affectation"),
    _t("affectation.uo_chemin", "UO (chemin complet)", "Affectation"),
    _t("affectation.uo_niveau1_libelle", "UO de 1er niveau", "Affectation"),
    _t("affectation.uo_niveau2_libelle", "UO de 2e niveau", "Affectation"),
    _t("affectation.emploi_code", "Code emploi", "Affectation"),
    _t("affectation.metier_code", "Code métier", "Affectation"),
    _t("qualification.code_classification", "Code classification", "Qualification"),
    _t("qualification.categorie_professionnelle_libelle", "Catégorie professionnelle (libellé)", "Qualification"),
    _t("contrat.type_contrat_libelle", "Type de contrat (libellé)", "Contrat"),
    # RG-EDT-LIBELLE-01 : intitulés lus dans les référentiels (population.LIBELLES_REFERENTIELS)
    _t("contrat.statut_contrat_libelle", "Statut du contrat (libellé)", "Contrat"),
    _t("contrat.temps_libelle", "Temps de travail (libellé)", "Contrat"),
    _t("qualification.motif_libelle", "Motif de classification (libellé)", "Qualification"),
    _t("qualification.fonction_libelle", "Fonction (libellé)", "Qualification"),
    _t("qualification.college_libelle", "Collège (libellé)", "Qualification"),
    _t("qualification.responsabilite_libelle", "Responsabilité (libellé)", "Qualification"),
    _t("qualification.niveau_libelle", "Niveau (libellé)", "Qualification"),
    _t("qualification.grade_libelle", "Grade (libellé)", "Qualification"),
    _t("qualification.echelle_libelle", "Échelle (libellé)", "Qualification"),
    _t("qualification.classe_libelle", "Classe (libellé)", "Qualification"),
    _t("qualification.echelon_libelle", "Échelon (libellé)", "Qualification"),
    _t("qualification.filiere_libelle", "Filière (libellé)", "Qualification"),
    _t("qualification.activite_libelle", "Activité (libellé)", "Qualification"),
    _t("qualification.emploi_libelle", "Emploi de la qualification (libellé)", "Qualification"),
    _t("qualification.secteur_libelle", "Secteur (libellé)", "Qualification"),
    _t("qualification.categorie_libelle", "Catégorie (libellé)", "Qualification"),
    _t("affectation.classification_libelle", "Classification requise (libellé)", "Affectation"),
    _t("affectation.metier_famille_libelle", "Famille de métier (libellé)", "Affectation"),
    _t("adresse.ville_libelle", "Ville (libellé)", "Adresse"),
    _t("adresse.region_libelle", "Région (libellé)", "Adresse"),
    _t("adresse.pays_libelle", "Pays (libellé)", "Adresse"),
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
    # mois précédent du même collaborateur (RG-EDT-PRECEDENT-01) : contrôles M / M-1
    _n("precedent.existe", "Mois précédent : bulletin trouvé (1/0)", "Mois précédent"),
    _t("precedent.periode", "Mois précédent : période", "Mois précédent"),
    _m("precedent.total_brut", "Mois précédent : salaire brut", "Mois précédent"),
    _m("precedent.total_brut_imposable", "Mois précédent : brut imposable", "Mois précédent"),
    _m("precedent.total_cot_salariale", "Mois précédent : cotisations salariales", "Mois précédent"),
    _m("precedent.total_cot_patronale", "Mois précédent : cotisations patronales", "Mois précédent"),
    _m("precedent.total_retenues", "Mois précédent : retenues", "Mois précédent"),
    _m("precedent.net_imposable", "Mois précédent : net imposable", "Mois précédent"),
    _m("precedent.net_a_payer", "Mois précédent : net à payer", "Mois précédent"),
    _m("precedent.cout_employeur", "Mois précédent : coût employeur", "Mois précédent"),
    _t("precedent.mode", "Comparaison : mois précédent ou période choisie", "Mois précédent"),
    _t("mouvement", "Mouvement (ENTREE, SORTIE, PRESENT)", "Comparaison"),
    _n("sortant", "Sortie : payé dans la période de comparaison seulement (1/0)", "Comparaison"),
    _n("comparaison.nb_rubriques", "Rubriques comparées", "Comparaison"),
    _n("comparaison.nb_ecarts", "Rubriques en écart (nouvelles, supprimées, modifiées)", "Comparaison"),
    _n("comparaison.nb_modifiees", "Rubriques modifiées", "Comparaison"),
    _n("comparaison.nb_nouvelles", "Rubriques nouvelles", "Comparaison"),
    _n("comparaison.nb_supprimees", "Rubriques supprimées", "Comparaison"),
    _m("comparaison.effet_net", "Effet des écarts sur le net (gains − retenues)", "Comparaison"),
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
        return [RelationDecl("lignes", "BULLETIN_LIGNE", "PLUSIEURS", "id", "bulletin_id"),
                RelationDecl("ecarts", "BULLETIN_ECART_LIGNE", "PLUSIEURS", "id", "bulletin_id")]

    # ---- périmètre ----
    def _perimetre(self, p: dict) -> tuple[str, dict, list[str]]:
        conds, binds, expanding = [], {}, []
        bulletin = _id(p.get("bulletin"))
        # RG-EDT-MOIS-01 : un mois de paie porte la liste de ses périodes (« ids »), pas un identifiant
        mois_paie = next((v for v in (p.get("periode"), p.get("mois")) if isinstance(v, dict) and v.get("ids")), None)
        periode = None if mois_paie else _id(p.get("periode"))
        annee = p.get("annee")
        periodes = _ids(p.get("_periodes_ids")) or (list(mois_paie["ids"]) if mois_paie else [])   # sortants, mois de paie
        if not (bulletin or periode or annee or periodes):
            raise ErreurSource("Paramètre requis : une période, une année ou un bulletin")
        if periodes and not periode:
            conds.append("b.periode_id IN :periodes")
            binds["periodes"] = periodes
            expanding.append("periodes")
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
        # RG-EDT-FILTRE-01/02 : population choisie au lancement ; RG-EDT-GROUPE-01 : axes de regroupement
        from app.editions import population
        population.completer_situation(db, resultat)                     # RG-EDT-SITUATION-01
        resultat = population.filtrer(db, resultat, parametres.get("_filtres"), sec.societe_id)
        population.enrichir(db, resultat, sec.societe_id)
        _ajouter_cumuls(db, resultat, sec)
        if parametres.get("_sans_comparaison"):
            return resultat
        _ajouter_comparaison(db, resultat, sec, parametres)
        if _oui(parametres.get("inclure_sortants")):                      # RG-EDT-COMPARAISON-03
            resultat += self._sortants(db, resultat, parametres, sec)
        if parametres.get("_comparaison_detaillee"):                      # RG-EDT-COMPARAISON-04
            ajouter_ecarts(db, resultat, sec)
        return resultat

    def _sortants(self, db: Session, presents: list[Ligne], parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        comp = _periode_comparaison(parametres)
        per = parametres.get("periode") if isinstance(parametres.get("periode"), dict) else None
        if comp:
            pids = [str(comp["id"])]
        elif per and per.get("annee") and per.get("mois"):
            rang = int(per["annee"]) * 12 + int(per["mois"]) - 2
            pids = [str(x) for x in db.execute(text(
                "SELECT id FROM calendrier_paie WHERE societe_id = :s AND annee = :a AND mois = :m"),
                {"s": sec.societe_id, "a": rang // 12, "m": rang % 12 + 1}).scalars()]
        else:
            return []
        if not pids:
            return []
        p2 = {k: v for k, v in parametres.items()
              if k not in ("periode", "periode_comparaison", "bulletin", "inclure_sortants", "_comparaison_detaillee")}
        p2.update({"_periodes_ids": pids, "_sans_comparaison": True})
        deja = {str(b.get("collaborateur_id")) for b in presents}
        libelle = (comp or {}).get("intitule") or None
        res: list[Ligne] = []
        for rb in sorted(self.lire(db, p2, sec), key=lambda x: str((x.get("plan") or {}).get("code") or "")):
            collab = str(rb.get("collaborateur_id"))
            if collab in deja:
                continue
            deja.add(collab)
            ph = dict(rb)
            per_b = rb.get("periode") or {}
            ph["precedent"] = {**{c: rb.get(c) for c in TOTAUX_CUMULES}, "existe": 1,
                               "periode": libelle or per_b.get("intitule") or (f"{int(per_b['mois']):02d}/{per_b['annee']}" if per_b.get("mois") else None),
                               "mode": "Période choisie" if comp else "Mois précédent"}
            for c in TOTAUX_CUMULES:
                ph[c] = Decimal(0)
            ph.update({"id": f"{SORTANT}{rb['id']}", "_comparaison_id": str(rb["id"]), "mouvement": "SORTIE",
                       "sortant": 1, "origine": "SORTANT", "statut": "SORTANT"})
            if per and per.get("id"):
                ph["periode_id"] = str(per["id"])
                ph["periode"] = {k: per.get(k) for k in ("id", "intitule", "annee", "mois", "date_debut", "date_fin")}
            res.append(ph)
        return res

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


SORTANT = "SORTANT:"


def _oui(v: Any) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("1", "oui", "true", "vrai", "o")
    return bool(v)


def _periode_comparaison(parametres: dict) -> Optional[dict]:
    p = parametres.get("periode_comparaison")
    return p if isinstance(p, dict) and p.get("id") else None


def _ajouter_comparaison(db: Session, bulletins: list[Ligne], sec: ContexteSecurite, parametres: Optional[dict] = None) -> None:
    """RG-EDT-PRECEDENT-01 / RG-EDT-COMPARAISON-01 (Adil DAIA) : totaux du bulletin de comparaison du
    même collaborateur — celui de la période « periode_comparaison » si elle est choisie, sinon celui du
    MOIS PRÉCÉDENT (même plan de paie de préférence). `precedent.existe` vaut 0 quand il n'y en a pas
    (entrée, ou premier mois de paie) : le mouvement est alors ENTREE."""
    if not bulletins:
        return
    comp = _periode_comparaison(parametres or {})
    collabs = sorted({str(b["collaborateur_id"]) for b in bulletins if b.get("collaborateur_id")})
    if not collabs:
        return
    cols = ", ".join(f"b.{c}" for c in TOTAUX_CUMULES)
    corps = f"""
        SELECT b.id, b.collaborateur_id, b.plan_paie_id, cal.annee, cal.mois, cal.intitule, {cols} FROM {{table}} b
        JOIN calendrier_paie cal ON cal.id = b.periode_id
        WHERE cal.societe_id = :societe AND b.collaborateur_id IN :collabs AND {{cond}}"""
    if comp:
        cond, binds, expanding = "b.periode_id = :pc", {"pc": str(comp["id"])}, ["collabs"]
    else:
        rangs = sorted({int(b["periode"]["annee"]) * 12 + int(b["periode"]["mois"]) - 2
                        for b in bulletins if (b.get("periode") or {}).get("annee") and (b.get("periode") or {}).get("mois")})
        if not rangs:
            return
        cond, binds, expanding = "(cal.annee * 12 + cal.mois - 1) IN :rangs", {"rangs": rangs}, ["collabs", "rangs"]
    sql = (corps.format(table="bulletin", cond=cond) + " UNION ALL " + corps.format(table="bulletin_historique", cond=cond)
           + " AND NOT EXISTS (SELECT 1 FROM bulletin live WHERE live.id = b.id)")
    q = text(sql)
    for nom in expanding:
        q = q.bindparams(bindparam(nom, expanding=True))
    par_cle: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for paquet in _paquets(collabs):
        for r in db.execute(q, {**binds, "societe": sec.societe_id, "collabs": paquet}).mappings():
            rang = 0 if comp else int(r["annee"]) * 12 + int(r["mois"]) - 1
            par_cle[(str(r["collaborateur_id"]), rang)].append(dict(r))
    for b in bulletins:
        per = b.get("periode") or {}
        if comp:
            rang = 0
        elif per.get("annee") and per.get("mois"):
            rang = int(per["annee"]) * 12 + int(per["mois"]) - 2
        else:
            continue
        candidats = par_cle.get((str(b["collaborateur_id"]), rang), [])
        r = next((c for c in candidats if str(c["plan_paie_id"]) == str(b.get("plan_paie_id"))), candidats[0] if candidats else None)
        prec: dict[str, Any] = {c: (r[c] if r else None) for c in TOTAUX_CUMULES}
        prec["existe"] = 1 if r else 0
        prec["periode"] = (r["intitule"] or f"{int(r['mois']):02d}/{r['annee']}") if r else (comp or {}).get("intitule")
        prec["mode"] = "Période choisie" if comp else "Mois précédent"
        b["precedent"] = prec
        b["_comparaison_id"] = str(r["id"]) if r else None
        b["mouvement"] = "PRESENT" if r else "ENTREE"
        b["sortant"] = 0


# compatibilité (appel historique)
def _ajouter_precedent(db: Session, bulletins: list[Ligne], sec: ContexteSecurite) -> None:
    _ajouter_comparaison(db, bulletins, sec, None)


# =============================================================================
# Écarts rubrique par rubrique — RG-EDT-COMPARAISON-04 (Adil DAIA)
# =============================================================================
STATUTS_ECART = {"NOUVELLE": "Nouvelle", "SUPPRIMEE": "Supprimée", "MODIFIEE": "Modifiée", "IDENTIQUE": "Identique"}
_SOMMES = ("montant", "nombre", "montant_patronal")
_DERNIERS = ("base", "taux", "taux_patronal")


def _dec(v: Any) -> Optional[Decimal]:
    return None if v is None or v == "" else Decimal(str(v))


def _diff(a: Any, b: Any) -> Optional[Decimal]:
    if a is None and b is None:
        return None
    return (_dec(a) or Decimal(0)) - (_dec(b) or Decimal(0))


def _lignes_par_rubrique(db: Session, ids: list[str], societe_id: str) -> dict[str, dict[str, dict]]:
    """{bulletin_id: {code: valeurs cumulées des lignes imprimables de la rubrique}}."""
    res: dict[str, dict[str, dict]] = defaultdict(dict)
    lignes = _lignes_brutes(db, ids, SENS_IMPRIMES)
    params = _rubriques_paie(db, {l["code_rubrique"] for l in lignes}, societe_id)
    for l in lignes:
        code = str(l["code_rubrique"]).strip()
        rub = params.get(code, {})
        e = res[str(l["bulletin_id"])].setdefault(code, {
            **{k: None for k in _SOMMES + _DERNIERS}, "sens": l["sens"], "ordre_affichage": l["ordre_affichage"],
            "libelle": rub.get("libelle_edition") or l.get("libelle") or rub.get("libelle") or code})
        for k in _SOMMES:
            if l.get(k) is not None:
                e[k] = (e[k] or Decimal(0)) + Decimal(str(l[k]))
        for k in _DERNIERS:
            if l.get(k) is not None:
                e[k] = Decimal(str(l[k]))
        if l["ordre_affichage"] is not None and (e["ordre_affichage"] is None or l["ordre_affichage"] < e["ordre_affichage"]):
            e["ordre_affichage"] = l["ordre_affichage"]
    return res


def _renseignee(e: Optional[dict]) -> bool:
    """Une rubrique compte dans une période si son montant, son nombre ou sa part patronale est non nul."""
    return bool(e) and any(e.get(k) not in (None, 0) and Decimal(str(e[k])) != 0 for k in _SOMMES)


def ajouter_ecarts(db: Session, bulletins: list[Ligne], sec: ContexteSecurite) -> None:
    """`_ecarts` (lignes comparées) et `comparaison.*` (décomptes) sur chaque bulletin."""
    ids = set()
    for b in bulletins:
        if not str(b["id"]).startswith(SORTANT):
            ids.add(str(b["id"]))
        if b.get("_comparaison_id"):
            ids.add(str(b["_comparaison_id"]))
    agg = _lignes_par_rubrique(db, sorted(ids), sec.societe_id) if ids else {}
    for b in bulletins:
        cur = {} if str(b["id"]).startswith(SORTANT) else agg.get(str(b["id"]), {})
        prev = agg.get(str(b["_comparaison_id"]), {}) if b.get("_comparaison_id") else {}
        ecarts = []
        for code in set(cur) | set(prev):
            c = cur.get(code) if _renseignee(cur.get(code)) else None
            p = prev.get(code) if _renseignee(prev.get(code)) else None
            if c is None and p is None:
                continue
            ref = c or p
            ligne = {"bulletin_id": b["id"], "code_rubrique": code, "libelle": ref["libelle"], "sens": ref["sens"],
                     "ordre_affichage": min(x for x in ((c or {}).get("ordre_affichage"), (p or {}).get("ordre_affichage"), 10 ** 6) if x is not None)}
            for k in _SOMMES + _DERNIERS:
                ligne[k] = (c or {}).get(k)
                ligne[f"p_{k}"] = (p or {}).get(k)
            ligne["ecart_montant"] = _diff(ligne["montant"], ligne["p_montant"])
            ligne["ecart_nombre"] = _diff(ligne["nombre"], ligne["p_nombre"])
            ligne["ecart_base"] = _diff(ligne["base"], ligne["p_base"])
            ligne["ecart_taux"] = _diff(ligne["taux"], ligne["p_taux"])
            ligne["ecart_patronal"] = _diff(ligne["montant_patronal"], ligne["p_montant_patronal"])
            pm = _dec(ligne["p_montant"])
            ligne["ecart_pct"] = (ligne["ecart_montant"] / abs(pm) * 100).quantize(Decimal("0.01")) if pm else None
            em = ligne["ecart_montant"] or Decimal(0)
            ligne["effet_net"] = em if ref["sens"] == "GAIN" else -em
            if p is None:
                statut = "NOUVELLE"
            elif c is None:
                statut = "SUPPRIMEE"
            elif any((ligne[f"ecart_{k}"] or 0) != 0 for k in ("montant", "nombre", "base", "taux", "patronal")):
                statut = "MODIFIEE"
            else:
                statut = "IDENTIQUE"
            ligne["statut"] = statut
            ligne["statut_libelle"] = STATUTS_ECART[statut]
            ligne["en_ecart"] = 0 if statut == "IDENTIQUE" else 1
            ecarts.append(ligne)
        ecarts.sort(key=lambda x: (x["ordre_affichage"], x["code_rubrique"]))
        b["_ecarts"] = ecarts
        n = {k: sum(1 for e in ecarts if e["statut"] == k) for k in STATUTS_ECART}
        b["comparaison"] = {"nb_rubriques": len(ecarts), "nb_modifiees": n["MODIFIEE"], "nb_nouvelles": n["NOUVELLE"],
                            "nb_supprimees": n["SUPPRIMEE"], "nb_identiques": n["IDENTIQUE"],
                            "nb_ecarts": n["MODIFIEE"] + n["NOUVELLE"] + n["SUPPRIMEE"],
                            "effet_net": sum((e["effet_net"] for e in ecarts), Decimal(0))}


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
    reels = [str(i) for i in bulletin_ids if i is not None and not str(i).startswith(SORTANT)]   # RG-EDT-COMPARAISON-03
    for paquet in _paquets(reels):
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
# BULLETIN_ECART_LIGNE — rubriques comparées d'un bulletin (jeu secondaire)
# =============================================================================
def _champs_ecart() -> list[ChampDecl]:
    g, gp, ge = "Rubrique", "Période de comparaison", "Écart"
    return [
        _t("bulletin_id", "Bulletin", g), _t("code_rubrique", "Code rubrique", g), _t("libelle", "Libellé", g),
        _t("sens", "Sens (GAIN, RETENUE)", g), _n("ordre_affichage", "Ordre d'affichage", g),
        _n("nombre", "Nombre", g), _n("base", "Base", g, masque_defaut="MONTANT"), _n("taux", "Taux", g),
        _m("montant", "Montant", g), _m("montant_patronal", "Montant patronal", g), _n("taux_patronal", "Taux patronal", g),
        _n("p_nombre", "Nombre (comparaison)", gp), _n("p_base", "Base (comparaison)", gp, masque_defaut="MONTANT"),
        _n("p_taux", "Taux (comparaison)", gp), _m("p_montant", "Montant (comparaison)", gp),
        _m("p_montant_patronal", "Montant patronal (comparaison)", gp), _n("p_taux_patronal", "Taux patronal (comparaison)", gp),
        _m("ecart_montant", "Écart de montant", ge), _n("ecart_nombre", "Écart de nombre", ge),
        _n("ecart_base", "Écart de base", ge, masque_defaut="MONTANT"), _n("ecart_taux", "Écart de taux", ge),
        _m("ecart_patronal", "Écart de part patronale", ge),
        _n("ecart_pct", "Écart de montant (%)", ge, masque_defaut="POURCENTAGE"),
        _m("effet_net", "Effet sur le net (gain +, retenue −)", ge),
        _t("statut", "Statut (NOUVELLE, SUPPRIMEE, MODIFIEE, IDENTIQUE)", ge), _t("statut_libelle", "Statut (libellé)", ge),
        _n("en_ecart", "En écart (1/0)", ge),
    ]


class FournisseurBulletinEcart(Fournisseur):
    code = "BULLETIN_ECART_LIGNE"
    libelle = "Rubriques comparées (période / période de comparaison)"
    nature = "PAIE_SNAPSHOT"
    avec_parents = True                        # l'exécuteur transmet les bulletins parents

    def champs(self) -> list[ChampDecl]:
        return _champs_ecart()

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        raise ErreurSource("BULLETIN_ECART_LIGNE se lit comme jeu secondaire d'un jeu BULLETIN")

    def lire_enfants(self, db: Session, cles: list[Any], sec: ContexteSecurite,
                     parametres: Optional[dict] = None, parents: Optional[list[Ligne]] = None) -> dict[Any, list[Ligne]]:
        parents = parents or []
        if any("_ecarts" not in p for p in parents):
            ajouter_ecarts(db, parents, sec)
        return {p["id"]: [dict(e) for e in p.get("_ecarts") or []] for p in parents}


# =============================================================================
# COMPARAISON_RUBRIQUES — une ligne par rubrique, toute la population (jeu principal)
# =============================================================================
TOTAUX_COMPARES = (("TOTAL_BRUT", "Salaire brut", "total_brut"), ("BRUT_IMPOSABLE", "Brut imposable", "total_brut_imposable"),
                   ("COT_SALARIALES", "Cotisations salariales", "total_cot_salariale"),
                   ("NET_IMPOSABLE", "Net imposable", "net_imposable"), ("NET_A_PAYER", "Net à payer", "net_a_payer"),
                   ("COT_PATRONALES", "Cotisations patronales", "total_cot_patronale"),
                   ("COUT_EMPLOYEUR", "Coût employeur", "cout_employeur"))
SENS_COMPARES = {"GAIN": (1, "Éléments de rémunération"), "RETENUE": (2, "Cotisations et retenues"), "TOTAL": (3, "Totaux du bulletin")}


class FournisseurComparaisonRubriques(Fournisseur):
    """RG-EDT-COMPARAISON-05 (Adil DAIA) : masse de chaque rubrique sur la population, dans la période
    et dans la période de comparaison (choisie, ou mois précédent), salariés concernés et mouvements,
    suivie des totaux du bulletin (sens TOTAL). Les sorties sont comptées."""
    code = "COMPARAISON_RUBRIQUES"
    libelle = "Rubriques comparées entre deux périodes (toute la population)"
    nature = "PAIE_SNAPSHOT"
    contexte_requis = ("periode",)

    def champs(self) -> list[ChampDecl]:
        g, gp, ge, gs = "Rubrique", "Période de comparaison", "Écart", "Salariés"
        return [
            _t("id", "Identifiant (code rubrique)", g), _t("code_rubrique", "Code rubrique", g), _t("libelle", "Libellé", g),
            _t("sens", "Sens (GAIN, RETENUE, TOTAL)", g), _t("sens_libelle", "Sens (libellé)", g), _n("rang_sens", "Rang du sens", g),
            _n("ordre_affichage", "Ordre d'affichage", g),
            _m("montant", "Montant", g), _n("nombre", "Nombre", g), _m("montant_patronal", "Montant patronal", g),
            _m("p_montant", "Montant (comparaison)", gp), _n("p_nombre", "Nombre (comparaison)", gp),
            _m("p_montant_patronal", "Montant patronal (comparaison)", gp),
            _m("ecart_montant", "Écart de montant", ge), _n("ecart_nombre", "Écart de nombre", ge),
            _m("ecart_patronal", "Écart de part patronale", ge),
            _n("ecart_pct", "Écart de montant (%)", ge, masque_defaut="POURCENTAGE"),
            _t("statut", "Statut (NOUVELLE, SUPPRIMEE, MODIFIEE, IDENTIQUE)", ge), _t("statut_libelle", "Statut (libellé)", ge),
            _n("en_ecart", "En écart (1/0)", ge),
            _n("nb_salaries", "Salariés concernés", gs), _n("p_nb_salaries", "Salariés concernés (comparaison)", gs),
            _n("nb_modifies", "Salariés dont la rubrique a changé", gs), _n("nb_nouveaux", "Salariés où elle apparaît", gs),
            _n("nb_disparus", "Salariés où elle disparaît", gs),
            _t("periode_libelle", "Période éditée", "Périodes"), _t("p_periode_libelle", "Période de comparaison", "Périodes"),
            _n("effectif", "Effectif payé (période)", "Périodes"), _n("p_effectif", "Effectif payé (comparaison)", "Périodes"),
            _n("nb_entrees", "Entrées (sans bulletin de comparaison)", "Périodes"), _n("nb_sorties", "Sorties", "Périodes"),
        ]

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        per = parametres.get("periode")
        if not isinstance(per, dict):
            raise ErreurSource("Paramètre requis : la période")
        bulletins = FournisseurBulletin().lire(db, {**parametres, "inclure_sortants": True, "_comparaison_detaillee": True}, sec)
        comp = _periode_comparaison(parametres)
        p_lib = (comp or {}).get("intitule") or next(((b.get("precedent") or {}).get("periode") for b in bulletins
                                                      if (b.get("precedent") or {}).get("periode")), None) or "Mois précédent"
        commun = {"periode_libelle": per.get("intitule") or f"{int(per['mois']):02d}/{per['annee']}", "p_periode_libelle": p_lib,
                  "effectif": sum(1 for b in bulletins if not b.get("sortant")),
                  "p_effectif": sum(1 for b in bulletins if (b.get("precedent") or {}).get("existe")),
                  "nb_entrees": sum(1 for b in bulletins if b.get("mouvement") == "ENTREE"),
                  "nb_sorties": sum(1 for b in bulletins if b.get("sortant"))}
        par_code: dict[str, dict] = {}
        zero = Decimal(0)
        for b in bulletins:
            for e in b.get("_ecarts") or []:
                r = par_code.setdefault(e["code_rubrique"], {
                    "id": e["code_rubrique"], "code_rubrique": e["code_rubrique"], "libelle": e["libelle"], "sens": e["sens"],
                    "ordre_affichage": e["ordre_affichage"], "montant": zero, "nombre": zero, "montant_patronal": zero,
                    "p_montant": zero, "p_nombre": zero, "p_montant_patronal": zero,
                    "nb_salaries": 0, "p_nb_salaries": 0, "nb_modifies": 0, "nb_nouveaux": 0, "nb_disparus": 0})
                for k in ("montant", "nombre", "montant_patronal"):
                    r[k] += _dec(e[k]) or zero
                    r["p_" + k] += _dec(e["p_" + k]) or zero
                r["nb_salaries"] += e["statut"] != "SUPPRIMEE"
                r["p_nb_salaries"] += e["statut"] != "NOUVELLE"
                r["nb_modifies"] += e["statut"] == "MODIFIEE"
                r["nb_nouveaux"] += e["statut"] == "NOUVELLE"
                r["nb_disparus"] += e["statut"] == "SUPPRIMEE"
        lignes = sorted(par_code.values(), key=lambda r: (SENS_COMPARES.get(r["sens"], (9,))[0], r["ordre_affichage"], r["code_rubrique"]))
        for k, (code, libelle, col) in enumerate(TOTAUX_COMPARES):
            lignes.append({"id": code, "code_rubrique": code, "libelle": libelle, "sens": "TOTAL", "ordre_affichage": 10 ** 6 + k,
                           "montant": sum((_dec(b.get(col)) or zero for b in bulletins), zero),
                           "p_montant": sum((_dec((b.get("precedent") or {}).get(col)) or zero for b in bulletins), zero),
                           "nombre": None, "p_nombre": None, "montant_patronal": None, "p_montant_patronal": None,
                           "nb_salaries": sum(1 for b in bulletins if _dec(b.get(col))),
                           "p_nb_salaries": sum(1 for b in bulletins if _dec((b.get("precedent") or {}).get(col))),
                           "nb_modifies": sum(1 for b in bulletins if (_dec(b.get(col)) or zero) != (_dec((b.get("precedent") or {}).get(col)) or zero)),
                           "nb_nouveaux": None, "nb_disparus": None})
        for r in lignes:
            r.update(commun)
            r["rang_sens"], r["sens_libelle"] = SENS_COMPARES.get(r["sens"], (9, r["sens"] or ""))
            r["ecart_montant"] = _diff(r["montant"], r["p_montant"])
            r["ecart_nombre"] = _diff(r["nombre"], r["p_nombre"])
            r["ecart_patronal"] = _diff(r["montant_patronal"], r["p_montant_patronal"])
            r["ecart_pct"] = (r["ecart_montant"] / abs(r["p_montant"]) * 100).quantize(Decimal("0.01")) if r["p_montant"] else None
            if not r["p_montant"] and r["montant"] and r["sens"] != "TOTAL":
                r["statut"] = "NOUVELLE"
            elif not r["montant"] and r["p_montant"] and r["sens"] != "TOTAL":
                r["statut"] = "SUPPRIMEE"
            elif (r["ecart_montant"] or 0) != 0 or (r["ecart_nombre"] or 0) != 0 or (r["ecart_patronal"] or 0) != 0 or (r["nb_modifies"] or 0):
                r["statut"] = "MODIFIEE"
            else:
                r["statut"] = "IDENTIQUE"
            r["statut_libelle"] = STATUTS_ECART[r["statut"]]
            r["en_ecart"] = 0 if r["statut"] == "IDENTIQUE" else 1
        return lignes


# =============================================================================
# EXERCICE_SALARIE — un salarié sur l'année (bulletin récapitulatif de l'exercice)
# =============================================================================
_HORS_EXERCICE = {"id", "periode_id", "periode", "plan_paie_id", "statut", "origine", "cumul", "precedent", "comparaison",
                  "_ecarts", "_comparaison_id", "mouvement", "sortant", *TOTAUX_CUMULES}
NOMS_MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre")


class FournisseurExercice(Fournisseur):
    """RG-EDT-EXERCICE-02 (Adil DAIA) : une ligne par salarié payé dans l'exercice (année civile) :
    situation du dernier bulletin de l'année, totaux de l'année, mois payés. Les rubriques se lisent
    mois par mois ([CODE].MT01…MT12) ou sur l'année ([CODE].MT) ; un corps « exercice » les ventile."""
    code = "EXERCICE_SALARIE"
    libelle = "Salariés de l'exercice (récapitulatif annuel)"
    nature = "PAIE_SNAPSHOT"
    contexte_requis = ("annee",)

    def champs(self) -> list[ChampDecl]:
        exclus = {"id", "periode_id", "statut", "origine"} | {c.code for c in CHAMPS_BULLETIN
                                                            if c.code.startswith(("precedent.", "comparaison.", "periode.", "cumul."))}
        g = "Exercice"
        return [_t("id", "Identifiant (collaborateur)", "Bulletin")] + [
            c for c in CHAMPS_BULLETIN if c.code not in exclus and c.code not in ("mouvement", "sortant")] + [
            _n("exercice.annee", "Exercice (année)", g), _n("exercice.nb_bulletins", "Bulletins de l'exercice", g),
            _n("exercice.nb_mois", "Mois payés", g), _n("exercice.premier_mois", "Premier mois payé (1-12)", g),
            _n("exercice.dernier_mois", "Dernier mois payé (1-12)", g), _t("exercice.mois_payes", "Mois payés (texte)", g),
            _d("exercice.date_debut", "Début de l'exercice", g), _d("exercice.date_fin", "Fin de l'exercice", g),
        ]

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        annee = parametres.get("annee")
        if not annee and isinstance(parametres.get("periode"), dict):
            annee = parametres["periode"].get("annee")
        if not annee:
            raise ErreurSource("Paramètre requis : l'année de l'exercice")
        annee = int(annee)
        p = {k: parametres[k] for k in ("plan_paie", "collaborateurs", "collaborateur", "organisations", "_filtres") if k in parametres}
        p.update({"annee": annee, "_sans_comparaison": True})
        bulletins = FournisseurBulletin().lire(db, p, sec)
        par_collab: dict[str, list[Ligne]] = defaultdict(list)
        for b in bulletins:
            par_collab[str(b["collaborateur_id"])].append(b)
        res: list[Ligne] = []
        for collab, liste in par_collab.items():
            liste.sort(key=lambda b: (int((b.get("periode") or {}).get("mois") or 0), str((b.get("plan") or {}).get("code") or "")))
            dernier = liste[-1]
            l = {k: v for k, v in dernier.items() if k not in _HORS_EXERCICE}
            l["id"] = collab
            for c in TOTAUX_CUMULES:
                l[c] = sum((_dec(b.get(c)) or Decimal(0) for b in liste), Decimal(0))
            mois = sorted({int(b["periode"]["mois"]) for b in liste if (b.get("periode") or {}).get("mois")})
            l["cumul"] = {**{c: l[c] for c in TOTAUX_CUMULES}, "nb_bulletins": len(liste)}
            l["_bulletins"] = [{"id": str(b["id"]), "mois": int((b.get("periode") or {}).get("mois") or 0),
                                **{c: b.get(c) for c in TOTAUX_CUMULES}} for b in liste]
            l["exercice"] = {
                "annee": annee, "nb_bulletins": len(liste), "nb_mois": len(mois),
                "premier_mois": mois[0] if mois else None, "dernier_mois": mois[-1] if mois else None,
                "mois_payes": (f"{NOMS_MOIS[mois[0] - 1]} à {NOMS_MOIS[mois[-1] - 1]}" if len(mois) > 1
                               else NOMS_MOIS[mois[0] - 1]) if mois else "",
                "date_debut": date(annee, 1, 1), "date_fin": date(annee, 12, 31)}
            res.append(l)
        return res


# =============================================================================
# Index des rubriques : [CODE].MT / NB / TX / BASE / PAT de chaque bulletin
# =============================================================================
def _index_lignes(lignes: list[Ligne], cle: Callable[[Ligne], Optional[str]], suffixe: Callable[[Ligne], str] = lambda l: "") \
        -> dict[str, dict[str, dict[str, Any]]]:
    """{clé: {code: {MT, NB, PAT, BASE, TX, TXP, ORDRE}}} : MT, NB et PAT cumulés ; BASE et TX gardent la
    dernière valeur. `suffixe` range les valeurs sous MT01…MT12 (récapitulatif de l'exercice)."""
    idx: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for l in lignes:
        k = cle(l)
        if k is None:
            continue
        sfx = suffixe(l)
        r = idx[k].setdefault(l["code_rubrique"], {})
        for attr, col in (("MT", "montant"), ("NB", "nombre"), ("PAT", "montant_patronal")):
            r.setdefault(attr + sfx, Decimal(0))
            if l[col] is not None:
                r[attr + sfx] += Decimal(str(l[col]))
        if l["base"] is not None:
            r["BASE" + sfx] = Decimal(str(l["base"]))
        if l["taux"] is not None:
            r["TX" + sfx] = Decimal(str(l["taux"]))
        if l.get("taux_patronal") is not None:
            r["TXP" + sfx] = Decimal(str(l["taux_patronal"]))
        if l.get("ordre_affichage") is not None:
            r["ORDRE"] = min(r.get("ORDRE", l["ordre_affichage"]), l["ordre_affichage"])
    return idx


def index_rubriques(db: Session, bulletins: list[Ligne], comparer: bool = False) -> dict[str, dict[str, dict[str, Decimal]]]:
    """{bulletin_id: {code: {MT, NB, TX, BASE, PAT}}}, toutes lignes confondues
    (NEUTRE compris : un calcul intermédiaire reste lisible). Une rubrique
    présente sur plusieurs lignes cumule MT, NB et PAT ; BASE et TX gardent la
    dernière valeur. Les totaux d'en-tête sont exposés comme des rubriques.
    CMT / CNB / CBASE : cumuls annuels à date (RG-EDT-CUMUL-01).
    `comparer` : P… (période de comparaison) et E… (écart), RG-EDT-COMPARAISON-02."""
    idx = _index_lignes(_lignes_brutes(db, [b["id"] for b in bulletins]), lambda l: l["bulletin_id"])
    for b in bulletins:
        for code, col in RUBRIQUES_EN_TETE.items():
            if b.get(col) is not None:
                e = idx[b["id"]].setdefault(code, {"MT": Decimal(str(b[col]))})
                cumul = (b.get("cumul") or {}).get(col)
                if cumul is not None:
                    e.setdefault("CMT", cumul)
    # RG-EDT-CUMUL-01 : cumuls par rubrique, y compris d'une rubrique absente du mois
    for bid, codes in _cumuls_rubriques(db, [b for b in bulletins if not str(b["id"]).startswith(SORTANT)]).items():
        for code, valeurs in codes.items():
            idx[bid].setdefault(code, {}).update(valeurs)
    if comparer:
        _index_comparaison(db, bulletins, idx)
    return dict(idx)


def _index_comparaison(db: Session, bulletins: list[Ligne], idx: dict) -> None:
    """RG-EDT-COMPARAISON-02 (Adil DAIA) : [CODE].PMT… (bulletin de comparaison) et [CODE].EMT… (écart)."""
    comp = {str(b["id"]): str(b["_comparaison_id"]) for b in bulletins if b.get("_comparaison_id")}
    autre = _index_lignes(_lignes_brutes(db, sorted(set(comp.values()))), lambda l: l["bulletin_id"]) if comp else {}
    for b in bulletins:
        bid = str(b["id"])
        prec = {code: dict(v) for code, v in autre.get(comp.get(bid), {}).items()}
        for code, col in RUBRIQUES_EN_TETE.items():
            if (b.get("precedent") or {}).get(col) is not None:
                prec.setdefault(code, {})["MT"] = Decimal(str(b["precedent"][col]))
        cible = idx.setdefault(b["id"], {})
        for code in set(cible) | set(prec):
            e = cible.setdefault(code, {})
            p = prec.get(code, {})
            for a in ATTRIBUTS_BASE:
                if p.get(a) is not None:
                    e["P" + a] = p[a]
                if e.get(a) is not None or p.get(a) is not None:
                    e["E" + a] = (e.get(a) or Decimal(0)) - (p.get(a) or Decimal(0))


ATTRIBUTS_BASE = ("MT", "NB", "TX", "BASE", "PAT", "TXP")
_SUFFIXES_MOIS = tuple(f"{m:02d}" for m in range(1, 13))


def index_exercice(db: Session, lignes: list[Ligne]) -> dict[str, dict[str, dict[str, Decimal]]]:
    """RG-EDT-EXERCICE-02 (Adil DAIA) : index des rubriques d'une ligne « exercice » (un salarié sur
    l'année) : MT01…MT12 (NB, BASE, PAT de même ; TX, TXP : dernière valeur du mois) et l'année
    entière sous MT, NB, BASE, PAT (sommes) et TX, TXP (dernière valeur). Les totaux d'en-tête du
    bulletin (NET_A_PAYER…) sont exposés de la même façon. CMT… = valeur de l'année."""
    vers: dict[str, tuple[str, int]] = {}
    for l in lignes:
        for b in l.get("_bulletins") or []:
            vers[str(b["id"])] = (str(l["id"]), int(b["mois"]))
    brutes = _lignes_brutes(db, sorted(vers))
    idx = _index_lignes(brutes, lambda x: vers.get(str(x["bulletin_id"]), (None, 0))[0],
                        lambda x: f"{vers.get(str(x['bulletin_id']), (None, 0))[1]:02d}")
    for l in lignes:
        e_l = idx.setdefault(str(l["id"]), {})
        for b in l.get("_bulletins") or []:
            sfx = f"{int(b['mois']):02d}"
            for code, col in RUBRIQUES_EN_TETE.items():
                if b.get(col) is not None:
                    e = e_l.setdefault(code, {})
                    e["MT" + sfx] = e.get("MT" + sfx, Decimal(0)) + Decimal(str(b[col]))
        for code, e in e_l.items():
            for a in ("MT", "NB", "PAT", "BASE"):
                mois = [e[a + m] for m in _SUFFIXES_MOIS if e.get(a + m) is not None]
                if mois:
                    e[a] = sum(mois, Decimal(0))
                    e["C" + a] = e[a]
            for a in ("TX", "TXP"):
                mois = [e[a + m] for m in _SUFFIXES_MOIS if e.get(a + m) is not None]
                if mois:
                    e[a] = mois[-1]
    return idx


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
enregistrer(FournisseurBulletinEcart())
enregistrer(FournisseurComparaisonRubriques())
enregistrer(FournisseurExercice())
