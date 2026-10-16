"""Mise en forme — RG-EDT-FORMAT-02/03/04/07, mêmes résultats que la grille (Adil DAIA)."""
from datetime import date, datetime
from decimal import Decimal

import pytest

from app.editions import format as f


@pytest.mark.parametrize("valeur, masque, attendu", [
    # les 7 masques de la grille (rapport_grille_engine.MASQUES), même rendu
    ("1974-10-06", "DATE_FR", "06/10/1974"),
    ("1974-10-06", "DATE_LONGUE", "6 octobre 1974"),
    (1234.5, "MONTANT", "1 234,50"),
    (0, "MONTANT_SANS_ZERO", ""),
    (1234.5, "ENTIER", "1 235"),
    (4.48, "POURCENTAGE", "4,48 %"),
    ("Direction Générale", "MAJUSCULES", "DIRECTION GÉNÉRALE"),
    # ajouts
    (Decimal("2.5"), "ENTIER", "3"),               # la moitié monte (pas d'arrondi au pair)
    (Decimal("-1234567.005"), "MONTANT", "-1 234 567,01"),
    ("1 234,50", "MONTANT", "1 234,50"),           # saisie déjà formatée
    (datetime(2026, 10, 1, 9, 30), "DATE_LONGUE", "1er octobre 2026"),
    (date(2026, 9, 30), "MOIS_ANNEE", "septembre 2026"),
    (Decimal("0.0448"), "TAUX", "0,0448"),
])
def test_masques(valeur, masque, attendu):
    assert f.appliquer_masque(valeur, masque) == attendu


def test_masque_inconnu_ou_inapplicable():          # RG-EDT-FORMAT-04
    assert f.appliquer_masque(Decimal("12.3"), "INEXISTANT") == "12,30"
    assert f.appliquer_masque("abc", "MONTANT") == "abc"
    assert f.appliquer_masque("pas une date", "DATE_FR") == "pas une date"


def test_rendu_par_defaut():                         # RG-EDT-FORMAT-02
    assert f.texte_par_defaut(Decimal("1234.567")) == "1 234,57"
    assert f.texte_par_defaut(2026) == "2026"
    assert f.texte_par_defaut(date(2026, 1, 5)) == "05/01/2026"
    assert f.texte_par_defaut(True) == "Oui"


def test_formater_vide_et_textes():                  # RG-EDT-FORMAT-03
    assert f.formater(None) == "-"
    assert f.formater(None, valeur_si_vide="") == ""
    assert f.formater("", valeur_si_vide="néant") == "néant"
    assert f.formater(None, texte_avant="Né le ") == "-"
    assert f.formater(1500, "MONTANT", texte_apres=" DH") == "1 500,00 DH"
    assert f.formater(0, "MONTANT_SANS_ZERO", texte_apres=" DH") == ""
    assert f.formater(0, "MONTANT_SANS_ZERO", valeur_si_vide="—") == "—"


def test_masque_parametrique_et_registre_societe():
    registre = {"MONTANT_DH": {"type": "NOMBRE", "decimales": 2, "sep_milliers": ".", "sep_decimal": ",",
                               "suffixe": " DH"}}
    assert f.appliquer_masque(1234.5, "MONTANT_DH", registre) == "1.234,50 DH"
    assert f.appliquer_masque(1234.5, {"type": "NOMBRE", "decimales": 1, "prefixe": "≈ "}) == "≈ 1 234,5"


def test_liste_masques():
    exemples = {m["code"]: m["exemple"] for m in f.liste_masques()}
    assert exemples["MONTANT"] == "1 234,50" and exemples["DATE_LONGUE"] == "6 octobre 1974"


def test_masque_quantite():
    assert f.appliquer_masque(Decimal("26.00"), "QUANTITE") == "26"
    assert f.appliquer_masque(Decimal("21.5"), "QUANTITE") == "21,5"
    assert f.appliquer_masque(Decimal("4.48"), "QUANTITE") == "4,48"
    assert f.appliquer_masque(0, "QUANTITE") == ""
