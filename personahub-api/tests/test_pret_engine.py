"""
tests/test_pret_engine.py

Tests unitaires purs du moteur d'amortissement — aucune dépendance DB/API.
À lancer avec : pytest tests/test_pret_engine.py -v
(depuis la racine de personahub-api, avec l'environnement du projet actif)
"""
from datetime import date
from decimal import Decimal

import pytest

from app.services.pret_engine import TrancheMensualite, generer_echeancier


@pytest.mark.parametrize("algo", ["lineaire", "french_amortissement", "in_fine"])
def test_capital_solde_a_zero(algo):
    """Quel que soit l'algo, le capital restant doit être exactement 0 à la
    dernière échéance, et la somme des capitaux remboursés = montant emprunté."""
    resultat = generer_echeancier(Decimal("30000"), Decimal("6"), 12, algo, date(2026, 8, 1))
    assert resultat.echeancier[-1].capital_restant == Decimal("0.00")
    assert sum(e.mt_capital for e in resultat.echeancier) == Decimal("30000.00")


def test_taux_zero_pourcent():
    """Une avance sur salaire (taux 0%) ne doit générer aucun intérêt."""
    resultat = generer_echeancier(Decimal("6000"), Decimal("0"), 6, "lineaire", date(2026, 8, 1))
    assert resultat.cout_total_interets == Decimal("0.00")
    assert all(e.mt_interet == Decimal("0.00") for e in resultat.echeancier)


def test_bornage_fin_annee_civile():
    """§ avance sur salaire : la dernière échéance ne doit jamais dépasser
    le 31 décembre de l'année de la première échéance."""
    resultat = generer_echeancier(
        Decimal("3000"), Decimal("0"), 6, "lineaire", date(2026, 11, 1),
        borner_fin_annee_civile=True,
    )
    assert resultat.nb_echeance_retenu < 6
    assert resultat.echeancier[-1].date_echeance.year == 2026
    assert len(resultat.avertissements) == 1


def test_pas_de_bornage_si_demande_tient_dans_annee():
    resultat = generer_echeancier(
        Decimal("3000"), Decimal("0"), 3, "lineaire", date(2026, 1, 1),
        borner_fin_annee_civile=True,
    )
    assert resultat.nb_echeance_retenu == 3
    assert resultat.avertissements == []


def test_french_mensualite_constante():
    """La méthode française doit avoir une mensualité quasi-identique à
    chaque échéance (aux arrondis près sur la dernière)."""
    resultat = generer_echeancier(Decimal("50000"), Decimal("5"), 24, "french_amortissement", date(2026, 8, 1))
    mensualites = [e.mt_total for e in resultat.echeancier[:-1]]  # la dernière absorbe l'arrondi
    assert len(set(mensualites)) == 1


def test_in_fine_capital_dernier_versement():
    """In fine : le capital n'est remboursé qu'à la toute dernière échéance."""
    resultat = generer_echeancier(Decimal("20000"), Decimal("4"), 6, "in_fine", date(2026, 8, 1))
    for e in resultat.echeancier[:-1]:
        assert e.mt_capital == Decimal("0.00")
    assert resultat.echeancier[-1].mt_capital == Decimal("20000.00")


def test_tranches_mensualite_progressive():
    tranches = [
        TrancheMensualite(1, Decimal("500"), date(2026, 8, 1), date(2027, 1, 1)),
        TrancheMensualite(2, Decimal("800"), date(2027, 2, 1), None),
    ]
    resultat = generer_echeancier(Decimal("10000"), Decimal("4"), 20, "lineaire", date(2026, 8, 1), tranches=tranches)
    assert resultat.echeancier[-1].capital_restant == Decimal("0.00")


def test_montant_zero_ou_negatif_rejete_en_amont():
    """Le moteur lui-même n'impose pas de borne (c'est le rôle des schémas
    Pydantic / règles d'éligibilité) — ce test documente ce choix."""
    resultat = generer_echeancier(Decimal("0"), Decimal("5"), 3, "lineaire", date(2026, 8, 1))
    assert all(e.mt_total == Decimal("0.00") for e in resultat.echeancier)
