"""Tests unitaires de la plateforme d'éditions — sans base ni API.
Lancer depuis personahub-api :  pytest tests_editions -q
(dossier séparé de tests/ : son conftest importe app.main et la base SQLite)."""
import sys

import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))


@pytest.fixture(scope="session")
def db():
    """Base de recette jetable (voir recette.py) ; partagée par les fichiers de tests."""
    from recette import creer_base
    yield from creer_base()
