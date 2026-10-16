"""
app/schemas/auth.py — Schémas Pydantic pour l'authentification
Enrichi avec created_at, matricule, collaborateur_id pour la gestion des accès

RG-05 (migration 057, multi-société façon Odoo) — AJOUT :
  - SocieteRef : référence légère société (id + raison sociale), utilisée dans
    TokenResponse/UserRead pour exposer les sociétés accessibles à l'utilisateur.
  - TokenResponse.societe_active_id / UserRead.societes + societe_active_id
  - SocieteActiveRequest : payload de POST /auth/societe-active
"""

from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

# ── Multi-société (RG-05) ─────────────────────────────────────────────────────

class SocieteRef(BaseModel):
    id: str
    raison_sociale: str
    nom_commercial: Optional[str] = None
    code_societe: Optional[str] = None

    class Config:
        from_attributes = True


class SocieteActiveRequest(BaseModel):
    societe_id: str


# ── Authentification ──────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    all_roles: list[str]
    user_id: str
    nom: Optional[str] = None
    prenom: Optional[str] = None
    societe_active_id: Optional[str] = None  # RG-05


# ── Création utilisateur ──────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    nom: str
    prenom: str
    roles: list[str] = ["collaborateur"]
    collaborateur_id: Optional[str] = None  # UUID du collaborateur à lier


# ── Lecture utilisateur ───────────────────────────────────────────────────────

class UserRead(BaseModel):
    id: str
    email: str
    is_active: bool = True
    nom: Optional[str] = None
    prenom: Optional[str] = None
    roles: list[str] = []
    created_at: Optional[datetime] = None
    # Champs issus de la liaison collaborateur
    matricule: Optional[str] = None
    collaborateur_id: Optional[str] = None
    # RG-05 : sociétés accessibles + société active
    societes: list[SocieteRef] = []
    societe_active_id: Optional[str] = None

    class Config:
        from_attributes = True


# ── Changement de mot de passe ────────────────────────────────────────────────

class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class AdminPasswordChange(BaseModel):
    new_password: str


# ── Ajout / suppression de rôle ───────────────────────────────────────────────

class RoleAdd(BaseModel):
    role: str
