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
