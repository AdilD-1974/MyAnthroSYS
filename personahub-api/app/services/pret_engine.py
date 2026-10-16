"""
app/services/pret_engine.py

Moteur d'amortissement — fonctions de calcul PURES (aucun accès DB), pour
rester testables unitairement et réutilisables à la fois par l'endpoint de
simulation (aucune écriture) et par la génération réelle de l'échéancier
(écriture dans pret_echeances).

Trois algorithmes, correspondant à l'enum réel `pret_algo_enum` :
- lineaire            : capital constant par échéance, intérêt dégressif.
- french_amortissement : mensualité totale constante (méthode française
                         classique — annuité constante).
- in_fine             : intérêts seuls à chaque échéance, capital remboursé
                         intégralement à la dernière échéance.

Règle métier §avance sur salaire (Adil, 13/07/2026) : une avance sur salaire
(taux 0%) voit sa dernière échéance bornée au 31 décembre de l'année de la
première échéance — le nombre d'échéances est automatiquement réduit en
conséquence, jamais rejeté silencieusement (le SIRH renvoie un avertissement).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, Optional

TWO_PLACES = Decimal("0.01")


def _round(v: Decimal) -> Decimal:
    return v.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _mois_suivant(d: date, n: int = 1) -> date:
    """Ajoute n mois à une date, en gérant le débordement de jour (ex. 31 → 28/29/30)."""
    mois_total = d.month - 1 + n
    annee = d.year + mois_total // 12
    mois = mois_total % 12 + 1
    jour = d.day
    while True:
        try:
            return date(annee, mois, jour)
        except ValueError:
            jour -= 1  # recule jusqu'à un jour valide (ex. 31 → 30 → ... → 28)


@dataclass
class TrancheMensualite:
    ordre: int
    montant_mensualite: Decimal
    date_debut: date
    date_fin: Optional[date] = None


@dataclass
class EcheanceCalculee:
    numero: int
    date_echeance: date
    capital_du: Decimal          # capital restant AVANT cette échéance
    mt_capital: Decimal
    mt_interet: Decimal
    mt_total: Decimal
    capital_restant: Decimal     # capital restant APRÈS cette échéance
    capital_rembourse_cumule: Decimal
    mt_tva_interet: Decimal = Decimal("0")


@dataclass
class ResultatSimulation:
    algo_name: str
    montant: Decimal
    taux_annuel: Decimal
    nb_echeance_demande: int
    nb_echeance_retenu: int
    mensualite_theorique: Decimal
    cout_total_interets: Decimal
    borne_fin_annee_civile_appliquee: bool
    echeancier: list[EcheanceCalculee] = field(default_factory=list)
    avertissements: list[str] = field(default_factory=list)


def _nb_echeances_avant_fin_annee(date_premiere_echeance: date, nb_echeance_demande: int) -> int:
    """Nombre d'échéances mensuelles, à partir de date_premiere_echeance, qui
    tombent encore dans la même année civile que date_premiere_echeance."""
    fin_annee = date(date_premiere_echeance.year, 12, 31)
    nb = 0
    d = date_premiere_echeance
    while nb < nb_echeance_demande and d <= fin_annee:
        nb += 1
        d = _mois_suivant(date_premiere_echeance, nb)
    return max(nb, 1)


def generer_echeancier(
    montant: Decimal,
    taux_annuel: Decimal,
    nb_echeance: int,
    algo_name: Literal["lineaire", "french_amortissement", "in_fine"],
    date_premiere_echeance: date,
    tranches: Optional[list[TrancheMensualite]] = None,
    borner_fin_annee_civile: bool = False,
    taux_tva: Decimal = Decimal("0"),
) -> ResultatSimulation:
    """Génère l'échéancier théorique. Ne touche à AUCUNE table — appelable
    tel quel depuis l'endpoint de simulation (§4.1 étape 2) ou depuis le
    service qui persiste réellement les échéances à la validation du prêt.
    """
    avertissements: list[str] = []
    nb_echeance_retenu = nb_echeance

    if borner_fin_annee_civile:
        nb_borne = _nb_echeances_avant_fin_annee(date_premiere_echeance, nb_echeance)
        if nb_borne < nb_echeance:
            avertissements.append(
                f"Durée réduite de {nb_echeance} à {nb_borne} échéance(s) : "
                f"l'échéance finale ne peut pas dépasser le 31 décembre "
                f"{date_premiere_echeance.year} (règle avance sur salaire)."
            )
        nb_echeance_retenu = nb_borne

    if tranches:
        echeancier = _generer_par_tranches(montant, taux_annuel, nb_echeance_retenu, date_premiere_echeance, tranches)
    elif algo_name == "lineaire":
        echeancier = _generer_lineaire(montant, taux_annuel, nb_echeance_retenu, date_premiere_echeance)
    elif algo_name == "french_amortissement":
        echeancier = _generer_french(montant, taux_annuel, nb_echeance_retenu, date_premiere_echeance)
    elif algo_name == "in_fine":
        echeancier = _generer_in_fine(montant, taux_annuel, nb_echeance_retenu, date_premiere_echeance)
    else:
        raise ValueError(f"Algorithme d'amortissement inconnu : {algo_name}")

    # TVA sur intérêts — calculée uniformément ici plutôt que dans chaque
    # branche d'algorithme, pour rester correcte quel que soit l'algo choisi.
    if taux_tva and taux_tva > 0:
        for e in echeancier:
            e.mt_tva_interet = _round(e.mt_interet * taux_tva / Decimal("100"))

    cout_total_interets = _round(sum((e.mt_interet for e in echeancier), Decimal("0")))
    mensualite_theorique = echeancier[0].mt_total if echeancier else Decimal("0")

    return ResultatSimulation(
        algo_name=algo_name,
        montant=montant,
        taux_annuel=taux_annuel,
        nb_echeance_demande=nb_echeance,
        nb_echeance_retenu=nb_echeance_retenu,
        mensualite_theorique=mensualite_theorique,
        cout_total_interets=cout_total_interets,
        borne_fin_annee_civile_appliquee=borner_fin_annee_civile and nb_echeance_retenu < nb_echeance,
        echeancier=echeancier,
        avertissements=avertissements,
    )


def _taux_mensuel(taux_annuel: Decimal) -> Decimal:
    return (taux_annuel / Decimal(100)) / Decimal(12)


def _generer_lineaire(montant: Decimal, taux_annuel: Decimal, nb_echeance: int, date_premiere: date) -> list[EcheanceCalculee]:
    tx_mensuel = _taux_mensuel(taux_annuel)
    capital_par_echeance = _round(montant / nb_echeance)
    capital_restant = montant
    cumule = Decimal("0")
    echeancier: list[EcheanceCalculee] = []

    for i in range(1, nb_echeance + 1):
        capital_du = capital_restant
        # Dernière échéance : absorbe l'arrondi cumulé pour tomber pile à 0.
        mt_capital = capital_du if i == nb_echeance else capital_par_echeance
        mt_interet = _round(capital_du * tx_mensuel)
        mt_total = _round(mt_capital + mt_interet)
        capital_restant = _round(capital_du - mt_capital)
        cumule = _round(cumule + mt_capital)
        echeancier.append(EcheanceCalculee(
            numero=i, date_echeance=_mois_suivant(date_premiere, i - 1),
            capital_du=capital_du, mt_capital=mt_capital, mt_interet=mt_interet,
            mt_total=mt_total, capital_restant=capital_restant, capital_rembourse_cumule=cumule,
        ))
    return echeancier


def _generer_french(montant: Decimal, taux_annuel: Decimal, nb_echeance: int, date_premiere: date) -> list[EcheanceCalculee]:
    tx_mensuel = _taux_mensuel(taux_annuel)
    if tx_mensuel == 0:
        mensualite = _round(montant / nb_echeance)
    else:
        facteur = (1 + tx_mensuel) ** nb_echeance
        mensualite = _round(montant * tx_mensuel * facteur / (facteur - 1))

    capital_restant = montant
    cumule = Decimal("0")
    echeancier: list[EcheanceCalculee] = []

    for i in range(1, nb_echeance + 1):
        capital_du = capital_restant
        mt_interet = _round(capital_du * tx_mensuel)
        mt_capital = capital_du if i == nb_echeance else _round(mensualite - mt_interet)
        mt_total = _round(mt_capital + mt_interet)
        capital_restant = _round(capital_du - mt_capital)
        cumule = _round(cumule + mt_capital)
        echeancier.append(EcheanceCalculee(
            numero=i, date_echeance=_mois_suivant(date_premiere, i - 1),
            capital_du=capital_du, mt_capital=mt_capital, mt_interet=mt_interet,
            mt_total=mt_total, capital_restant=capital_restant, capital_rembourse_cumule=cumule,
        ))
    return echeancier


def _generer_in_fine(montant: Decimal, taux_annuel: Decimal, nb_echeance: int, date_premiere: date) -> list[EcheanceCalculee]:
    tx_mensuel = _taux_mensuel(taux_annuel)
    mt_interet_periode = _round(montant * tx_mensuel)
    echeancier: list[EcheanceCalculee] = []

    for i in range(1, nb_echeance + 1):
        capital_du = montant
        if i < nb_echeance:
            mt_capital = Decimal("0")
            capital_restant = montant
        else:
            mt_capital = montant
            capital_restant = Decimal("0")
        mt_total = _round(mt_capital + mt_interet_periode)
        echeancier.append(EcheanceCalculee(
            numero=i, date_echeance=_mois_suivant(date_premiere, i - 1),
            capital_du=capital_du, mt_capital=mt_capital, mt_interet=mt_interet_periode,
            mt_total=mt_total, capital_restant=capital_restant,
            capital_rembourse_cumule=mt_capital if i == nb_echeance else Decimal("0"),
        ))
    return echeancier


def _generer_par_tranches(
    montant: Decimal, taux_annuel: Decimal, nb_echeance: int,
    date_premiere: date, tranches: list[TrancheMensualite],
) -> list[EcheanceCalculee]:
    """Mensualité totale imposée par tranche (généralise MENS_TRANCHE_1/2/3
    du legacy) — le capital de chaque échéance est déduit de la mensualité
    fixée, l'intérêt étant calculé sur le capital restant, comme en méthode
    française mais avec un montant de mensualité qui change dans le temps."""
    tx_mensuel = _taux_mensuel(taux_annuel)
    tranches_triees = sorted(tranches, key=lambda t: t.ordre)
    capital_restant = montant
    cumule = Decimal("0")
    echeancier: list[EcheanceCalculee] = []

    for i in range(1, nb_echeance + 1):
        d_echeance = _mois_suivant(date_premiere, i - 1)
        tranche_active = next(
            (t for t in tranches_triees if t.date_debut <= d_echeance and (t.date_fin is None or d_echeance <= t.date_fin)),
            tranches_triees[-1],
        )
        capital_du = capital_restant
        mt_interet = _round(capital_du * tx_mensuel)
        mt_capital_theorique = _round(tranche_active.montant_mensualite - mt_interet)
        mt_capital = capital_du if (i == nb_echeance or mt_capital_theorique >= capital_du) else mt_capital_theorique
        mt_total = _round(mt_capital + mt_interet)
        capital_restant = _round(capital_du - mt_capital)
        cumule = _round(cumule + mt_capital)
        echeancier.append(EcheanceCalculee(
            numero=i, date_echeance=d_echeance, capital_du=capital_du,
            mt_capital=mt_capital, mt_interet=mt_interet, mt_total=mt_total,
            capital_restant=capital_restant, capital_rembourse_cumule=cumule,
        ))
        if capital_restant <= 0:
            break
    return echeancier


def recalculer_apres_remboursement_anticipe(
    capital_restant_apres: Decimal,
    taux_annuel: Decimal,
    nb_echeances_restantes_avant: int,
    mensualite_actuelle: Decimal,
    algo_name: Literal["lineaire", "french_amortissement", "in_fine"],
    date_prochaine_echeance: date,
    impact: Literal["REDUCTION_MENSUALITE", "REDUCTION_DUREE"],
) -> ResultatSimulation:
    """§4.3.A — recalcule le reste de l'échéancier après un remboursement
    anticipé partiel, selon l'impact choisi par le gestionnaire RH."""
    if capital_restant_apres <= 0:
        return ResultatSimulation(
            algo_name=algo_name, montant=Decimal("0"), taux_annuel=taux_annuel,
            nb_echeance_demande=0, nb_echeance_retenu=0, mensualite_theorique=Decimal("0"),
            cout_total_interets=Decimal("0"), borne_fin_annee_civile_appliquee=False,
        )

    if impact == "REDUCTION_DUREE":
        # Mensualité inchangée, la durée restante est recalculée.
        tx_mensuel = _taux_mensuel(taux_annuel)
        if algo_name == "french_amortissement" and tx_mensuel > 0 and mensualite_actuelle > capital_restant_apres * tx_mensuel:
            n = math.ceil(
                -math.log(1 - float(tx_mensuel * capital_restant_apres / mensualite_actuelle))
                / math.log(1 + float(tx_mensuel))
            )
        else:
            n = math.ceil(float(capital_restant_apres / mensualite_actuelle)) if mensualite_actuelle > 0 else nb_echeances_restantes_avant
        return generer_echeancier(capital_restant_apres, taux_annuel, max(n, 1), algo_name, date_prochaine_echeance)

    # REDUCTION_MENSUALITE : durée inchangée, nouvelle mensualité recalculée.
    return generer_echeancier(capital_restant_apres, taux_annuel, nb_echeances_restantes_avant, algo_name, date_prochaine_echeance)
