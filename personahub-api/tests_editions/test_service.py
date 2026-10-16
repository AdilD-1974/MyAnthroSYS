"""Cycle de vie des modèles et production — RG-EDT-MODELE/VERSION/PROD/SECU/AUDIT (Adil DAIA)."""

import pytest
from sqlalchemy import text

from app.editions import service as sv
from tests_editions.recette import P_S2, P_SEP, S1, S2, base_requise

pytestmark = base_requise

ADMIN_ID = "dddddddd-0000-0000-0000-000000000001"
PAIE_ID = "dddddddd-0000-0000-0000-000000000002"
COLLAB_ID = "dddddddd-0000-0000-0000-000000000003"
ADMIN = sv.Utilisateur(ADMIN_ID, S1, frozenset({"administrateur"}))
PAIE = sv.Utilisateur(PAIE_ID, S1, frozenset({"gestionnaire_paie"}))
COLLAB = sv.Utilisateur(COLLAB_ID, S1, frozenset({"collaborateur"}))
PAIE_S2 = sv.Utilisateur(PAIE_ID, S2, frozenset({"gestionnaire_paie"}))


@pytest.fixture
def s(db, tmp_path, monkeypatch):
    """Session de recette remise à zéro après chaque test ; stockage temporaire."""
    monkeypatch.setattr(sv, "racine_documents", lambda: tmp_path)
    for uid in (ADMIN_ID, PAIE_ID, COLLAB_ID):
        db.execute(text("INSERT INTO users (id, email) VALUES (:id, :e)"), {"id": uid, "e": f"{uid}@x.ma"})
    sv.initialiser(db)
    yield db
    db.rollback()


def _systeme(db):
    return db.execute(text("SELECT id FROM edt_modele WHERE code = 'BULLETIN_CLASSIQUE'")).scalar()


def test_installation_des_modeles_systeme_idempotente(s):
    mid = str(_systeme(s))
    assert sv.installer_modeles_systeme(s) == []                    # fichier inchangé : rien
    v = sv.lister_versions(s, PAIE, mid)
    assert [(x["numero"], x["statut"]) for x in v] == [(1, "PUBLIEE")]
    deps = {r[0] for r in s.execute(text("SELECT code FROM edt_modele_dependance"))}
    assert {"BULLETIN", "BULLETIN_LIGNE"} <= deps


def test_visibilite_des_modeles(s):                                  # RG-EDT-MODELE-01
    prive = sv.creer_modele(s, PAIE, code="MON_ETAT", libelle="Mon état")
    sv.creer_modele(s, PAIE, code="ETAT_SOC", libelle="Commun", visibilite="SOCIETE")
    codes = lambda u: {m["code"] for m in sv.lister_modeles(s, u)}
    assert codes(PAIE) == {"BULLETIN_CLASSIQUE", "MON_ETAT", "ETAT_SOC"}
    assert codes(COLLAB) == {"BULLETIN_CLASSIQUE", "ETAT_SOC"}       # privé d'un autre : invisible
    assert codes(ADMIN) == {"BULLETIN_CLASSIQUE", "MON_ETAT", "ETAT_SOC"}
    assert codes(PAIE_S2) == {"BULLETIN_CLASSIQUE", "MON_ETAT"}     # privé suit le propriétaire
    with pytest.raises(sv.Introuvable):
        sv.lire_modele(s, COLLAB, prive["modele_id"])


def test_creation_controles(s):
    with pytest.raises(sv.Interdit):
        sv.creer_modele(s, COLLAB, code="X1", libelle="x")          # RG-EDT-SECU-03 (défaut)
    with pytest.raises(sv.Invalide):
        sv.creer_modele(s, PAIE, code="1abc", libelle="x")
    with pytest.raises(sv.Invalide):
        sv.creer_modele(s, PAIE, code="X1", libelle="x", visibilite="GLOBAL")
    sv.creer_modele(s, PAIE, code="X1", libelle="x")
    with pytest.raises(sv.Conflit):
        sv.creer_modele(s, PAIE, code="x1", libelle="doublon")


def test_modele_systeme_non_modifiable_mais_copiable(s):            # RG-EDT-MODELE-02
    mid = str(_systeme(s))
    with pytest.raises(sv.Interdit):
        sv.ouvrir_brouillon(s, ADMIN, mid)
    copie = sv.creer_modele(s, PAIE, code="BULLETIN_SOLGEIS", libelle="Bulletin SOLGEIS", origine_id=mid)
    v, m = sv.lire_version(s, PAIE, copie["version_id"])
    assert m["categorie"] == "BULLETIN" and m["modele_origine_id"] == mid
    assert v["statut"] == "BROUILLON" and v["definition"]["sortie"]["eclatement"] == "collaborateur_id"


def test_enregistrement_concurrent_refuse(s):                       # RG-EDT-VERSION-03
    c = sv.creer_modele(s, PAIE, code="LISTE", libelle="Liste", visibilite="SOCIETE")
    v, _ = sv.lire_version(s, PAIE, c["version_id"])
    d = v["definition"]
    d["bandes"][0]["elements"][0]["valeur"] = '"Liste du personnel"'
    r1 = sv.enregistrer(s, PAIE, c["version_id"], d, v["jeton_concurrence"])
    assert r1["valide"], r1["erreurs"]
    assert r1["jeton"] != v["jeton_concurrence"]
    with pytest.raises(sv.Conflit) as e:                              # second onglet, jeton périmé
        sv.enregistrer(s, ADMIN, c["version_id"], d, v["jeton_concurrence"])
    assert e.value.details["jeton_actuel"] == r1["jeton"]
    with pytest.raises(sv.Conflit):
        sv.enregistrer(s, PAIE, c["version_id"], d, None)


def test_brouillon_invalide_enregistre_mais_non_publiable(s):
    c = sv.creer_modele(s, PAIE, code="LISTE2", libelle="Liste")
    v, _ = sv.lire_version(s, PAIE, c["version_id"])
    d = v["definition"]
    d["bandes"][1]["elements"][0]["valeur"] = "identite.inexistant"
    r = sv.enregistrer(s, PAIE, c["version_id"], d, v["jeton_concurrence"])
    assert not r["valide"] and "inexistant" in r["erreurs"][0]["message"]
    with pytest.raises(sv.Invalide) as e:
        sv.publier(s, PAIE, c["version_id"])
    assert e.value.details["erreurs"]


def test_publication_puis_nouveau_brouillon(s):                     # RG-EDT-VERSION-02/04
    c = sv.creer_modele(s, PAIE, code="LISTE3", libelle="Liste")
    p = sv.publier(s, PAIE, c["version_id"])
    assert len(p["empreinte"]) == 64
    m = sv.lire_modele(s, PAIE, c["modele_id"])
    assert m["version_publiee_id"] == c["version_id"]
    with pytest.raises(sv.Conflit):
        sv.publier(s, PAIE, c["version_id"])                         # déjà publiée
    b = sv.ouvrir_brouillon(s, PAIE, c["modele_id"])
    assert b["cree"] and sv.ouvrir_brouillon(s, PAIE, c["modele_id"]) == {"version_id": b["version_id"], "cree": False}
    v2, _ = sv.lire_version(s, PAIE, b["version_id"])
    assert v2["numero"] == 2 and v2["definition"] == sv.lire_version(s, PAIE, c["version_id"])[0]["definition"]
    sv.publier(s, PAIE, b["version_id"])
    assert [(x["numero"], x["statut"]) for x in sv.lister_versions(s, PAIE, c["modele_id"])] == \
        [(2, "PUBLIEE"), (1, "RETIREE")]
    with pytest.raises(Exception):                                   # trigger : version figée
        s.execute(text("UPDATE edt_modele_version SET definition = '{}'::jsonb WHERE id = :id"),
                  {"id": c["version_id"]})


def test_lancement_bulletins_et_telechargement(s, tmp_path):        # RG-EDT-PROD-01/02
    mid = str(_systeme(s))
    r = sv.lancer(s, PAIE, mid, {"periode": P_SEP})
    assert r["statut"] == "TERMINEE"
    assert [d["nom_fichier"] for d in r["documents"]] == ["Bulletin_M001_2026-09.pdf", "Bulletin_M002_2026-09.pdf"]
    dem = sv.lire_demande(s, PAIE, r["demande_id"])
    assert dem["nb_documents"] == 2 and dem["modele_code"] == "BULLETIN_CLASSIQUE"
    chemin, nom = sv.fichier_document(s, PAIE, r["documents"][0]["id"])
    assert chemin.read_bytes().startswith(b"%PDF") and str(tmp_path) in str(chemin)
    # RG-EDT-SECU-04 : le collaborateur n'a pas le droit données sensibles
    with pytest.raises((sv.Interdit, sv.Introuvable)):
        sv.fichier_document(s, COLLAB, r["documents"][0]["id"])
    # une autre société ne voit ni la demande ni le document
    with pytest.raises(sv.Introuvable):
        sv.lire_demande(s, PAIE_S2, r["demande_id"])
    with pytest.raises(sv.Introuvable):
        sv.fichier_document(s, PAIE_S2, r["documents"][0]["id"])
    # fichier altéré sur disque : refusé
    chemin.write_bytes(b"%PDF-falsifie")
    with pytest.raises(sv.Conflit):
        sv.fichier_document(s, PAIE, r["documents"][0]["id"])
    actions = [x[0] for x in s.execute(text("SELECT action FROM edt_audit ORDER BY id"))]
    assert "LANCEMENT" in actions and "TELECHARGEMENT" in actions


def test_lancement_refuse_trace_l_echec(s):                         # RG-EDT-SECU-02
    mid = str(_systeme(s))
    with pytest.raises(sv.ErreurEdition) as e:
        sv.lancer(s, PAIE, mid, {"periode": P_S2})
    assert e.value.conserver and "société active" in e.value.message
    statut = s.execute(text("SELECT statut, erreur FROM edt_demande WHERE id = :id"),
                       {"id": e.value.details["demande_id"]}).first()
    assert statut[0] == "ECHEC" and "société" in statut[1]


def test_lancement_sans_version_publiee(s):
    c = sv.creer_modele(s, PAIE, code="SANS_PUB", libelle="x")
    with pytest.raises(sv.Conflit):
        sv.lancer(s, PAIE, c["modele_id"], {"periode": P_SEP})


def test_apercu_d_un_brouillon_avec_filigrane(s):
    c = sv.creer_modele(s, PAIE, code="APERCU_T", libelle="x", visibilite="SOCIETE", origine_id=str(_systeme(s)))
    pdf, info = sv.apercu(s, PAIE, c["version_id"], {"periode": P_SEP})
    assert pdf.startswith(b"%PDF") and info["documents"] == 2 and info["affiches"] == 2
    from pypdf import PdfReader
    import io
    lecteur = PdfReader(io.BytesIO(pdf))
    assert len(lecteur.pages) == 2 and "APERÇU" in lecteur.pages[0].extract_text()
    assert s.execute(text("SELECT count(*) FROM edt_demande")).scalar() == 0      # rien de conservé
    with pytest.raises(sv.Interdit):
        sv.apercu(s, COLLAB, c["version_id"], {"periode": P_SEP})


def test_droits_parametres_remplacent_les_defauts(s):              # RG-EDT-SECU-03
    mid = str(_systeme(s))
    s.execute(text("""INSERT INTO edt_droit (cible, cible_code, role_code, permission, societe_id)
                      VALUES ('CATEGORIE', 'BULLETIN', 'collaborateur', 'LANCER', :s)"""), {"s": S1})
    bulletin = sv.lire_modele(s, COLLAB, mid)                               # LANCER donne VOIR
    assert sv.peut(s, COLLAB, "LANCER", bulletin)
    assert not sv.peut(s, PAIE, "LANCER", bulletin)                         # plus de droits par défaut
    with pytest.raises(sv.Introuvable):
        sv.lire_modele(s, PAIE, mid)                                         # ni VOIR : 404
    assert not sv.peut(s, PAIE, "CONCEVOIR")
    assert sv.peut(s, ADMIN, "ADMINISTRER")


def test_aides_au_designer(s):
    cat = {x["code"]: x for x in sv.catalogue_sources(s)}
    assert "BULLETIN" in cat and any(c["code"] == "identite.matricule" for c in cat["BULLETIN"]["champs"])
    assert {"code": "lignes", "cible": "BULLETIN_LIGNE", "cardinalite": "PLUSIEURS"} in cat["BULLETIN"]["relations"]
    rub = {r["code"]: r["libelle"] for r in sv.rubriques(s, PAIE)}
    assert rub["PRIM_ANC"] == "Prime d'ancienneté (SOLGEIS)" and "VIEILLE" not in rub
    ok = sv.analyser_expression(s, PAIE, 'identite.nom + " " + [SALBASE].MT', "BULLETIN")
    assert ok["valide"] and ok["rubriques"] == ["SALBASE"]
    ko = sv.analyser_expression(s, PAIE, "identite.inconnu + [VIEILLE].MT", "BULLETIN")
    assert not ko["valide"] and len(ko["erreurs"]) == 2
    syntaxe = sv.analyser_expression(s, PAIE, "1 + * 2")
    assert not syntaxe["valide"] and syntaxe["erreurs"][0]["debut"] is not None
    assert any(m["code"] == "MONTANT" for m in sv.masques(s, PAIE))


def test_valeurs_des_parametres(s):
    per = sv.periodes(s, PAIE)
    assert per and all(p["id"] != P_S2 for p in per)                  # autre société exclue
    sep = next(p for p in per if p["id"] == P_SEP)
    assert sep["nb_bulletins"] == 2 and sep["plan_code"] == "MENS"
    assert [p["code"] for p in sv.plans_paie(s, PAIE)] == ["MENS"]
