"""Langage de formules des éditions — RG-EDT-FORMULE-01..06 (Adil DAIA)."""
from datetime import date
from decimal import Decimal

import pytest

from app.editions import expressions as ex
from app.services import regle_dsl as dsl

D = Decimal


def r(**kw):
    base = dict(
        ligne={
            "identite": {"nom": "ALAMI", "prenom": "Sara", "matricule": "M001",
                         "date_naissance": "1990-03-01"},
            "contrat": {"code_type_contrat": "CDI", "date_embauche": "2015-10-01"},
            "regimes": [{"code_regime": "CNSS", "date_affiliation": "2015-10-05"},
                        {"code": "CIMR", "taux": D("6")}],
            "b.net_a_payer": D("8450.50"),
            "montant": D("100"),
            "vide": None,
        },
        parametres={"periode": {"code": "2026-09", "date_fin": date(2026, 9, 30)},
                    "date_edition": date(2026, 10, 16)},
        rubriques={"SALBASE": {"MT": D("10000"), "NB": D("26"), "BASE": D("10000"), "TX": D("100")},
                   "PRIM_ANC": {"MT": D("500")},
                   "CNSS_SAL": {"MT": D("268.80"), "PAT": D("1077.12")}},
        constantes={"CNSS_TAUX_SALARIAL": D("4.48")},
        date_jour=date(2026, 10, 16),
    )
    base.update(kw)
    return ex.ResolverEdition(**base)


def ev(src, resolver=None):
    return ex.evaluer(src, resolver or r())


# ---- syntaxe héritée de la paie : même résultat que regle_dsl ----
@pytest.mark.parametrize("src", [
    "1 + 2 * 3", "(1 + 2) * 3", "10 / 4", "200 % 10", "200 -% 10", "10 / 0",
    'SI(2 > 1, "oui", "non")', "ARRONDI(2.345, 2)", "MAX(1, 7, 3)", "ABS(-4)",
    '"A" + "B"', "NON VRAI", "1 = 1 ET 2 <> 3", "MOD(10, 3)",
    "MOISENTRE(DATEJOUR(), DATEJOUR())", "FINMOIS(DATEJOUR())",
])
def test_meme_resultat_que_la_paie(src):
    class Rp:
        def date_jour(self): return date(2026, 10, 16)
        def date_paie(self): return date(2026, 10, 16)
        def manquant(self, q): pass
    attendu = dsl.Evaluator(Rp(), {}).eval(dsl.compiler_expression(src))
    assert ev(src) == attendu


def test_rubriques_et_constantes():
    assert ev("[SALBASE].MT + [PRIM_ANC].MT") == D("10500")
    assert ev("[SALBASE]") == D("10000")             # .MT par défaut, comme en paie
    assert ev("[CNSS_SAL].PAT") == D("1077.12")
    assert ev("#CNSS_TAUX_SALARIAL") == D("4.48")
    assert ev("[SALBASE].MT * #CNSS_TAUX_SALARIAL % 1") == D("4.48") * D("10000") / 100


def test_rubrique_absente_vaut_vide_sans_manque():
    res = r()
    assert ex.evaluer("[INCONNUE].MT", res) is None
    assert res.manques == []


def test_attribut_rubrique_inconnu():
    with pytest.raises(ex.ErreurFormule, match="Attribut de rubrique inconnu"):
        ex.compiler("[SALBASE].XX")


# ---- ajouts des éditions ----
def test_champs_et_chemins():
    assert ev("identite.nom") == "ALAMI"
    assert ev('identite.prenom + " " + identite.nom') == "Sara ALAMI"
    assert ev("b.net_a_payer") == D("8450.50")        # ligne déjà aplatie
    assert ev("montant * 2") == D("200")              # nom simple = champ de la ligne
    assert ev("regimes.CNSS.date_affiliation") == "2015-10-05"
    assert ev("regimes.CIMR.taux") == D("6")


def test_champ_absent_vaut_vide_et_est_signale():   # RG-EDT-FORMULE-03
    res = r()
    assert ex.evaluer("identite.surnom", res) is None
    assert ex.evaluer("regimes.AMO.date_affiliation", res) is None
    assert "champ identite.surnom" in res.manques


def test_parametres():
    assert ev("@periode.code") == "2026-09"
    assert ev("@periode.date_fin") == date(2026, 9, 30)
    assert ev("ANNEES(@date_edition, contrat.date_embauche)") == D("11")
    res = r()
    assert ex.evaluer("@inconnu", res) is None and "paramètre @inconnu" in res.manques


def test_vide_se_propage():                          # RG-EDT-FORMULE-04
    assert ev("vide + 1") is None
    assert ev("VIDE * 3") is None
    assert ev('"Nom : " + vide') == "Nom : "
    assert ev("vide = VIDE") is True
    assert ev("vide <> 0") is True
    assert ev("vide > 0") is False
    assert ev('SIVIDE(vide, "néant")') == "néant"
    assert ev('SIVIDE(identite.nom, "néant")') == "ALAMI"


def test_si_paresseux_et_sans_sinon():               # RG-EDT-FORMULE-05
    assert ev('SI(contrat.code_type_contrat = "CDI", "indéterminée", 1 / 0)') == "indéterminée"
    assert ev('SI(FAUX, "x")') is None
    assert ev("FAUX ET (1 / 0 = 1)") is False


def test_chaine_avec_guillemet_double():
    assert ev('"il a dit ""oui"""') == 'il a dit "oui"'


def test_fonctions_texte():
    assert ev("MAJUSCULE(identite.prenom)") == "SARA"
    assert ev('GAUCHE(identite.nom, 2) + DROITE(identite.nom, 2)') == "ALMI"
    assert ev('REMPLACER("a-b-c", "-", "/")') == "a/b/c"
    assert ev('SUPPRESPACE("  a   b ")') == "a b"
    assert ev('CONTIENT(identite.nom, "lam")') is True


def test_format_et_lettres():
    assert ev('FORMAT(b.net_a_payer, "MONTANT")') == "8 450,50"
    assert ev('FORMAT(identite.date_naissance, "DATE_LONGUE")') == "1er mars 1990"
    assert ev("MONTANT_EN_LETTRES(1234.5)") == "mille deux cent trente-quatre dirhams et cinquante centimes"
    assert ev("MONTANT_EN_LETTRES(1)") == "un dirham"
    assert ev('MONTANT_EN_LETTRES(81.01, "FR")') == "quatre-vingt-un dirhams et un centime"
    assert "درهم" in ev('MONTANT_EN_LETTRES(10, "AR")')


def test_agregats_lus_dans_le_resolver():           # RG-EDT-FORMULE-06
    cle = ex.cle_expression(ex.compiler("montant"))
    res = r(agregats={("TOTAL", cle, "GROUPE"): D("300"), ("TOTAL", cle, "PAGE"): D("900")})
    assert ex.evaluer("TOTAL(montant)", res) == D("300")
    assert ex.evaluer("TOTAL(montant, PAGE)", res) == D("900")
    with pytest.raises(ex.ErreurFormule, match="Portée inconnue"):
        ex.evaluer("TOTAL(montant, SEMAINE)", res)


def test_somme_garde_son_sens_paie():
    assert ex.FONCTIONS["SOMME"] is dsl.FONCTIONS["SOMME"]


def test_contexte_de_page():
    res = r(contexte={"PAGE": D(2), "NB_PAGES": D(5)})
    assert ex.evaluer('"Page " + PAGE() + " / " + NB_PAGES()', res) == "Page 2 / 5"


# ---- erreurs et sécurité ----
def test_erreur_positionnee():                       # RG-EDT-FORMULE-01
    with pytest.raises(ex.ErreurFormule) as e:
        ex.compiler("identite.nom + + ")
    assert e.value.debut is not None
    with pytest.raises(ex.ErreurFormule) as e:
        ex.compiler("1 + $")
    assert (e.value.debut, e.value.fin) == (4, 5)


def test_fonction_inconnue():
    with pytest.raises(ex.ErreurFormule, match="Fonction inconnue"):
        ev("NIMPORTE(1)")


def test_budget():                                   # RG-EDT-FORMULE-02
    src = " + ".join(["1"] * 600)
    with pytest.raises(ex.ErreurBudget):
        ex.evaluer(src, r(), budget=100)
    assert ex.evaluer(src, r()) == D(600)


def test_pas_d_execution_de_code():
    for src in ['__import__("os")', "().__class__", "open(1)"]:
        with pytest.raises(ex.ErreurFormule):
            ev(src)


def test_registre_paie_intact():
    """Importer les éditions ne modifie pas les fonctions de la paie."""
    assert "MAJUSCULE" not in dsl.FONCTIONS and "FORMAT" not in dsl.FONCTIONS


# ---- analyse statique ----
def test_analyse_references():
    a = ex.analyser('SI(identite.nom <> "", [SALBASE].MT * #CNSS_TAUX_SALARIAL, @periode.code) + TOTAL(montant, ETAT)')
    assert a.champs == {"identite.nom", "montant"}
    assert a.rubriques == {"SALBASE"} and a.constantes == {"CNSS_TAUX_SALARIAL"}
    assert a.parametres == {"periode"}
    assert a.agregats == [("TOTAL", ex.cle_expression(ex.compiler("montant")), "ETAT")]
    assert a.erreurs == []


def test_analyse_signale_inconnus():
    a = ex.analyser("nom + identite.surnom + @perode", champs_connus={"identite.nom"},
                    parametres_connus={"periode"})
    messages = [e.message for e in a.erreurs]
    assert "Champ inconnu : nom" in messages
    assert "Champ inconnu : identite.surnom" in messages
    assert "Paramètre inconnu : @perode" in messages


# ---- texte à variables ----
def test_interpolation():
    texte = 'Attestons que {identite.prenom + " " + identite.nom}, née le {FORMAT(identite.date_naissance, "DATE_FR")}, perçoit {b.net_a_payer} DH.{vide}'
    assert ex.interpoler(texte, r()) == "Attestons que Sara ALAMI, née le 01/03/1990, perçoit 8 450,50 DH."


def test_interpolation_accolade_dans_chaine_et_non_fermee():
    assert ex.interpoler('{"a}b"}', r()) == "a}b"
    with pytest.raises(ex.ErreurFormule, match="non fermée"):
        ex.interpoler("Bonjour {identite.nom", r())


def test_catalogue():
    noms = {f["nom"]: f for f in ex.catalogue()}
    assert noms["TOTAL"]["origine"] == "EDITION" and noms["ARRONDI"]["origine"] == "PAIE"
