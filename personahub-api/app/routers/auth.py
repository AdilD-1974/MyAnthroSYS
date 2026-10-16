from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import (
    verify_password, hash_password, create_access_token,
    get_current_user_payload, require_roles
)
from app.models.auth import User, Profile, UserRole
from app.schemas.auth import (
    LoginRequest, TokenResponse, UserCreate, UserRead, PasswordChange,
    SocieteRef, SocieteActiveRequest,
)

router = APIRouter(prefix="/auth", tags=["Authentification"])

ROLE_PRIORITY = ["administrateur", "gestionnaire_rh", "gestionnaire_paie", "manager", "collaborateur"]


def _dominant_role(roles: list[str]) -> str:
    """Retourne le rôle dominant selon la priorité définie."""
    for r in ROLE_PRIORITY:
        if r in roles:
            return r
    return roles[0] if roles else "collaborateur"


# ─────────────────────────────────────────────────────────────────────────────
# RG-05 (migration 057, multi-société façon Odoo) — helpers société
# ─────────────────────────────────────────────────────────────────────────────
# SQL brut (comme le lookup matricule existant plus bas) plutôt qu'un modèle
# ORM Societe/UserSociete : ces modèles ne sont pas dans les fichiers fournis,
# et le pattern SQL brut est déjà celui utilisé dans ce routeur pour tout ce
# qui touche à une table hors du périmètre auth (collaborateurs).

def _societes_utilisateur(db: Session, user_id: str) -> list[dict]:
    """Sociétés accessibles à l'utilisateur (table user_societes), triées
    société par défaut en premier."""
    rows = db.execute(text("""
        SELECT s.id, s.raison_sociale, s.nom_commercial, s.code_societe, us.est_defaut
          FROM public.user_societes us
          JOIN public.societes s ON s.id = us.societe_id
         WHERE us.user_id = :uid
         ORDER BY us.est_defaut DESC, s.raison_sociale
    """), {"uid": str(user_id)}).mappings().all()
    return [dict(r) for r in rows]


def _resoudre_societe_active(db: Session, user: User, societes: list[dict]) -> str | None:
    """
    Détermine la société active à poser dans le JWT au login :
      1. user.societe_active_id s'il est bien dans la liste des sociétés
         accessibles (choix précédent de l'utilisateur, respecté) ;
      2. sinon la société marquée est_defaut=true ;
      3. sinon la première société accessible ;
      4. None si l'utilisateur n'a accès à aucune société (cas à surveiller :
         un utilisateur nouvellement créé sans ligne dans user_societes).
    Persiste le choix sur user.societe_active_id si différent (pour que le
    prochain login retombe directement dessus).
    """
    if not societes:
        return None
    ids_accessibles = {s["id"] for s in societes}
    courant = str(user.societe_active_id) if user.societe_active_id else None
    if courant and courant in {str(i) for i in ids_accessibles}:
        resolue = courant
    else:
        resolue = str(next((s["id"] for s in societes if s["est_defaut"]), societes[0]["id"]))
    if str(user.societe_active_id) != resolue:
        user.societe_active_id = resolue
        db.commit()
    return resolue


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """
    Authentifie un utilisateur et retourne un JWT.
    Remplace Supabase Auth.
    """
    user = db.query(User).filter(User.email == data.email, User.is_active == True).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou mot de passe incorrect",
        )

    roles = [r.role for r in user.roles]
    dominant = _dominant_role(roles)

    # RG-05 : société active posée au login, embarquée dans le JWT.
    societes = _societes_utilisateur(db, str(user.id))
    societe_active_id = _resoudre_societe_active(db, user, societes)

    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": dominant,
        "all_roles": roles,
        "societe_active_id": societe_active_id,
    })

    return TokenResponse(
        access_token=token,
        role=dominant,
        all_roles=roles,
        user_id=str(user.id),
        nom=user.profile.nom if user.profile else None,
        prenom=user.profile.prenom if user.profile else None,
        societe_active_id=societe_active_id,
    )


@router.post("/societe-active", response_model=TokenResponse)
def changer_societe_active(
    data: SocieteActiveRequest,
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db),
):
    """
    RG-05 : bascule de société active (sélecteur façon Odoo multi-company).
    Vérifie que la société demandée fait bien partie des sociétés accessibles
    à l'utilisateur (table user_societes) avant de l'accepter -- pas de
    confiance dans un societe_id envoyé par le client sans validation.
    Renvoie un NOUVEAU token JWT avec le claim societe_active_id à jour ;
    le token précédent reste valide jusqu'à son expiration naturelle (pas de
    révocation ici) -- acceptable pour une bascule de contexte, pas une
    déconnexion de sécurité.
    """
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    societes = _societes_utilisateur(db, str(user.id))
    if not any(s["id"] == data.societe_id or str(s["id"]) == data.societe_id for s in societes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Société non accessible pour cet utilisateur",
        )

    user.societe_active_id = data.societe_id
    db.commit()

    roles = [r.role for r in user.roles]
    dominant = _dominant_role(roles)
    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": dominant,
        "all_roles": roles,
        "societe_active_id": data.societe_id,
    })

    return TokenResponse(
        access_token=token,
        role=dominant,
        all_roles=roles,
        user_id=str(user.id),
        nom=user.profile.nom if user.profile else None,
        prenom=user.profile.prenom if user.profile else None,
        societe_active_id=data.societe_id,
    )


@router.post("/users", response_model=UserRead, status_code=201,
             dependencies=[Depends(require_roles("administrateur"))])
def create_user(data: UserCreate, db: Session = Depends(get_db)):
    """Crée un nouvel utilisateur (administrateur uniquement)."""
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Cet email est déjà utilisé")

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
    )
    db.add(user)
    db.flush()  # obtenir l'id sans commit

    profile = Profile(user_id=user.id, nom=data.nom, prenom=data.prenom)
    db.add(profile)

    for role in data.roles:
        db.add(UserRole(user_id=user.id, role=role))

    db.commit()
    db.refresh(user)

    return UserRead(
        id=str(user.id),
        email=user.email,
        is_active=user.is_active,
        nom=user.profile.nom,
        prenom=user.profile.prenom,
        roles=[r.role for r in user.roles],
    )


@router.get("/me", response_model=UserRead)
def get_me(payload: dict = Depends(get_current_user_payload), db: Session = Depends(get_db)):
    """Retourne les informations de l'utilisateur connecté."""
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    # Lien collaborateur via profiles.collaborateur_id -> collaborateurs.matricule
    collaborateur_id = None
    matricule = None
    if user.profile and user.profile.collaborateur_id:
        collaborateur_id = str(user.profile.collaborateur_id)
        row = db.execute(
            text("SELECT matricule FROM collaborateurs WHERE id = :cid"),
            {"cid": collaborateur_id},
        ).first()
        if row:
            matricule = row[0]

    # RG-05 : sociétés accessibles + société active
    societes = _societes_utilisateur(db, str(user.id))
    societe_refs = [
        SocieteRef(id=str(s["id"]), raison_sociale=s["raison_sociale"], nom_commercial=s["nom_commercial"], code_societe=s.get("code_societe"))
        for s in societes
    ]
    societe_active_id = str(user.societe_active_id) if user.societe_active_id else (
        societe_refs[0].id if societe_refs else None
    )

    return UserRead(
        id=str(user.id),
        email=user.email,
        is_active=user.is_active,
        nom=user.profile.nom if user.profile else None,
        prenom=user.profile.prenom if user.profile else None,
        roles=[r.role for r in user.roles],
        matricule=matricule,
        collaborateur_id=collaborateur_id,
        societes=societe_refs,
        societe_active_id=societe_active_id,
    )


@router.post("/me/change-password", status_code=204)
def change_password(
    data: PasswordChange,
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db),
):
    """Permet à l'utilisateur connecté de changer son mot de passe."""
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")
    user.hashed_password = hash_password(data.new_password)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints administration des utilisateurs (réservés administrateur)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserRead],
            dependencies=[Depends(require_roles("administrateur"))])
def list_users(db: Session = Depends(get_db)):
    """Liste tous les utilisateurs avec leurs profils et rôles."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    result = []
    for u in users:
        # Récupérer le matricule depuis la liaison collaborateur si elle existe
        matricule = None
        collaborateur_id = None
        if hasattr(u, "collaborateur") and u.collaborateur:
            matricule = u.collaborateur.matricule
            collaborateur_id = str(u.collaborateur.id)

        result.append(UserRead(
            id=str(u.id),
            email=u.email,
            is_active=u.is_active,
            nom=u.profile.nom if u.profile else None,
            prenom=u.profile.prenom if u.profile else None,
            roles=[r.role for r in u.roles],
            created_at=u.created_at,
            matricule=matricule,
            collaborateur_id=collaborateur_id,
        ))
    return result


@router.post("/users/{user_id}/roles", status_code=201,
             dependencies=[Depends(require_roles("administrateur"))])
def add_role(user_id: str, body: dict, db: Session = Depends(get_db)):
    """Ajoute un rôle à un utilisateur existant."""
    role = body.get("role")
    if not role or role not in [r for r in ROLE_PRIORITY]:
        raise HTTPException(status_code=400, detail=f"Rôle invalide : {role}")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    already = any(r.role == role for r in user.roles)
    if already:
        raise HTTPException(status_code=409, detail="Ce rôle est déjà attribué")

    db.add(UserRole(user_id=user.id, role=role))
    db.commit()
    return {"detail": f"Rôle '{role}' ajouté"}


@router.delete("/users/{user_id}/roles/{role}", status_code=204,
               dependencies=[Depends(require_roles("administrateur"))])
def remove_role(user_id: str, role: str, db: Session = Depends(get_db)):
    """Retire un rôle d'un utilisateur. Impossible s'il n'en a qu'un seul."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    current_roles = user.roles
    if len(current_roles) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Impossible de retirer le dernier rôle d'un utilisateur"
        )

    role_obj = next((r for r in current_roles if r.role == role), None)
    if not role_obj:
        raise HTTPException(status_code=404, detail=f"Rôle '{role}' non trouvé pour cet utilisateur")

    db.delete(role_obj)
    db.commit()


@router.post("/users/{user_id}/change-password", status_code=204,
             dependencies=[Depends(require_roles("administrateur"))])
def admin_change_password(user_id: str, body: dict, db: Session = Depends(get_db)):
    """Permet à un administrateur de changer le mot de passe d'un utilisateur."""
    new_password = body.get("new_password", "")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Le mot de passe doit contenir au moins 8 caractères")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    user.hashed_password = hash_password(new_password)
    db.commit()
