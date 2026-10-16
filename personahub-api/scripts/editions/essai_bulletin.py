"""
scripts/editions/essai_bulletin.py — Produit les bulletins d'une période avec le NOUVEAU moteur.
Auteur : Adil DAIA — lot 1, porte de sortie (16/10/2026)

LECTURE SEULE : aucune écriture en base. Les PDF sont déposés dans un dossier
local pour comparaison visuelle avec l'édition actuelle.

Depuis D:\\SOLGEIS\\personahub-api, venv312 activé :
    python scripts/editions/essai_bulletin.py                     → liste les sociétés et périodes
    python scripts/editions/essai_bulletin.py --societe <id> --periode <id>
    python scripts/editions/essai_bulletin.py --societe <id> --periode <id> --sans-donnees-sensibles

Contrôle automatique : pour chaque bulletin, le net imprimé doit être celui de
la base (colonne net_a_payer). Tout écart est signalé.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from decimal import Decimal
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE))

from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.editions.definition import Definition  # noqa: E402
from app.editions.moteur.executeur import executer  # noqa: E402
from app.editions.sources import REGISTRE, ContexteSecurite  # noqa: E402


def lister(db):
    print("\nSociétés et périodes ayant des bulletins définitifs :\n")
    rows = db.execute(text("""
        SELECT s.id AS societe_id, s.raison_sociale, cal.id AS periode_id, cal.intitule, cal.annee, cal.mois,
               (SELECT count(*) FROM bulletin b WHERE b.periode_id = cal.id)
             + (SELECT count(*) FROM bulletin_historique h WHERE h.periode_id = cal.id
                AND NOT EXISTS (SELECT 1 FROM bulletin b2 WHERE b2.id = h.id)) AS nb
        FROM calendrier_paie cal JOIN societes s ON s.id = cal.societe_id
        ORDER BY s.raison_sociale, cal.annee DESC, cal.mois DESC""")).mappings().all()
    for r in rows:
        if r["nb"]:
            print(f"  {r['raison_sociale'][:28]:<28} société {r['societe_id']}  "
                  f"période {r['periode_id']}  {r['intitule'] or ''} ({r['annee']}-{r['mois']:02d}) : {r['nb']} bulletin(s)")


def ecrire(chemin: Path, contenu: bytes) -> Path:
    """Un PDF resté ouvert dans la visionneuse est verrouillé sous Windows :
    on écrit alors une copie horodatée au lieu de s'arrêter."""
    try:
        chemin.write_bytes(contenu)
        return chemin
    except PermissionError:
        autre = chemin.with_name(f"{chemin.stem}_{time.strftime('%H%M%S')}{chemin.suffix}")
        autre.write_bytes(contenu)
        print(f"        ({chemin.name} est ouvert ailleurs : copie écrite sous {autre.name})")
        return autre


def main():
    ap = argparse.ArgumentParser(description="Bulletins d'une période avec le nouveau moteur d'éditions")
    ap.add_argument("--societe")
    ap.add_argument("--periode")
    ap.add_argument("--modele", default=str(RACINE / "app/editions/modeles_systeme/bulletin_classique.json"))
    ap.add_argument("--sortie", default=str(RACINE / "storage/editions_essai"))
    ap.add_argument("--sans-donnees-sensibles", action="store_true")
    a = ap.parse_args()

    db = SessionLocal()
    cible = db.get_bind().url.render_as_string(hide_password=True)
    print(f"Base : {cible}")
    try:
        db.execute(text("SELECT 1"))
    except UnicodeDecodeError:
        # psycopg2 sous Windows : le message d'erreur du serveur, en français
        # (Latin-1), ne se décode pas — le vrai motif est masqué.
        print("\nConnexion refusée par PostgreSQL (message illisible sous Windows).\n"
              "Causes habituelles : mot de passe, nom de base ou serveur arrêté.\n"
              "Lancer le script avec la même DATABASE_URL que l'API, par exemple :\n"
              '  $env:DATABASE_URL = "postgresql://postgres:<mot de passe>@localhost:5432/<base>"')
        return
    try:
        if not (a.societe and a.periode):
            lister(db)
            print("\nRelancer avec --societe <id> --periode <id>.")
            return
        d = Definition.model_validate(json.loads(Path(a.modele).read_text(encoding="utf-8")))
        sec = ContexteSecurite(None, a.societe, donnees_sensibles=not a.sans_donnees_sensibles)
        debut = time.perf_counter()
        docs = executer(db, d, {"periode": a.periode}, sec, racine_fichiers=str(RACINE / "storage"))
        duree = time.perf_counter() - debut

        sortie = Path(a.sortie) / a.periode
        sortie.mkdir(parents=True, exist_ok=True)
        nets = {str(l["collaborateur_id"]): l["net_a_payer"]
                for l in REGISTRE["BULLETIN"].lire(db, {"periode": a.periode}, sec)}
        from pypdf import PdfReader
        ecarts = 0
        for doc in docs:
            ecrire(sortie / doc.nom_fichier, doc.contenu)
            texte = "".join(p.extract_text() for p in PdfReader(io.BytesIO(doc.contenu)).pages)
            imprime = re.search(r"([\d ]+,\d\d) DH", texte)
            attendu = nets.get(doc.cle_objet)
            ok = imprime and attendu is not None and \
                Decimal(imprime.group(1).replace(" ", "").replace(",", ".")) == Decimal(str(attendu)).quantize(Decimal("0.01"))
            ecarts += 0 if ok else 1
            anomalies = f"  anomalies : {[(x.source_id, x.message) for x in doc.anomalies]}" if doc.anomalies else ""
            print(f"  {'OK   ' if ok else 'ÉCART'} {doc.nom_fichier:<40} {doc.nb_pages} page(s)  "
                  f"net imprimé {imprime.group(1) if imprime else '?':>12}  base {attendu}{anomalies}")
        print(f"\n{len(docs)} bulletin(s) en {duree:.2f} s ({duree / max(len(docs), 1) * 1000:.0f} ms par bulletin)"
              f" — {ecarts} écart(s) — PDF dans {sortie}")
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
