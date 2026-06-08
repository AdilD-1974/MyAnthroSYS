"""Tests pour le module Absences & Congés."""
import pytest
from tests.conftest import client, TestSession
from app.models.absences import TypeConge


@pytest.fixture
def type_conge(auth_headers):
    r = client.post("/api/v1/types-conge", json={
        "code": "CA_TEST",
        "libelle": "Congé Annuel Test",
        "duree_max_annuelle": 18,
        "deductible_paie": False,
    }, headers=auth_headers)
    assert r.status_code == 201
    yield r.json()
    db = TestSession()
    db.query(TypeConge).filter(TypeConge.id == r.json()["id"]).delete()
    db.commit()
    db.close()


class TestTypesConge:
    def test_liste_types(self, auth_headers):
        r = client.get("/api/v1/types-conge", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_creer_type(self, auth_headers):
        r = client.post("/api/v1/types-conge", json={
            "code": "CM_TEST",
            "libelle": "Congé Maladie Test",
            "deductible_paie": True,
        }, headers=auth_headers)
        assert r.status_code == 201
        assert r.json()["code"] == "CM_TEST"

    def test_code_duplique(self, type_conge, auth_headers):
        r = client.post("/api/v1/types-conge", json={
            "code": "CA_TEST",
            "libelle": "Doublon",
            "deductible_paie": False,
        }, headers=auth_headers)
        assert r.status_code == 400


class TestDemandesConge:
    def test_creer_demande(self, collab_cree, type_conge, auth_headers):
        r = client.post("/api/v1/absences/demandes", json={
            "collaborateur_id": collab_cree["id"],
            "type_conge_id": type_conge["id"],
            "date_debut": "2025-08-01",
            "date_fin": "2025-08-10",
            "nombre_jours": 8,
            "motif": "Vacances été",
        }, headers=auth_headers)
        assert r.status_code == 201
        assert r.json()["statut"] == "en_attente"

    def test_date_fin_avant_debut_refusee(self, collab_cree, type_conge, auth_headers):
        r = client.post("/api/v1/absences/demandes", json={
            "collaborateur_id": collab_cree["id"],
            "type_conge_id": type_conge["id"],
            "date_debut": "2025-09-10",
            "date_fin": "2025-09-01",  # fin avant début
            "nombre_jours": 5,
        }, headers=auth_headers)
        assert r.status_code == 422

    def test_valider_demande(self, collab_cree, type_conge, auth_headers):
        # Créer une demande
        r_create = client.post("/api/v1/absences/demandes", json={
            "collaborateur_id": collab_cree["id"],
            "type_conge_id": type_conge["id"],
            "date_debut": "2025-10-01",
            "date_fin": "2025-10-05",
            "nombre_jours": 4,
        }, headers=auth_headers)
        demande_id = r_create.json()["id"]

        # Approuver
        r_val = client.post(f"/api/v1/absences/demandes/{demande_id}/valider",
                            json={"decision": "approuvee", "commentaire": "OK"},
                            headers=auth_headers)
        assert r_val.status_code == 200
        assert r_val.json()["statut"] == "approuvee"

    def test_refuser_demande(self, collab_cree, type_conge, auth_headers):
        r_create = client.post("/api/v1/absences/demandes", json={
            "collaborateur_id": collab_cree["id"],
            "type_conge_id": type_conge["id"],
            "date_debut": "2025-11-03",
            "date_fin": "2025-11-07",
            "nombre_jours": 5,
        }, headers=auth_headers)
        demande_id = r_create.json()["id"]
        r_val = client.post(f"/api/v1/absences/demandes/{demande_id}/valider",
                            json={"decision": "refusee", "commentaire": "Période chargée"},
                            headers=auth_headers)
        assert r_val.status_code == 200
        assert r_val.json()["statut"] == "refusee"

    def test_decision_invalide(self, collab_cree, type_conge, auth_headers):
        r_create = client.post("/api/v1/absences/demandes", json={
            "collaborateur_id": collab_cree["id"],
            "type_conge_id": type_conge["id"],
            "date_debut": "2025-12-01",
            "date_fin": "2025-12-03",
            "nombre_jours": 2,
        }, headers=auth_headers)
        demande_id = r_create.json()["id"]
        r_val = client.post(f"/api/v1/absences/demandes/{demande_id}/valider",
                            json={"decision": "peut_etre"},  # invalide
                            headers=auth_headers)
        assert r_val.status_code == 422


class TestJoursFeries:
    def test_creer_jour_ferie(self, auth_headers):
        r = client.post("/api/v1/jours-feries", json={
            "date": "2025-01-01",
            "libelle": "Nouvel An Test",
            "recurrent": True,
        }, headers=auth_headers)
        assert r.status_code == 201
        assert r.json()["annee"] == 2025

    def test_liste_jours_feries(self, auth_headers):
        r = client.get("/api/v1/jours-feries", headers=auth_headers)
        assert r.status_code == 200

    def test_filtre_par_annee(self, auth_headers):
        r = client.get("/api/v1/jours-feries?annee=2025", headers=auth_headers)
        assert r.status_code == 200
        for jf in r.json():
            assert jf["annee"] == 2025
