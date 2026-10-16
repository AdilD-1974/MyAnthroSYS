"""
Sources de paie et catalogue — tests sur PostgreSQL (Adil DAIA).

Opt-in : définir EDITIONS_TEST_DB_URL, par exemple
    $env:EDITIONS_TEST_DB_URL = "postgresql+psycopg2://postgres:motdepasse@localhost:5432/AnthroBase"
Le test crée un schéma jetable « edt_recette_xxxxxx », y recrée les tables de
paie avec leurs colonnes réelles (schema_recette.sql) et la migration 075, y
insère un jeu de données de recette, puis SUPPRIME ce schéma. Les tables
existantes de la base ne sont ni lues ni modifiées.
"""
import os
import re
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

URL = os.environ.get("EDITIONS_TEST_DB_URL")
pytestmark = pytest.mark.skipif(not URL, reason="EDITIONS_TEST_DB_URL non défini (tests base de données)")

ICI = Path(__file__).resolve().parent
RACINE = ICI.parent

S1, S2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
P_SEP, P_OCT = "aaaaaaaa-0000-0000-0000-000000000009", "aaaaaaaa-0000-0000-0000-000000000010"
P_S2 = "aaaaaaaa-0000-0000-0000-000000000099"
PLAN = "dddddddd-0000-0000-0000-000000000001"
SARA, OMAR, NADIA = ("c0000000-0000-0000-0000-00000000000" + str(i) for i in (1, 2, 3))
B_SARA_SEP = "b0000000-0000-0000-0000-000000000001"   # clôturé : live ET historique
B_OMAR_SEP = "b0000000-0000-0000-0000-000000000002"   # live seulement
B_SARA_AOU = "b0000000-0000-0000-0000-000000000003"   # historique seulement (purgé du live)
B_NADIA_S2 = "b0000000-0000-0000-0000-000000000004"   # autre société

DONNEES = f"""
INSERT INTO societes (id, raison_sociale, ice, ville, adresse) VALUES
  ('{S1}', 'SOLGEIS CONSULTING', '001234567000089', 'Temara', '12 rue Al Massira'),
  ('{S2}', 'AD2S', '009999999000011', 'Rabat', NULL);
INSERT INTO societe_affiliations (id, societe_id, code_type_affiliation, numero_affiliation) VALUES
  (gen_random_uuid(), '{S1}', 'CNSS', '1234567'), (gen_random_uuid(), '{S1}', 'CIMR', 'C-889');
INSERT INTO plan_paie (id, code, libelle) VALUES ('{PLAN}', 'MENS', 'Mensuel');
INSERT INTO calendrier_paie (id, plan_paie_id, annee, mois, date_debut, date_fin, intitule, societe_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000008', '{PLAN}', 2026, 8, '2026-08-01', '2026-08-31', 'Août 2026', '{S1}'),
  ('{P_SEP}', '{PLAN}', 2026, 9, '2026-09-01', '2026-09-30', 'Septembre 2026', '{S1}'),
  ('{P_OCT}', '{PLAN}', 2026, 10, '2026-10-01', '2026-10-31', 'Octobre 2026', '{S1}'),
  ('{P_S2}', '{PLAN}', 2026, 9, '2026-09-01', '2026-09-30', 'Septembre 2026', '{S2}');
INSERT INTO bulletin (id, periode_id, collaborateur_id, matricule, plan_paie_id, total_brut, net_a_payer, total_gains, total_retenues, statut) VALUES
  ('{B_SARA_SEP}', '{P_SEP}', '{SARA}', 'M001', '{PLAN}', 10500, 8450.50, 10500, 2049.50, 'CLOTURE'),
  ('{B_OMAR_SEP}', '{P_SEP}', '{OMAR}', 'M002', '{PLAN}', 6000, 5100, 6000, 900, 'VALIDE'),
  ('{B_NADIA_S2}', '{P_S2}', '{NADIA}', 'X001', '{PLAN}', 9000, 7000, 9000, 2000, 'VALIDE');
INSERT INTO bulletin_historique (id, periode_id, collaborateur_id, matricule, plan_paie_id, total_brut, net_a_payer, statut) VALUES
  ('{B_SARA_SEP}', '{P_SEP}', '{SARA}', 'M001', '{PLAN}', 10500, 9999.99, 'CLOTURE'),
  ('{B_SARA_AOU}', 'aaaaaaaa-0000-0000-0000-000000000008', '{SARA}', 'M001', '{PLAN}', 10000, 8000, 'CLOTURE');
INSERT INTO bulletin_ligne (id, bulletin_id, code_rubrique, libelle, base, nombre, taux, montant, montant_patronal, sens, ordre_affichage) VALUES
  (gen_random_uuid(), '{B_SARA_SEP}', 'SALBASE', 'Salaire de base', 10000, 26, NULL, 10000, NULL, 'GAIN', 10),
  (gen_random_uuid(), '{B_SARA_SEP}', 'PRIM_ANC', 'Prime ancienneté', 10000, NULL, 5, 500, NULL, 'GAIN', 20),
  (gen_random_uuid(), '{B_SARA_SEP}', 'CNSS_SAL', 'CNSS', 6000, NULL, 4.48, 268.80, 1077.12, 'RETENUE', 50),
  (gen_random_uuid(), '{B_SARA_SEP}', 'BRUT_INTER', 'Intermédiaire', NULL, NULL, NULL, 10500, NULL, 'NEUTRE', 99),
  (gen_random_uuid(), '{B_SARA_SEP}', 'AVANCE', 'Avance', NULL, NULL, NULL, 0, NULL, 'RETENUE', 60),
  (gen_random_uuid(), '{B_OMAR_SEP}', 'SALBASE', 'Salaire de base', 6000, 26, NULL, 6000, NULL, 'GAIN', 10),
  (gen_random_uuid(), '{B_NADIA_S2}', 'SALBASE', 'Salaire de base', 9000, 26, NULL, 9000, NULL, 'GAIN', 10);
INSERT INTO bulletin_historique_ligne (id, bulletin_id, code_rubrique, libelle, montant, sens, ordre_affichage) VALUES
  (gen_random_uuid(), '{B_SARA_SEP}', 'SALBASE', 'COPIE A IGNORER', 99999, 'GAIN', 10),
  (gen_random_uuid(), '{B_SARA_AOU}', 'SALBASE', 'Salaire de base', 10000, 'GAIN', 10);
INSERT INTO bulletin_snapshot_collaborateur (id, bulletin_id, donnees) VALUES
  (gen_random_uuid(), '{B_SARA_SEP}', '{{"identite": {{"matricule": "M001", "nom": "ALAMI", "prenom": "Sara", "cin": "AB123"}},
     "affectation": {{"organisation_id": "o-1", "emploi_libelle": "Comptable"}},
     "paiement": {{"numero_compte": "011780000012345678901234", "banque_libelle": "CIH"}},
     "regimes": [{{"code_regime": "CNSS", "matricule_organisme": "987654"}}]}}'),
  (gen_random_uuid(), '{B_OMAR_SEP}', '{{"identite": {{"matricule": "M002", "nom": "BENNANI", "prenom": "Omar"}},
     "affectation": {{"organisation_id": "o-2"}}}}');
INSERT INTO rubrique_paie (code, libelle, libelle_edition, archive, traiter, ne_editer_si_mt_zero, societe_id) VALUES
  ('SALBASE', 'Salaire de base', NULL, false, true, false, NULL),
  ('PRIM_ANC', 'Prime d''ancienneté', NULL, false, true, false, NULL),
  ('PRIM_ANC', 'Prime d''ancienneté', 'Prime d''ancienneté (SOLGEIS)', false, true, false, '{S1}'),
  ('CNSS_SAL', 'CNSS salariale', 'Cotisation CNSS', false, true, false, NULL),
  ('AVANCE', 'Avance sur salaire', NULL, false, true, true, NULL),
  ('VIEILLE', 'Ancienne prime', NULL, true, true, false, NULL);
INSERT INTO ref_constante_paie (id, code, valeur, actif, date_debut, date_fin, societe_id) VALUES
  (gen_random_uuid(), 'CNSS_TAUX_SALARIAL', '4.48', true, '2020-01-01', NULL, NULL),
  (gen_random_uuid(), 'CNSS_TAUX_SALARIAL', '4.50', true, '2026-10-01', NULL, NULL),
  (gen_random_uuid(), 'CNSS_PLAFOND', '6000', true, NULL, NULL, NULL),
  (gen_random_uuid(), 'CNSS_PLAFOND', '6500', true, NULL, NULL, '{S1}');
"""


def _sans_public(sql: str) -> str:
    return re.sub(r"\bpublic\.", "", sql)


@pytest.fixture(scope="module")
def db():
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    schema = "edt_recette_" + uuid.uuid4().hex[:6]
    admin = create_engine(URL)
    with admin.begin() as c:
        c.execute(text(f'CREATE SCHEMA "{schema}"'))
    moteur = create_engine(URL, connect_args={"options": f"-csearch_path={schema},public"})
    try:
        migration = (RACINE / "migration" / "075_editions_socle.sql").read_text(encoding="utf-8")
        migration = _sans_public(migration).replace("BEGIN;", "").replace("ROLLBACK;", "")
        with moteur.begin() as c:
            curseur = c.connection.cursor()        # SQL brut : les « % » ne sont pas des paramètres
            curseur.execute(_sans_public((ICI / "schema_recette.sql").read_text(encoding="utf-8")))
            curseur.execute(migration)
            curseur.execute(DONNEES)
        session = Session(moteur)
        yield session
        session.close()
    finally:
        moteur.dispose()
        with admin.begin() as c:
            c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def sec(societe=S1, sensibles=True):
    from app.editions.sources import ContexteSecurite
    return ContexteSecurite(utilisateur_id=None, societe_id=societe, donnees_sensibles=sensibles)


def F(code):
    from app.editions.sources import REGISTRE
    return REGISTRE[code]


# ---- BULLETIN ----
def test_bulletins_de_la_periode_la_ligne_live_fait_foi(db):
    lignes = F("BULLETIN").lire(db, {"periode": {"id": P_SEP}}, sec())
    par_id = {l["id"]: l for l in lignes}
    assert set(par_id) == {B_SARA_SEP, B_OMAR_SEP}                 # RG-EDT-SOURCE-01 : lu une fois
    assert par_id[B_SARA_SEP]["origine"] == "LIVE"
    assert par_id[B_SARA_SEP]["net_a_payer"] == Decimal("8450.50")  # pas la copie 9999.99
    assert par_id[B_SARA_SEP]["periode"]["intitule"] == "Septembre 2026"
    assert par_id[B_SARA_SEP]["plan"]["code"] == "MENS"
    assert par_id[B_SARA_SEP]["identite"]["nom"] == "ALAMI"        # RG-EDT-SOURCE-02 : snapshot


def test_bulletin_seulement_historique(db):
    lignes = F("BULLETIN").lire(db, {"bulletin": B_SARA_AOU}, sec())
    assert len(lignes) == 1 and lignes[0]["origine"] == "HISTORIQUE"


def test_isolation_societe(db):                                    # RG-EDT-SOURCE-03
    assert F("BULLETIN").lire(db, {"bulletin": B_NADIA_S2}, sec(S1)) == []
    assert F("BULLETIN").lire(db, {"periode": P_SEP}, sec(S2)) == []
    assert [l["id"] for l in F("BULLETIN").lire(db, {"periode": P_S2}, sec(S2))] == [B_NADIA_S2]


def test_filtres_de_perimetre(db):
    assert [l["id"] for l in F("BULLETIN").lire(db, {"periode": P_SEP, "collaborateurs": [OMAR]}, sec())] == [B_OMAR_SEP]
    assert [l["id"] for l in F("BULLETIN").lire(db, {"periode": P_SEP, "organisations": ["o-1"]}, sec())] == [B_SARA_SEP]
    assert {l["id"] for l in F("BULLETIN").lire(db, {"annee": 2026}, sec())} == {B_SARA_SEP, B_OMAR_SEP, B_SARA_AOU}
    from app.editions.sources import ErreurSource
    with pytest.raises(ErreurSource):
        F("BULLETIN").lire(db, {}, sec())


def test_champs_sensibles_masques(db):                             # RG-EDT-SECU-01
    lignes = F("BULLETIN").lire(db, {"bulletin": B_SARA_SEP}, sec(sensibles=False))
    F("BULLETIN").masquer(lignes, sec(sensibles=False))
    assert lignes[0]["paiement"]["numero_compte"] == "****" and lignes[0]["identite"]["cin"] == "****"
    assert lignes[0]["paiement"]["banque_libelle"] == "CIH"
    assert lignes[0]["identite"]["nom"] == "ALAMI"


# ---- BULLETIN_LIGNE ----
def test_lignes_imprimables(db):
    groupes = F("BULLETIN_LIGNE").lire_enfants(db, [B_SARA_SEP, B_SARA_AOU], sec())
    sara = groupes[B_SARA_SEP]
    assert [l["code_rubrique"] for l in sara] == ["SALBASE", "PRIM_ANC", "CNSS_SAL"]   # trié, sans NEUTRE ni AVANCE à 0
    assert all(l["libelle"] != "COPIE A IGNORER" for l in sara)
    assert sara[1]["libelle"] == "Prime d'ancienneté (SOLGEIS)"     # libellé d'édition de la société
    assert sara[2]["libelle"] == "Cotisation CNSS"                   # libellé d'édition générique
    assert [l["montant"] for l in groupes[B_SARA_AOU]] == [Decimal("10000")]


# ---- index des rubriques et constantes ----
def test_index_rubriques(db):
    from app.editions.sources.paie import index_rubriques
    bulletins = F("BULLETIN").lire(db, {"bulletin": B_SARA_SEP}, sec())
    idx = index_rubriques(db, bulletins)[B_SARA_SEP]
    assert idx["SALBASE"]["MT"] == Decimal("10000") and idx["SALBASE"]["NB"] == Decimal("26")
    assert idx["CNSS_SAL"]["PAT"] == Decimal("1077.12") and idx["CNSS_SAL"]["TX"] == Decimal("4.48")
    assert idx["BRUT_INTER"]["MT"] == Decimal("10500")                # NEUTRE lisible par [CODE].MT
    assert idx["NET_A_PAYER"]["MT"] == Decimal("8450.50")             # total d'en-tête


def test_constantes_a_date(db):
    from app.editions.sources.paie import constantes_a_date
    sep = constantes_a_date(db, S1, date(2026, 9, 30))
    oct_ = constantes_a_date(db, S1, date(2026, 10, 31))
    assert sep["CNSS_TAUX_SALARIAL"] == Decimal("4.48") and oct_["CNSS_TAUX_SALARIAL"] == Decimal("4.50")
    assert sep["CNSS_PLAFOND"] == Decimal("6500")                      # la société prime
    assert constantes_a_date(db, S2, date(2026, 9, 30))["CNSS_PLAFOND"] == Decimal("6000")


# ---- SOCIETE ----
def test_societe(db):
    s = F("SOCIETE").lire(db, None, sec())[0]
    assert s["raison_sociale"] == "SOLGEIS CONSULTING" and s["numero_cnss"] == "1234567"
    assert s["affiliations"]["CIMR"] == "C-889"
    assert F("SOCIETE").lire(db, None, sec(S2))[0]["numero_cnss"] is None


# ---- catalogue ----
def test_synchronisation_du_catalogue(db):
    from sqlalchemy import text
    from app.editions import catalogue

    bilan = catalogue.synchroniser(db)
    assert bilan["sources"] == 3 and bilan["champs_ajoutes"] > 80 and bilan["relations"] == 1
    # l'administrateur renomme un champ et lève sa sensibilité : la synchro les respecte
    db.execute(text("""UPDATE edt_source_champ SET libelle = 'N° de RIB', libelle_modifie = true, sensible = false
                       WHERE source_code = 'BULLETIN' AND code = 'paiement.numero_compte'"""))
    bilan2 = catalogue.synchroniser(db)
    assert bilan2["champs_ajoutes"] == 0
    r = db.execute(text("""SELECT libelle, sensible FROM edt_source_champ
                           WHERE source_code = 'BULLETIN' AND code = 'paiement.numero_compte'""")).one()
    assert (r.libelle, r.sensible) == ("N° de RIB", False)
    assert "paiement.numero_compte" not in catalogue.champs_sensibles(db, "BULLETIN")
    db.commit()


def test_catalogue_valide_le_bulletin_classique(db):
    import json
    from app.editions import catalogue
    from app.editions.validation import valider

    catalogue.synchroniser(db)
    cat = catalogue.charger(db, S1)
    assert "VIEILLE" not in cat.rubriques and "SALBASE" in cat.rubriques
    modele = json.loads((RACINE / "app" / "editions" / "modeles_systeme" / "bulletin_classique.json")
                        .read_text(encoding="utf-8"))
    r = valider(modele, cat)
    assert r.valide, [(e.chemin, e.message) for e in r.erreurs]
