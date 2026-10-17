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
    assert "Prime exceptionnelle" not in t                              # aucune valeur : jamais imprimée, même « Nulls »
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


def test_total_corps_et_ligne_de_total():
    from app.editions import expressions as ex
    r = ex.ResolverEdition(ligne={"corps": {
        "detail": [{"groupe": "Gains", "gains": 100}, {"groupe": "Indemnités", "gains": 500}, {"groupe": "Indemnités", "gains": 680}],
        "cumuls": {"mois": {"brut": 10}, "cumul": {"brut": 30}}}})
    assert ex.evaluer('TOTAL_CORPS("detail", "gains")', r) == 1280
    assert ex.evaluer('TOTAL_CORPS("detail", "gains", "Indemnités")', r) == 1180
    assert ex.evaluer('TOTAL_CORPS("cumuls", "brut")', r) == 40
    assert ex.evaluer('TOTAL_CORPS("cumuls", "brut", "cumul")', r) == 30
    assert ex.evaluer('TOTAL_CORPS("absent", "x")', r) is None
    noms = {f["nom"]: f for f in ex.catalogue()}
    assert noms["TOTAL_CORPS"]["exemple"] and noms["SI"]["description"]


@base_requise
def test_formule_qui_totalise_son_corps_et_test_de_formule(db):
    from app.editions.moteur.executeur import donnees_brutes, tester_formule
    from app.editions.sources import ContexteSecurite
    d = definition()
    d["corps"][0]["affectations"].append({"formule": 'TOTAL_CORPS("detail", "gains", "Gains")', "groupe": "Gains",
                                          "libelle": "Total des gains", "cibles": {"VAL": "gains"}})
    d["corps"][0]["affectations"].insert(0, {"formule": '"titre"', "libelle": "rang conservé", "nulle": True, "cibles": {"VAL": "base"}})
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    res = donnees_brutes(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)
    lignes = res["lignes"][0]["corps"]["detail"]
    assert lignes[0]["libelle"] == "rang conservé"                     # l'ordre des affectations est gardé
    total = next(l for l in lignes if l["libelle"] == "Total des gains")
    assert total["gains"] == 10500.0                                   # 10 000 + 500 ; la ligne de total n'est pas comptée
    t = tester_formule(db, Definition.model_validate(d), {"periode": P_SEP}, sec, "[SALBASE].CMT + 1")
    assert t["nb_lignes"] == 2 and any(x["valeur"] == 20001.0 for x in t["resultats"])
    t2 = tester_formule(db, Definition.model_validate(d), {"periode": P_SEP}, sec, "1 + * 2")
    assert t2["resultats"][0]["erreur"]
    t3 = tester_formule(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec,
                        "libelle + \" / \" + TEXTE(gains)", contexte="corps:detail")
    assert t3["resultats"][0]["texte"].startswith("rang conservé")


def test_fusion_invalide():
    d = definition()
    d["corps"][0]["affectations"][0]["fusion"] = True                  # première affectation : rien à quoi s'ajouter
    d["corps"][0]["affectations"].append({"formule": "1", "fusion": True, "cibles": {"VAL": "gains"}})
    messages = [e.message for e in valider(d, CAT).erreurs]
    assert sum("se fusionne" in m for m in messages) == 2


@base_requise
def test_lignes_fusionnees_gras_et_corps_a_la_suite(db):
    from app.editions.moteur.executeur import donnees_brutes, executer
    from app.editions.sources import ContexteSecurite
    d = definition()
    affs = d["corps"][0]["affectations"]
    # SALBASE + PRIM_ANC sur une seule ligne « Salaire et ancienneté » ; CNSS_SAL soustraite de la même ligne
    affs[0]["libelle"] = "Salaire et ancienneté"
    affs[1]["fusion"] = True
    affs.insert(2, {"rubrique": "CNSS_SAL", "fusion": True, "negatif": True, "cibles": {"MT": "gains"}})
    affs.append({"formule": 'TOTAL_CORPS("detail", "gains")', "libelle": "Total formule", "cibles": {"VAL": "gains"}})
    affs.append({"rubrique": "ATRISK", "gras": True, "libelle": "AT en gras", "cibles": {"PAT": "patronal"}})
    # second corps « lignes » affiché à la suite dans le même tableau, sans groupe : titre = libellé du corps
    d["corps"].append({"code": "indem", "libelle": "Indemnités non imposables", "nature": "LIGNES", "colonnes": COLS,
                       "affectations": [{"rubrique": "PRIM_ANC", "libelle": "Indemnité test", "cibles": {"MT": "gains"}}]})
    d["bandes"][0]["elements"][1]["corps_suivants"] = ["indem"]
    assert valider(d, CAT).valide, [e.message for e in valider(d, CAT).erreurs]
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    res = donnees_brutes(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)
    detail = res["lignes"][0]["corps"]["detail"]
    fus = detail[0]
    assert fus["libelle"] == "Salaire et ancienneté" and fus["code_rubrique"] == "SALBASE+PRIM_ANC+CNSS_SAL"
    assert fus["gains"] == 10000 + 500 - 268.80 and fus["base"] == 20000.0
    assert not any(l["code_rubrique"] == "PRIM_ANC" for l in detail)       # plus de ligne séparée
    tot = next(l for l in detail if l["libelle"] == "Total formule")
    assert tot["gras"] is True and fus["gras"] is False
    assert next(l for l in detail if l["libelle"] == "AT en gras")["gras"] is True
    docs = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)
    t = textes(docs[0].contenu)
    assert docs[0].anomalies == []
    assert "Salaire et ancienneté" in t and "10 231,20" in t
    assert t.index("Retenues") < t.index("Indemnités non imposables") < t.index("Indemnité test")


@base_requise
def test_nulls_titre_du_corps_et_entete(db):
    from app.editions.moteur.executeur import donnees_brutes, executer
    from app.editions.sources import ContexteSecurite
    d = definition()
    affs = d["corps"][0]["affectations"]
    affs[4]["nulle"] = True                       # AVANCE : présente sur le bulletin, montant 0 → imprimée
    affs[4]["libelle"] = "Avance à zéro"
    for a in affs:
        a.pop("groupe", None)                     # sans groupe : le titre serait le libellé du corps…
    d["corps"][0]["afficher_titre"] = False       # …masqué
    d["bandes"][0]["elements"][1]["entete"] = False
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    lignes = donnees_brutes(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)["lignes"][0]["corps"]["detail"]
    libelles = [l["libelle"] for l in lignes]
    assert "Avance à zéro" in libelles and "Prime exceptionnelle" not in libelles and "ABSENTE" not in libelles
    t = textes(executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu)
    assert "Détail" not in t                      # pas de titre de corps
    assert "Désignation" not in t                 # pas de ligne d'en-tête de colonnes
    assert "Salaire de base" in t and "Avance à zéro" in t


def test_controle_des_valeurs_brutes_des_rubriques(db):
    """RG-EDT-DONNEES-06 : l'aperçu donne les valeurs brutes de chaque rubrique citée."""
    from app.editions.moteur.executeur import donnees_brutes
    from app.editions.sources import ContexteSecurite
    d = definition()
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    rubs = donnees_brutes(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)["lignes"][0]["rubriques"]
    codes = [r["code"] for r in rubs]
    assert len(codes) == len(set(codes)) and codes
    absentes = {r["code"] for r in rubs if r["absente"]}
    presentes = [r for r in rubs if not r["absente"]]
    assert presentes and all(r["MT"] is not None for r in presentes)
    assert all(all(r[k] is None for k in ("NB", "MT", "PAT")) for r in rubs if r["code"] in absentes)
