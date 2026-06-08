"""
Provisioning des comptes utilisateurs à partir des collaborateurs.

- GET  /api/v1/provisioning/collaborateurs-sans-compte
       Liste les collaborateurs actifs n'ayant pas encore de compte (via profiles.collaborateur_id).
- POST /api/v1/provisioning/generer-comptes
       Crée un compte (mot de passe temporaire) pour chaque collaborateur demandé.
       Réservé aux administrateurs. Idempotent. Renvoie les mots de passe temporaires UNE SEULE FOIS.

S'appuie sur l'existant : models User/Profile/UserRole, hash_password(), require_roles("administrateur").
"""
import secrets
import string
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import hash_password, require_roles
from app.models.auth import User, Profile, UserRole

router = APIRouter(prefix="/provisioning", tags=["Provisioning"])

ROLE_DEFAUT = "collaborateur"
DOMAINE_FALLBACK = "solgeis.ma"  # utilisé si aucun email collaborateur n'est renseigné


# ── Schémas ──────────────────────────────────────────────────────────────────
class CollaborateurSansCompte(BaseModel):
    collaborateur_id: str
    matricule: str | None = None
    nom: str | None = None
    prenom: str | None = None
    email: str | None = None          # email résolu (pro > perso > matricule@domaine)
    email_source: str                 # "professionnel" | "personnel" | "genere"


class GenererRequest(BaseModel):
    collaborateur_ids: list[str]
    role: str = ROLE_DEFAUT


class CompteGenere(BaseModel):
    collaborateur_id: str
    nom: str | None = None
    prenom: str | None = None
    email: str
    mot_de_passe_temporaire: str
    statut: str                       # "cree" | "ignore"
    message: str | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────
def _resoudre_email(row) -> tuple[str, str]:
    """(email, source) avec repli pro > perso > matricule@domaine."""
    pro = (row.email_professionnel or "").strip()
    perso = (row.email_personnel or "").strip()
    if pro:
        return pro, "professionnel"
    if perso:
        return perso, "personnel"
    mat = (row.matricule or str(row.id)[:8]).strip().lower()
    return f"{mat}@{DOMAINE_FALLBACK}", "genere"


def _mot_de_passe_temporaire(n: int = 12) -> str:
    """Mot de passe fort : maj, min, chiffres, symbole, sans caractères ambigus."""
    maj = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    minu = "abcdefghijkmnpqrstuvwxyz"
    chiff = "23456789"
    sym = "!@#%*?-"
    base = maj + minu + chiff
    pwd = [secrets.choice(maj), secrets.choice(minu), secrets.choice(chiff), secrets.choice(sym)]
    pwd += [secrets.choice(base) for _ in range(max(0, n - len(pwd)))]
    secrets.SystemRandom().shuffle(pwd)
    return "".join(pwd)


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get(
    "/collaborateurs-sans-compte",
    response_model=list[CollaborateurSansCompte],
    dependencies=[Depends(require_roles("administrateur"))],
)
def collaborateurs_sans_compte(db: Session = Depends(get_db)):
    """Collaborateurs actifs (non archivés) qui n'ont pas encore de compte utilisateur."""
    sql = text("""
        SELECT c.id, c.matricule, c.nom, c.prenom, c.email_professionnel, c.email_personnel
        FROM collaborateurs c
        WHERE COALESCE(c.archive, false) = false
          AND NOT EXISTS (
              SELECT 1 FROM profiles p WHERE p.collaborateur_id = c.id
          )
        ORDER BY c.nom, c.prenom
    """)
    rows = db.execute(sql).fetchall()
    out: list[CollaborateurSansCompte] = []
    for r in rows:
        email, source = _resoudre_email(r)
        out.append(CollaborateurSansCompte(
            collaborateur_id=str(r.id), matricule=r.matricule, nom=r.nom, prenom=r.prenom,
            email=email, email_source=source,
        ))
    return out


@router.post(
    "/generer-comptes",
    response_model=list[CompteGenere],
    dependencies=[Depends(require_roles("administrateur"))],
)
def generer_comptes(data: GenererRequest, db: Session = Depends(get_db)):
    """
    Génère un compte par collaborateur demandé.
    Idempotent : ignore ceux qui ont déjà un compte ou dont l'email est déjà pris.
    Renvoie les mots de passe temporaires (à transmettre, non re-consultables ensuite).
    """
    if data.role not in ("administrateur", "gestionnaire_rh", "gestionnaire_paie", "manager", "collaborateur"):
        raise HTTPException(status_code=400, detail=f"Rôle invalide : {data.role}")
    if not data.collaborateur_ids:
        return []

    resultats: list[CompteGenere] = []
    for cid in data.collaborateur_ids:
        row = db.execute(text("""
            SELECT id, matricule, nom, prenom, email_professionnel, email_personnel
            FROM collaborateurs WHERE id = :id
        """), {"id": cid}).fetchone()

        if not row:
            resultats.append(CompteGenere(collaborateur_id=cid, email="", mot_de_passe_temporaire="",
                                          statut="ignore", message="Collaborateur introuvable"))
            continue

        # Déjà un compte ?
        existe = db.query(Profile).filter(Profile.collaborateur_id == row.id).first()
        if existe:
            resultats.append(CompteGenere(collaborateur_id=cid, nom=row.nom, prenom=row.prenom,
                                          email="", mot_de_passe_temporaire="", statut="ignore",
                                          message="Compte déjà existant"))
            continue

        email, _ = _resoudre_email(row)

        # Email déjà pris ?
        if db.query(User).filter(User.email == email).first():
            resultats.append(CompteGenere(collaborateur_id=cid, nom=row.nom, prenom=row.prenom,
                                          email=email, mot_de_passe_temporaire="", statut="ignore",
                                          message="Email déjà utilisé"))
            continue

        # Création
        pwd = _mot_de_passe_temporaire()
        user = User(email=email, hashed_password=hash_password(pwd))
        # flag mot de passe temporaire (colonne ajoutée par provisioning.sql)
        if hasattr(user, "must_change_password"):
            user.must_change_password = True
        db.add(user)
        db.flush()  # obtenir user.id

        db.add(Profile(user_id=user.id, nom=row.nom, prenom=row.prenom, collaborateur_id=row.id))
        db.add(UserRole(user_id=user.id, role=data.role))
        db.commit()

        resultats.append(CompteGenere(collaborateur_id=cid, nom=row.nom, prenom=row.prenom,
                                      email=email, mot_de_passe_temporaire=pwd, statut="cree"))

    return resultats
