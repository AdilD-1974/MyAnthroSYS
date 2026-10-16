"""
scripts/test_moteur_paie.py — Test console du moteur de paie.
Auteur : Adil DAIA

Lance un calcul de bulletin pour le collaborateur de démo (ou ceux passés en
argument) et imprime totaux, lignes et trace — SANS le front ni la persistance.

Usage (depuis D:\\SOLGEIS\\personahub-api, venv activé) :
    python scripts/test_moteur_paie.py
    python scripts/test_moteur_paie.py <collaborateur_id> <periode_id>
    python scripts/test_moteur_paie.py --trace     (affiche la trace détaillée)
"""
import sys
from decimal import Decimal
from uuid import UUID

# Permet le lancement direct depuis la racine du backend
sys.path.insert(0, ".")

from sqlalchemy import text                          # noqa: E402
from app.core.database import SessionLocal            # noqa: E402
from app.services.paie_engine import calculer_bulletin  # noqa: E402

# Période de démo (07/2026). Le collaborateur par défaut = Adil DAIA (résolu par nom).
DEMO_PERIODE = "1a4f1dc3-c5b3-4816-ab0a-1d738db84f19"


def resoudre_collaborateur(db) -> str:
    row = db.execute(text("""
        SELECT id FROM public.collaborateurs
         WHERE nom ILIKE 'DAIA' AND prenom ILIKE 'Adil%'
         ORDER BY created_at LIMIT 1
    """)).first()
    if not row:
        raise SystemExit("Collaborateur « Adil DAIA » introuvable — passe un id en argument.")
    return str(row[0])


def money(v) -> str:
    return f"{Decimal(str(v)):>12,.2f}"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_trace = "--trace" in sys.argv
    periode = args[1] if len(args) > 1 else DEMO_PERIODE

    db = SessionLocal()
    try:
        collab = args[0] if len(args) > 0 else resoudre_collaborateur(db)
        res = calculer_bulletin(db, UUID(collab), UUID(periode))
    finally:
        db.close()

    c, p = res["collaborateur"], res["periode"]
    print("=" * 74)
    print(f"  BULLETIN — {c['prenom']} {c['nom']} (matr. {c['matricule']})   période {p['libelle']}")
    print("=" * 74)

    print(f"\n{'RUBRIQUE':<22}{'TYPE':<7}{'BASE':>12}{'NB':>8}{'TAUX':>8}"
          f"{'MONTANT':>13}{'PART PAT.':>13}")
    print("-" * 83)
    for l in res["lignes"]:
        base = f"{Decimal(str(l['base'])):>12,.2f}" if l["base"] is not None else " " * 12
        nb = f"{Decimal(str(l['nombre'])):>8,.2f}" if l["nombre"] is not None else " " * 8
        tx = f"{Decimal(str(l['taux'])):>8,.2f}" if l["taux"] is not None else " " * 8
        pat = f"{Decimal(str(l['montant_patronal'])):>13,.2f}" if l["montant_patronal"] is not None else " " * 13
        print(f"{l['code_rubrique']:<22}{(l['code_type'] or ''):<7}{base}{nb}{tx}"
              f"{Decimal(str(l['montant'])):>13,.2f}{pat}")

    t = res["totaux"]
    print("-" * 83)
    print(f"  Total gains ......... {money(t['total_gains'])}")
    print(f"  Total retenues ...... {money(t['total_retenues'])}")
    print(f"  Cotis. salariales ... {money(t['total_cot_salariale'])}")
    print(f"  Cotis. patronales ... {money(t['total_cot_patronale'])}")
    print(f"  Brut imposable ...... {money(t['total_brut_imposable'])}")
    print(f"  Net imposable ....... {money(t['net_imposable'])}")
    print(f"  NET À PAYER ......... {money(t['net_a_payer'])}")
    print(f"  Coût employeur ...... {money(t['cout_employeur'])}")

    if res["messages"]:
        print("\n  AVERTISSEMENTS :")
        for m in res["messages"]:
            print(f"    • {m}")

    if show_trace:
        print("\n" + "=" * 74)
        print("  TRACE DÉTAILLÉE")
        print("=" * 74)
        for e in res["trace"]:
            r = e["resultat"]
            print(f"\n[{e['rubrique']}] {e['libelle']}  ({e['type']}/{e['type_regle']})"
                  f"  → MT={r['MT']}  NB={r['NB']}  TY={r['TY']}"
                  + (f"  PAT={r['MT_PAT']}" if r.get("MT_PAT") else ""))
            for d in e["detail"]:
                if d:
                    print(f"    · {d}")
            for a in e["avert"]:
                print(f"    ⚠ {a}")

    print()


if __name__ == "__main__":
    main()
