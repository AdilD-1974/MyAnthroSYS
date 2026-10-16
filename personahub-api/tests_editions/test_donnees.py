"""Données avant la forme : corps, affectations, variables, mises en forme multiples.
RG-EDT-DONNEES-01 à 05 (Adil DAIA)."""
import copy
import io

import pytest
from pypdf import PdfReader

from app.editions.definition import Definition
from app.editions.validation import CatalogueValidation, valider
from tests_editions.recette import B_SARA_SEP, P_SEP, S1, base_requise


def textes(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


COLS = [{"code": "base", "libelle": "Base"}, {"code": "taux", "libelle": "Taux", "type": "TAUX"},
        {"code": "gains", "libelle": "Gains", "total": True}, {"code": "retenues", "libelle": "Retenues", "total": True},
        {"code": "patronal", "libelle": "Part patronale"}]


def definition() -> dict:
    return {
        "parametres": [{"code": "periode", "libelle": "Période", "type": "PERIODE"}],
        "jeux": [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"]}],
        "corps": [
            {"code": "detail", "libelle": "Détail", "nature": "LIGNES", "colonnes": COLS, "affectations": [
                {"rubrique": "SALBASE", "groupe": "Gains", "cibles": {"BASE": "base", "MT": "gains"}},
                {"rubrique": "PRIM_ANC", "groupe": "Gains", "cibles": {"BASE": "base", "TX": "taux", "MT": "gains"}},
                {"rubrique": "BRUT_INTER", "groupe": "Gains", "libelle": "SALAIRE BRUT", "cibles": {"MT": "base"}},
                {"rubrique": "PRIM_EXCEP", "groupe": "Gains", "libelle": "Prime exceptionnelle", "nulle": True,
                 "cibles": {"MT": "gains"}},
                {"rubrique": "AVANCE", "groupe": "Retenues", "cibles": {"MT": "retenues"}},   # ne_editer_si_mt_zero
                {"rubrique": "CNSS_SAL", "groupe": "Retenues",
                 "cibles": {"BASE": "base", "TX": "taux", "MT": "retenues", "PAT": "patronal"}},
                {"rubrique": "ATRISK", "groupe": "Retenues", "negatif": True, "cibles": {"PAT": "patronal"}},
                {"rubrique": "ABSENTE", "groupe": "Retenues", "cibles": {"MT": "retenues"}},  # pas sur le bulletin
            ]},
            {"code": "cumuls", "libelle": "Cumuls", "nature": "CASES",
             "lignes": [{"code": "mois", "libelle": "Mois"}, {"code": "cumul", "libelle": "Cumul"}],
             "colonnes": [{"code": "brut", "libelle": "Brut"}, {"code": "base", "libelle": "Base"},
                          {"code": "jours", "libelle": "Jours", "type": "NOMBRE"}, {"code": "nb", "libelle": "Bulletins"}],
             "affectations": [
                 {"rubrique": "TOTAL_BRUT", "cibles": {"MT": "mois.brut"}},
                 {"rubrique": "TOTAL_BRUT", "periode": "CUMUL", "cibles": {"MT": "cumul.brut"}},
                 {"rubrique": "SALBASE", "cibles": {"MT": "mois.base", "NB": "mois.jours"}},
                 {"rubrique": "PRIM_ANC", "cibles": {"MT": "mois.base"}},                     # somme dans la case
                 {"rubrique": "SALBASE", "periode": "CUMUL", "cibles": {"MT": "cumul.base", "NB": "cumul.jours"}},
                 {"formule": "cumul.nb_bulletins", "cibles": {"VAL": "cumul.nb"}},
             ]},
        ],
        "variables": [
            {"code": "nom_complet", "libelle": "Nom complet", "valeur": 'identite.nom + " " + identite.prenom'},
            {"code": "salut", "libelle": "Salut", "valeur": 'var.nom_complet + " !"'},
            {"code": "brut_cumul", "libelle": "Brut cumulé", "type": "MONTANT", "valeur": "corps.cumuls.cumul.brut"},
        ],
        "usages": {"formes_au_choix": True, "confidentialite": 2},
        "page": {"marges": [12, 12, 12, 12]},
        "bandes": [{"id": "corps_b", "type": "CORPS", "hauteur": 120, "saut_apres": True, "elements": [
            {"id": "nom", "type": "CHAMP", "x": 0, "y": 0, "l": 100, "h": 6, "valeur": "var.salut"},
            {"id": "detail", "type": "TABLEAU", "x": 0, "y": 8, "l": 186, "h": 20, "corps": "detail", "colonnes": [
                {"id": "c_lib", "titre": "Désignation", "largeur": 61, "valeur": "libelle"},
                {"id": "c_base", "titre": "Base", "largeur": 25, "valeur": "base", "affichage": {"masque": "MONTANT_SANS_ZERO"}},
                {"id": "c_taux", "titre": "Taux", "largeur": 20, "valeur": "taux", "affichage": {"masque": "QUANTITE"}},
                {"id": "c_gains", "titre": "Gains", "largeur": 25, "valeur": "gains", "affichage": {"masque": "MONTANT_SANS_ZERO"}, "total": "SOMME"},
                {"id": "c_ret", "titre": "Retenues", "largeur": 25, "valeur": "retenues", "affichage": {"masque": "MONTANT_SANS_ZERO"}, "total": "SOMME"},
                {"id": "c_pat", "titre": "Patronal", "largeur": 30, "valeur": "patronal", "affichage": {"masque": "MONTANT_SANS_ZERO"}},
            ]},
            {"id": "grille", "type": "GRILLE", "x": 0, "y": 30, "l": 120, "h": 15, "largeur_titres": 20, "colonnes": [
                {"id": "g_brut", "titre": "Brut", "largeur": 30, "affichage": {"masque": "MONTANT"}},
                {"id": "g_base", "titre": "Base", "largeur": 30, "affichage": {"masque": "MONTANT"}},
                {"id": "g_jours", "titre": "Jours", "largeur": 20, "affichage": {"masque": "QUANTITE"}},
                {"id": "g_nb", "titre": "Bulletins", "largeur": 20}],
             "lignes": [
                {"id": "g_mois", "titre": "Mois", "valeurs": {"g_brut": "corps.cumuls.mois.brut", "g_base": "corps.cumuls.mois.base",
                                                             "g_jours": "corps.cumuls.mois.jours"}},
                {"id": "g_cumul", "titre": "Cumul", "valeurs": {"g_brut": "corps.cumuls.cumul.brut", "g_base": "corps.cumuls.cumul.base",
                                                               "g_jours": "corps.cumuls.cumul.jours", "g_nb": "corps.cumuls.cumul.nb"}}]},
        ]}],
        "sortie": {"nom_fichier": '"Essai_" + identite.matricule', "eclatement": "collaborateur_id"},
        "formes": [{"code": "compacte", "libelle": "Compacte", "bandes": [{"id": "c2", "type": "CORPS", "hauteur": 10, "elements": [
            {"id": "seul", "type": "CHAMP", "x": 0, "y": 0, "l": 100, "h": 6, "valeur": '"Brut cumulé : " + TEXTE(var.brut_cumul)'}]}],
            "sortie": {"nom_fichier": '"Compacte_" + identite.matricule', "eclatement": "collaborateur_id"}}],
    }


CAT = CatalogueValidation(
    champs={"BULLETIN": {"id", "collaborateur_id", "periode_id", "matricule", "total_brut", "cumul.*", "identite.*",
                         "paiement.*"},
            "SOCIETE": {"raison_sociale"}},
    relations={("BULLETIN", "lignes"): "BULLETIN_LIGNE"},
    rubriques={"SALBASE", "PRIM_ANC", "BRUT_INTER", "PRIM_EXCEP", "AVANCE", "CNSS_SAL", "ATRISK", "ABSENTE"},
)


# ---------------------------------------------------------------- validation
def test_definition_de_donnees_valide():
    r = valider(definition(), CAT)
    assert r.valide, [(e.chemin, e.message) for e in r.erreurs]
    assert ("RUBRIQUE", "CNSS_SAL") in r.dependances and ("RUBRIQUE", "TOTAL_BRUT") in r.dependances


def test_v1_sans_donnees_reste_valide():
    d = definition()
    for k in ("corps", "variables", "usages", "formes"):
        d.pop(k)
    d["bandes"][0]["elements"] = [{"id": "x", "type": "TEXTE", "x": 0, "y": 0, "l": 10, "h": 5, "valeur": '"ok"'}]
    assert valider(d, CAT).valide


@pytest.mark.parametrize("modifier, attendu", [
    (lambda d: d["corps"][0]["affectations"][0]["cibles"].update(MT="inconnue"), "Cible inconnue : inconnue"),
    (lambda d: d["corps"][1]["affectations"][1]["cibles"].update(TX="cumul.base"), "Pas de cumul pour TX"),
    (lambda d: d["corps"][0]["affectations"][0].update(formule="1"), "une rubrique OU une formule"),
    (lambda d: d["corps"][1]["affectations"][5]["cibles"].update(MT="cumul.nb"), "Attribut MT impossible"),
    (lambda d: d["corps"][0]["affectations"][0].update(rubrique="FANTOME"), "Rubrique inconnue ou archivée : FANTOME"),
    (lambda d: d["corps"][1].update(lignes=[]), "au moins une ligne"),
    (lambda d: d["corps"].append(copy.deepcopy(d["corps"][0])), "Corps « detail » déjà utilisé"),
    (lambda d: d["bandes"][0]["elements"][1].update(corps="cumuls"), "corps « lignes » existant"),
    (lambda d: d["bandes"][0]["elements"][0].update(valeur="var.inconnue"), "Champ inconnu"),
    (lambda d: d["bandes"][0]["elements"][2]["lignes"][0]["valeurs"].update(g_brut="corps.cumuls.annee.brut"), "Champ inconnu"),
    (lambda d: d["formes"][0].update(code="standard"), "Mise en forme « standard » déjà utilisé"),
    (lambda d: d["formes"][0]["bandes"][0]["elements"][0].update(valeur="var.nulle_part"), "Champ inconnu"),
])
def test_erreurs_de_donnees(modifier, attendu):
    d = definition()
    modifier(d)
    r = valider(d, CAT)
    assert any(attendu in e.message for e in r.erreurs), [(e.chemin, e.message) for e in r.erreurs]


def test_erreur_de_forme_alternative_situee():
    d = definition()
    d["formes"][0]["bandes"][0]["elements"][0]["valeur"] = "var.nulle_part"
    chemins = [e.chemin for e in valider(d, CAT).erreurs]
    assert any(c.startswith("formes[0].bandes[0]") for c in chemins)


def test_avec_forme():
    d = Definition.model_validate(definition())
    assert d.avec_forme(None) is d and d.avec_forme("standard") is d
    c = d.avec_forme("compacte")
    assert c.bandes[0].id == "c2" and c.corps == d.corps and c.variables == d.variables
    with pytest.raises(ValueError):
        d.avec_forme("inconnue")


# ---------------------------------------------------------------- production
@base_requise
def test_corps_lignes_et_cases_au_rendu(db):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    docs = executer(db, Definition.model_validate(definition()), {"periode": P_SEP, "bulletin": B_SARA_SEP},
                    ContexteSecurite(None, S1, donnees_sensibles=True))
    assert len(docs) == 1 and docs[0].anomalies == [], docs[0].anomalies
    t = textes(docs[0].contenu)
    assert "ALAMI Sara !" in t                                           # variable lisant une variable
    # corps LIGNES : groupes, ordre des affectations, lignes non nulles
    assert t.index("Gains") < t.index("Salaire de base") < t.index("Prime d'ancienneté (SOLGEIS)") < t.index("SALAIRE BRUT")
    assert "Prime exceptionnelle" in t                                  # « Nulls »
    assert "Avance" not in t                                            # ne_editer_si_mt_zero
    assert "ABSENTE" not in t                                           # absente du bulletin
    assert t.index("Retenues") < t.index("Cotisation CNSS")
    assert "-55,65" in t                                                # « en – » sur la part patronale
    assert "1 077,12" in t and "268,80" in t
    # corps CASES : sommes, cumuls, formule
    assert "10 500,00" in t                                             # base du mois = SALBASE + PRIM_ANC
    assert "20 500,00" in t and "20 000,00" in t and "52" in t


@base_requise
def test_mise_en_forme_au_choix(db):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite, ErreurSource
    d = Definition.model_validate(definition())
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    docs = executer(db, d, {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec, forme="compacte")
    assert docs[0].nom_fichier == "Compacte_M001.pdf"
    assert "Brut cumulé : 20500" in textes(docs[0].contenu)            # TEXTE() : valeur brute, sans masque
    with pytest.raises(ErreurSource, match="Mise en forme inconnue"):
        executer(db, d, {"periode": P_SEP}, sec, forme="inconnue")


def test_forme_par_defaut():
    d = definition()
    d["usages"]["forme_par_defaut"] = "inexistante"
    assert any("par défaut inconnue" in e.message for e in valider(d, CAT).erreurs)
    d["usages"]["forme_par_defaut"] = "compacte"
    assert valider(d, CAT).valide


@base_requise
def test_forme_par_defaut_au_rendu(db):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    d = definition()
    d["usages"]["forme_par_defaut"] = "compacte"
    docs = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP},
                    ContexteSecurite(None, S1, donnees_sensibles=True))
    assert docs[0].nom_fichier == "Compacte_M001.pdf"
