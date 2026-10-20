"""
scripts/editions/actualiser_copie.py — Fait profiter une COPIE d'un modèle livré des évolutions du modèle livré.
Auteur : Adil DAIA — 20/10/2026

    cd personahub-api
    python scripts/editions/actualiser_copie.py ATTESTATION_TRAVAIL_SALAIRE_STD             (essai : rien n'est écrit)
    python scripts/editions/actualiser_copie.py ATTESTATION_TRAVAIL_SALAIRE_STD --appliquer

Le modèle d'origine (copié depuis) décide de la mise à jour :
    attestation de travail et de salaire → date, objet, contenu « travail seulement » (RG-EDT-ATTESTATION-01)
    bulletin récapitulatif de l'exercice → tout paramétrage, sections, synthèse sur rubriques (RG-EDT-EXERCICE-03)
    bulletins (classique, détaillé, moderne, formulaire) → corps « Rubriques » (rubriques du plan de la société,
        rangées en sections) et « Totaux » ; la mise en forme ne lit plus que ces corps (RG-EDT-BULLETIN-CORPS-01)
Vos libellés, rubriques et mise en page ne bougent pas. Travaille sur le BROUILLON : enregistrez et fermez le
designer avant (un brouillon est créé depuis la version publiée s'il n'y en a pas).
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
from app.editions import bulletins as bul  # noqa: E402
from app.editions import catalogue  # noqa: E402
from app.editions.validation import valider  # noqa: E402
from generer_modeles_exemples import completer_attestation, transposer_bulletin, transposer_recapitulatif  # noqa: E402

engine.echo = False
MISES_A_JOUR = {"ATTESTATION_TRAVAIL_SALAIRE": completer_attestation, "BULLETIN_RECAP_EXERCICE": transposer_recapitulatif,
                **{c: transposer_bulletin for c in ("BULLETIN_CLASSIQUE", "BULLETIN_DETAILLE", "BULLETIN_MODERNE",
                                                    "BULLETIN_FORMULAIRE")}}


def origine(db, modele_id) -> str | None:
    vus = set()
    while modele_id and modele_id not in vus:
        vus.add(modele_id)
        r = db.execute(text("SELECT code, est_systeme, modele_origine_id FROM edt_modele WHERE id = :i"), {"i": modele_id}).first()
        if not r:
            return None
        if r[0] in MISES_A_JOUR:
            return r[0]
        modele_id = r[2]
    return None


def main(code: str, appliquer: bool) -> int:
    db = SessionLocal()
    try:
        m = db.execute(text("SELECT id, code, libelle, societe_id FROM edt_modele WHERE code = :c"), {"c": code}).mappings().all()
        if len(m) != 1:
            print(f"Modèle {code} : {len(m)} trouvé(s)")
            return 1
        m = m[0]
        src = origine(db, m["id"])
        if not src:
            print("Ce modèle n'est pas une copie d'un modèle livré qui a une mise à jour (attestation, récapitulatif, bulletins).")
            return 1
        v = db.execute(text("""SELECT id, numero, statut, definition FROM edt_modele_version WHERE modele_id = :m
                               AND statut IN ('BROUILLON', 'EN_REVUE') ORDER BY numero DESC LIMIT 1"""), {"m": m["id"]}).mappings().first()
        nouveau_brouillon = v is None
        if nouveau_brouillon:
            v = db.execute(text("""SELECT id, numero, statut, definition FROM edt_modele_version WHERE modele_id = :m
                                   ORDER BY numero DESC LIMIT 1"""), {"m": m["id"]}).mappings().first()
        avant = v["definition"] if isinstance(v["definition"], dict) else json.loads(v["definition"])
        apres = MISES_A_JOUR[src](copy.deepcopy(avant))
        societe = str(m["societe_id"]) if m["societe_id"] else None
        if src.startswith("BULLETIN_") and src != "BULLETIN_RECAP_EXERCICE":
            apres = bul.garder_rubriques_de(bul.instancier(apres, db), catalogue.charger(db, societe).rubriques)
            nb = next((len(c["affectations"]) for c in apres["corps"] if c["code"] == bul.CORPS_RUBRIQUES), 0)
            print(f"  corps « Rubriques » : {nb} rubrique(s) affectée(s) ; corps « Totaux » : mois, cumul, part du coût")
        Definition.model_validate(apres)
        reste = valider(apres, catalogue.charger(db, societe))
        for e in reste.erreurs[:15]:                       # retouches de la copie à reprendre dans le designer
            print(f"  à reprendre : {e.chemin} — {e.message}")
        print(f"{m['libelle']} ({m['code']}) — copie de {src}")
        if apres == avant:
            print("  déjà à jour : rien à faire")
            return 0
        print("  paramètres ajoutés :", [p["code"] for p in apres["parametres"] if p["code"] not in {x["code"] for x in avant.get("parametres", [])}])
        if not appliquer:
            print("Essai seulement : relancez avec --appliquer.")
            return 0
        if nouveau_brouillon:
            num = db.execute(text("SELECT COALESCE(max(numero), 0) + 1 FROM edt_modele_version WHERE modele_id = :m"), {"m": m["id"]}).scalar()
            db.execute(text("""INSERT INTO edt_modele_version (id, modele_id, numero, statut, definition, schema_version, jeton_concurrence)
                               VALUES (:id, :m, :n, 'BROUILLON', CAST(:d AS jsonb), 1, :j)"""),
                       {"id": str(uuid.uuid4()), "m": m["id"], "n": num, "d": json.dumps(apres, ensure_ascii=False), "j": str(uuid.uuid4())})
            print(f"Brouillon v{num} créé.")
        else:
            db.execute(text("""UPDATE edt_modele_version SET definition = CAST(:d AS jsonb), jeton_concurrence = :j,
                               modifie_le = CURRENT_TIMESTAMP WHERE id = :id"""),
                       {"d": json.dumps(apres, ensure_ascii=False), "j": str(uuid.uuid4()), "id": v["id"]})
            print(f"Brouillon v{v['numero']} mis à jour.")
        db.commit()
        print("Rouvrez le modèle dans le designer, vérifiez (Aperçu), puis publiez.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(args[0], "--appliquer" in sys.argv))
