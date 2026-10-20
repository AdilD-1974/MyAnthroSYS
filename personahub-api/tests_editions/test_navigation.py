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


def test_menu_publie_en_sous_menus_et_suivi(s):
    """RG-EDT-NAV-05 : dossiers et états sous « Éditions de la paie », dans l'arborescence ; suivi des changements."""
    from app.editions.navigation import _repere
    racine = _repere(s)
    bilan = th.publier_navigation(s, ADMIN, "PAIE", True)
    assert bilan["crees"] > 0
    lignes = s.execute(text("SELECT code, label, parent_id, chemin FROM nav_menu_item WHERE code LIKE 'edt%'")).mappings().all()
    dossiers = {l["label"]: l for l in lignes if l["code"].startswith("edt_d_")}
    assert "États de synthèse" in dossiers and str(dossiers["États de synthèse"]["parent_id"]) == str(racine["id"])
    masse = next(l for l in lignes if l["code"] == "edt_m_masse_salariale")
    assert masse["parent_id"] == s.execute(text("SELECT id FROM nav_menu_item WHERE label = 'États de synthèse' AND code LIKE 'edt_d_%'")).scalar()
    # idempotent
    assert th.publier_navigation(s, ADMIN, "PAIE", True)["crees"] == 0
    # suivi : nouveau dossier, état reclassé
    t = th.creer_theme(s, ADMIN, libelle="Mes états", module="PAIE")
    m = next(x for x in sv.lister_modeles(s, ADMIN) if x["code"] == "MASSE_SALARIALE")
    th.regler_modele(s, ADMIN, m["id"], theme_id=t["id"])
    nouveau = s.execute(text("SELECT id FROM nav_menu_item WHERE label = 'Mes états'")).scalar()
    assert nouveau and s.execute(text("SELECT parent_id FROM nav_menu_item WHERE code = 'edt_m_masse_salariale'")).scalar() is not None
    # dossier supprimé → son écran retiré
    th.supprimer_theme(s, ADMIN, t["id"])
    assert not s.execute(text("SELECT 1 FROM nav_menu_item WHERE label = 'Mes états'")).first()
