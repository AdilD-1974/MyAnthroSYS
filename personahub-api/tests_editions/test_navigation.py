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


def test_acces_aux_etats_par_les_roles_des_ecrans(s):
    """RG-EDT-ACCES-01..03 : écran de l'état > écran du dossier > droits des éditions ; l'administrateur voit tout."""
    def visibles(u):
        return {m["code"] for t in th.arbre(s, u, "PAIE")["themes"] for m in t["modeles"]}
    tous = visibles(PAIE)
    assert "MASSE_SALARIALE" in tous and "JOURNAL_PAIE" in tous
    synthese = next(t for t in th.arbre(s, ADMIN, "PAIE")["themes"] if t["libelle"] == "États de synthèse")
    # dossier réservé à l'administrateur → ses états disparaissent pour la paie
    th.regler_acces_menu(s, ADMIN, "DOSSIER", synthese["id"], ["administrateur"])
    v = visibles(PAIE)
    assert "MASSE_SALARIALE" not in v and "FICHE_SYNTHESE_ANNUELLE" not in v and "JOURNAL_PAIE" in v
    assert "MASSE_SALARIALE" in visibles(ADMIN)
    # l'écran de l'état prime sur celui du dossier
    a = th.regler_acces_menu(s, ADMIN, "MODELE", "MASSE_SALARIALE", ["gestionnaire_paie"])
    assert a["existe"] and a["roles"] == ["gestionnaire_paie"]
    assert "MASSE_SALARIALE" in visibles(PAIE) and "FICHE_SYNTHESE_ANNUELLE" not in visibles(PAIE)
    # rangé sous l'écran de son dossier
    assert s.execute(text("""SELECT p.code FROM nav_menu_item i JOIN nav_menu_item p ON p.id = i.parent_id
                             WHERE i.code = 'edt_m_masse_salariale'""")).scalar().startswith("edt_d_")
    # héritage affiché
    h = th.acces_menu(s, ADMIN, "MODELE", "FICHE_SYNTHESE_ANNUELLE")
    assert not h["existe"] and h["herite_de"] == "dossier" and h["roles"] == ["administrateur"]
    # lancement refusé hors accès
    fiche = next(m for m in sv.lister_modeles(s, ADMIN) if m["code"] == "FICHE_SYNTHESE_ANNUELLE")
    with pytest.raises(sv.Interdit):
        th.lancer(s, PAIE, "PAIE", fiche["id"], {"periode": "2026-09"})
    with pytest.raises(sv.Interdit):
        th.regler_acces_menu(s, PAIE, "MODELE", "JOURNAL_PAIE", ["gestionnaire_paie"])


def test_publication_automatique_a_la_premiere_ouverture(s):
    assert not th.publier_si_jamais(s, PAIE, "PAIE")                       # pas administrateur : rien
    assert th.publier_si_jamais(s, ADMIN, "PAIE")
    assert s.execute(text("SELECT count(*) FROM nav_menu_item WHERE code LIKE 'edt_d_%'")).scalar() > 0
    assert not th.publier_si_jamais(s, ADMIN, "PAIE")                      # une seule fois
    # un état inactif garde son écran (et ses rôles)
    m = next(x for x in sv.lister_modeles(s, ADMIN) if x["code"] == "JOURNAL_PAIE")
    th.regler_modele(s, ADMIN, m["id"], actif=False)
    th.publier_navigation(s, ADMIN, "PAIE", True)
    assert s.execute(text("SELECT 1 FROM nav_menu_item WHERE code = 'edt_m_journal_paie'")).first()


def test_navigation_suit_publication_archivage_suppression(s):
    """RG-EDT-NAV-06 : sans manipulation — publier crée l'écran, renommer le renomme, archiver le retire,
    désarchiver le rétablit."""
    th.publier_navigation(s, ADMIN, "PAIE", True)
    ecran = lambda: s.execute(text("SELECT label FROM nav_menu_item WHERE code = 'edt_m_etat_nav'")).scalar()
    r = sv.creer_modele(s, ADMIN, code="ETAT_NAV", libelle="État de test", categorie="LISTE", visibilite="SOCIETE")
    assert ecran() is None                                                  # brouillon : pas d'écran
    v = sv.lire_version(s, ADMIN, r["version_id"])[0]
    sv.publier(s, ADMIN, r["version_id"], v["jeton_concurrence"])
    assert ecran() == "État de test"
    parent = s.execute(text("""SELECT p.label FROM nav_menu_item i JOIN nav_menu_item p ON p.id = i.parent_id
                               WHERE i.code = 'edt_m_etat_nav'""")).scalar()
    assert parent == "États standard"                                       # dossier de sa catégorie
    sv.modifier_modele(s, ADMIN, r["modele_id"], libelle="État de test renommé")
    assert ecran() == "État de test renommé"
    sv.archiver_modele(s, ADMIN, r["modele_id"], True)
    assert ecran() is None
    sv.archiver_modele(s, ADMIN, r["modele_id"], False)
    assert ecran() == "État de test renommé"


def test_editions_rh_attestations(s):
    """RG-EDT-NAV-07 : le menu RH (attestations, courriers) a son écran « Éditions RH » et ses sous-menus."""
    assert th.publier_si_jamais(s, ADMIN, "RH")
    racine = s.execute(text("SELECT id, label FROM nav_menu_item WHERE chemin = '/editions/menu/rh'")).one()
    assert racine[1] == "Éditions RH"
    roles = {r[0] for r in s.execute(text("SELECT role_code FROM nav_role_visibilite WHERE item_id = :i"), {"i": racine[0]}).all()}
    assert roles == {"administrateur", "gestionnaire_rh"}
    att = s.execute(text("""SELECT i.chemin, p.label FROM nav_menu_item i JOIN nav_menu_item p ON p.id = i.parent_id
                            WHERE i.code = 'edt_m_attestation_travail_salaire'""")).one()
    assert att[0] == "/editions/etat/ATTESTATION_TRAVAIL_SALAIRE?module=RH" and att[1] == "Attestations"
    # un écran d'état RH créé à l'unité va aussi sous « Éditions RH »
    assert sv.ecran_navigation(s, ADMIN, "MODELE", "NOTIFICATION_REMUNERATION")["chemin"].endswith("?module=RH")


def test_attestation_depuis_la_fiche_collaborateur(s):
    """RG-EDT-ECRAN-07/08 : bouton Imprimer de la fiche collaborateur : attestations proposées, mois = dernier payé ;
    RG-EDT-ACCES : un rôle exclu de l'écran de l'attestation ne la voit plus sur la fiche."""
    from app.editions import ecrans as ec
    from tests_editions.recette import SARA
    s.execute(text("""INSERT INTO ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route, categorie_edition)
                      VALUES ('fiche_collaborateur', 'Fiche collaborateur', '["collaborateur_id"]', :ch, 'ATTESTATION')"""),
              {"ch": "/collaborateurs/:id"})
    RH = sv.Utilisateur(ADMIN_ID, PAIE.societe_id, frozenset({"gestionnaire_rh"}))
    codes = {m["code"] for m in ec.modeles_ecran(s, RH, "fiche_collaborateur")["modeles"]}
    assert "ATTESTATION_TRAVAIL_SALAIRE" in codes
    att = next(m for m in sv.lister_modeles(s, ADMIN) if m["code"] == "ATTESTATION_TRAVAIL_SALAIRE")
    r = ec.lancer(s, RH, "fiche_collaborateur", att["id"], {"collaborateur_id": SARA})
    assert len(r["documents"]) == 1                                         # septembre 2026, dernier mois payé
    th.regler_acces_menu(s, ADMIN, "MODELE", "ATTESTATION_TRAVAIL_SALAIRE", ["administrateur"])
    assert "ATTESTATION_TRAVAIL_SALAIRE" not in {m["code"] for m in ec.modeles_ecran(s, RH, "fiche_collaborateur")["modeles"]}
