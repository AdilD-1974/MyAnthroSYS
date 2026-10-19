"""
scripts/editions/diagnostic_edition.py — Ce que voit une édition pour un mois de paie (lecture seule).
Auteur : Adil DAIA — 19/10/2026

    cd personahub-api
    python scripts/editions/diagnostic_edition.py 2025 12

Affiche, pour chaque société : les périodes du mois, les bulletins en base (en cours, historisés,
temporaires), leur situation figée au calcul (UO, catégorie, classification), la qualification
actuelle du salarié dans la fiche RH, puis les bulletins réellement lus par l'édition.
Aucune écriture, aucun mot de passe affiché. Copier toute la sortie dans la conversation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402

engine.echo = False                                     # sortie lisible : pas de trace SQL


def snap(d):
    if d is None:
        return {}
    return json.loads(d) if isinstance(d, str) else d


def main(annee: int, mois: int) -> None:
    db = SessionLocal()
    try:
        db.execute(text("SET TRANSACTION READ ONLY"))
        periodes = db.execute(text("""
            SELECT cal.id, cal.societe_id, s.raison_sociale, cal.intitule, cal.statut, cal.date_debut, cal.date_fin,
                   p.code AS plan
            FROM calendrier_paie cal LEFT JOIN plan_paie p ON p.id = cal.plan_paie_id
            LEFT JOIN societes s ON s.id = cal.societe_id
            WHERE cal.annee = :a AND cal.mois = :m ORDER BY s.raison_sociale, p.code"""), {"a": annee, "m": mois}).mappings().all()
        print(f"=== Périodes {mois:02d}/{annee} : {len(periodes)}")
        for p in periodes:
            print(f"  {p['raison_sociale']} | {p['plan']} | {p['intitule']} | statut={p['statut']} | {p['date_debut']} → {p['date_fin']} | id={p['id']}")
        ids = [str(p["id"]) for p in periodes]
        if not ids:
            return
        print("\n=== Bulletins de ces périodes")
        for table in ("bulletin", "bulletin_historique", "bulletin_temp"):
            try:
                rows = db.execute(text(f"""
                    SELECT b.id, b.periode_id, b.collaborateur_id, b.matricule, b.statut, b.total_brut, b.net_a_payer,
                           (SELECT donnees FROM bulletin_snapshot_collaborateur s WHERE s.bulletin_id = b.id) AS snap,
                           EXISTS (SELECT 1 FROM bulletin l WHERE l.id = b.id) AS aussi_live
                    FROM {table} b WHERE CAST(b.periode_id AS text) = ANY(:ids) ORDER BY b.matricule"""),
                    {"ids": ids}).mappings().all()
            except Exception as e:                                   # table absente
                db.rollback()
                db.execute(text("SET TRANSACTION READ ONLY"))
                print(f"  [{table}] lecture impossible : {str(e).splitlines()[0][:120]}")
                continue
            print(f"  [{table}] {len(rows)} bulletin(s)")
            for r in rows:
                s = snap(r["snap"])
                q, a = s.get("qualification") or {}, s.get("affectation") or {}
                print(f"    {r['matricule']} | statut={r['statut']} | brut={r['total_brut']} | net={r['net_a_payer']}"
                      f" | periode={str(r['periode_id'])[:8]} | snapshot={'oui' if s else 'NON'}"
                      f"{' | aussi en cours' if table != 'bulletin' and r['aussi_live'] else ''}")
                if s:
                    print(f"       figé : UO={a.get('organisation_id')} ({a.get('organisation_libelle')})"
                          f" | cat. pro={q.get('code_categorie_professionnelle')} | catégorie={q.get('code_categorie')}"
                          f" | classification={q.get('code_classification')} | qualif. du {q.get('date_evolution')}")
                try:
                    with db.begin_nested():
                        quals = db.execute(text("""
                            SELECT date_evolution, code_categorie_professionnelle, code_categorie, code_classification, archive
                            FROM collaborateur_qualifications WHERE collaborateur_id = :c ORDER BY date_evolution"""),
                            {"c": r["collaborateur_id"]}).mappings().all()
                except Exception as e:
                    print(f"       fiche RH : lecture impossible ({str(e).splitlines()[0][:80]})")
                    continue
                for qq in quals:
                    print(f"       fiche RH : qualif. du {qq['date_evolution']} | cat. pro={qq['code_categorie_professionnelle']}"
                          f" | catégorie={qq['code_categorie']} | classification={qq['code_classification']}"
                          f"{' | ARCHIVÉE' if qq['archive'] else ''}")
                if not quals:
                    print("       fiche RH : aucune qualification")
        try:
            refs = db.execute(text("SELECT code, libelle FROM ref_categorie_professionnelle ORDER BY code")).mappings().all()
            liste = ", ".join("%s=%s" % (x["code"], x["libelle"]) for x in refs) or "vide"
            print(f"\n=== ref_categorie_professionnelle : {liste}")
        except Exception as e:
            db.rollback()
            print(f"\n=== ref_categorie_professionnelle : lecture impossible ({str(e).splitlines()[0][:100]})")

        # derniers lancements : paramètres réellement envoyés par l'écran
        print("\n=== 8 derniers lancements d'éditions")
        try:
            with db.begin_nested():
                for d in db.execute(text("""
                        SELECT dm.cree_le, m.code, v.numero, dm.origine, dm.nb_documents, dm.statut, dm.parametres
                        FROM edt_demande dm JOIN edt_modele_version v ON v.id = dm.version_id
                        JOIN edt_modele m ON m.id = v.modele_id ORDER BY dm.cree_le DESC LIMIT 8""")).mappings():
                    params = {k: x for k, x in (snap(d["parametres"]) or {}).items() if not str(k).startswith("_modele")}
                    print(f"  {str(d['cree_le'])[:19]} | {d['code']} v{d['numero']} | {d['origine']} | {d['statut']}"
                          f" | {d['nb_documents']} doc(s) | {json.dumps(params, ensure_ascii=False, default=str)[:300]}")
        except Exception as e:
            print(f"  lecture impossible ({str(e).splitlines()[0][:100]})")

        # ce que lit réellement l'édition (même code que le moteur)
        from app.editions.moteur.executeur import mois_de_paie
        from app.editions.sources.base import ContexteSecurite
        from app.editions.sources.paie import FournisseurBulletin
        print("\n=== Lu par les éditions (mois de paie)")
        for societe in sorted({str(p["societe_id"]) for p in periodes}):
            sec = ContexteSecurite(None, societe, frozenset(), True)
            try:
                m = mois_de_paie(db, f"{annee}-{mois:02d}", sec)
                lignes = FournisseurBulletin().lire(db, {"periode": m}, sec)
                print(f"  société {societe[:8]} : {m['nb_periodes']} période(s), {len(lignes)} bulletin(s) lus")
                for l in lignes:
                    q, a = l.get("qualification") or {}, l.get("affectation") or {}
                    print(f"    {l.get('matricule')} | brut={l.get('total_brut')} | UO 1er niveau={a.get('uo_niveau1_libelle')}"
                          f" | catégorie lue={q.get('categorie_professionnelle_libelle')}"
                          f" | complété depuis la fiche RH : {(l.get('situation') or {}).get('completee') or 'non'}")
            except Exception as e:
                db.rollback()
                print(f"  société {societe[:8]} : ERREUR {type(e).__name__} : {e}")
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage : python scripts/editions/diagnostic_edition.py ANNEE MOIS   (ex. 2025 12)")
        sys.exit(1)
    main(int(sys.argv[1]), int(sys.argv[2]))
