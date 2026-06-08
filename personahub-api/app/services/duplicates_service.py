# app/services/duplicates_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Service de vérification des doublons d'identifiants collaborateur.
# À placer dans : D:/SOLGEIS/personahub-api/app/services/duplicates_service.py

from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from app.models.collaborateur import Collaborateur  # adapter selon votre modèle


# ─── Schémas de réponse ──────────────────────────────────────────────────────

from pydantic import BaseModel

class CollabConflict(BaseModel):
    id: str
    nom: str
    prenom: str
    matricule: str

class DuplicateEntry(BaseModel):
    field: str        # libellé humain du champ
    value: str        # valeur en doublon
    conflicting: list[CollabConflict]

class CheckDuplicatesRequest(BaseModel):
    cin:         Optional[str] = None
    passeport:   Optional[str] = None
    num_fiscal:  Optional[str] = None
    affiliations: Optional[dict[str, str]] = {}
    exclude_id:  Optional[str] = None   # ID du collab en cours d'édition

# ─── Mapping champ → colonne du modèle + libellé ─────────────────────────────

DIRECT_FIELDS = {
    "cin":        ("cin",        "CIN"),
    "passeport":  ("passeport",  "N° Passeport"),
    "num_fiscal": ("num_fiscal", "N° Fiscal"),
}

AFFILIATION_FIELDS = {
    "cnss":      ("affiliation_cnss",      "N° CNSS"),
    "cimr":      ("affiliation_cimr",      "N° CIMR"),
    "mutuelle":  ("affiliation_mutuelle",  "N° Mutuelle"),
    "amo":       ("affiliation_amo",       "N° AMO"),
    "retraite":  ("affiliation_retraite",  "N° Retraite"),
    "at":        ("affiliation_at",        "N° Assurance AT"),
    "prevoyance":("affiliation_prevoyance","N° Prévoyance"),
}

# ─── Service ─────────────────────────────────────────────────────────────────

def check_duplicates(
    db: Session,
    payload: CheckDuplicatesRequest
) -> list[DuplicateEntry]:
    """
    Vérifie si les identifiants fournis sont déjà attribués à d'autres
    collaborateurs actifs.

    Retourne la liste des champs en doublon avec les collaborateurs concernés.
    """
    duplicates: list[DuplicateEntry] = []

    def search(column_name: str, label: str, value: str):
        """Requête générique : cherche la valeur dans la colonne donnée."""
        if not value or not value.strip():
            return

        query = db.query(Collaborateur).filter(
            getattr(Collaborateur, column_name) == value.strip()
        )

        # Exclure le collaborateur en cours d'édition
        if payload.exclude_id:
            query = query.filter(
                Collaborateur.id != payload.exclude_id
            )

        # Ne chercher que parmi les actifs (adapter si besoin)
        # query = query.filter(Collaborateur.actif == True)

        found = query.all()

        if found:
            duplicates.append(DuplicateEntry(
                field=label,
                value=value.strip(),
                conflicting=[
                    CollabConflict(
                        id=str(c.id),
                        nom=c.nom,
                        prenom=c.prenom,
                        matricule=c.matricule,
                    )
                    for c in found
                ]
            ))

    # ── Champs directs ────────────────────────────────────────────────────────
    for field_key, (col, label) in DIRECT_FIELDS.items():
        value = getattr(payload, field_key, None)
        if value:
            search(col, label, value)

    # ── Affiliations ──────────────────────────────────────────────────────────
    for aff_key, (col, label) in AFFILIATION_FIELDS.items():
        value = (payload.affiliations or {}).get(aff_key)
        if value:
            search(col, label, value)

    return duplicates
