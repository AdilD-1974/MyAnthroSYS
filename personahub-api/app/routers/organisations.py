from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional
from pydantic import BaseModel
from datetime import datetime
import shutil, uuid, os

from app.core.database import get_db
from app.core.security import require_roles
from app.models.organisation import Organisation, Poste

router = APIRouter(tags=["Organisations & Postes"])

RH_ROLES = ("administrateur", "gestionnaire_rh", "manager")


# ── Schémas ───────────────────────────────────────────────────────────────────

class OrganisationCreate(BaseModel):
    code: str
    libelle: str
    type_organisation: Optional[str] = None
    parent_id: Optional[UUID] = None
    responsable_id: Optional[UUID] = None
    description: Optional[str] = None
    actif: bool = True


class OrganisationRead(BaseModel):
    id: UUID
    code: str
    libelle: str
    type_organisation: Optional[str]
    parent_id: Optional[UUID]
    responsable_id: Optional[UUID]
    actif: bool
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class PosteCreate(BaseModel):
    code: str
    libelle: str
    organisation_id: Optional[UUID] = None
    niveau_hierarchique: Optional[int] = None
    description: Optional[str] = None
    actif: bool = True


class PosteRead(BaseModel):
    id: UUID
    code: str
    libelle: str
    organisation_id: Optional[UUID]
    niveau_hierarchique: Optional[int]
    actif: bool
    description: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Upload Logo Société ───────────────────────────────────────────────────────

LOGOS_DIR = "storage/logos_societes"
PHOTOS_DIR = "storage/photos_collaborateurs"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "svg", "webp"}
ALLOWED_PHOTO_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}  # SVG interdit pour photos
MAX_FILE_SIZE = 2 * 1024 * 1024  # 2 Mo
MAX_PHOTO_SIZE = 5 * 1024 * 1024  # 5 Mo pour les photos d'identité


@router.post("/storage/logos_societes", tags=["Storage"])
async def upload_logo_societe(
    file: UploadFile = File(...),
):
    # Vérifier l'extension
    ext = file.filename.split(".")[-1].lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            detail=f"Extension non autorisée : {ext}. Utilisez PNG, JPG, SVG ou WEBP."
        )

    # Lire et vérifier la taille
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, detail="Fichier trop volumineux (max 2 Mo)")

    # Créer le dossier si nécessaire
    os.makedirs(LOGOS_DIR, exist_ok=True)

    # Générer un nom unique
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(LOGOS_DIR, filename)

    # Sauvegarder le fichier
    with open(filepath, "wb") as buffer:
        buffer.write(content)

    public_url = f"http://localhost:8000/api/v1/storage/logos_societes/{filename}"
    return JSONResponse({"publicUrl": public_url, "filename": filename})


@router.delete("/storage/logos_societes/{filename}", tags=["Storage"])
async def delete_logo_societe(
    filename: str,
):
    # Sécurité : empêcher les path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, detail="Nom de fichier invalide")

    filepath = os.path.join(LOGOS_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
    return JSONResponse({"deleted": True, "filename": filename})


# ── Upload Photo Collaborateur ────────────────────────────────────────────────

@router.post("/storage/photos_collaborateurs/{collaborateur_id}", tags=["Storage"])
async def upload_photo_collaborateur(
    collaborateur_id: str,
    file: UploadFile = File(...),
):
    """
    Upload de la photo d'un collaborateur. Le fichier est nommé d'après
    l'UUID du collaborateur, ce qui écrase automatiquement l'ancienne
    photo lors d'un nouvel upload.
    """
    # Sécurité : valider l'UUID
    try:
        UUID(collaborateur_id)
    except ValueError:
        raise HTTPException(400, detail="Identifiant collaborateur invalide")

    # Vérifier l'extension
    ext = file.filename.split(".")[-1].lower() if file.filename else ""
    if ext not in ALLOWED_PHOTO_EXTENSIONS:
        raise HTTPException(
            400,
            detail=f"Extension non autorisée : {ext}. Utilisez PNG, JPG ou WEBP."
        )

    # Lire et vérifier la taille
    content = await file.read()
    if len(content) > MAX_PHOTO_SIZE:
        raise HTTPException(400, detail="Fichier trop volumineux (max 5 Mo)")

    # Créer le dossier si nécessaire
    os.makedirs(PHOTOS_DIR, exist_ok=True)

    # Nom basé sur l'UUID du collaborateur (écrase l'ancienne)
    # On supprime d'abord toutes les variantes d'extensions possibles
    for old_ext in ALLOWED_PHOTO_EXTENSIONS:
        old_path = os.path.join(PHOTOS_DIR, f"{collaborateur_id}.{old_ext}")
        if os.path.exists(old_path):
            os.remove(old_path)

    filename = f"{collaborateur_id}.{ext}"
    filepath = os.path.join(PHOTOS_DIR, filename)

    # Sauvegarder le fichier
    with open(filepath, "wb") as buffer:
        buffer.write(content)

    public_url = f"http://localhost:8000/api/v1/storage/photos_collaborateurs/{filename}"
    return JSONResponse({"publicUrl": public_url, "filename": filename})


@router.delete("/storage/photos_collaborateurs/{collaborateur_id}", tags=["Storage"])
async def delete_photo_collaborateur(
    collaborateur_id: str,
):
    """Supprime la photo d'un collaborateur (toutes extensions confondues)."""
    try:
        UUID(collaborateur_id)
    except ValueError:
        raise HTTPException(400, detail="Identifiant collaborateur invalide")

    deleted_files = []
    for ext in ALLOWED_PHOTO_EXTENSIONS:
        filepath = os.path.join(PHOTOS_DIR, f"{collaborateur_id}.{ext}")
        if os.path.exists(filepath):
            os.remove(filepath)
            deleted_files.append(f"{collaborateur_id}.{ext}")

    return JSONResponse({"deleted": True, "files": deleted_files})


# ── Organisations ─────────────────────────────────────────────────────────────

@router.get("/organisations", response_model=list[OrganisationRead])
def list_organisations(db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    return db.query(Organisation).filter(Organisation.actif == True).order_by(Organisation.libelle).all()


@router.post("/organisations", response_model=OrganisationRead, status_code=201)
def create_organisation(
    data: OrganisationCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh")),
):
    if db.query(Organisation).filter(Organisation.code == data.code).first():
        raise HTTPException(400, detail=f"Le code organisation '{data.code}' existe déjà")
    org = Organisation(**data.model_dump())
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@router.get("/organisations/{org_id}", response_model=OrganisationRead)
def get_organisation(org_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if not org:
        raise HTTPException(404, detail="Organisation introuvable")
    return org


@router.patch("/organisations/{org_id}", response_model=OrganisationRead)
def update_organisation(
    org_id: UUID,
    data: OrganisationCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh")),
):
    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if not org:
        raise HTTPException(404, detail="Organisation introuvable")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(org, field, value)
    db.commit()
    db.refresh(org)
    return org


@router.delete("/organisations/{org_id}", status_code=204)
def deactivate_organisation(
    org_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur")),
):
    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if not org:
        raise HTTPException(404, detail="Organisation introuvable")
    org.actif = False
    db.commit()


# ── Postes ────────────────────────────────────────────────────────────────────

@router.get("/postes", response_model=list[PosteRead])
def list_postes(db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    return db.query(Poste).filter(Poste.actif == True).order_by(Poste.libelle).all()


@router.post("/postes", response_model=PosteRead, status_code=201)
def create_poste(
    data: PosteCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh")),
):
    if db.query(Poste).filter(Poste.code == data.code).first():
        raise HTTPException(400, detail=f"Le code poste '{data.code}' existe déjà")
    p = Poste(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/postes/{poste_id}", status_code=204)
def delete_poste(
    poste_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh")),
):
    p = db.query(Poste).filter(Poste.id == poste_id).first()
    if not p:
        raise HTTPException(404, detail="Poste introuvable")
    p.actif = False
    db.commit()
