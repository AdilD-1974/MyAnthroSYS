"""Thèmes, indicateur Actif, menu en arborescence — RG-EDT-THEME/ACTIF/MENU (Adil DAIA, 19/10/2026)."""

import pytest
from sqlalchemy import text

from app.editions import ecrans as ec
from app.editions import service as sv
from app.editions import themes as th
from tests_editions.recette import P_SEP, base_requise
from tests_editions.test_service import ADMIN_ID, COLLAB, COLLAB_ID, PAIE, PAIE_ID, PAIE_S2, _systeme

pytestmark = base_requise


@pytest.fixture
def s(db, tmp_path, monkeypatch):
    monkeypatch.setattr(sv, "racine_documents", lambda: tmp_path)
    for uid in (ADMIN_ID, PAIE_ID, COLLAB_ID):
        db.execute(text("INSERT INTO users (id, email) VALUES (:id, :e)"), {"id": uid, "e": f"{uid}@x.ma"})
    sv.initialiser(db)
    yield db
    db.rollback()


def _libelles(a):
    return {t["libelle"]: [m["code"] for m in t["modeles"]] for t in a["themes"]}


def test_menu_paie_en_arborescence(s):                                       # RG-EDT-MENU-01
    a = th.arbre(s, PAIE, "PAIE")
    assert _libelles(a) == {"Bulletins de paie": ["BULLETIN_CLASSIQUE"]}       # thèmes vides masqués
    tous = th.arbre(s, PAIE, "PAIE", tout=True)
    assert [t["libelle"] for t in tous["themes"]][:3] == ["Bulletins de paie", "États standard", "Journaux de paie"]
    assert "Attestations" not in _libelles(tous)                               # module RH
    m = a["themes"][0]["modeles"][0]
    assert {p["type"] for p in m["parametres"]} == {"PERIODE", "COLLABORATEUR", "PLAN_PAIE"}


def test_plusieurs_bulletins_et_classement(s):                               # RG-EDT-THEME-01/02
    c = ec.creer_modele(s, PAIE, code="BULL_CADRES", libelle="Bulletin cadres", categorie="BULLETIN",
                        visibilite="SOCIETE", origine_id=str(_systeme(s)))
    sv.publier(s, PAIE, c["version_id"])
    j = sv.creer_modele(s, PAIE, code="JRN", libelle="Journal", categorie="JOURNAL", visibilite="SOCIETE")
    sv.publier(s, PAIE, j["version_id"])
    assert _libelles(th.arbre(s, PAIE, "PAIE")) == {
        "Bulletins de paie": ["BULL_CADRES", "BULLETIN_CLASSIQUE"], "Journaux de paie": ["JRN"]}
    # dossier de la société, sous « Journaux de paie »
    journaux = next(t for t in th.lister_themes(s, PAIE, "PAIE") if t["code"] == "PAIE_JOURNAUX")
    cema = th.creer_theme(s, PAIE, libelle="Journal de paie Cema", parent_id=journaux["id"])
    assert cema["code"] == "JOURNAL_DE_PAIE_CEMA" and not cema["est_systeme"]
    th.regler_modele(s, PAIE, j["modele_id"], theme_id=cema["id"])
    a = _libelles(th.arbre(s, PAIE, "PAIE"))
    assert a["Journal de paie Cema"] == ["JRN"] and a["Journaux de paie"] == []  # parent gardé : sous-dossier garni
    lib = {m["code"]: m for m in th.avec_theme(s, PAIE, sv.lister_modeles(s, PAIE))}
    assert lib["JRN"]["theme_libelle"] == "Journal de paie Cema" and not lib["JRN"]["theme_implicite"]
    assert lib["BULL_CADRES"]["theme_libelle"] == "Bulletins de paie" and lib["BULL_CADRES"]["theme_implicite"]
    # RG-EDT-THEME-03 : dossier supprimé → le journal retourne dans « Journaux de paie »
    th.supprimer_theme(s, PAIE, cema["id"])
    assert _libelles(th.arbre(s, PAIE, "PAIE"))["Journaux de paie"] == ["JRN"]
    # un thème système ne se modifie pas ; pas de boucle
    with pytest.raises(sv.Interdit):
        th.modifier_theme(s, PAIE, journaux["id"], libelle="X")
    a1 = th.creer_theme(s, PAIE, libelle="A")
    b1 = th.creer_theme(s, PAIE, libelle="B", parent_id=a1["id"])
    with pytest.raises(sv.Invalide):
        th.modifier_theme(s, PAIE, a1["id"], parent_id=b1["id"])
    # le collaborateur ne crée pas de thème ; une autre société ne voit pas ceux-ci
    with pytest.raises(sv.Interdit):
        th.creer_theme(s, COLLAB, libelle="Z")
    assert "A" not in {t["libelle"] for t in th.lister_themes(s, PAIE_S2)}


def test_indicateur_actif(s):                                                # RG-EDT-ACTIF-01
    mid = str(_systeme(s))
    assert sv.lire_modele(s, PAIE, mid)["actif"] is True
    th.regler_modele(s, PAIE, mid, actif=False)
    assert sv.lire_modele(s, PAIE, mid)["actif"] is False
    assert th.arbre(s, PAIE, "PAIE")["themes"] == []                          # plus dans le menu
    assert ec.modeles_ecran(s, PAIE, "traitement_paie")["modeles"] == []      # ni au traitement
    with pytest.raises(sv.Conflit):
        sv.lancer(s, PAIE, mid, {"periode": P_SEP})
    with pytest.raises(sv.Interdit):
        th.lancer(s, PAIE, "PAIE", mid, {"periode": P_SEP})
    # par société : l'autre société le garde actif
    assert sv.lire_modele(s, PAIE_S2, mid)["actif"] is True
    th.regler_modele(s, PAIE, mid, actif=True)
    r = th.lancer(s, PAIE, "PAIE", mid, {"periode": P_SEP})
    assert len(r["documents"]) == 2 and r["modele"]["code"] == "BULLETIN_CLASSIQUE"
    with pytest.raises(sv.Interdit):
        th.regler_modele(s, COLLAB, mid, actif=False)


def test_ecran_bulletins_remplace_par_le_menu_paie(s):
    menu = s.execute(text("SELECT label, chemin FROM nav_menu_item WHERE code = 'paie_edition_bulletins'")).one()
    assert tuple(menu) == ("Éditions de la paie", "/paie/editions-paie")
    assert "edition_bulletins" not in {e["code_ecran"] for e in ec.lister_ecrans(s, PAIE)}


def test_changer_la_categorie_d_un_modele(s):                              # RG-EDT-MODELE-03
    j = sv.creer_modele(s, PAIE, code="JRNLPAIE", libelle="Journal de Paie", visibilite="SOCIETE", categorie="LISTE")
    sv.publier(s, PAIE, j["version_id"])
    assert _libelles(th.arbre(s, PAIE, "PAIE")).get("États standard") == ["JRNLPAIE"]
    m = ec.modifier_modele(s, PAIE, j["modele_id"], categorie="JOURNAL", libelle="Journal de paie mensuel")
    assert m["categorie"] == "JOURNAL" and m["libelle"] == "Journal de paie mensuel"
    assert [x["code"] for x in sv.lister_modeles(s, PAIE, "JOURNAL")] == ["JRNLPAIE"]      # onglet Journaux
    assert _libelles(th.arbre(s, PAIE, "PAIE"))["Journaux de paie"] == ["JRNLPAIE"]       # dossier suivi
    with pytest.raises(sv.Invalide):
        ec.modifier_modele(s, PAIE, j["modele_id"], categorie="INCONNUE")
    with pytest.raises(sv.Interdit):                                        # modèle système
        ec.modifier_modele(s, PAIE, str(_systeme(s)), categorie="JOURNAL")
