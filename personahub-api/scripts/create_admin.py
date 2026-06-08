#!/usr/bin/env python3
"""
Script CLI — Crée le premier administrateur de PersonaHub HR.

Usage :
    python scripts/create_admin.py
    python scripts/create_admin.py --email admin@ma-societe.ma --nom Alaoui --prenom Mohammed
"""
import argparse
import sys
import os

# Permettre l'import des modules app depuis la racine du projet
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy.orm import Session
from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password
from app.models.auth import User, Profile, UserRole
from app.models import auth, collaborateur, paie, absences, organisation  # noqa

# Créer les tables si elles n'existent pas
Base.metadata.create_all(bind=engine)


def create_admin(email: str, password: str, nom: str, prenom: str) -> None:
    db: Session = SessionLocal()
    try:
        # Vérifier si l'email est déjà utilisé
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            print(f"⚠️  L'email '{email}' est déjà utilisé.")
            roles = [r.role for r in existing.roles]
            if "administrateur" not in roles:
                db.add(UserRole(user_id=existing.id, role="administrateur"))
                db.commit()
                print("✅  Rôle 'administrateur' ajouté à l'utilisateur existant.")
            else:
                print("   Cet utilisateur est déjà administrateur.")
            return

        # Créer l'utilisateur
        user = User(email=email, hashed_password=hash_password(password))
        db.add(user)
        db.flush()

        db.add(Profile(user_id=user.id, nom=nom, prenom=prenom))
        db.add(UserRole(user_id=user.id, role="administrateur"))

        db.commit()
        print(f"✅  Administrateur créé avec succès !")
        print(f"   Email    : {email}")
        print(f"   Nom      : {prenom} {nom}")
        print(f"   Rôle     : administrateur")
        print(f"\n   Connectez-vous sur : http://localhost:5173/login")

    except Exception as e:
        db.rollback()
        print(f"❌  Erreur : {e}")
        sys.exit(1)
    finally:
        db.close()


def prompt_password() -> str:
    import getpass
    while True:
        pwd = getpass.getpass("Mot de passe : ")
        if len(pwd) < 8:
            print("   Le mot de passe doit contenir au moins 8 caractères.")
            continue
        confirm = getpass.getpass("Confirmer le mot de passe : ")
        if pwd != confirm:
            print("   Les mots de passe ne correspondent pas.")
            continue
        return pwd


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Créer le premier administrateur PersonaHub HR")
    parser.add_argument("--email", help="Email de l'administrateur")
    parser.add_argument("--nom", help="Nom de famille")
    parser.add_argument("--prenom", help="Prénom")
    parser.add_argument("--password", help="Mot de passe (déconseillé en ligne de commande)")
    args = parser.parse_args()

    print("\n=== PersonaHub HR — Création du premier administrateur ===\n")

    email = args.email or input("Email administrateur : ").strip()
    nom = args.nom or input("Nom : ").strip()
    prenom = args.prenom or input("Prénom : ").strip()
    password = args.password or prompt_password()

    create_admin(email=email, password=password, nom=nom, prenom=prenom)
