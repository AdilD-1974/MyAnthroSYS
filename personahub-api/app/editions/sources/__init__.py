"""
app/editions/sources — Fournisseurs de données de la plateforme d'éditions (Adil DAIA).
Importer ce paquet enregistre tous les fournisseurs dans REGISTRE.
Lot 1 : BULLETIN, BULLETIN_LIGNE, SOCIETE (+ index des rubriques et constantes).
"""
from app.editions.sources.base import REGISTRE, ContexteSecurite, ErreurSource  # noqa: F401
from app.editions.sources import paie, societe  # noqa: F401  (enregistrement)
