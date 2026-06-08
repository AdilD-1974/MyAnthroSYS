"""Tests CRUD pour les collaborateurs."""
import pytest
from tests.conftest import client


class TestListCollaborateurs:
    def test_liste_vide_retourne_200(self, auth_headers):
        r = client.get("/api/v1/collaborateurs", headers=auth_headers)
        assert r.status_code == 200
        assert "items" in r.json()
        assert "total" in r.json()

    def test_liste_sans_token_retourne_403(self):
        r = client.get("/api/v1/collaborateurs")
        assert r.status_code == 403

    def test_pagination(self, auth_headers):
        r = client.get("/api/v1/collaborateurs?page=1&page_size=5", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["page"] == 1
        assert r.json()["page_size"] == 5

    def test_recherche(self, collab_cree, auth_headers):
        r = client.get("/api/v1/collaborateurs?search=Alaoui", headers=auth_headers)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(c["nom"] == "Alaoui" for c in items)

    def test_recherche_vide(self, auth_headers):
        r = client.get("/api/v1/collaborateurs?search=NomInexistantXXX999", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["total"] == 0


class TestCreateCollaborateur:
    def test_creer_collaborateur(self, auth_headers):
        r = client.post("/api/v1/collaborateurs", json={
            "matricule": "NEW002",
            "nom": "Benali",
            "prenom": "Fatima",
            "date_naissance": "1990-03-22",
            "code_genre": "F",
        }, headers=auth_headers)
        assert r.status_code == 201
        data = r.json()
        assert data["matricule"] == "NEW002"
        assert data["nom"] == "Benali"
        assert data["archive"] is False

    def test_matricule_duplique(self, collab_cree, auth_headers, collab_data):
        r = client.post("/api/v1/collaborateurs", json=collab_data, headers=auth_headers)
        assert r.status_code == 400

    def test_genre_invalide(self, auth_headers):
        r = client.post("/api/v1/collaborateurs", json={
            "matricule": "ERR001",
            "nom": "Test",
            "prenom": "Test",
            "date_naissance": "1990-01-01",
            "code_genre": "X",  # invalide
        }, headers=auth_headers)
        assert r.status_code == 422

    def test_champs_requis_manquants(self, auth_headers):
        r = client.post("/api/v1/collaborateurs", json={"matricule": "INC001"}, headers=auth_headers)
        assert r.status_code == 422

    def test_rh_peut_creer(self, rh_token):
        r = client.post("/api/v1/collaborateurs", json={
            "matricule": "RH003",
            "nom": "Zouhair",
            "prenom": "Test",
            "date_naissance": "1988-11-10",
            "code_genre": "M",
        }, headers={"Authorization": f"Bearer {rh_token}"})
        assert r.status_code == 201


class TestGetCollaborateur:
    def test_get_par_id(self, collab_cree, auth_headers):
        collab_id = collab_cree["id"]
        r = client.get(f"/api/v1/collaborateurs/{collab_id}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["id"] == collab_id

    def test_get_id_inexistant(self, auth_headers):
        r = client.get("/api/v1/collaborateurs/00000000-0000-0000-0000-000000000000", headers=auth_headers)
        assert r.status_code == 404

    def test_get_id_invalide(self, auth_headers):
        r = client.get("/api/v1/collaborateurs/pas-un-uuid", headers=auth_headers)
        assert r.status_code == 422


class TestUpdateCollaborateur:
    def test_patch_partiel(self, collab_cree, auth_headers):
        collab_id = collab_cree["id"]
        r = client.patch(f"/api/v1/collaborateurs/{collab_id}",
                         json={"telephone": "+212600000000"},
                         headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["telephone"] == "+212600000000"

    def test_patch_nom(self, collab_cree, auth_headers):
        collab_id = collab_cree["id"]
        r = client.patch(f"/api/v1/collaborateurs/{collab_id}",
                         json={"nom": "AlaouiModifie"},
                         headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["nom"] == "AlaouiModifie"


class TestDeleteCollaborateur:
    def test_archive_collaborateur(self, auth_headers):
        # Créer puis archiver
        r = client.post("/api/v1/collaborateurs", json={
            "matricule": "DEL001",
            "nom": "AArchiver",
            "prenom": "Test",
            "date_naissance": "1975-01-01",
            "code_genre": "M",
        }, headers=auth_headers)
        collab_id = r.json()["id"]

        r_del = client.delete(f"/api/v1/collaborateurs/{collab_id}", headers=auth_headers)
        assert r_del.status_code == 204

        # Vérifier qu'il n'est plus accessible
        r_get = client.get(f"/api/v1/collaborateurs/{collab_id}", headers=auth_headers)
        assert r_get.status_code == 404
