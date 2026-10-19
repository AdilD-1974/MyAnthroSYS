"""Filtres de population au lancement et axes de regroupement — RG-EDT-FILTRE/GROUPE (Adil DAIA, 19/10/2026)."""

import json

import pytest
from sqlalchemy import text

from app.editions import population as po
from app.editions import service as sv
from tests_editions.recette import B_OMAR_SEP, B_SARA_SEP, P_SEP, S1, base_requise
from tests_editions.test_service import ADMIN_ID, COLLAB_ID, PAIE, PAIE_ID, _systeme

pytestmark = base_requise
DG, DAF, CPT, COM, AUTRE = ("a0000000-0000-0000-0000-0000000000" + x for x in ("d1", "f1", "c1", "b1", "e9"))


@pytest.fixture
def s(db, tmp_path, monkeypatch):
    monkeypatch.setattr(sv, "racine_documents", lambda: tmp_path)
    monkeypatch.setattr(sv, "MODELES_SYSTEME", {"bulletin_classique.json": sv.MODELES_SYSTEME["bulletin_classique.json"]})
    for uid in (ADMIN_ID, PAIE_ID, COLLAB_ID):
        db.execute(text("INSERT INTO users (id, email) VALUES (:id, :e)"), {"id": uid, "e": f"{uid}@x.ma"})
    # Sara en Comptabilité (cadre, CDI), Omar au Commercial (employé, CDD)
    for b, uo, cat, ct in ((B_SARA_SEP, CPT, "CAD", "CDI"), (B_OMAR_SEP, COM, "EMP", "CDD")):
        snap = db.execute(text("SELECT donnees FROM bulletin_snapshot_collaborateur WHERE bulletin_id = :b"), {"b": b}).scalar()
        snap = snap if isinstance(snap, dict) else json.loads(snap)
        snap.setdefault("affectation", {})["organisation_id"] = uo
        snap["qualification"] = {"code_categorie_professionnelle": cat}
        snap["contrat"] = {"code_type_contrat": ct}
        db.execute(text("UPDATE bulletin_snapshot_collaborateur SET donnees = CAST(:d AS jsonb) WHERE bulletin_id = :b"),
                   {"d": json.dumps(snap), "b": b})
    sv.initialiser(db)
    yield db
    db.rollback()


def _docs(s, filtres):
    r = sv.lancer(s, PAIE, str(_systeme(s)), {"periode": P_SEP, "_filtres": filtres})
    return sorted(d["nom_fichier"][9:13] for d in r["documents"])


def test_valeurs_proposees_limitees_a_la_societe(s):                      # RG-EDT-FILTRE-03
    v = po.valeurs(s, S1)
    assert {u["code"] for u in v["uos"]} == {"DG", "DAF", "CPT", "COM"}
    crit = {c["code"]: [o["code"] for o in c["options"]] for c in v["criteres"]}
    assert crit["categories"] == ["CAD", "EMP"] and crit["contrats"] == ["CDD", "CDI"]


def test_filtre_uo_avec_ou_sans_rattachees(s):                            # RG-EDT-FILTRE-01
    assert _docs(s, {}) == ["M001", "M002"]
    assert _docs(s, {"uo": [DAF]}) == ["M001"]                           # Comptabilité est rattachée à la DAF
    assert _docs(s, {"uo": [DAF], "uo_rattachees": False}) == []         # sans les rattachées : personne en DAF même
    assert _docs(s, {"uo": [DG]}) == ["M001", "M002"]
    assert _docs(s, {"uo": [COM, CPT], "uo_rattachees": False}) == ["M001", "M002"]


def test_criteres_combines(s):
    assert _docs(s, {"categories": ["EMP"]}) == ["M002"]
    assert _docs(s, {"categories": ["CAD", "EMP"], "contrats": ["CDI"]}) == ["M001"]   # OU dans un critère, ET entre critères
    assert _docs(s, {"uo": [AUTRE]}) == []                               # UO d'une autre société : ignorée, donc personne


def test_axes_de_regroupement(s):                                         # RG-EDT-GROUPE-01
    from app.editions.sources.paie import FournisseurBulletin
    lignes = FournisseurBulletin().lire(s, {"periode": P_SEP}, sv.contexte_securite(s, PAIE))
    sara = next(l for l in lignes if l["matricule"] == "M001")
    a = sara["affectation"]
    assert a["uo_chemin"] == "Direction générale › Direction financière › Comptabilité"
    assert (a["uo_niveau1_libelle"], a["uo_niveau2_libelle"], a["uo_code"]) == ("Direction générale", "Direction financière", "CPT")
    assert sara["qualification"]["categorie_professionnelle_libelle"] == "Cadres"
    assert sara["contrat"]["type_contrat_libelle"] == "Contrat à durée indéterminée"


def test_regroupement_par_uo_avec_sous_totaux(s):                          # RG-EDT-GROUPE-02 (bandes du designer)
    from app.editions.definition import Definition
    from app.editions.moteur import executeur
    from app.editions.moteur.mise_en_page import Contexte, composer
    d = Definition.model_validate({
        "parametres": [{"code": "periode", "libelle": "Période", "type": "PERIODE"}],
        "jeux": [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
                  "groupes": ["affectation.uo_niveau2_libelle"],
                  "tri": [{"champ": "affectation.uo_niveau2_libelle"}, {"champ": "identite.nom"}]}],
        "bandes": [
            {"id": "g1", "type": "EN_TETE_GROUPE", "niveau_groupe": 1, "hauteur": 8, "saut_avant": True, "elements": [
                {"id": "t", "type": "CHAMP", "x": 0, "y": 1, "l": 100, "h": 6,
                 "valeur": '"UO de 2e niveau : " + SIVIDE(affectation.uo_niveau2_libelle, "(non renseigné)")'}]},
            {"id": "c", "type": "CORPS", "hauteur": 5, "elements": [
                {"id": "n", "type": "CHAMP", "x": 0, "y": 0, "l": 100, "h": 5, "valeur": "identite.nom"}]},
            {"id": "p1", "type": "PIED_GROUPE", "niveau_groupe": 1, "hauteur": 8, "elements": [
                {"id": "st", "type": "CHAMP", "x": 0, "y": 1, "l": 100, "h": 6,
                 "valeur": '"Sous-total " + NB(id, GROUPE) + " : " + FORMAT(TOTAL(net_a_payer, GROUPE), "MONTANT")'}]}]})
    prep = executeur._preparer(s, d, {"periode": P_SEP}, sv.contexte_securite(s, PAIE), registre_masques=None,
                               racine_fichiers="storage", contexte_fixe=None, forme=None)
    pages, anomalies = composer(Contexte(definition=prep.definition, lignes=prep.lignes, **prep.contexte))
    textes = [" ".join(b.lignes) for p in pages for b in p.boites if b.lignes]
    assert not anomalies and len(pages) == 2                              # nouvelle page à chaque groupe
    assert textes == ["UO de 2e niveau : Commercial", "BENNANI", "Sous-total 1 : 5 100,00",
                      "UO de 2e niveau : Direction financière", "ALAMI", "Sous-total 1 : 8 450,50"]


# ---- RG-EDT-LIBELLE-01 : intitulé de chaque code de référentiel ----
def test_intitules_lus_dans_les_referentiels(db):
    from sqlalchemy import text
    from app.editions import population
    db.execute(text("CREATE TABLE IF NOT EXISTS ref_grade (code text, libelle text)"))
    db.execute(text("CREATE TABLE IF NOT EXISTS ref_type_temps (code text, libelle text)"))
    db.execute(text("CREATE TABLE IF NOT EXISTS ref_ville (code text, libelle text)"))
    db.execute(text("INSERT INTO ref_grade VALUES ('G3', 'Grade 3 — Agent de maîtrise')"))
    db.execute(text("INSERT INTO ref_type_temps VALUES ('TP', 'Temps plein')"))      # 2e référentiel candidat
    db.execute(text("INSERT INTO ref_ville VALUES ('RBT', 'Rabat')"))
    lignes = [{"qualification": {"code_grade": "G3", "code_echelle": "INCONNU"}, "contrat": {"code_temps": "TP"},
               "adresse": {"code_ville": "RBT"}},
              {"qualification": {"code_grade": "G3", "grade_libelle": "Libellé figé"}}]
    population.libeller(db, lignes)
    assert lignes[0]["qualification"]["grade_libelle"] == "Grade 3 — Agent de maîtrise"
    assert lignes[0]["contrat"]["temps_libelle"] == "Temps plein" and lignes[0]["adresse"]["ville_libelle"] == "Rabat"
    assert "echelle_libelle" not in lignes[0]["qualification"]           # code inconnu : pas d'intitulé inventé
    assert lignes[1]["qualification"]["grade_libelle"] == "Libellé figé"  # le figé n'est pas remplacé
    db.rollback()
