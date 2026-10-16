"""Plan des lignes, cumuls annuels et grilles — RG-EDT-LIGNES-01, RG-EDT-CUMUL-01, RG-EDT-GRILLE-01 (Adil DAIA)."""
import copy
import io
import json
from decimal import Decimal
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.editions.definition import Definition
from app.editions.validation import CatalogueValidation, valider
from tests_editions.recette import B_OMAR_SEP, B_SARA_SEP, P_SEP, S1, base_requise

RACINE = Path(__file__).resolve().parents[1]
BULLETIN = json.loads((RACINE / "app/editions/modeles_systeme/bulletin_classique.json").read_text(encoding="utf-8"))


def textes(pdf: bytes) -> list[str]:
    return [p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages]


def tableau(d: dict) -> dict:
    return next(e for b in d["bandes"] for e in b["elements"] if e["type"] == "TABLEAU")


def avec_plan() -> dict:
    d = copy.deepcopy(BULLETIN)
    t = tableau(d)
    t["sections"] = [
        {"id": "g_gains", "titre": "Éléments de salaire", "rubriques": [
            {"code": "PRIM_ANC"},                                       # ordre du plan, pas celui du bulletin
            {"code": "SALBASE", "libelle": "SALAIRE DE BASE", "style": {"gras": True}},
            {"code": "BRUT_INTER", "libelle": "**** BRUT INTER ****", "style": {"gras": True},
             "valeurs": {"col_base": "montant", "col_gain": "VIDE"}},     # ligne NEUTRE, absente du jeu
            {"code": "INCONNUE_DU_BULLETIN"},                           # ni ligne ni valeur : non imprimée
            {"code": "PRIM_EXCEP", "libelle": "Prime exceptionnelle", "toujours": True},
        ]},
        {"id": "g_ret", "titre": "Cotisations", "rubriques": [{"code": "CNSS_SAL"}]},
    ]
    t["section_autres"] = "Autres éléments"
    t["quadrillage"] = "COLONNES"
    t["lignes_min"] = 14
    return d


def grille() -> dict:
    return {
        "id": "cumuls", "type": "GRILLE", "x": 0, "y": 46, "l": 186, "h": 15, "largeur_titres": 20,
        "colonnes": [
            {"id": "c_brut", "titre": "Salaire brut", "largeur": 40, "affichage": {"masque": "MONTANT"}},
            {"id": "c_base", "titre": "Salaire de base", "largeur": 40, "affichage": {"masque": "MONTANT"}},
            {"id": "c_jours", "titre": "Jours", "largeur": 20, "affichage": {"masque": "QUANTITE"}},
            {"id": "c_conge", "titre": "Prime congé", "largeur": 30, "affichage": {"masque": "MONTANT"}},
            {"id": "c_nb", "titre": "Bulletins", "largeur": 20},
        ],
        "lignes": [
            {"id": "l_mois", "titre": "Mois", "valeurs": {
                "c_brut": "total_brut", "c_base": "[SALBASE].MT", "c_jours": "[SALBASE].NB", "c_conge": "[PRIM_CONGE].MT"}},
            {"id": "l_cumul", "titre": "Cumul", "valeurs": {
                "c_brut": "cumul.total_brut", "c_base": "[SALBASE].CMT", "c_jours": "[SALBASE].CNB",
                "c_conge": "[PRIM_CONGE].CMT", "c_nb": "cumul.nb_bulletins"}},
        ],
    }


# ---------------------------------------------------------------- validation (sans base)
CAT = CatalogueValidation(
    champs={"BULLETIN": {"id", "collaborateur_id", "periode_id", "matricule", "total_brut", "net_imposable", "net_a_payer",
                         "total_cot_salariale", "total_cot_patronale", "cumul.*", "identite.*", "contrat.*",
                         "affectation.*", "situation_familiale.*", "periode.*"},
            "BULLETIN_LIGNE": {"code_rubrique", "libelle", "base", "nombre", "taux", "montant", "montant_patronal",
                               "sens", "ordre_affichage"},
            "SOCIETE": {"raison_sociale", "adresse", "ville", "ice", "numero_cnss"}},
    relations={("BULLETIN", "lignes"): "BULLETIN_LIGNE"},
    rubriques={"SALBASE", "PRIM_ANC", "CNSS_SAL", "BRUT_INTER", "PRIM_EXCEP", "PRIM_CONGE"},
)


def test_plan_et_grille_valides():
    d = avec_plan()
    tableau(d)["sections"][0]["rubriques"].pop(3)               # INCONNUE_DU_BULLETIN
    d["bandes"][1]["elements"].append(grille())
    d["bandes"][1]["hauteur"] = 62
    r = valider(d, CAT)
    assert r.valide, [e.message for e in r.erreurs]
    assert ("RUBRIQUE", "BRUT_INTER") in r.dependances and ("RUBRIQUE", "PRIM_CONGE") in r.dependances


def test_plan_et_grille_erreurs():
    d = avec_plan()
    t = tableau(d)
    t["sections"][0]["rubriques"][1]["valeurs"] = {"col_inexistante": "base"}
    t["sections"][1]["rubriques"].append({"code": "cnss_sal"})   # doublon (casse ignorée)
    g = grille()
    g["lignes"][0]["valeurs"]["c_fantome"] = "1"
    g["lignes"][1]["valeurs"]["c_brut"] = "cumul.inexistant"
    d["bandes"][1]["elements"].append(g)
    d["bandes"][1]["hauteur"] = 62
    messages = [e.message for e in valider(d, CAT).erreurs]
    assert any("INCONNUE_DU_BULLETIN" in m for m in messages)
    assert any("col_inexistante" in m for m in messages)
    assert any("déjà dans ce groupe" in m for m in messages)
    assert any("c_fantome" in m for m in messages)
    # cumul.* est un motif du catalogue : le champ inexistant y passe, comme identite.* (contrôle au rendu)
    assert sum("Colonne inconnue" in m for m in messages) == 2


def test_totaux_d_en_tete_utilisables_comme_rubriques():
    d = avec_plan()
    tableau(d)["sections"][0]["rubriques"] = [{"code": "BRUT_IMPOSABLE", "valeurs": {"col_base": "[BRUT_IMPOSABLE].MT"}},
                                             {"code": "SALBASE"}]
    tableau(d)["sections"].pop(1)
    assert valider(d, CAT).valide


# ---------------------------------------------------------------- base de recette
@base_requise
def test_cumuls_des_totaux(db):
    from app.editions.sources import REGISTRE, ContexteSecurite
    lignes = {l["id"]: l for l in REGISTRE["BULLETIN"].lire(db, {"periode": P_SEP}, ContexteSecurite(None, S1))}
    sara, omar = lignes[B_SARA_SEP], lignes[B_OMAR_SEP]
    assert sara["cumul"]["total_brut"] == Decimal("20500")          # août (historique) + septembre
    assert sara["cumul"]["net_a_payer"] == Decimal("16450.50")
    assert sara["cumul"]["nb_bulletins"] == 2
    assert omar["cumul"]["total_brut"] == Decimal("6000") and omar["cumul"]["nb_bulletins"] == 1


@base_requise
def test_cumuls_des_rubriques(db):
    from app.editions.sources import REGISTRE, ContexteSecurite
    from app.editions.sources.paie import index_rubriques
    lignes = REGISTRE["BULLETIN"].lire(db, {"periode": P_SEP}, ContexteSecurite(None, S1))
    idx = index_rubriques(db, lignes)[B_SARA_SEP]
    # août + septembre, plan MENS ; ni octobre, ni l'autre plan, ni 2025
    assert idx["SALBASE"]["CMT"] == Decimal("20000") and idx["SALBASE"]["CNB"] == Decimal("52")
    assert idx["SALBASE"]["MT"] == Decimal("10000")                 # la valeur du mois est intacte
    assert idx["PRIM_CONGE"] == {"CMT": Decimal("1200"), "CNB": Decimal("0"), "CBASE": Decimal("0")}
    assert idx["TOTAL_BRUT"]["CMT"] == Decimal("20500")


@base_requise
def test_plan_des_lignes_au_rendu(db):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    docs = executer(db, Definition.model_validate(avec_plan()), {"periode": P_SEP, "bulletin": B_SARA_SEP},
                    ContexteSecurite(None, S1, donnees_sensibles=True))
    t = textes(docs[0].contenu)[0]
    assert docs[0].anomalies == []
    assert t.index("Prime d'ancienneté (SOLGEIS)") < t.index("SALAIRE DE BASE")   # ordre du plan
    assert "**** BRUT INTER ****" in t and "Intermédiaire" not in t      # ligne NEUTRE reconstituée
    assert "Prime exceptionnelle" in t                                            # « toujours »
    assert "INCONNUE_DU_BULLETIN" not in t
    assert "Autres éléments" in t and "Accident du travail" in t                 # hors plan → « autres »
    assert t.index("Cotisations") < t.index("Autres éléments")
    assert "Cotisation CNSS" in t and "268,80" in t
    assert "10 500,00" in t                                                       # base forcée de BRUT_INTER


@base_requise
def test_grille_de_cumuls_au_rendu(db):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    d = copy.deepcopy(BULLETIN)
    corps = d["bandes"][1]
    for el in corps["elements"]:
        if el["type"] != "TABLEAU":
            el["y"] += 17
    corps["elements"].append(grille())
    corps["elements"][-1]["y"] = 22
    corps["hauteur"] = 63
    docs = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP},
                    ContexteSecurite(None, S1, donnees_sensibles=True))
    t = textes(docs[0].contenu)[0]
    assert docs[0].anomalies == [], docs[0].anomalies
    assert "Salaire brut" in t and "Cumul" in t
    assert "20 500,00" in t and "20 000,00" in t and "1 200,00" in t
    assert "52" in t
