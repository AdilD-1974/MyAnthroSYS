from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from uuid import UUID
from typing import Optional
from datetime import date
from pydantic import BaseModel
from app.core.database import get_db
from app.core.security import require_roles, get_societe_active_id
from app.models.collaborateur import Collaborateur, Contrat
from app.schemas.collaborateur import (
    CollaborateurCreate, CollaborateurUpdate, CollaborateurRead,
    CollaborateurList, ContratCreate, ContratRead
)

router = APIRouter(prefix="/collaborateurs", tags=["Collaborateurs"])

RH_ROLES = ("administrateur", "gestionnaire_rh", "manager")


# ── Schémas internes : vérification doublons ──────────────────────────────────

class CollabConflict(BaseModel):
    id: str
    nom: str
    prenom: str
    matricule: str

class DuplicateEntry(BaseModel):
    field: str
    value: str
    conflicting: list[CollabConflict]

class CheckDuplicatesRequest(BaseModel):
    cin:          Optional[str]            = None
    passeport:    Optional[str]            = None
    num_fiscal:   Optional[str]            = None
    affiliations: Optional[dict[str, str]] = {}
    exclude_id:   Optional[str]            = None  # ID du collab en cours d'édition

# Schéma : validation contrat
class ValidateContratRequest(BaseModel):
    occurrence:           Optional[str]  = None
    date_debut:           Optional[date] = None
    date_fin:             Optional[date] = None
    date_titularisation:  Optional[date] = None
    date_naissance_collab: Optional[date] = None
    age_minimum_travail:  Optional[int]  = None    # lu depuis ParametreRH si None

class ContratValidationError(BaseModel):
    field: str
    message: str

class ValidateContratResponse(BaseModel):
    valid: bool
    errors: list[ContratValidationError]


# ── Mapping colonnes → libellés (doublons) ────────────────────────────────────

DIRECT_FIELDS = {
    "cin":       ("cin",       "CIN"),
    "passeport": ("passeport", "N° Passeport"),
    "num_fiscal":("num_fiscal","N° Fiscal"),
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


# ── Collaborateurs : CRUD ─────────────────────────────────────────────────────

@router.get("", response_model=CollaborateurList)
def list_collaborateurs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", description="Recherche sur nom, prénom, matricule"),
    statut: str = Query("", description="Filtrer par statut (actif, inactif...)"),
    payload: dict = Depends(require_roles(*RH_ROLES)),
    db: Session = Depends(get_db),
    societe_id: str = Depends(get_societe_active_id),
):
    """Liste paginée des collaborateurs avec recherche et filtres.

    RG-MULTISOCIETE-08 (correctif 24/08) : bornée à la société active --
    sans ce filtre, un utilisateur SOLGES voyait aussi les fiches AD2S
    (table `collaborateurs`, RÉELLE et vivante, confirmée le 24/08 --
    contrairement à Contrat/Affectation dans ce même fichier, qui pointent
    vers des tables jamais alimentées).
    """
    query = db.query(Collaborateur).filter(
        Collaborateur.archive == False,
        Collaborateur.societe_id == societe_id,
    )

    if search:
        term = f"%{search.lower()}%"
        query = query.filter(
            (func.lower(Collaborateur.nom).like(term))
            | (func.lower(Collaborateur.prenom).like(term))
            | (func.lower(Collaborateur.matricule).like(term))
        )

    if statut:
        query = query.filter(Collaborateur.statut_collaborateur == statut)

    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()

    return CollaborateurList(total=total, page=page, page_size=page_size, items=items)


@router.post("", response_model=CollaborateurRead, status_code=201)
def create_collaborateur(
    data: CollaborateurCreate,
    payload: dict = Depends(require_roles("administrateur", "gestionnaire_rh")),
    db: Session = Depends(get_db),
    societe_id: str = Depends(get_societe_active_id),
):
    """Crée un nouveau collaborateur. (RG-MGR-COLLAB-01 : managers exclus)

    RG-MULTISOCIETE-08 (correctif 24/08) : la vérification de doublon de
    matricule était GLOBALE -- bloquait la création légitime d'un 2e
    collaborateur portant le même matricule dans une AUTRE société
    (exactement le modèle qu'on vient d'adopter, migration 066). Scopée à la
    société active, et societe_id forcé sur la fiche créée (jamais confié au
    client) -- toujours la société de la session, jamais une autre.
    """
    if db.query(Collaborateur).filter(
        Collaborateur.matricule == data.matricule,
        Collaborateur.societe_id == societe_id,
    ).first():
        raise HTTPException(status_code=400, detail=f"Le matricule '{data.matricule}' est déjà utilisé pour cette société")

    collab = Collaborateur(**data.model_dump(), societe_id=societe_id)
    db.add(collab)
    db.commit()
    db.refresh(collab)
    return collab


@router.get("/{collab_id}", response_model=CollaborateurRead)
def get_collaborateur(
    collab_id: UUID,
    payload: dict = Depends(require_roles(*RH_ROLES)),
    db: Session = Depends(get_db),
    societe_id: str = Depends(get_societe_active_id),
):
    """Récupère la fiche d'un collaborateur par son ID.

    RG-MULTISOCIETE-08 : 404 (pas 403) si la fiche appartient à une autre
    société -- ne jamais confirmer son existence à qui n'y a pas accès.
    """
    collab = db.query(Collaborateur).filter(
        Collaborateur.id == collab_id,
        Collaborateur.archive == False,
        Collaborateur.societe_id == societe_id,
    ).first()
    if not collab:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    return collab


@router.patch("/{collab_id}", response_model=CollaborateurRead)
def update_collaborateur(
    collab_id: UUID,
    data: CollaborateurUpdate,
    payload: dict = Depends(require_roles("administrateur", "gestionnaire_rh")),
    db: Session = Depends(get_db),
    societe_id: str = Depends(get_societe_active_id),
):
    """Mise à jour partielle d'un collaborateur (PATCH).

    RG-MULTISOCIETE-08 : bornée à la société active. `societe_id` n'est
    jamais modifiable via ce endpoint même si présent dans `data` -- une
    fiche ne change pas de société après coup (elle se scinde, comme fait
    manuellement pour DAIA/EL KHALLADI le 24/08).
    """
    collab = db.query(Collaborateur).filter(
        Collaborateur.id == collab_id,
        Collaborateur.societe_id == societe_id,
    ).first()
    if not collab:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")

    for field, value in data.model_dump(exclude_unset=True, exclude={"societe_id"}).items():
        setattr(collab, field, value)

    db.commit()
    db.refresh(collab)
    return collab


@router.delete("/{collab_id}", status_code=204)
def archive_collaborateur(
    collab_id: UUID,
    payload: dict = Depends(require_roles("administrateur", "gestionnaire_rh")),
    db: Session = Depends(get_db),
    societe_id: str = Depends(get_societe_active_id),
):
    """Archive un collaborateur (suppression logique, non physique).

    RG-MULTISOCIETE-08 : bornée à la société active.
    """
    collab = db.query(Collaborateur).filter(
        Collaborateur.id == collab_id,
        Collaborateur.societe_id == societe_id,
    ).first()
    if not collab:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable")
    collab.archive = True
    collab.statut_collaborateur = "inactif"
    db.commit()


# ── Contrats ──────────────────────────────────────────────────────────────────
# ⚠️ RG-MULTISOCIETE-08 (découverte 24/08) : les deux endpoints ci-dessous
# opèrent sur le modèle `Contrat` (table "contrats", 0 ligne en production
# confirmé le 24/08) -- DISTINCTE de `collaborateur_contrats`, la vraie table
# utilisée par tout le reste de l'application (paie, congés, prêts...).
# Ces deux endpoints sont donc INERTES en pratique : aucune donnée réelle n'y
# transite. Non corrigés pour le multi-société (inutile de patcher du code
# mort) -- à supprimer ou à rebrancher sur collaborateur_contrats si un jour
# on veut vraiment les utiliser.

@router.get("/{collab_id}/contrats", response_model=list[ContratRead])
def get_contrats(
    collab_id: UUID,
    payload: dict = Depends(require_roles(*RH_ROLES)),
    db: Session = Depends(get_db),
):
    return db.query(Contrat).filter(Contrat.collaborateur_id == collab_id).all()


@router.post("/{collab_id}/contrats", response_model=ContratRead, status_code=201)
def create_contrat(
    collab_id: UUID,
    data: ContratCreate,
    payload: dict = Depends(require_roles("administrateur", "gestionnaire_rh")),
    db: Session = Depends(get_db),
):
    contrat = Contrat(**data.model_dump(), collaborateur_id=collab_id)
    db.add(contrat)
    db.commit()
    db.refresh(contrat)
    return contrat


# ── Vérification doublons identifiants (Feature 1) ────────────────────────────

@router.post(
    "/check-duplicates",
    response_model=list[DuplicateEntry],
    summary="Vérifier si des identifiants sont déjà attribués",
    description=(
        "Vérifie si la CIN, le passeport, le numéro fiscal ou les numéros "
        "d'affiliation fournis existent déjà pour un autre collaborateur. "
        "Retourne une liste vide si aucun doublon n'est détecté."
    ),
)
def check_duplicates(
    body: CheckDuplicatesRequest,
    payload: dict = Depends(require_roles(*RH_ROLES)),
    db: Session = Depends(get_db),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    RG-MULTISOCIETE-08 (correctif 24/08) : bornée à la société active --
    deux fiches de sociétés différentes ne se signalent jamais entre elles
    comme doublons. Nécessaire depuis la scission DAIA/EL KHALLADI
    (migration 066) : un même CIN existe désormais légitimement sur deux
    fiches distinctes (une par société), ce qui aurait été un faux positif
    permanent sans ce filtre.
    """
    duplicates: list[DuplicateEntry] = []

    def _search(column_name: str, label: str, value: str):
        """Requête générique : cherche la valeur dans la colonne donnée."""
        if not value or not value.strip():
            return
        query = db.query(Collaborateur).filter(
            getattr(Collaborateur, column_name) == value.strip(),
            Collaborateur.archive == False,
            Collaborateur.societe_id == societe_id,
        )
        if body.exclude_id:
            query = query.filter(Collaborateur.id != body.exclude_id)
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
                ],
            ))

    # Champs directs
    for field_key, (col, label) in DIRECT_FIELDS.items():
        _search(col, label, getattr(body, field_key) or "")

    # Affiliations
    for aff_key, (col, label) in AFFILIATION_FIELDS.items():
        _search(col, label, (body.affiliations or {}).get(aff_key, ""))

    return duplicates


# ── Validation contrat (Feature 2) ───────────────────────────────────────────

@router.post(
    "/validate-contrat",
    response_model=ValidateContratResponse,
    summary="Valider les règles métier d'un contrat avant enregistrement",
    description=(
        "Vérifie : occurrence obligatoire, date début ≥ date naissance + âge minimum, "
        "date fin > date début, date titularisation ≥ date début."
    ),
)
def validate_contrat(
    body: ValidateContratRequest,
    payload: dict = Depends(require_roles(*RH_ROLES)),
    db: Session = Depends(get_db),
):
    errors: list[ContratValidationError] = []

    # ── Récupérer l'âge minimum depuis ParametreRH si non fourni ─────────────
    age_min = body.age_minimum_travail
    if age_min is None:
        try:
            from app.models.parametre_rh import ParametreRH  # adapter si besoin
            param = db.query(ParametreRH).filter(
                ParametreRH.code == "AGE_MINIMUM_TRAVAIL"
            ).first()
            age_min = int(param.valeur) if param else 15
        except Exception:
            age_min = 15  # valeur légale de secours (Maroc, Code du travail art. 143)

    # ── Règle 1 : Occurrence obligatoire ─────────────────────────────────────
    if not body.occurrence or not body.occurrence.strip():
        errors.append(ContratValidationError(
            field="occurrence",
            message="L'occurrence du contrat est obligatoire.",
        ))

    # ── Règle 2 : Date de début obligatoire ──────────────────────────────────
    if not body.date_debut:
        errors.append(ContratValidationError(
            field="date_debut",
            message="La date de début est obligatoire.",
        ))
    else:
        # ── Règle 2b : date_debut >= date_naissance + age_min ────────────────
        if body.date_naissance_collab:
            from dateutil.relativedelta import relativedelta
            date_min_embauche = body.date_naissance_collab + relativedelta(years=age_min)
            if body.date_debut < date_min_embauche:
                errors.append(ContratValidationError(
                    field="date_debut",
                    message=(
                        f"La date de début ({body.date_debut.strftime('%d/%m/%Y')}) "
                        f"doit être ≥ à la date de naissance + {age_min} ans "
                        f"(âge minimum légal), soit le "
                        f"{date_min_embauche.strftime('%d/%m/%Y')}."
                    ),
                ))

        # ── Règle 3 : date_fin > date_debut ──────────────────────────────────
        if body.date_fin and body.date_fin <= body.date_debut:
            errors.append(ContratValidationError(
                field="date_fin",
                message=(
                    f"La date de fin ({body.date_fin.strftime('%d/%m/%Y')}) "
                    f"doit être postérieure à la date de début "
                    f"({body.date_debut.strftime('%d/%m/%Y')})."
                ),
            ))

        # ── Règle 4 : date_titularisation >= date_debut ──────────────────────
        if body.date_titularisation and body.date_titularisation < body.date_debut:
            errors.append(ContratValidationError(
                field="date_titularisation",
                message=(
                    f"La date de titularisation ({body.date_titularisation.strftime('%d/%m/%Y')}) "
                    f"ne peut pas être antérieure à la date de début "
                    f"({body.date_debut.strftime('%d/%m/%Y')})."
                ),
            ))

    return ValidateContratResponse(valid=len(errors) == 0, errors=errors)
