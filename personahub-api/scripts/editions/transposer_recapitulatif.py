"""
scripts/editions/transposer_recapitulatif.py — Passe une copie du bulletin récapitulatif en « tout paramétrage ».
Auteur : Adil DAIA — 20/10/2026 — RG-EDT-EXERCICE-03

    cd personahub-api
    python scripts/editions/transposer_recapitulatif.py BULLETIN_RECAP_EXERCICE_SOLGES             (essai : rien n'est écrit)
    python scripts/editions/transposer_recapitulatif.py BULLETIN_RECAP_EXERCICE_SOLGES --appliquer

Ce qui était écrit en dur dans la mise en forme passe dans l'onglet Données du modèle :
    * fiche du salarié (nom, matricule, emploi, affectation, catégorie, entrée, CIN / CNSS, mois payés) → Variables ;
    * cartes « … de l'exercice » du pied → corps à cases « Synthèse » (une formule ou une rubrique par carte) ;
    * condition d'impression de la bande Activité → « le corps Activité a une valeur ».
Vos rubriques, libellés, groupes et votre mise en page ne bougent pas.

Travaille sur le BROUILLON du modèle : enregistrez et fermez le designer avant de lancer le script
(il change le jeton du brouillon ; un designer resté ouvert devra être rechargé).
"""
from __future__ import annotations

import copy
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402
from app.editions.definition import Definition  # noqa: E402
from generer_modeles_exemples import transposer_recapitulatif  # noqa: E402

engine.echo = False


def main(code: str, appliquer: bool) -> int:
    db = SessionLocal()
    try:
        m = db.execute(text("SELECT id, code, libelle FROM edt_modele WHERE code = :c"), {"c": code}).mappings().all()
        if len(m) != 1:
            print(f"Modèle {code} : {len(m)} trouvé(s) — vérifiez le code (colonne Code de la bibliothèque)")
            return 1
        m = m[0]
        v = db.execute(text("""SELECT id, numero, statut, definition FROM edt_modele_version
                               WHERE modele_id = :m AND statut IN ('BROUILLON', 'EN_REVUE')
                               ORDER BY numero DESC LIMIT 1"""), {"m": m["id"]}).mappings().first()
        if not v:
            print("Aucun brouillon : ouvrez le modèle dans le designer, cliquez « Modifier », enregistrez, puis relancez.")
            return 1
        avant = v["definition"] if isinstance(v["definition"], dict) else json.loads(v["definition"])
        apres = transposer_recapitulatif(copy.deepcopy(avant))
        Definition.model_validate(apres)                          # structure valide avant d'écrire
        print(f"{m['libelle']} ({m['code']}) — brouillon v{v['numero']}")
        print("  variables ajoutées :", [x["code"] for x in apres.get("variables", [])
                                          if x["code"] not in {y["code"] for y in avant.get("variables", [])}] or "aucune")
        print("  corps ajoutés      :", [c["code"] for c in apres["corps"] if c["code"] not in {x["code"] for x in avant.get("corps", [])}] or "aucun")
        changes = []
        for ba, bp in zip(avant.get("bandes", []), apres.get("bandes", [])):
            if ba.get("condition") != bp.get("condition"):
                changes.append(f"bande {bp['id']} : condition → {bp.get('condition')}")
            for ea, ep in zip(ba.get("elements", []), bp.get("elements", [])):
                if ea.get("valeur") != ep.get("valeur"):
                    changes.append(f"{ep['id']} : {ea.get('valeur')}  →  {ep.get('valeur')}")
        for c in changes:
            print("  ", c[:160])
        if not changes and apres == avant:
            print("  déjà en « tout paramétrage » : rien à faire")
            return 0
        if not appliquer:
            print("\nEssai seulement. Relancez avec --appliquer pour écrire le brouillon.")
            return 0
        db.execute(text("""UPDATE edt_modele_version SET definition = CAST(:d AS jsonb), jeton_concurrence = :j,
                               modifie_le = CURRENT_TIMESTAMP WHERE id = :id"""),
                   {"d": json.dumps(apres, ensure_ascii=False), "j": str(uuid.uuid4()), "id": v["id"]})
        db.execute(text("""INSERT INTO edt_audit (action, objet_type, objet_id, details)
                           VALUES ('TRANSPOSITION_PARAMETRAGE', 'VERSION', :id, CAST(:d AS jsonb))"""),
                   {"id": v["id"], "d": json.dumps({"modele": m["code"], "changements": len(changes)})})
        db.commit()
        print("\nBrouillon mis à jour : rouvrez le modèle dans le designer, vérifiez (Aperçu), puis publiez.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(args[0], "--appliquer" in sys.argv))
