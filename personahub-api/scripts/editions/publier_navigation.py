"""
scripts/editions/publier_navigation.py — Publie le menu d'éditions dans la navigation (RG-EDT-NAV-05).
Auteur : Adil DAIA — 20/10/2026

    cd personahub-api
    python scripts/editions/publier_navigation.py              (essai : affiche ce qui serait créé, n'écrit rien)
    python scripts/editions/publier_navigation.py --appliquer  (écrit)

Pour chaque société : dossiers et états du menu « Éditions de la paie » → sous-menus de l'écran
« Éditions de la paie » dans Configuration › Navigation, avec ses rôles. Sans effet sur ce qui existe déjà
(libellés mis à jour). Affiche l'erreur exacte si la publication échoue.
"""
from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402
from app.editions import navigation as nav  # noqa: E402
from app.editions import service as sv  # noqa: E402
from app.editions import themes as th  # noqa: E402

engine.echo = False


def main(appliquer: bool) -> int:
    db = SessionLocal()
    try:
        if not nav.disponible(db):
            print("Tables nav_menu_item / nav_role_visibilite absentes : rien à faire.")
            return 1
        ref = nav._repere(db)
        print("Écran repère :", ref and db.execute(text("SELECT code, label, chemin FROM nav_menu_item WHERE id = :i"),
                                                    {"i": ref["id"]}).one())
        print("Rôles du repère :", nav._roles(db, ref["id"]) if ref else "—")
        societes = db.execute(text("SELECT id, raison_sociale FROM societes ORDER BY raison_sociale")).all()
        for sid, nom in societes:
            u = sv.Utilisateur(None, str(sid), frozenset({"administrateur"}))
            try:
                with db.begin_nested():
                    a = th.arbre(db, u, "PAIE")
                    bilan = nav.synchroniser(db, a, avec_etats=True)
                print(f"{nom} : {len(a['themes'])} dossier(s), {sum(len(t['modeles']) for t in a['themes'])} état(s) → {bilan}")
            except Exception:
                print(f"{nom} : ÉCHEC")
                traceback.print_exc()
        lignes = db.execute(text("""SELECT i.label, p.label FROM nav_menu_item i LEFT JOIN nav_menu_item p ON p.id = i.parent_id
                                    WHERE i.code LIKE 'edt\\_%' ORDER BY p.label, i.ordre""")).all()
        print(f"\n{len(lignes)} écran(s) d'éditions dans la navigation :")
        for l, p in lignes[:60]:
            print(f"  {p or '(racine)'} › {l}")
        if appliquer:
            db.commit()
            print("\nÉcrit. Rechargez Configuration › Navigation et dépliez « Éditions de la paie ».")
        else:
            db.rollback()
            print("\nEssai seulement : relancez avec --appliquer pour écrire.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main("--appliquer" in sys.argv))
