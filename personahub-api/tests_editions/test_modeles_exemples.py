"""Modèles d'exemple livrés, un par type d'état — produits sans anomalie (Adil DAIA, 19/10/2026)."""

import pytest
from sqlalchemy import text

from app.editions import service as sv
from app.editions import themes as th
from tests_editions.recette import P_SEP, base_requise
from tests_editions.test_service import ADMIN_ID, COLLAB_ID, PAIE, PAIE_ID

pytestmark = base_requise

ATTENDUS = {  # code : (catégorie, nb de documents pour septembre : 1 = un état pour tous, 2 = un par salarié)
    "BULLETIN_CLASSIQUE": ("BULLETIN", 2), "JOURNAL_PAIE": ("JOURNAL", 1), "ORDRE_VIREMENT": ("LISTE", 1),
    "ATTESTATION_TRAVAIL_SALAIRE": ("ATTESTATION", 2), "NOTIFICATION_REMUNERATION": ("COURRIER", 2),
    "ETAT_COTISATIONS_SOCIALES": ("DECLARATION", 1), "FICHE_SYNTHESE_ANNUELLE": ("AUTRE", 2),
    "BULLETIN_DETAILLE": ("BULLETIN", 2), "BULLETIN_MODERNE": ("BULLETIN", 2), "BULLETIN_FORMULAIRE": ("BULLETIN", 2),
}


@pytest.fixture
def s(db, tmp_path, monkeypatch):
    monkeypatch.setattr(sv, "racine_documents", lambda: tmp_path)
    for uid in (ADMIN_ID, PAIE_ID, COLLAB_ID):
        db.execute(text("INSERT INTO users (id, email) VALUES (:id, :e)"), {"id": uid, "e": f"{uid}@x.ma"})
    sv.initialiser(db)
    yield db
    db.rollback()


def test_un_exemple_par_type_produit_sans_anomalie(s):
    modeles = {m["code"]: m for m in sv.lister_modeles(s, PAIE) if m["est_systeme"]}
    assert set(modeles) == set(ATTENDUS)
    assert {c for c, _ in ATTENDUS.values()} == set(sv.CATEGORIES)          # tous les types couverts
    for code, (categorie, nb) in ATTENDUS.items():
        m = modeles[code]
        assert m["categorie"] == categorie
        r = sv.lancer(s, PAIE, m["id"], {"periode": P_SEP})
        assert len(r["documents"]) == nb, code
        assert all(not d["anomalies"] for d in r["documents"]), (code, r["documents"][0]["anomalies"])


def test_exemples_ranges_dans_le_menu_de_la_paie(s):
    a = {t["libelle"]: {m["code"] for m in t["modeles"]} for t in th.arbre(s, PAIE, "PAIE")["themes"]}
    assert a["Journaux de paie"] == {"JOURNAL_PAIE"}
    assert a["Déclarations"] == {"ETAT_COTISATIONS_SOCIALES"}
    assert a["États standard"] == {"ORDRE_VIREMENT", "FICHE_SYNTHESE_ANNUELLE"}
    rh = {t["libelle"]: {m["code"] for m in t["modeles"]} for t in th.arbre(s, PAIE, "RH")["themes"]}
    assert rh == {"Attestations": {"ATTESTATION_TRAVAIL_SALAIRE"}, "Courriers": {"NOTIFICATION_REMUNERATION"}}


def test_quatre_bulletins_au_choix_dans_le_menu(s):
    a = {t["libelle"]: [m["code"] for m in t["modeles"]] for t in th.arbre(s, PAIE, "PAIE")["themes"]}
    assert set(a["Bulletins de paie"]) == {"BULLETIN_CLASSIQUE", "BULLETIN_DETAILLE", "BULLETIN_MODERNE", "BULLETIN_FORMULAIRE"}


def test_fond_de_page_dans_l_ordre_des_elements(s):
    """Un aplat du FOND est dessiné avant les textes posés dessus (bandeau du bulletin moderne)."""
    from app.editions.definition import Definition
    from app.editions.moteur import executeur
    m = next(x for x in sv.lister_modeles(s, PAIE) if x["code"] == "BULLETIN_MODERNE")
    v, _ = sv.lire_version(s, PAIE, m["version_publiee_id"])
    d = Definition.model_validate(v["definition"])
    prep = executeur._preparer(s, d, {"periode": P_SEP}, sv.contexte_securite(s, PAIE, m), registre_masques=None,
                               racine_fichiers="storage", contexte_fixe=None, forme=None)
    from app.editions.moteur.mise_en_page import Contexte, composer
    pages, _ = composer(Contexte(definition=prep.definition, lignes=prep.lignes[:1], **prep.contexte))
    ids = [b.source_id for b in pages[0].boites]
    assert ids.index("lat_fond") < ids.index("lat_nom") < ids.index("titre")


def test_qr_de_controle_sur_tous_les_bulletins(s):                        # RG-EDT-QR-01
    from app.editions.definition import CodeBarre, Definition
    for m in sv.lister_modeles(s, PAIE):
        if m["categorie"] != "BULLETIN" or not m["est_systeme"]:
            continue
        d = Definition.model_validate(sv.lire_version(s, PAIE, m["version_publiee_id"])[0]["definition"])
        qr = [e for b in d.bandes for e in b.elements if isinstance(e, CodeBarre)]
        assert qr and "net_a_payer" in qr[0].valeur, m["code"]


def test_journal_grille_et_forme_synthetique(s):
    m = next(x for x in sv.lister_modeles(s, PAIE) if x["code"] == "JOURNAL_PAIE")
    for forme in (None, "synthetique"):
        r = sv.lancer(s, PAIE, m["id"], {"periode": P_SEP}, forme)
        assert len(r["documents"]) == 1 and not r["documents"][0]["anomalies"], forme
