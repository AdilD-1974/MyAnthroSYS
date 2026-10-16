"""Définition, validation et variantes — RG-EDT-VERSION-01/03, RG-EDT-FORME-01..04 (Adil DAIA)."""
import copy
import json
from pathlib import Path

import pytest

from app.editions import variantes as va
from app.editions.definition import Definition
from app.editions.validation import CatalogueValidation, valider

BULLETIN = json.loads((Path(__file__).resolve().parents[1] / "app" / "editions" / "modeles_systeme"
                       / "bulletin_classique.json").read_text(encoding="utf-8"))

CATALOGUE = CatalogueValidation(
    champs={
        "BULLETIN": {"id", "collaborateur_id", "periode_id", "matricule", "total_brut", "net_imposable",
                     "net_a_payer", "total_gains", "total_retenues",
                     "identite.*", "contrat.*", "affectation.*", "situation_familiale.*", "regimes.*.*"},
        "BULLETIN_LIGNE": {"code_rubrique", "libelle", "base", "nombre", "taux", "montant",
                           "montant_patronal", "sens", "ordre_affichage"},
        "SOCIETE": {"raison_sociale", "adresse", "ville", "ice", "numero_cnss", "identifiant_fiscal"},
    },
    relations={("BULLETIN", "lignes"): "BULLETIN_LIGNE"},
    rubriques={"SALBASE", "PRIM_ANC", "CNSS_SAL"},
)


def d(**modifs):
    brut = copy.deepcopy(BULLETIN)
    for chemin, valeur in modifs.items():
        cible = brut
        parties = chemin.split("__")
        for p in parties[:-1]:
            cible = cible[int(p)] if p.isdigit() else cible[p]
        dernier = parties[-1]
        cible[int(dernier) if dernier.isdigit() else dernier] = valeur
    return brut


def messages(rapport):
    return [(e.chemin, e.message) for e in rapport.erreurs]


# ---- le bulletin système de référence ----
def test_bulletin_classique_valide():
    r = valider(BULLETIN, CATALOGUE)
    assert r.valide, messages(r)
    assert ("SOURCE", "BULLETIN") in r.dependances and ("SOURCE", "BULLETIN_LIGNE") in r.dependances
    assert ("CHAMP", "BULLETIN.net_a_payer") in r.dependances
    assert ("CHAMP", "BULLETIN_LIGNE.montant") in r.dependances
    assert ("CHAMP", "SOCIETE.raison_sociale") in r.dependances
    assert ("MASQUE", "MONTANT") in r.dependances


def test_empreinte_stable_et_sensible():               # RG-EDT-VERSION-01
    a = Definition.model_validate(BULLETIN)
    b = Definition.model_validate(json.loads(json.dumps(BULLETIN)))
    assert a.empreinte() == b.empreinte() and len(a.empreinte()) == 64
    c = Definition.model_validate(d(page__orientation="PAYSAGE"))
    assert c.empreinte() != a.empreinte()


# ---- erreurs avec chemin (RG-EDT-VERSION-03) ----
def test_structure_invalide_donne_un_chemin():
    r = valider(d(bandes__0__elements__0__x=-5), CATALOGUE)
    assert any(ch == "bandes[0].elements[0].x" for ch, _ in messages(r))
    r = valider(d(bandes__0__elements__0__type="INCONNU"), CATALOGUE)
    assert not r.valide


def test_champ_inconnu_dans_une_formule_positionne():
    r = valider(d(bandes__0__elements__10__valeur="identite.nom + salaire_reel"), CATALOGUE)
    err = next(e for e in r.erreurs if "salaire_reel" in e.message)
    assert err.chemin == "bandes[0].elements[10].valeur"


def test_contexte_du_tableau():
    # une colonne lit le jeu secondaire, pas le principal
    r = valider(d(bandes__1__elements__0__colonnes__0__valeur="net_a_payer"), CATALOGUE)
    assert any("jeu « l »" in m and "net_a_payer" in m for _, m in messages(r))


def test_syntaxe_et_fonction():
    r = valider(d(bandes__2__elements__1__valeur='"Page " + * PAGE()'), CATALOGUE)
    err = next(e for e in r.erreurs if e.chemin == "bandes[2].elements[1].valeur")
    assert err.debut is not None
    r = valider(d(bandes__2__elements__1__valeur="INCONNUE(1)"), CATALOGUE)
    assert any("Fonction inconnue" in m for _, m in messages(r))


def test_rubrique_parametre_masque_inconnus():
    r = valider(d(bandes__1__elements__2__valeur="[SALBASE].MT + [ARCHIVEE].MT + @inconnu"), CATALOGUE)
    msgs = [m for _, m in messages(r)]
    assert "Rubrique inconnue ou archivée : ARCHIVEE" in msgs
    assert "Paramètre inconnu : @inconnu" in msgs
    r = valider(d(bandes__1__elements__3__affichage={"masque": "PAS_DE_MASQUE"}), CATALOGUE)
    assert "Masque inconnu : PAS_DE_MASQUE" in [m for _, m in messages(r)]


def test_texte_riche_positions_decalees():
    brut = d()
    brut["bandes"][1]["elements"].append(
        {"id": "attestation", "type": "TEXTE_RICHE", "x": 0, "y": 0, "l": 100, "h": 10,
         "contenu": "Nous attestons que {identite.nom} {salaire_reel}"})
    r = valider(brut, CATALOGUE)
    err = next(e for e in r.erreurs if "salaire_reel" in e.message)
    assert err.chemin.endswith(".contenu")


def test_jeux_et_relations():
    r = valider(d(jeux__1__relation="prets"), CATALOGUE)
    assert any(ch == "jeux[1].relation" for ch, _ in messages(r))
    r = valider(d(jeux__1__role="PRINCIPAL"), CATALOGUE)
    msgs = [m for _, m in messages(r)]
    assert any("exactement un jeu PRINCIPAL" in m for m in msgs)
    assert any("jeu SECONDAIRE" in m for m in msgs)
    r = valider(d(jeux__0__source="INCONNUE"), CATALOGUE)
    assert ("jeux[0].source", "Source inconnue : INCONNUE") in messages(r)


def test_identifiants_uniques():
    r = valider(d(bandes__0__elements__1__id="logo"), CATALOGUE)
    assert any("déjà utilisé" in m for _, m in messages(r))


def test_geometrie():
    r = valider(d(bandes__0__elements__0__x=170), CATALOGUE)     # 170 + 35 > 186 mm utiles
    assert any("Déborde à droite" in m for _, m in messages(r))
    r = valider(d(bandes__0__elements__0__y=40), CATALOGUE)      # 40 + 18 > 48 mm de bande
    assert any("Déborde de sa bande" in m for _, m in messages(r))
    r = valider(d(bandes__1__elements__0__colonnes__1__largeur=200), CATALOGUE)
    assert any("Colonnes" in m for _, m in messages(r))


def test_dimensions_page():
    p = Definition.model_validate(d(page__orientation="PAYSAGE")).page
    assert p.dimensions() == (297.0, 210.0) and p.largeur_utile() == 297 - 24


# ---- variantes de forme ----
BASE = Definition.model_validate(BULLETIN)


def test_variante_modifie_la_forme():
    r = va.appliquer(BASE, [
        {"cible": "logo", "action": "MODIFIER", "proprietes": {"x": 5, "l": 30}},
        {"cible": "titre", "action": "MODIFIER", "proprietes": {"style": {"taille": 14}}},
        {"cible": "lib_matricule", "action": "MODIFIER", "proprietes": {"valeur": '"Mle"'}},
        {"cible": "col_libelle", "action": "MODIFIER", "proprietes": {"titre": "Libellé", "largeur": 60}},
        {"cible": "col_taux", "action": "MASQUER"},
        {"cible": "cin", "action": "MASQUER"},
        {"cible": "@page", "action": "MODIFIER", "proprietes": {"marges": [10, 10, 10, 10]}},
        {"cible": "pied", "action": "AJOUTER",
         "element": {"id": "confidentiel", "type": "TEXTE", "x": 0, "y": 8, "l": 40, "h": 2, "valeur": '"Confidentiel"'}},
    ])
    assert r.conflits == [] and r.appliquees == 8
    e = {el.id: el for b in r.definition.bandes for el in b.elements}
    assert e["logo"].x == 5 and e["titre"].style.taille == 14 and e["titre"].style.gras is True
    assert e["lib_matricule"].valeur == '"Mle"' and "cin" not in e and "confidentiel" in e
    cols = {c.id: c for c in e["lignes"].colonnes}
    assert cols["col_taux"].masquee and cols["col_libelle"].titre == "Libellé"
    assert r.definition.page.marges == (10, 10, 10, 10)
    assert BASE.page.marges == (12, 12, 12, 12)          # la base n'est pas modifiée


@pytest.mark.parametrize("surcharge, motif", [
    ({"cible": "net", "action": "MASQUER"}, "verrouillé"),                                 # RG-EDT-FORME-02
    ({"cible": "net", "action": "MODIFIER", "proprietes": {"x": 1}}, "verrouillé"),
    ({"cible": "titre", "action": "MODIFIER", "proprietes": {"valeur": '"X"'}}, "non modifiables"),  # verrou FORME
    ({"cible": "matricule", "action": "MODIFIER", "proprietes": {"valeur": "identite.cin"}}, "non modifiables"),  # RG-EDT-FORME-01
    ({"cible": "lib_matricule", "action": "MODIFIER", "proprietes": {"valeur": "identite.cin"}}, "non modifiables"),
    ({"cible": "logo", "action": "MODIFIER", "proprietes": {"condition": {"expression": "VRAI"}}}, "non modifiables"),
    ({"cible": "corps", "action": "AJOUTER", "element": {"id": "z", "type": "CHAMP", "x": 0, "y": 0, "l": 5, "h": 5, "valeur": "net_a_payer"}}, "Seuls"),  # RG-EDT-FORME-04
    ({"cible": "corps", "action": "AJOUTER", "element": {"id": "z", "type": "TEXTE", "x": 0, "y": 0, "l": 5, "h": 5, "valeur": "net_a_payer"}}, "lire de données"),
    ({"cible": "ancien_element", "action": "MODIFIER", "proprietes": {"x": 1}}, "absente"),  # RG-EDT-FORME-03
    ({"cible": "logo", "action": "MODIFIER", "proprietes": {"l": -3}}, "Valeur invalide"),
    ({"cible": "@page", "action": "MODIFIER", "proprietes": {"charte": "AUTRE"}}, "Page"),
])
def test_variante_refus(surcharge, motif):
    r = va.appliquer(BASE, [surcharge, {"cible": "logo", "action": "MODIFIER", "proprietes": {"x": 2}}])
    assert len(r.conflits) == 1 and motif in r.conflits[0]["motif"]
    assert r.appliquees == 1                                 # la surcharge valide passe quand même
    assert r.definition.empreinte() != BASE.empreinte()


def test_variante_reste_valide():
    r = va.appliquer(BASE, [{"cible": "col_libelle", "action": "MODIFIER", "proprietes": {"largeur": 50}}])
    assert valider(r.definition, CATALOGUE).valide
