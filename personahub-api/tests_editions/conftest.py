"""Tests unitaires de la plateforme d'éditions — sans base ni API.
Lancer depuis personahub-api :  pytest tests_editions -q
(dossier séparé de tests/ : son conftest importe app.main et la base SQLite)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
