"""
scripts/test_moteur_pret_standalone.py

Test autonome du moteur d'amortissement (app/services/pret_engine.py), sans
passer par pytest/conftest.py — utile tant que le bug préexistant sur
ref_organisme_social (app/models/cotisation.py) bloque
Base.metadata.create_all() dans conftest.py.

Lancer avec : python scripts\\test_moteur_pret_standalone.py
"""
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.pret_engine import TrancheMensualite, generer_echeancier  # noqa: E402

erreurs = []


def verifier(nom, condition):
    statut = "OK" if condition else "ECHEC"
    print(f"[{statut}] {nom}")
    if not condition:
        erreurs.append(nom)


for algo in ["lineaire", "french_amortissement", "in_fine"]:
    r = generer_echeancier(Decimal("30000"), Decimal("6"), 12, algo, date(2026, 8, 1))
    verifier(f"{algo} : capital soldé à 0", r.echeancier[-1].capital_restant == Decimal("0.00"))
    verifier(f"{algo} : somme capital = montant emprunté", sum(e.mt_capital for e in r.echeancier) == Decimal("30000.00"))

r0 = generer_echeancier(Decimal("6000"), Decimal("0"), 6, "lineaire", date(2026, 8, 1))
verifier("taux 0% : aucun intérêt", r0.cout_total_interets == Decimal("0.00"))

rb = generer_echeancier(Decimal("3000"), Decimal("0"), 6, "lineaire", date(2026, 11, 1), borner_fin_annee_civile=True)
verifier("bornage fin année civile : durée réduite", rb.nb_echeance_retenu < 6)
verifier("bornage fin année civile : dernière échéance dans l'année", rb.echeancier[-1].date_echeance.year == 2026)

tranches = [
    TrancheMensualite(1, Decimal("500"), date(2026, 8, 1), date(2027, 1, 1)),
    TrancheMensualite(2, Decimal("800"), date(2027, 2, 1), None),
]
rt = generer_echeancier(Decimal("10000"), Decimal("4"), 20, "lineaire", date(2026, 8, 1), tranches=tranches)
verifier("tranches : capital soldé à 0", rt.echeancier[-1].capital_restant == Decimal("0.00"))

print()
if erreurs:
    print(f"{len(erreurs)} test(s) en échec : {erreurs}")
    sys.exit(1)
else:
    print("Tous les tests sont passés.")
    sys.exit(0)
