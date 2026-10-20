"""Écrans d'édition générés dans la navigation — RG-EDT-NAV-02..04 (Adil DAIA, 20/10/2026)."""
import pytest
from sqlalchemy import text

from app.editions import service as sv
from app.editions import themes as th
from tests_editions.recette import base_requise
from tests_editions.test_service import ADMIN_ID, PAIE

pytestmark = base_requise
ADMIN = sv.Utilisateur(ADMIN_ID, PAIE.societe_id, frozenset({"administrateur"}))


@pytest.fixture
def s(db, tmp_path, monkeypatch):
    monkeypatch.setattr(sv, "racine_documents", lambda: tmp_path)
    db.execute(text("INSERT INTO users (id, email) VALUES (:id, 'a@x.ma')"), {"id": ADMIN_ID})
    sv.initialiser(db)
    yield db
    db.rollback()


def test_etat_et_dossier_deviennent_des_ecrans(s):
    e = sv.generer_ecran_navigation(s, ADMIN, "MODELE", "MASSE_SALARIALE")
    assert e["cree"] and e["chemin"] == "/editions/etat/MASSE_SALARIALE"
    r = s.execute(text("""SELECT i.label, i.section_id, i.icone, string_agg(v.role_code, ',') FROM nav_menu_item i
                          JOIN nav_role_visibilite v ON v.item_id = i.id WHERE i.code = :c GROUP BY 1, 2, 3"""),
                  {"c": e["code"]}).one()
    assert r[0] == "Masse salariale par direction et catégorie" and str(r[1]) == "5e000000-0000-0000-0000-000000000001"
    from app.editions.navigation import _repere
    ref = _repere(s)
    roles_ref = sorted(x[0] for x in s.execute(text("SELECT role_code FROM nav_role_visibilite WHERE item_id = :i"), {"i": ref["id"]}).all())
    assert sorted(r[3].split(",")) == (roles_ref or ["administrateur", "gestionnaire_paie", "gestionnaire_rh"])  # rôles du repère
    # idempotent, libellé modifiable
    e2 = sv.generer_ecran_navigation(s, ADMIN, "MODELE", "MASSE_SALARIALE", "Masse salariale")
    assert not e2["cree"] and s.execute(text("SELECT count(*) FROM nav_menu_item WHERE code = :c"), {"c": e["code"]}).scalar() == 1
    assert sv.ecran_navigation(s, ADMIN, "MODELE", "MASSE_SALARIALE")["existe"]
    # dossier
    theme = next(t for t in th.arbre(s, PAIE, "PAIE")["themes"] if t["libelle"] == "États de synthèse")
    d = sv.generer_ecran_navigation(s, ADMIN, "DOSSIER", theme["id"])
    assert d["chemin"] == f"/paie/editions-paie?dossier={theme['id']}"
    # retrait
    sv.retirer_ecran_navigation(s, ADMIN, "MODELE", "MASSE_SALARIALE")
    assert not sv.ecran_navigation(s, ADMIN, "MODELE", "MASSE_SALARIALE")["existe"]


def test_droits_et_etat_non_publie(s):
    with pytest.raises(sv.Interdit):
        sv.generer_ecran_navigation(s, PAIE, "MODELE", "MASSE_SALARIALE")
    m = sv.creer_modele(s, ADMIN, code="BROUILLON_NAV", libelle="Brouillon", categorie="LISTE")
    with pytest.raises(sv.Invalide, match="Publiez"):
        sv.generer_ecran_navigation(s, ADMIN, "MODELE", "BROUILLON_NAV")
