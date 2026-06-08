"""
Script one-shot : crée un compte pour chaque collaborateur ACTIF non encore relié
à un compte (profiles.collaborateur_id). Une fois exécuté, ces collaborateurs
apparaissent dans le chat et peuvent se connecter.

À lancer depuis le dossier backend, le venv activé :
    cd D:\\SOLGEIS\\personahub-api
    python provision_chat_accounts.py

Ré-exécutable sans risque : les collaborateurs déjà reliés sont ignorés.
"""

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.auth import User, Profile, UserRole
from app.models.collaborateur import Collaborateur


# ── Paramètres ────────────────────────────────────────────────────────────────
MOT_DE_PASSE = "Solges@2026!"        # ⚠️ mot de passe initial commun (à faire changer)
ROLE_PAR_DEFAUT = "collaborateur"     # rôle minimal ; à élever ensuite si besoin
DOMAINE_FALLBACK = "solgeis.ma"       # pour générer un email si email_professionnel manque
FORCER_CHANGEMENT = True              # True = l'utilisateur devra changer son mdp à la 1re connexion
                                      # (mets False si ton écran de 1re connexion n'est pas prêt)


def email_pour(c: Collaborateur) -> str:
    if c.email_professionnel and c.email_professionnel.strip():
        return c.email_professionnel.strip().lower()
    return f"{(c.matricule or '').strip().lower()}@{DOMAINE_FALLBACK}"


def main() -> None:
    db = SessionLocal()
    hashed = hash_password(MOT_DE_PASSE)
    crees, relies, ignores = 0, 0, 0
    journal: list[str] = []

    try:
        # Collaborateurs (on saute les archivés)
        collabs = db.query(Collaborateur).all()

        # ids déjà reliés à un compte
        deja_relies = {
            p.collaborateur_id
            for p in db.query(Profile).filter(Profile.collaborateur_id.isnot(None)).all()
        }

        for c in collabs:
            if c.archive:                      # fiche archivée → ignorée
                continue
            if c.id in deja_relies:            # déjà un compte relié → ignorée
                ignores += 1
                continue

            email = email_pour(c)
            existant = db.query(User).filter(User.email == email).first()

            if existant:
                # Un compte existe déjà avec cet email → on relie sa fiche au lieu d'en créer un doublon
                prof = existant.profile
                if prof is None:
                    db.add(Profile(user_id=existant.id, nom=c.nom, prenom=c.prenom, collaborateur_id=c.id))
                else:
                    prof.collaborateur_id = c.id
                    if not prof.nom:
                        prof.nom = c.nom
                    if not prof.prenom:
                        prof.prenom = c.prenom
                if not any(r.role == ROLE_PAR_DEFAUT for r in existant.roles):
                    db.add(UserRole(user_id=existant.id, role=ROLE_PAR_DEFAUT))
                relies += 1
                journal.append(f"  relié    {email:40} {c.matricule:10} {c.prenom} {c.nom}")
                continue

            # Création complète : user + profile relié + rôle
            user = User(
                email=email,
                hashed_password=hashed,
                is_active=True,
                must_change_password=FORCER_CHANGEMENT,
            )
            db.add(user)
            db.flush()  # pour obtenir user.id avant de créer profile/role
            db.add(Profile(user_id=user.id, nom=c.nom, prenom=c.prenom, collaborateur_id=c.id))
            db.add(UserRole(user_id=user.id, role=ROLE_PAR_DEFAUT))
            crees += 1
            journal.append(f"  créé     {email:40} {c.matricule:10} {c.prenom} {c.nom}")

        db.commit()

        print("\n".join(journal) if journal else "  (rien à faire)")
        print("\n──────────────────────────────────────────────")
        print(f"  Comptes créés                : {crees}")
        print(f"  Fiches reliées à un compte   : {relies}")
        print(f"  Déjà reliés (ignorés)        : {ignores}")
        print(f"  Mot de passe initial         : {MOT_DE_PASSE}")
        print("──────────────────────────────────────────────")

    except Exception as e:
        db.rollback()
        print(f"ERREUR — aucune modification appliquée : {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
