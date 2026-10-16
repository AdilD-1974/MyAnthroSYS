from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Set
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db

# ── Hachage des mots de passe ─────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Bearer token ──────────────────────────────────────────────────────────────
bearer_scheme = HTTPBearer()


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Crée un JWT signé avec les données utilisateur."""
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload.update({"exp": expire})
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    """Décode et valide un JWT. Lève HTTPException si invalide."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Dépendances FastAPI ───────────────────────────────────────────────────────

def get_current_user_payload(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """Dépendance : extrait et valide le payload JWT du header Authorization."""
    return decode_token(credentials.credentials)


# ──────────────────────────────────────────────────────────────────────────────
# SOCIÉTÉ ACTIVE (RG-05, migration 057) — multi-société façon Odoo
# ──────────────────────────────────────────────────────────────────────────────
# Le JWT doit porter un claim "societe_active_id", posé au login et rafraîchi
# par l'endpoint de bascule (POST /auth/societe-active — routeur auth, pas
# encore fourni à ce stade). Cette dépendance suppose que create_access_token()
# reçoit bien "societe_active_id" dans son payload au login : à vérifier/
# adapter dans le routeur auth réel une fois partagé.

def get_societe_active_id(payload: dict = Depends(get_current_user_payload)) -> str:
    """Dépendance : société active de l'utilisateur courant (claim JWT).
    Lève 403 si absente -- un token émis sans société active ne devrait
    jamais arriver en usage normal (elle est posée au login), donc une
    absence signale un problème d'émission plutôt qu'un cas légitime à
    tolérer silencieusement (pas de repli implicite sur une société)."""
    sid = payload.get("societe_active_id")
    if not sid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Aucune société active sur ce token — reconnexion requise",
        )
    return sid


# ──────────────────────────────────────────────────────────────────────────────
# RÔLES — source unique de vérité pour l'autorisation
# ──────────────────────────────────────────────────────────────────────────────
# Un collaborateur peut détenir plusieurs profils (rôles). L'autorisation se
# fait sur l'UNION de ses rôles, pas sur le seul rôle "actif" choisi dans l'UI.
# Cette fonction tolère plusieurs formes de payload pour rester compatible :
#   - "role"      : rôle actif (singulier) — ancien comportement
#   - "roles"     : liste de tous les rôles détenus
#   - "all_roles" : alias historique de la liste
# Faire transiter "roles" dans le JWT (au login) est ce qui rend l'union
# pleinement effective. À défaut, on retombe proprement sur "role".

def roles_from_payload(payload: dict) -> Set[str]:
    """Ensemble de tous les rôles détenus par l'utilisateur, d'après le JWT."""
    acc: Set[str] = set()
    actif = payload.get("role")
    if isinstance(actif, str) and actif:
        acc.add(actif)
    for cle in ("roles", "all_roles"):
        val = payload.get(cle)
        if isinstance(val, (list, tuple, set)):
            acc.update(str(r) for r in val if r)
        elif isinstance(val, str) and val:
            acc.add(val)
    return acc


def user_has_any_role(payload: dict, roles: Iterable[str]) -> bool:
    """True si l'utilisateur détient AU MOINS un des rôles demandés."""
    return bool(roles_from_payload(payload).intersection(set(roles)))


def require_roles(*roles: str):
    """
    Restreint une route aux utilisateurs détenant AU MOINS UN des `roles`.

    Autorise sur l'UNION des profils du collaborateur (multi-profils géré
    nativement) : un utilisateur Manager + Gestionnaire RH accède aux écrans
    des deux espaces sans avoir à "basculer" de rôle actif.

    Usage (inchangé) :
        @router.get("/x", dependencies=[Depends(require_roles("administrateur"))])

    Rôles : administrateur | gestionnaire_rh | gestionnaire_paie | manager | collaborateur

    ⚠️ Liste de rôles FIGÉE au moment de la déclaration de la route. Pour un
    module dont l'accès doit rester ouvert à des rôles créés après coup par
    l'administrateur (ex. Évaluation, Recrutement, Formation, Social — pas
    encore créés au 26/08/2026), utiliser require_menu_access() à la place,
    qui lit la matrice d'accès à chaque requête plutôt qu'une liste en dur.
    """
    requis = set(roles)

    def _check(payload: dict = Depends(get_current_user_payload)):
        if not user_has_any_role(payload, requis):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Accès refusé. Rôle requis : {', '.join(roles)}",
            )
        return payload

    return _check


def require_active_role(*roles: str):
    """
    Variante STRICTE : restreint au rôle ACTIF (l'espace courant), même si
    l'utilisateur détient d'autres profils. À n'utiliser que pour les rares
    écrans qui doivent dépendre de l'espace sélectionné, pas de l'union.

    Usage :
        @router.get("/x", dependencies=[Depends(require_active_role("manager"))])
    """
    requis = set(roles)

    def _check(payload: dict = Depends(get_current_user_payload)):
        if payload.get("role") not in requis:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Accès refusé. Espace requis : {', '.join(roles)}",
            )
        return payload

    return _check


# ──────────────────────────────────────────────────────────────────────────────
# ACCÈS PAR MENU (matrice rôle ↔ menu, pilotée par l'administrateur)
# ──────────────────────────────────────────────────────────────────────────────
# Contrairement à require_roles(*codes_fixes), la liste des rôles autorisés
# n'est PAS codée en dur : elle est lue dynamiquement dans menu_role, la
# table RÉELLEMENT active pour la matrice d'accès menus (confirmée le
# 26/08/2026 par lecture de app/routers/roles.py — set_acces_menus() écrit
# dans menu_items/menu_role, PAS dans acc_role_acces/ref_menus malgré ce que
# disent les commentaires du même fichier, qui décrivent un système jamais
# branché ailleurs dans le projet).
#
# Usage :
#     @router.post("/x", dependencies=[Depends(require_menu_access("etats"))])
#
# L'administrateur reste toujours autorisé (même bypass qu'en place dans
# set_acces_menus() : "L'admin voit tout (géré par la sidebar) → ses accès
# ne sont pas modifiables"). Pour tout autre rôle, l'accès est accordé si et
# seulement si l'admin a coché ce menu pour ce rôle via l'écran existant
# (PUT /roles/{id}/acces) — un rôle créé après coup (Évaluation,
# Recrutement, Formation, Social...) fonctionne sans toucher au code, dès
# qu'il est coché dans cette matrice.

def require_menu_access(code_menu: str):
    """Restreint une route aux utilisateurs ayant accès au menu `code_menu`
    (table menu_role), avec bypass total pour le rôle administrateur."""

    def _check(
        payload: dict = Depends(get_current_user_payload),
        db: Session = Depends(get_db),
    ) -> dict:
        roles_utilisateur = roles_from_payload(payload)
        if "administrateur" in roles_utilisateur:
            return payload
        if not roles_utilisateur:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé.")

        autorise = db.execute(
            text(
                """
                SELECT 1
                FROM public.menu_role mr
                JOIN public.menu_items m ON m.id = mr.menu_id
                WHERE m.code = :code_menu AND m.actif = true
                  AND mr.role = ANY(:roles)
                LIMIT 1
                """
            ),
            {"code_menu": code_menu, "roles": list(roles_utilisateur)},
        ).first()

        if not autorise:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Accès refusé au module '{code_menu}'.",
            )
        return payload

    return _check
