"""
app/services/pret_eligibilite_engine.py

Applique les règles dynamiques de `pret_type_regle` (§3.2 du dossier
fonctionnel) à une demande candidate. Chaque règle BLOQUANTE non respectée
bloque la demande sauf si `derogation_rh_autorisee` est vraie ET que le code
de la règle figure dans `derogations_explicites` (dérogation RH tracée,
jamais silencieuse).

⚠️ Hypothèses sur votre base non vérifiables depuis cet environnement,
à adapter si besoin :
- table `collaborateurs` avec colonnes `date_embauche`, `code_type_contrat`,
  `salaire_net_imposable` (utilisée pour ANCIENNETE_MIN / TYPE_CONTRAT_AUTORISE
  / QUOTITE_SAISISSABLE).
- Les mensualités "autres saisies" (pensions alimentaires, saisies
  Trésor/tribunal) ne sont PAS dans ce module — si elles existent dans une
  autre table du SIRH, il faut l'ajouter à `_mensualite_autres_saisies`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass
class ResultatRegle:
    code_regle: str
    libelle: str
    niveau: str  # BLOQUANT | ALERTE
    respectee: bool
    message: str
    derogation_rh_autorisee: bool


def verifier_eligibilite(
    db: Session,
    *,
    matricule: str,
    collaborateur_id: UUID | None,
    type_code: str,
    montant_demande: Decimal,
    mensualite_demandee: Decimal,
    date_demande: date,
    derogations_explicites: list[str] | None = None,
) -> list[ResultatRegle]:
    """Évalue toutes les règles actives attachées au type de prêt demandé."""
    derogations_explicites = derogations_explicites or []
    resultats: list[ResultatRegle] = []

    regles = (db.execute(text("""
        SELECT ptr.code_regle, ptr.parametres, ptr.niveau, ptr.derogation_rh_autorisee,
               rtre.libelle
        FROM public.pret_type_regle ptr
        JOIN public.ref_type_regle_eligibilite_pret rtre ON rtre.code = ptr.code_regle
        WHERE ptr.type_pret_code = :type_code AND ptr.actif = true
        ORDER BY ptr.ordre
    """), {"type_code": type_code})).mappings().all()

    for regle in regles:
        code_regle = regle["code_regle"]
        params: dict[str, Any] = regle["parametres"] or {}
        handler = _HANDLERS.get(code_regle)

        if handler is None:
            # Règle du catalogue non (encore) implémentée côté moteur —
            # signalée mais non bloquante par défaut, pour ne jamais planter
            # silencieusement une demande sur une règle mal câblée.
            resultats.append(ResultatRegle(
                code_regle=code_regle, libelle=regle["libelle"], niveau=regle["niveau"],
                respectee=True,
                message=f"Règle '{code_regle}' non implémentée dans le moteur — ignorée.",
                derogation_rh_autorisee=regle["derogation_rh_autorisee"],
            ))
            continue

        respectee, message = handler(
            db=db, matricule=matricule, collaborateur_id=collaborateur_id,
            type_code=type_code, montant_demande=montant_demande,
            mensualite_demandee=mensualite_demandee, date_demande=date_demande,
            params=params,
        )

        # Une règle BLOQUANTE non respectée peut être levée par dérogation RH
        # EXPLICITE — jamais implicite : le code doit apparaître dans la
        # liste transmise par l'appelant (tracée ensuite dans pret_audit_log
        # / la décision du workflow).
        if not respectee and regle["derogation_rh_autorisee"] and code_regle in derogations_explicites:
            message = f"{message} — dérogation RH appliquée."
            respectee = True

        resultats.append(ResultatRegle(
            code_regle=code_regle, libelle=regle["libelle"], niveau=regle["niveau"],
            respectee=respectee, message=message,
            derogation_rh_autorisee=regle["derogation_rh_autorisee"],
        ))

    return resultats


def est_eligible(resultats: list[ResultatRegle]) -> bool:
    """Une demande est bloquée si au moins une règle BLOQUANTE n'est pas
    respectée (après application des dérogations)."""
    return not any(r.niveau == "BLOQUANT" and not r.respectee for r in resultats)


# ---------------------------------------------------------------------------
# Implémentations des règles du catalogue (ref_type_regle_eligibilite_pret)
# ---------------------------------------------------------------------------

def _regle_anciennete_min(db, matricule, collaborateur_id, type_code, montant_demande,
                                 mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    mois_requis = int(params.get("mois", 12))
    row = (db.execute(text(
        "SELECT date_embauche FROM public.collaborateurs WHERE matricule = :matricule"
    ), {"matricule": matricule})).mappings().first()

    if not row or not row["date_embauche"]:
        return False, "Date d'embauche introuvable — impossible de vérifier l'ancienneté."

    anciennete_mois = _mois_entre(row["date_embauche"], date_demande)
    if anciennete_mois < mois_requis:
        return False, f"Ancienneté de {anciennete_mois} mois, {mois_requis} mois requis."
    return True, f"Ancienneté de {anciennete_mois} mois — OK."


def _regle_type_contrat_autorise(db, matricule, collaborateur_id, type_code, montant_demande,
                                        mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    contrats_autorises = set(params.get("contrats", []))
    if not contrats_autorises:
        return True, "Aucune restriction de type de contrat configurée."

    row = (db.execute(text(
        "SELECT code_type_contrat FROM public.collaborateurs WHERE matricule = :matricule"
    ), {"matricule": matricule})).mappings().first()

    code_contrat = row["code_type_contrat"] if row else None
    if code_contrat not in contrats_autorises:
        return False, f"Type de contrat '{code_contrat}' non autorisé pour ce type de prêt (autorisés : {', '.join(sorted(contrats_autorises))})."
    return True, f"Type de contrat '{code_contrat}' autorisé."


def _regle_quotite_saisissable(db, matricule, collaborateur_id, type_code, montant_demande,
                                      mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    pourcent_max = Decimal(str(params.get("pourcent_max", 30)))

    row = (db.execute(text(
        "SELECT salaire_net_imposable FROM public.collaborateurs WHERE matricule = :matricule"
    ), {"matricule": matricule})).mappings().first()
    salaire_net = Decimal(str(row["salaire_net_imposable"])) if row and row["salaire_net_imposable"] else None
    if not salaire_net or salaire_net <= 0:
        return False, "Salaire net imposable introuvable — impossible de calculer la quotité saisissable."

    mensualites_existantes = (db.execute(text("""
        SELECT COALESCE(SUM(mt_echeance), 0) AS total
        FROM public.prets
        WHERE matricule = :matricule
          AND statut IN ('valide', 'debloque', 'en_cours')
    """), {"matricule": matricule})).scalar_one()

    cumul_mensualites = Decimal(str(mensualites_existantes)) + mensualite_demandee
    quotite_utilisee_pct = (cumul_mensualites / salaire_net) * 100

    if quotite_utilisee_pct > pourcent_max:
        return False, (
            f"Quotité saisissable dépassée : {quotite_utilisee_pct:.1f}% du salaire net "
            f"(plafond {pourcent_max}%) en cumulant les prêts en cours + cette demande."
        )
    return True, f"Quotité saisissable respectée : {quotite_utilisee_pct:.1f}% (plafond {pourcent_max}%)."


def _regle_nb_prets_simultanes_max(db, matricule, collaborateur_id, type_code, montant_demande,
                                          mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    nb_max = int(params.get("nb_max", 1))
    nb_actifs = (db.execute(text("""
        SELECT COUNT(*) FROM public.prets
        WHERE matricule = :matricule AND type_code = :type_code
          AND statut IN ('valide', 'debloque', 'en_cours', 'suspendu')
    """), {"matricule": matricule, "type_code": type_code})).scalar_one()

    if nb_actifs >= nb_max:
        return False, f"{nb_actifs} prêt(s) de ce type déjà actif(s), maximum autorisé {nb_max}."
    return True, f"{nb_actifs}/{nb_max} prêt(s) actif(s) de ce type."


def _regle_montant_max(db, matricule, collaborateur_id, type_code, montant_demande,
                              mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    plafond = Decimal(str(params.get("montant", 0)))
    if plafond and montant_demande > plafond:
        return False, f"Montant demandé ({montant_demande}) supérieur au plafond ({plafond})."
    return True, "Montant dans le plafond autorisé."


def _regle_cumul_encours_max(db, matricule, collaborateur_id, type_code, montant_demande,
                                    mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    plafond = Decimal(str(params.get("montant", 0)))
    encours = (db.execute(text("""
        SELECT COALESCE(SUM(capital_restant), 0) FROM public.prets
        WHERE matricule = :matricule AND statut IN ('valide', 'debloque', 'en_cours', 'suspendu')
    """), {"matricule": matricule})).scalar_one()

    cumul = Decimal(str(encours)) + montant_demande
    if plafond and cumul > plafond:
        return False, f"Cumul des encours ({cumul}) dépasserait le plafond ({plafond})."
    return True, f"Cumul des encours après octroi : {cumul} (plafond {plafond})."


def _regle_delai_entre_deux_prets(db, matricule, collaborateur_id, type_code, montant_demande,
                                         mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    mois_carence = int(params.get("mois", 6))
    dernier_solde = (db.execute(text("""
        SELECT dt_decision FROM public.prets
        WHERE matricule = :matricule AND type_code = :type_code
          AND statut IN ('solde', 'cloture_stc_solde', 'cloture_stc_reste_du')
        ORDER BY dt_decision DESC LIMIT 1
    """), {"matricule": matricule, "type_code": type_code})).mappings().first()

    if not dernier_solde or not dernier_solde["dt_decision"]:
        return True, "Aucun prêt antérieur de ce type soldé — pas de délai de carence à vérifier."

    mois_ecoules = _mois_entre(dernier_solde["dt_decision"], date_demande)
    if mois_ecoules < mois_carence:
        return False, f"Délai de carence non respecté : {mois_ecoules} mois écoulés, {mois_carence} requis depuis le dernier prêt soldé."
    return True, f"Délai de carence respecté ({mois_ecoules} mois écoulés)."


def _regle_echeance_bornee_annee_civile(db, matricule, collaborateur_id, type_code, montant_demande,
                                               mensualite_demandee, date_demande, params) -> tuple[bool, str]:
    # Purement informatif ici : le bornage réel est appliqué par
    # pret_engine.generer_echeancier(borner_fin_annee_civile=True). Cette
    # règle sert à afficher l'avertissement au moment de la simulation,
    # jamais à bloquer la demande (les échéances sont réduites, pas refusées).
    return True, "L'échéance finale sera automatiquement bornée au 31 décembre si nécessaire."


_HANDLERS = {
    "ANCIENNETE_MIN": _regle_anciennete_min,
    "TYPE_CONTRAT_AUTORISE": _regle_type_contrat_autorise,
    "QUOTITE_SAISISSABLE": _regle_quotite_saisissable,
    "NB_PRETS_SIMULTANES_MAX": _regle_nb_prets_simultanes_max,
    "MONTANT_MAX": _regle_montant_max,
    "CUMUL_ENCOURS_MAX": _regle_cumul_encours_max,
    "DELAI_ENTRE_DEUX_PRETS": _regle_delai_entre_deux_prets,
    "ECHEANCE_BORNEE_ANNEE_CIVILE": _regle_echeance_bornee_annee_civile,
}


def _mois_entre(d1: date, d2: date) -> int:
    return (d2.year - d1.year) * 12 + (d2.month - d1.month) - (1 if d2.day < d1.day else 0)
