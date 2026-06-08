"""
Tests d'intégration pour les endpoints d'authentification.
Lance avec : pytest tests/ -v
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.core.database import Base, get_db
from app.core.security import hash_password
from app.models.auth import User, Profile, UserRole

# ── Base de données de test (SQLite en mémoire) ───────────────────────────────
SQLALCHEMY_TEST_URL = "sqlite:///./test.db"
engine_test = create_engine(SQLALCHEMY_TEST_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db

Base.metadata.create_all(bind=engine_test)

client = TestClient(app)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clean_db():
    """Nettoie la base après chaque test."""
    yield
    db = TestSession()
    db.query(UserRole).delete()
    db.query(Profile).delete()
    db.query(User).delete()
    db.commit()
    db.close()


@pytest.fixture
def admin_user():
    """Crée un utilisateur administrateur pour les tests."""
    db = TestSession()
    user = User(email="admin@test.ma", hashed_password=hash_password("Admin123!"))
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, nom="Admin", prenom="Test"))
    db.add(UserRole(user_id=user.id, role="administrateur"))
    db.commit()
    db.refresh(user)
    db.close()
    return {"email": "admin@test.ma", "password": "Admin123!"}


def get_token(credentials: dict) -> str:
    r = client.post("/api/v1/auth/login", json=credentials)
    assert r.status_code == 200
    return r.json()["access_token"]


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestLogin:
    def test_login_succes(self, admin_user):
        r = client.post("/api/v1/auth/login", json=admin_user)
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["role"] == "administrateur"
        assert data["token_type"] == "bearer"

    def test_login_mauvais_mot_de_passe(self, admin_user):
        r = client.post("/api/v1/auth/login", json={**admin_user, "password": "mauvais"})
        assert r.status_code == 401

    def test_login_email_inexistant(self):
        r = client.post("/api/v1/auth/login", json={"email": "inconnu@test.ma", "password": "123"})
        assert r.status_code == 401

    def test_login_email_invalide(self):
        r = client.post("/api/v1/auth/login", json={"email": "pasunemail", "password": "123"})
        assert r.status_code == 422


class TestMe:
    def test_get_me(self, admin_user):
        token = get_token(admin_user)
        r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == admin_user["email"]
        assert "administrateur" in r.json()["roles"]

    def test_get_me_sans_token(self):
        r = client.get("/api/v1/auth/me")
        assert r.status_code == 403  # HTTPBearer retourne 403 si pas de header

    def test_get_me_token_invalide(self):
        r = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer tokenbidon"})
        assert r.status_code == 401


class TestCreateUser:
    def test_creer_utilisateur(self, admin_user):
        token = get_token(admin_user)
        r = client.post(
            "/api/v1/auth/users",
            json={"email": "nouveau@test.ma", "password": "Pass123!", "roles": ["gestionnaire_rh"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 201
        assert r.json()["email"] == "nouveau@test.ma"
        assert "gestionnaire_rh" in r.json()["roles"]

    def test_creer_utilisateur_email_duplique(self, admin_user):
        token = get_token(admin_user)
        payload = {"email": "dup@test.ma", "password": "Pass123!", "roles": ["collaborateur"]}
        client.post("/api/v1/auth/users", json=payload, headers={"Authorization": f"Bearer {token}"})
        r = client.post("/api/v1/auth/users", json=payload, headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 400

    def test_creer_utilisateur_sans_droits(self, admin_user):
        # Crée un simple collaborateur puis tente de créer un user
        db = TestSession()
        collab = User(email="collab@test.ma", hashed_password=hash_password("pass"))
        db.add(collab)
        db.flush()
        db.add(UserRole(user_id=collab.id, role="collaborateur"))
        db.commit()
        db.close()
        token = get_token({"email": "collab@test.ma", "password": "pass"})
        r = client.post(
            "/api/v1/auth/users",
            json={"email": "autre@test.ma", "password": "pass", "roles": ["collaborateur"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403
