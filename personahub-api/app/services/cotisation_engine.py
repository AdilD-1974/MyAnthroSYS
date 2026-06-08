"""
app/services/cotisation_engine.py — Moteur de calcul des cotisations
Auteur : Adil DAIA

Algorithme de calcul d'une cotisation pour un collaborateur sur une période :

  1. Charger la règle + composantes + modalités
  2. Vérifier que le collaborateur est affecté au régime de la règle
  3. Appliquer les options sur l'assiette :
        - Si négative et non acceptée → erreur
        - Si négative et "ramener à zéro" → assiette = 0
        - Si prorata_temporis activé → assiette × jours_presents / jours_du_mois
  4. Pour chaque composante :
        - base = min(assiette, plafond_mensuel)
        - taux_sal/pat = composante.taux_salarial/patronal
        - montant_sal = base × taux_sal / 100
        - montant_pat = base × taux_pat / 100
  5. Sommer les composantes
  6. Appliquer min/max sur les totaux

Limitations V1 :
  - Le mode "CUMUL" et "GLISSANT" ne sont pas encore implémentés (V2)
  - Le barème de taux n'est pas encore appliqué (V2 — utilisera les tranches du barème
    au lieu des taux fixes)
  - Le calcul utilise les taux fixes des composantes uniquement
"""
from decimal import Decimal
from datetime import date
from uuid import UUID
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select
from fastapi import HTTPException

from app.models.cotisation import (
    RegleCalculCotisation,
    RegleCalculCotisationComposante,
    CollaborateurRegime,
)
from app.schemas.cotisation import (
    CotisationCalculRequest,
    CotisationCalculResult,
    CotisationComposanteResult,
)


D0 = Decimal("0")
D100 = Decimal("100")


def calculer_cotisation(
    db: Session,
    req: CotisationCalculRequest,
) -> CotisationCalculResult:
    """
    Calcule une cotisation pour un collaborateur sur une période donnée.
    Lève HTTPException 404 si la règle ou l'affectation est introuvable.
    """
    # ── 1. Charger la règle avec ses composantes ─────────────────────────
    regle: RegleCalculCotisation | None = (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(
            RegleCalculCotisation.code == req.code_regle,
            RegleCalculCotisation.archive == False,  # noqa: E712
            RegleCalculCotisation.actif == True,     # noqa: E712
        )
        .first()
    )
    if not regle:
        raise HTTPException(404, f"Règle de cotisation '{req.code_regle}' introuvable ou inactive")

    avertissements: list[str] = []
    composantes_actives = [c for c in regle.composantes if c.actif]
    if not composantes_actives:
        raise HTTPException(400, f"La règle '{regle.code}' n'a aucune composante active")

    # ── 2. Vérifier l'affectation collaborateur ↔ régime ─────────────────
    if regle.code_regime:
        affectation = (
            db.query(CollaborateurRegime)
            .filter(
                CollaborateurRegime.collaborateur_id == req.collaborateur_id,
                CollaborateurRegime.code_regime == regle.code_regime,
                CollaborateurRegime.actif == True,  # noqa: E712
            )
            .first()
        )
        if not affectation:
            raise HTTPException(
                404,
                f"Le collaborateur n'est pas affecté au régime '{regle.code_regime}' "
                f"requis par la règle '{regle.code}'",
            )

        # Période hors validité de l'affectation ?
        if affectation.date_radiation and req.periode_mois > affectation.date_radiation:
            avertissements.append(
                f"L'affectation au régime {regle.code_regime} est radiée depuis "
                f"le {affectation.date_radiation.isoformat()}"
            )

    # ── 3. Appliquer les options sur l'assiette ──────────────────────────
    assiette_initiale = Decimal(str(req.assiette_montant))
    assiette = assiette_initiale

    if assiette < D0:
        if regle.assiette_negative_ramenee_zero:
            avertissements.append(f"Assiette négative ({assiette}) ramenée à zéro")
            assiette = D0
        elif not regle.assiette_negative_acceptee:
            raise HTTPException(
                400,
                f"Assiette négative ({assiette}) refusée par la règle '{regle.code}'. "
                f"Activez 'assiette négative acceptée' ou 'ramenée à zéro'.",
            )

    if regle.prorata_temporis and req.jours_presents is not None and req.jours_du_mois > 0:
        ratio = Decimal(req.jours_presents) / Decimal(req.jours_du_mois)
        assiette_proratisee = (assiette * ratio).quantize(Decimal("0.01"))
        avertissements.append(
            f"Prorata temporis appliqué : {req.jours_presents}/{req.jours_du_mois} "
            f"→ assiette {assiette} × {ratio:.4f} = {assiette_proratisee}"
        )
        assiette = assiette_proratisee

    # ── 4. Calculer chaque composante ────────────────────────────────────
    if regle.code_bareme_taux:
        avertissements.append(
            f"Barème '{regle.code_bareme_taux}' défini mais l'application "
            f"par tranches n'est pas encore implémentée (V2). Taux fixes utilisés."
        )

    composantes_calc: list[CotisationComposanteResult] = []
    total_sal = D0
    total_pat = D0

    for compo in composantes_actives:
        # Plafonner si plafond défini
        if compo.plafond_mensuel is not None:
            base = min(assiette, Decimal(str(compo.plafond_mensuel)))
        else:
            base = assiette

        taux_sal = Decimal(str(compo.taux_salarial)) if compo.taux_salarial is not None else D0
        taux_pat = Decimal(str(compo.taux_patronal)) if compo.taux_patronal is not None else D0

        montant_sal = (base * taux_sal / D100).quantize(Decimal("0.01"))
        montant_pat = (base * taux_pat / D100).quantize(Decimal("0.01"))

        total_sal += montant_sal
        total_pat += montant_pat

        composantes_calc.append(
            CotisationComposanteResult(
                code=compo.code,
                libelle=compo.libelle,
                base_appliquee=base,
                plafond_applique=Decimal(str(compo.plafond_mensuel)) if compo.plafond_mensuel else None,
                taux_salarial=taux_sal if taux_sal != D0 else None,
                taux_patronal=taux_pat if taux_pat != D0 else None,
                montant_salarial=montant_sal,
                montant_patronal=montant_pat,
                code_rubrique_part_salariale=compo.code_rubrique_part_salariale,
                code_rubrique_part_patronale=compo.code_rubrique_part_patronale,
            )
        )

    # ── 5. Appliquer min/max ─────────────────────────────────────────────
    minimum_applique = False
    maximum_applique = False

    if regle.minimum_salarial is not None and total_sal < Decimal(str(regle.minimum_salarial)):
        avertissements.append(f"Total salarial {total_sal} ramené au minimum {regle.minimum_salarial}")
        total_sal = Decimal(str(regle.minimum_salarial))
        minimum_applique = True

    if regle.maximum_salarial is not None and total_sal > Decimal(str(regle.maximum_salarial)):
        avertissements.append(f"Total salarial {total_sal} plafonné au maximum {regle.maximum_salarial}")
        total_sal = Decimal(str(regle.maximum_salarial))
        maximum_applique = True

    if regle.minimum_patronal is not None and total_pat < Decimal(str(regle.minimum_patronal)):
        avertissements.append(f"Total patronal {total_pat} ramené au minimum {regle.minimum_patronal}")
        total_pat = Decimal(str(regle.minimum_patronal))
        minimum_applique = True

    if regle.maximum_patronal is not None and total_pat > Decimal(str(regle.maximum_patronal)):
        avertissements.append(f"Total patronal {total_pat} plafonné au maximum {regle.maximum_patronal}")
        total_pat = Decimal(str(regle.maximum_patronal))
        maximum_applique = True

    # ── 6. Renvoyer le résultat ──────────────────────────────────────────
    return CotisationCalculResult(
        code_regle=regle.code,
        libelle_regle=regle.libelle,
        code_regime=regle.code_regime,
        mode_calcul=regle.mode_calcul,
        assiette_initiale=assiette_initiale,
        assiette_apres_options=assiette,
        composantes=composantes_calc,
        total_salarial=total_sal,
        total_patronal=total_pat,
        minimum_applique=minimum_applique,
        maximum_applique=maximum_applique,
        avertissements=avertissements,
    )
