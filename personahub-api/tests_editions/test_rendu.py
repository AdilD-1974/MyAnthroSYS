"""Mise en page et rendu PDF — RG-EDT-RENDU-03..06 (Adil DAIA).

Les tests « sans base » composent des pages à partir de données en mémoire ;
les tests « base » (opt-in EDITIONS_TEST_DB_URL) produisent le bulletin
système sur la recette."""
import io
import json
import re
from decimal import Decimal
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.editions.definition import Definition
from app.editions.moteur.mise_en_page import Contexte, composer
from app.editions.moteur.rendu_pdf import RenduPDF
from recette import B_SARA_SEP, P_S2, P_SEP, S1, S2, base_requise

RACINE = Path(__file__).resolve().parents[1]
BULLETIN = json.loads((RACINE / "tests_editions/donnees/bulletin_lignes.json").read_text(encoding="utf-8"))


def textes(pdf: bytes) -> list[str]:
    return [p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages]


def contexte(definition: dict, lignes, enfants=None, **kw) -> Contexte:
    return Contexte(definition=Definition.model_validate(definition), lignes=lignes, enfants=enfants or {},
                    parametres=kw.pop("parametres", {}), societe=kw.pop("societe", {"raison_sociale": "SOLGEIS"}),
                    constantes={}, rubriques=kw.pop("rubriques", {}), **kw)


def rendre(ctx: Contexte) -> tuple[list, bytes]:
    pages, anomalies = composer(ctx)
    assert anomalies == [], [(a.source_id, a.message) for a in anomalies]
    return pages, RenduPDF(ctx.definition.page).rendre(pages)


# ---------------------------------------------------------------- sans base
def test_tableau_sur_plusieurs_pages_repete_son_entete():       # RG-EDT-RENDU-03
    lignes_paie = [{"code_rubrique": f"R{i:03d}", "libelle": f"Rubrique {i}", "montant": Decimal(i),
                    "sens": "GAIN", "ordre_affichage": i} for i in range(1, 121)]
    bulletin = {"id": "B1", "identite": {"matricule": "M9", "nom": "TEST", "prenom": "Long"},
                "net_a_payer": Decimal("7260"), "total_brut": Decimal("7260")}
    ctx = contexte(BULLETIN, [bulletin], {"l": {"B1": lignes_paie}},
                   parametres={"periode": {"id": "p", "code": "2026-09", "date_fin": None}})
    pages, pdf = rendre(ctx)
    t = textes(pdf)
    assert len(pages) >= 3
    avec_lignes = [p for p in t if "Rubrique" in p]
    assert len(avec_lignes) >= 3 and all("Désignation" in p for p in avec_lignes)   # en-tête répété
    assert all(f"Page {i + 1} / {len(pages)}" in p for i, p in enumerate(t))
    tout = "\n".join(t)
    assert "Rubrique 1\n" in tout or "Rubrique 1 " in tout
    assert "Rubrique 120" in tout
    assert "7 260,00" in t[-1]                                   # total des gains en dernière page
    assert "NET À PAYER" in t[-1]


JOURNAL = {
    "parametres": [{"code": "periode", "libelle": "Période", "type": "PERIODE"}],
    "jeux": [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL",
              "tri": [{"champ": "affectation.organisation_libelle"}, {"champ": "matricule"}],
              "groupes": ["affectation.organisation_libelle"]}],
    "page": {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
    "bandes": [
        {"id": "titre", "type": "EN_TETE_ETAT", "hauteur": 10, "elements": [
            {"id": "t", "type": "TEXTE", "x": 0, "y": 0, "l": 200, "h": 8, "valeur": '"JOURNAL DE PAIE"',
             "style": {"gras": True, "taille": 12}},
            {"id": "total_annonce", "type": "CHAMP", "x": 200, "y": 0, "l": 77, "h": 8,
             "valeur": 'FORMAT(TOTAL(net_a_payer, ETAT), "MONTANT")', "style": {"alignement": "DROITE"}}]},
        {"id": "entete", "type": "EN_TETE_PAGE", "hauteur": 8, "elements": [
            {"id": "report", "type": "CHAMP", "x": 150, "y": 0, "l": 127, "h": 6,
             "valeur": '"Report : " + FORMAT(TOTAL(net_a_payer, REPORT), "MONTANT")',
             "condition": {"expression": "PAGE() > 1"}}]},
        {"id": "groupe", "type": "EN_TETE_GROUPE", "niveau_groupe": 1, "hauteur": 7, "elements": [
            {"id": "org", "type": "CHAMP", "x": 0, "y": 0, "l": 150, "h": 7,
             "valeur": "affectation.organisation_libelle", "style": {"gras": True}}]},
        {"id": "corps", "type": "CORPS", "hauteur": 6, "elements": [
            {"id": "mat", "type": "CHAMP", "x": 0, "y": 0, "l": 30, "h": 6, "valeur": "matricule"},
            {"id": "nom", "type": "CHAMP", "x": 30, "y": 0, "l": 100, "h": 6, "valeur": "identite.nom"},
            {"id": "net", "type": "CHAMP", "x": 200, "y": 0, "l": 77, "h": 6, "valeur": "net_a_payer",
             "affichage": {"masque": "MONTANT"}, "style": {"alignement": "DROITE"}}]},
        {"id": "pied_groupe", "type": "PIED_GROUPE", "niveau_groupe": 1, "hauteur": 7, "elements": [
            {"id": "st", "type": "CHAMP", "x": 0, "y": 0, "l": 277, "h": 7,
             "valeur": '"Sous-total " + affectation.organisation_libelle + " : " + FORMAT(TOTAL(net_a_payer), "MONTANT") + " (" + NB(matricule) + " salariés)"'}]},
        {"id": "pied", "type": "PIED_PAGE", "hauteur": 8, "elements": [
            {"id": "areporter", "type": "CHAMP", "x": 0, "y": 0, "l": 200, "h": 6,
             "valeur": '"À reporter : " + FORMAT(TOTAL(net_a_payer, REPORT), "MONTANT") + " · page : " + FORMAT(TOTAL(net_a_payer, PAGE), "MONTANT")'},
            {"id": "num", "type": "CHAMP", "x": 200, "y": 0, "l": 77, "h": 6,
             "valeur": '"Page " + PAGE() + " / " + NB_PAGES()', "style": {"alignement": "DROITE"}}]},
        {"id": "fin", "type": "PIED_ETAT", "hauteur": 8, "elements": [
            {"id": "total", "type": "CHAMP", "x": 0, "y": 0, "l": 277, "h": 8,
             "valeur": '"TOTAL GÉNÉRAL : " + FORMAT(TOTAL(net_a_payer, ETAT), "MONTANT")', "style": {"gras": True}}]},
    ],
}


def _montants(texte: str, libelle: str) -> list[Decimal]:
    return [Decimal(m.replace(" ", "").replace(",", ".")) for m in re.findall(libelle + r" : ([\d ]+,\d\d)", texte)]


def test_journal_groupes_reports_et_totaux():                  # RG-EDT-RENDU-05
    lignes = []
    for i in range(1, 81):
        org = "Direction" if i <= 25 else ("Production" if i <= 70 else "Commercial")
        lignes.append({"id": f"B{i}", "matricule": f"M{i:03d}", "identite": {"nom": f"NOM{i}"},
                       "affectation": {"organisation_libelle": org}, "net_a_payer": Decimal(i * 100)})
    lignes.sort(key=lambda l: (l["affectation"]["organisation_libelle"], l["matricule"]))
    total = sum(l["net_a_payer"] for l in lignes)
    pages, pdf = rendre(contexte(JOURNAL, lignes))
    t = textes(pdf)
    assert len(pages) >= 2
    assert all(f"Page {i + 1} / {len(pages)}" in p for i, p in enumerate(t))
    assert "TOTAL GÉNÉRAL : 324 000,00" in t[-1] and total == Decimal("324000")
    assert "324 000,00" in t[0]                                   # total d'état annoncé dès la page 1
    # sous-totaux par groupe
    tout = "\n".join(t)
    assert "Sous-total Commercial : 75 500,00 (10 salariés)" in tout
    assert "Sous-total Direction : 32 500,00 (25 salariés)" in tout
    assert "Sous-total Production : 216 000,00 (45 salariés)" in tout
    # à reporter : cumul croissant, égal au total en dernière page ; report = à reporter précédent
    a_reporter = [_montants(p, "À reporter")[0] for p in t]
    assert a_reporter == sorted(a_reporter) and a_reporter[-1] == total
    for i in range(1, len(t)):
        assert _montants(t[i], "Report")[0] == a_reporter[i - 1]
    # le total de page est la différence de deux reports
    pages_tot = [_montants(p, "page")[0] for p in t]
    assert sum(pages_tot) == total


def test_bande_insecable_et_saut_de_page():
    d = json.loads(json.dumps(JOURNAL))
    d["bandes"][3]["saut_apres"] = True                           # un bulletin par page
    lignes = [{"id": f"B{i}", "matricule": f"M{i}", "identite": {"nom": "X"}, "affectation":
               {"organisation_libelle": "A"}, "net_a_payer": Decimal(1)} for i in range(3)]
    pages, _ = rendre(contexte(d, lignes))
    assert len(pages) == 3


def test_erreur_de_formule_n_arrete_pas_le_document():          # RG-EDT-RENDU-04
    d = json.loads(json.dumps(JOURNAL))
    d["bandes"][3]["elements"][1]["valeur"] = "1 / MAJUSCULE()"
    pages, anomalies = composer(contexte(d, [{"id": "B1", "matricule": "M1", "net_a_payer": Decimal(5),
                                              "affectation": {"organisation_libelle": "A"}}]))
    pdf = RenduPDF(Definition.model_validate(d).page).rendre(pages)
    assert anomalies and anomalies[0].source_id == "nom"
    assert "#ERR" in textes(pdf)[0]


def test_texte_arabe_mis_en_forme():                            # RG-EDT-RENDU-01
    from app.editions.moteur import texte as tx
    lignes = tx.decouper("الأجر الصافي", "Helvetica", 9, 50)
    assert lignes and lignes[0] != "الأجر الصافي"                  # remis en forme et réordonné


# ---------------------------------------------------------------- base
@base_requise
def test_bulletin_classique_sur_la_recette(db):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite

    d = Definition.model_validate(BULLETIN)
    docs = executer(db, d, {"periode": P_SEP}, ContexteSecurite(None, S1, donnees_sensibles=True))
    assert [x.nom_fichier for x in docs] == ["Bulletin_M001_2026-09.pdf", "Bulletin_M002_2026-09.pdf"]
    sara = textes(docs[0].contenu)[0]
    assert "SOLGEIS CONSULTING" in sara and "CNSS : 1234567" in sara
    assert "septembre 2026" in sara
    assert "8 450,50 DH" in sara and "huit mille quatre cent cinquante dirhams et cinquante centimes" in sara
    assert "Prime d'ancienneté (SOLGEIS)" in sara and "Cotisation CNSS" in sara
    assert "COPIE A IGNORER" not in sara and "BRUT_INTER" not in sara and "AVANCE" not in sara
    assert "10 500,00" in sara and "268,80" in sara                # totaux des colonnes
    # part patronale toujours imprimée (Code du travail) ; ligne sans aucun montant écartée
    assert "patronale" in sara and "Accident du travail" in sara
    assert "1 077,12" in sara and "1 132,77" in sara               # colonne et son total
    assert "Cotisations CIMR" not in sara and "Cotisations patronales" in sara
    assert "AB123" in sara
    assert docs[0].anomalies == [] and docs[0].nb_pages == 1 and len(docs[0].empreinte_donnees) == 64


@base_requise
def test_bulletin_sans_droit_donnees_sensibles(db):              # RG-EDT-SECU-01
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite

    docs = executer(db, Definition.model_validate(BULLETIN), {"periode": P_SEP, "bulletin": B_SARA_SEP},
                    ContexteSecurite(None, S1, donnees_sensibles=False))
    t = textes(docs[0].contenu)[0]
    assert "AB123" not in t and "****" in t
    assert "8 450,50 DH" in t


@base_requise
def test_periode_d_une_autre_societe_refusee(db):               # RG-EDT-SECU-02
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite, ErreurSource

    with pytest.raises(ErreurSource, match="société active"):
        executer(db, Definition.model_validate(BULLETIN), {"periode": P_S2}, ContexteSecurite(None, S1))
    with pytest.raises(ErreurSource, match="société active"):
        executer(db, Definition.model_validate(BULLETIN), {"periode": P_SEP}, ContexteSecurite(None, S2))


# ---- logo de la société (RG-EDT-IMAGE-06/07) ----
def test_logo_enregistre_en_url_par_l_ecran_societes():
    from app.editions.moteur.executeur import _chemin_relatif
    assert _chemin_relatif("http://localhost:8000/api/v1/storage/logos_societes/a1.png") == "logos_societes/a1.png"
    assert _chemin_relatif("http://serveur:8000/api/v1/storage/logos_societes/a1.png?v=3") == "logos_societes/a1.png"
    assert _chemin_relatif("storage/logos_societes/a1.png") == "logos_societes/a1.png"
    assert _chemin_relatif("/storage/logos_societes/a1.png") == "logos_societes/a1.png"
    assert _chemin_relatif("logos_societes\\a1.png") == "logos_societes/a1.png"
    assert _chemin_relatif("https://autre-site.ma/logo.png") == ""          # hors du storage : ignoré


def test_logo_svg_dessine(tmp_path):
    import pytest
    pytest.importorskip("svglib")
    from app.editions.definition import Page as PageDef
    from app.editions.moteur.mise_en_page import Boite, Page
    from app.editions.moteur.rendu_pdf import RenduPDF
    (tmp_path / "logos_societes").mkdir()
    (tmp_path / "logos_societes" / "l.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#0E3D5C"/></svg>')
    page = Page(numero=1, boites=[Boite(0, 0, 40, 20, "IMAGE", valeur="logos_societes/l.svg", ajustement="CONTENIR")])
    sans = RenduPDF(PageDef(), {}, str(tmp_path)).rendre([Page(numero=1, boites=[])])
    avec = RenduPDF(PageDef(), {}, str(tmp_path)).rendre([page])
    assert b"0.054902 0.239216 0.360784" in avec or len(avec) > len(sans) + 40    # le rectangle bleu est dessiné
