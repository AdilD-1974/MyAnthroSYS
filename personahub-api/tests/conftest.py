"""
Fixtures partagées — importées automatiquement par pytest dans tous les tests.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.core.database import Base, get_db
from app.core.security import hash_password
from app.models.auth import User, Profile, UserRole
from app.models.collaborateur import Collaborateur

SQLALCHEMY_TEST_URL = "sqlite:///./test_shared.db"
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


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine_test)
    yield
    Base.metadata.drop_all(bind=engine_test)


@pytest.fixture
def db():
    session = TestSession()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def admin_credentials(db):
    user = User(email="admin_fixture@test.ma", hashed_password=hash_password("Admin123!"))
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, nom="Admin", prenom="Fixture"))
    db.add(UserRole(user_id=user.id, role="administrateur"))
    db.commit()
    yield {"email": "admin_fixture@test.ma", "password": "Admin123!"}
    db.query(UserRole).filter(UserRole.user_id == user.id).delete()
    db.query(Profile).filter(Profile.user_id == user.id).delete()
    db.query(User).filter(User.id == user.id).delete()
    db.commit()


@pytest.fixture
def rh_credentials(db):
    user = User(email="rh_fixture@test.ma", hashed_password=hash_password("RH123!"))
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, nom="RH", prenom="Fixture"))
    db.add(UserRole(user_id=user.id, role="gestionnaire_rh"))
    db.commit()
    yield {"email": "rh_fixture@test.ma", "password": "RH123!"}
    db.query(UserRole).filter(UserRole.user_id == user.id).delete()
    db.query(Profile).filter(Profile.user_id == user.id).delete()
    db.query(User).filter(User.id == user.id).delete()
    db.commit()


@pytest.fixture
def admin_token(admin_credentials):
    r = client.post("/api/v1/auth/login", json=admin_credentials)
    return r.json()["access_token"]


@pytest.fixture
def rh_token(rh_credentials):
    r = client.post("/api/v1/auth/login", json=rh_credentials)
    return r.json()["access_token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def collab_data():
    return {
        "matricule": "TEST001",
        "nom": "Alaoui",
        "prenom": "Mohammed",
        "date_naissance": "1985-06-15",
        "code_genre": "M",
        "statut_collaborateur": "actif",
    }


@pytest.fixture
def collab_cree(auth_headers, collab_data):
    """Crée un collaborateur et le supprime après le test."""
    r = client.post("/api/v1/collaborateurs", json=collab_data, headers=auth_headers)
    assert r.status_code == 201
    collab = r.json()
    yield collab
    # Nettoyage
    db = TestSession()
    db.query(Collaborateur).filter(Collaborateur.id == collab["id"]).delete()
    db.commit()
    db.close()
