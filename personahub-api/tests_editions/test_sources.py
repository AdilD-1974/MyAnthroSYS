"""Sources de paie et catalogue — tests sur PostgreSQL (Adil DAIA). Voir recette.py."""
from datetime import date
from decimal import Decimal

import pytest

from recette import *  # noqa: F401,F403
from recette import base_requise

pytestmark = base_requise


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
    assert [l["code_rubrique"] for l in sara] == ["SALBASE", "PRIM_ANC", "CNSS_SAL", "ATRISK", "CIMR_TITRE"]   # trié, sans NEUTRE ni AVANCE à 0
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
    # BULLETIN, BULLETIN_LIGNE, SOCIETE + écarts par rubrique, comparaison des rubriques, exercice
    assert bilan["sources"] == 7 and bilan["champs_ajoutes"] > 80 and bilan["relations"] == 3   # + DEPART (RG-EDT-RH)
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


@base_requise
def test_plan_de_paie_unique_ou_liste(db):
    for valeur in (PLAN, [PLAN], {"id": PLAN}):
        lignes = F("BULLETIN").lire(db, {"periode": P_SEP, "plan_paie": valeur}, sec())
        assert len(lignes) == 2, valeur
    assert F("BULLETIN").lire(db, {"periode": P_SEP, "plan_paie": ["00000000-0000-0000-0000-000000000000"]}, sec()) == []
