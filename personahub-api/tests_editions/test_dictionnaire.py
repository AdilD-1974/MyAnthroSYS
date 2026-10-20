"""Dictionnaire des données configurable — RG-EDT-DICO-01..08 (Adil DAIA, 20/10/2026)."""
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text

from recette import *  # noqa: F401,F403
from recette import base_requise

pytestmark = base_requise

TABLES = f"""
CREATE TABLE collaborateurs (id uuid PRIMARY KEY, societe_id uuid, nom text);
INSERT INTO collaborateurs VALUES ('{SARA}', '{S1}', 'ALAMI'), ('{OMAR}', '{S1}', 'BENNANI'), ('{NADIA}', '{S2}', 'NADIA');
CREATE TABLE pret_test (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), societe_id uuid, collaborateur_id uuid,
                        libelle text, montant numeric(12,2), date_octroi date, archive boolean DEFAULT false);
INSERT INTO pret_test (societe_id, collaborateur_id, libelle, montant, date_octroi, archive) VALUES
  ('{S1}', '{SARA}', 'Prêt logement', 50000, '2026-01-10', false),
  ('{S1}', '{SARA}', 'Avance', 2000, '2026-08-01', false),
  ('{S1}', '{SARA}', 'Ancien prêt', 9999, '2020-01-01', true),
  ('{S2}', '{NADIA}', 'Prêt autre société', 7000, '2026-01-01', false);
CREATE TABLE poste_hist (collaborateur_id uuid, poste text, date_debut date, date_fin date);
INSERT INTO poste_hist VALUES ('{SARA}', 'Comptable', '2020-01-01', '2026-06-30'),
                              ('{SARA}', 'Chef comptable', '2026-07-01', NULL);
CREATE TABLE ref_niveau_t (code text PRIMARY KEY, libelle text);
INSERT INTO ref_niveau_t VALUES ('CAD', 'Cadre'), ('EMP', 'Employé');
"""


@pytest.fixture
def d(db):
    from app.editions import dictionnaire as dico
    from app.editions.sources import REGISTRE
    db.execute(text("UPDATE edt_source SET actif = actif"))
    from app.editions import catalogue
    catalogue.synchroniser(db)
    db.connection().exec_driver_sql(TABLES)
    yield db
    db.rollback()
    for c in [c for c, f in REGISTRE.items() if getattr(f, "perso", False)]:
        del REGISTRE[c]


def sec(societe=S1, sensibles=True):
    from app.editions.sources import ContexteSecurite
    return ContexteSecurite(None, societe, frozenset(), sensibles)


def bulletins(db):
    from app.editions import dictionnaire as dico
    from app.editions.sources import REGISTRE
    lignes = REGISTRE["BULLETIN"].lire(db, {"periode": {"id": P_SEP}}, sec())
    dico.completer(db, "BULLETIN", lignes, {}, sec())
    return {l["collaborateur_id"]: l for l in lignes}


def test_champs_recherche_somme_nombre_liste_historise(d):
    from app.editions import dictionnaire as dico
    base = {"mode": "RECHERCHE", "cle_ligne": "collaborateur_id", "table_cible": "pret_test", "colonne_cle": "collaborateur_id",
            "conditions": [{"colonne": "archive", "operateur": "=", "valeur": "false"}]}
    dico.creer_champ(d, "BULLETIN", {**base, "code": "prets.total", "libelle": "Total des prêts", "groupe": "Prêts",
                                     "colonne_valeur": "montant", "agregat": "SOMME"}, None)
    dico.creer_champ(d, "BULLETIN", {**base, "code": "prets.nb", "libelle": "Nombre de prêts", "agregat": "NB"}, None)
    dico.creer_champ(d, "BULLETIN", {**base, "code": "prets.liste", "libelle": "Prêts", "colonne_valeur": "libelle",
                                     "agregat": "LISTE", "colonne_ordre": "date_octroi"}, None)
    dico.creer_champ(d, "BULLETIN", {"mode": "RECHERCHE", "code": "poste.actuel", "libelle": "Poste à la date de la paie",
                                     "cle_ligne": "collaborateur_id", "table_cible": "poste_hist", "colonne_cle": "collaborateur_id",
                                     "colonne_valeur": "poste", "colonne_date_debut": "date_debut", "colonne_date_fin": "date_fin"}, None)
    b = bulletins(d)
    sara, omar = b[SARA], b[OMAR]
    assert sara["prets"]["total"] == Decimal("52000.00")             # archivé exclu (condition)
    assert sara["prets"]["nb"] == Decimal(2) and omar["prets"]["nb"] == Decimal(0)
    assert sara["prets"]["liste"] == "Prêt logement, Avance"         # ordre de la date d'octroi
    assert sara["poste"]["actuel"] == "Chef comptable"               # en vigueur fin septembre 2026
    types = dict(d.execute(text("SELECT code, type_donnee FROM edt_source_champ WHERE source_code='BULLETIN' AND perso")).all())
    assert types == {"prets.total": "MONTANT", "prets.nb": "NOMBRE", "prets.liste": "TEXTE", "poste.actuel": "TEXTE"}


def test_association_code_referentiel_intitule(d):
    from app.editions import dictionnaire as dico
    dico.creer_champ(d, "BULLETIN", {"mode": "RECHERCHE", "code": "complement.niveau_libelle", "libelle": "Niveau (intitulé)",
                                     "cle_ligne": "qualification.code_categorie_professionnelle", "table_cible": "ref_niveau_t",
                                     "colonne_cle": "code", "colonne_valeur": "libelle"}, None)
    d.execute(text("""UPDATE bulletin_snapshot_collaborateur SET donnees = jsonb_set(COALESCE(donnees, '{}'::jsonb),
                      '{qualification}', '{"code_categorie_professionnelle": "CAD"}') WHERE bulletin_id = :b"""), {"b": B_SARA_SEP})
    assert bulletins(d)[SARA]["complement"]["niveau_libelle"] == "Cadre"


def test_source_personnalisee_filtree_par_societe_et_relation(d):
    from app.editions import dictionnaire as dico
    from app.editions.sources import REGISTRE
    dico.creer_source(d, {"code": "PRETS_T", "libelle": "Prêts (test)", "table_principale": "pret_test",
                          "colonne_societe": "societe_id", "colonne_collaborateur": "collaborateur_id",
                          "conditions": [{"colonne": "archive", "operateur": "=", "valeur": "false"}],
                          "colonnes": ["libelle", "montant", "date_octroi"]}, None)
    f = REGISTRE["PRETS_T"]
    lignes = f.lire(d, {}, sec())
    assert sorted(l["libelle"] for l in lignes) == ["Avance", "Prêt logement"]          # société 1, non archivés
    assert {l["collaborateur_id"] for l in lignes} == {SARA}
    assert f.lire(d, {}, sec(S2))[0]["libelle"] == "Prêt autre société"
    assert isinstance(lignes[0]["montant"], Decimal) and isinstance(lignes[0]["date_octroi"], date)
    # relation BULLETIN → PRETS_T, jeu secondaire par le moteur
    dico.creer_relation(d, {"source": "BULLETIN", "cible": "PRETS_T", "code": "prets", "cle_source": "collaborateur_id",
                            "cle_cible": "collaborateur_id"})
    from app.editions import catalogue
    from app.editions.definition import Definition
    from app.editions.moteur import executeur
    from app.editions.validation import valider
    defn = {"parametres": [{"code": "periode", "libelle": "Période", "type": "PERIODE"}],
            "jeux": [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"]},
                     {"code": "p", "source": "PRETS_T", "role": "SECONDAIRE", "parent": "b", "relation": "prets"}],
            "bandes": [{"id": "c", "type": "CORPS", "hauteur": 5, "elements": [
                {"id": "x", "type": "CHAMP", "x": 0, "y": 0, "l": 50, "h": 5, "valeur": "identite.nom"}]}]}
    rapport = valider(Definition.model_validate(defn), catalogue.charger(d, S1))
    assert not rapport.erreurs, rapport.erreurs
    prep = executeur._preparer(d, Definition.model_validate(defn), {"periode": P_SEP}, sec(), registre_masques=None,
                               racine_fichiers="storage", contexte_fixe=None, forme=None)
    enfants = prep.contexte["enfants"]["p"]
    par_collab = {l["collaborateur_id"]: enfants[l["id"]] for l in prep.lignes}
    assert len(par_collab[SARA]) == 2 and par_collab[OMAR] == []
    # suppression refusée tant qu'un modèle l'utilise
    d.execute(text("""INSERT INTO edt_modele (id, code, libelle, categorie, visibilite) VALUES
                      ('eeeeeeee-0000-0000-0000-000000000001', 'TEST_DICO', 'Test', 'AUTRE', 'SOCIETE')"""))
    d.execute(text("""INSERT INTO edt_modele_version (modele_id, numero, statut, definition) VALUES
                      ('eeeeeeee-0000-0000-0000-000000000001', 1, 'BROUILLON', CAST(:d AS jsonb))"""),
              {"d": __import__("json").dumps(defn)})
    with pytest.raises(dico.ErreurDictionnaire):
        dico.supprimer_source(d, "PRETS_T")
    with pytest.raises(dico.ErreurDictionnaire):
        dico.supprimer_relation(d, "BULLETIN", "prets")


def test_garde_fous(d):
    from app.editions import dictionnaire as dico
    with pytest.raises(dico.ErreurDictionnaire, match="non autorisée"):
        dico.creer_champ(d, "BULLETIN", {"mode": "RECHERCHE", "code": "x.y", "libelle": "x", "cle_ligne": "id",
                                         "table_cible": "users", "colonne_cle": "id", "colonne_valeur": "email"}, None)
    with pytest.raises(dico.ErreurDictionnaire, match="absente"):
        dico.creer_champ(d, "BULLETIN", {"mode": "RECHERCHE", "code": "x.y", "libelle": "x", "cle_ligne": "id",
                                         "table_cible": "pret_test", "colonne_cle": "id", "colonne_valeur": "x; DROP TABLE"}, None)
    with pytest.raises(dico.ErreurDictionnaire, match="source personnalisée"):
        dico.creer_champ(d, "BULLETIN", {"mode": "COLONNE", "code": "x.y", "libelle": "x", "colonne": "id"}, None)
    with pytest.raises(dico.ErreurDictionnaire, match="société"):
        dico.creer_source(d, {"code": "POSTES_T", "libelle": "Postes", "table_principale": "poste_hist",
                              "colonne_cle": "poste"}, None)
    with pytest.raises(dico.ErreurDictionnaire, match="existe déjà"):
        dico.creer_champ(d, "BULLETIN", {"mode": "RECHERCHE", "code": "identite.nom", "libelle": "x", "cle_ligne": "id",
                                         "table_cible": "pret_test", "colonne_cle": "id", "colonne_valeur": "libelle"}, None)
    # filtre par le collaborateur rattaché à la société : accepté
    dico.creer_source(d, {"code": "POSTES_T", "libelle": "Postes", "table_principale": "poste_hist",
                          "colonne_cle": "poste", "colonne_collaborateur": "collaborateur_id", "colonnes": ["poste"]}, None)
    from app.editions.sources import REGISTRE
    assert len(REGISTRE["POSTES_T"].lire(d, {}, sec())) == 2 and REGISTRE["POSTES_T"].lire(d, {}, sec(S2)) == []


def test_gestion_des_champs_existants_et_synchronisation(d):
    from app.editions import catalogue
    from app.editions import dictionnaire as dico
    dico.modifier_champ(d, "BULLETIN", "identite.nom", {"libelle": "Nom de famille", "groupe": "État civil",
                                                         "visible": False, "sensible": True}, None)
    dico.creer_champ(d, "BULLETIN", {"mode": "RECHERCHE", "code": "prets.nb", "libelle": "Nb", "cle_ligne": "collaborateur_id",
                                     "table_cible": "pret_test", "colonne_cle": "collaborateur_id", "agregat": "NB"}, None)
    catalogue.synchroniser(d)                                      # au redémarrage : rien n'est écrasé
    r = d.execute(text("SELECT libelle, groupe, visible, sensible FROM edt_source_champ WHERE source_code='BULLETIN' AND code='identite.nom'")).one()
    assert tuple(r) == ("Nom de famille", "État civil", False, True)
    assert d.execute(text("SELECT actif FROM edt_source_champ WHERE source_code='BULLETIN' AND code='prets.nb'")).scalar() is True
    # masquage d'un champ ajouté sensible (RG-EDT-DICO-08)
    dico.modifier_champ(d, "BULLETIN", "prets.nb", {"sensible": True}, None)
    from app.editions.moteur.executeur import _sensibles
    assert "prets.nb" in _sensibles(d, "BULLETIN")
    dico.modifier_champ(d, "BULLETIN", "identite.nom", {"reinitialiser": True}, None)
    r = d.execute(text("SELECT libelle, groupe, visible FROM edt_source_champ WHERE source_code='BULLETIN' AND code='identite.nom'")).one()
    assert r[0] != "Nom de famille" and r[2] is True
    sources = {s["code"]: s for s in dico.consulter(d)}
    assert any(c["code"] == "prets.nb" and c["perso"] and c["definition"]["agregat"] == "NB" for c in sources["BULLETIN"]["champs"])
    assert any(t["nom"] == "pret_test" and t["a_societe"] for t in dico.tables(d))
    assert not any(t["nom"] in ("users", "edt_modele") for t in dico.tables(d))
