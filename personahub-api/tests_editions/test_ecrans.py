"""Lancement des éditions depuis les menus métier — RG-EDT-ECRAN-01..06 (Adil DAIA, 19/10/2026)."""

import pytest
from sqlalchemy import text

from app.editions import ecrans as ec
from app.editions import service as sv
from app.editions.definition import Definition
from tests_editions.recette import B_OMAR_SEP, OMAR, P_SEP, PLAN, S1, SARA, base_requise
from tests_editions.test_service import ADMIN, ADMIN_ID, COLLAB_ID, PAIE, PAIE_ID, PAIE_S2, _systeme

pytestmark = base_requise


@pytest.fixture
def s(db, tmp_path, monkeypatch):
    monkeypatch.setattr(sv, "racine_documents", lambda: tmp_path)
    # ces tests portent sur le bulletin système seul (les exemples ont leurs propres tests)
    monkeypatch.setattr(sv, "MODELES_SYSTEME", {"bulletin_classique.json": sv.MODELES_SYSTEME["bulletin_classique.json"]})
    for uid in (ADMIN_ID, PAIE_ID, COLLAB_ID):
        db.execute(text("INSERT INTO users (id, email) VALUES (:id, :e)"), {"id": uid, "e": f"{uid}@x.ma"})
    sv.initialiser(db)
    yield db
    db.rollback()


def test_migration_menu_et_ecrans(s):
    menu = s.execute(text("""SELECT i.chemin, i.section_id, i.ordre, array_agg(v.role_code ORDER BY v.role_code)
                             FROM nav_menu_item i JOIN nav_role_visibilite v ON v.item_id = i.id
                             WHERE i.code = 'paie_edition_bulletins' GROUP BY i.chemin, i.section_id, i.ordre""")).one()
    assert menu[0] == "/paie/editions-paie"  # renommé par 078 and str(menu[1]).startswith("5e000000") and menu[2] == 40
    assert menu[3] == ["administrateur", "gestionnaire_paie"]               # rôles de l'ancien menu
    codes = {e["code_ecran"]: e["categorie_edition"] for e in ec.lister_ecrans(s, PAIE)}
    assert codes["traitement_paie"] == codes["consultation_bulletin"] == "BULLETIN"


def test_ecran_sans_rattachement_propose_la_categorie(s):                  # RG-EDT-ECRAN-03
    r = ec.modeles_ecran(s, PAIE, "consultation_bulletin")
    assert [m["code"] for m in r["modeles"]] == ["BULLETIN_CLASSIQUE"]
    assert r["defaut"] == str(_systeme(s))
    assert {p["type"] for p in r["modeles"][0]["parametres"]} == {"PERIODE", "COLLABORATEUR", "PLAN_PAIE"}
    with pytest.raises(sv.Introuvable):
        ec.modeles_ecran(s, PAIE, "ecran_inconnu")


def test_creation_rattache_aux_menus_de_la_categorie(s):                    # RG-EDT-ECRAN-02/04
    c = ec.creer_modele(s, PAIE, code="BULL_SOLGEIS", libelle="Bulletin SOLGEIS", categorie="BULLETIN",
                        visibilite="SOCIETE", origine_id=str(_systeme(s)))
    # non publié : pas encore proposé ; le bulletin système reste disponible
    assert [m["code"] for m in ec.modeles_ecran(s, PAIE, "consultation_bulletin")["modeles"]] == ["BULLETIN_CLASSIQUE"]
    sv.publier(s, PAIE, c["version_id"])
    codes = [m["code"] for m in ec.modeles_ecran(s, PAIE, "consultation_bulletin")["modeles"]]
    assert codes == ["BULL_SOLGEIS", "BULLETIN_CLASSIQUE"]                 # société avant système
    assert {e["code_ecran"] for e in ec.ecrans_du_modele(s, PAIE, c["modele_id"])} == \
        {"traitement_paie", "consultation_bulletin"}
    # une liste ne va pas dans les menus du bulletin
    l = ec.creer_modele(s, PAIE, code="LISTE_X", libelle="Liste", categorie="LISTE")
    assert ec.ecrans_du_modele(s, PAIE, l["modele_id"]) == []
    # défaut : le système, sur un seul écran
    ec.rattacher(s, PAIE, str(_systeme(s)), [{"code_ecran": "consultation_bulletin", "par_defaut": True},
                                              {"code_ecran": "traitement_paie"}])
    r = ec.modeles_ecran(s, PAIE, "consultation_bulletin")
    assert r["modeles"][0]["code"] == "BULLETIN_CLASSIQUE" and r["defaut"] == str(_systeme(s))
    ec.rattacher(s, PAIE, c["modele_id"], [{"code_ecran": "consultation_bulletin", "par_defaut": True}])
    r = ec.modeles_ecran(s, PAIE, "consultation_bulletin")
    assert [(m["code"], m["par_defaut"]) for m in r["modeles"]] == [("BULL_SOLGEIS", True), ("BULLETIN_CLASSIQUE", False)]
    # retiré du traitement : n'y est plus proposé
    assert [m["code"] for m in ec.modeles_ecran(s, PAIE, "traitement_paie")["modeles"]] == ["BULLETIN_CLASSIQUE"]
    # une autre société n'est pas concernée par ces rattachements
    assert [m["code"] for m in ec.modeles_ecran(s, PAIE_S2, "consultation_bulletin")["modeles"]] == ["BULLETIN_CLASSIQUE"]


def test_contexte_vers_parametres(s):                                       # RG-EDT-ECRAN-05
    d = Definition.model_validate(sv.lire_version(s, PAIE, sv.lire_modele(s, PAIE, str(_systeme(s)))["version_publiee_id"])[0]["definition"])
    p = ec.parametres_depuis_contexte(d, {"periode_id": P_SEP, "collaborateur_id": SARA, "bulletin_id": "b1",
                                          "plan_paie_id": PLAN}, {"plan_paie": None})
    assert p == {"periode": P_SEP, "collaborateurs": [SARA], "plan_paie": PLAN, "bulletin": "b1"}
    p = ec.parametres_depuis_contexte(d, {"periode_id": P_SEP}, {"collaborateurs": [OMAR]})
    assert p == {"periode": P_SEP, "collaborateurs": [OMAR]}


def test_impression_depuis_le_traitement_et_en_serie(s):                     # RG-EDT-ECRAN-05/06
    r = ec.lancer(s, PAIE, "traitement_paie", None, {"periode_id": P_SEP, "collaborateur_id": OMAR,
                                                     "bulletin_id": B_OMAR_SEP})
    assert [d["nom_fichier"] for d in r["documents"]] == ["Bulletin_M002_2026-09.pdf"]
    assert r["modele"]["code"] == "BULLETIN_CLASSIQUE"
    pdf, nom = ec.pdf_demande(s, PAIE, r["demande_id"])
    assert pdf.startswith(b"%PDF") and nom.startswith("bulletin_classique_")
    # menu Édition des bulletins : toute la période en un seul PDF
    r = ec.lancer(s, PAIE, "consultation_bulletin", None, {}, {"periode": P_SEP})
    assert len(r["documents"]) == 2
    from pypdf import PdfReader
    import io
    pdf, _ = ec.pdf_demande(s, PAIE, r["demande_id"])
    assert len(PdfReader(io.BytesIO(pdf)).pages) == sum(d["nb_pages"] for d in r["documents"])
    # un modèle non proposé sur l'écran est refusé
    c = ec.creer_modele(s, PAIE, code="LISTE_Y", libelle="Liste", categorie="LISTE", visibilite="SOCIETE")
    sv.publier(s, PAIE, c["version_id"])
    with pytest.raises(sv.Interdit):
        ec.lancer(s, PAIE, "consultation_bulletin", c["modele_id"], {"periode_id": P_SEP})
    # pas de bulletin définitif : message clair
    with pytest.raises(sv.ErreurEdition):
        ec.lancer(s, PAIE, "consultation_bulletin", None, {"periode_id": P_SEP, "collaborateur_id": "c0000000-0000-0000-0000-000000000009"})
