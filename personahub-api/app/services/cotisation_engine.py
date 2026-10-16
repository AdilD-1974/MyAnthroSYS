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
        - Si regle.code_bareme_taux est renseigné ET que l'affectation du
          collaborateur porte une valeur_bareme_taux : le taux salarial/patronal
          est résolu via le barème (mode EXACT), au lieu des taux fixes de la
          composante — cas CIMR (taux choisi librement par le collaborateur).
        - Sinon : taux_sal/pat = composante.taux_salarial/patronal (comportement
          historique, inchangé pour CNSS/AMO/IR).
        - montant_sal = base × taux_sal / 100
        - montant_pat = base × taux_pat / 100
  5. Sommer les composantes
  6. Appliquer min/max sur les totaux

Limitations :
  - Le mode "CUMUL" et "GLISSANT" ne sont pas encore implémentés (V2)
  - La résolution de barème ne gère que le mode EXACT (clé unique, valeur
    exacte) — le mode PLAGE (tranches, ex. IGR/PANC) n'est pas utilisé ici,
    c'est un cas d'usage différent (choix discret vs interpolation par tranche)
"""
from decimal import Decimal
from datetime import date
from types import SimpleNamespace
from uuid import UUID
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select, text
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


def _appliquer_surcharge_taux(taux_sal: Decimal, taux_pat: Decimal, surcharge: dict) -> tuple[Decimal, Decimal]:
    """
    RG-SIM-COTISATION-01 (module Simulation, proposition — à valider) :
    applique une surcharge de taux à un couple (taux_salarial, taux_patronal)
    déjà résolu (fixe OU via barème, peu importe la source). Jamais appelée
    en calcul réel (`surcharge_taux` vaut toujours None hors simulation).

    `mode` :
      - FORCAGE : remplace le taux par la valeur donnée ;
      - AJOUT (défaut) : ajoute la valeur EN POINTS (ex. +0.5 pour passer
        de 6,4 % à 6,9 %) ;
      - POURCENTAGE : augmente le taux actuel de X % de lui-même (ex. +10 %
        sur 6,4 % → 7,04 %) — distinct d'AJOUT, qui ajoute des points bruts.

    `taux_salarial`/`taux_patronal` à None dans la surcharge = ce taux n'est
    pas modifié (l'autre peut l'être indépendamment).
    """
    mode = (surcharge.get("mode") or "AJOUT").upper()

    def resoudre(taux_actuel: Decimal, valeur) -> Decimal:
        if valeur is None:
            return taux_actuel
        valeur = Decimal(str(valeur))
        if mode == "FORCAGE":
            return valeur
        if mode == "POURCENTAGE":
            return taux_actuel + (taux_actuel * valeur / D100)
        return taux_actuel + valeur  # AJOUT — points de pourcentage

    return (
        resoudre(taux_sal, surcharge.get("taux_salarial")),
        resoudre(taux_pat, surcharge.get("taux_patronal")),
    )


def _resoudre_taux_bareme_exact(
    db: Session,
    code_bareme: str,
    nom_technique_cle: str,
    valeur_cle: Decimal,
    societe_id: str | None = None,
) -> tuple[Decimal, Decimal] | None:
    """
    Résout (taux_salarial, taux_patronal) depuis un barème en mode EXACT
    (bareme_cle.mode = 'EXACT') : recherche la ligne dont valeurs_cles[nom_technique_cle]
    correspond exactement à valeur_cle, puis lit taux_salarial/taux_patronal dans
    valeurs_sorties (JSONB).

    RG-MULTISOCIETE-03 (migration 057) : `societe_id` optionnel -- bareme.
    societe_id est nullable (générique si NULL, surcharge si renseigné,
    même principe que ContexteCalcul._charger()). Bug corrigé : sans ce
    filtre, un barème surchargé par une société (ex. taux CIMR différent)
    pouvait remonter une ligne arbitraire (LIMIT 1 sans priorité société),
    au lieu de systématiquement préférer la ligne spécifique à la société
    active quand elle existe. `societe_id=None` (par défaut) ne remonte
    QUE les barèmes génériques -- identique au comportement d'avant
    migration 057, aucune régression pour les appelants pas encore mis
    à jour vers le paramètre société.

    Retourne None si le barème, la clé EXACT ou la ligne correspondante sont
    introuvables — l'appelant décide alors du repli (taux fixes + avertissement).
    """
    row = db.execute(
        text(
            """
            SELECT bl.valeurs_sorties
            FROM bareme b
            JOIN bareme_cle bc
              ON bc.bareme_id = b.id
             AND bc.nom_technique = :nom_technique_cle
             AND bc.mode = 'EXACT'
            JOIN bareme_ligne bl
              ON bl.bareme_id = b.id
             AND (bl.valeurs_cles ->> :nom_technique_cle)::numeric = :valeur_cle
            WHERE b.code = :code_bareme
              AND b.actif = true
              AND b.archive = false
              AND (b.societe_id IS NULL OR b.societe_id = :societe_id)
            ORDER BY (b.societe_id IS NULL) ASC
            LIMIT 1
            """
        ),
        {
            "code_bareme": code_bareme,
            "nom_technique_cle": nom_technique_cle,
            "valeur_cle": valeur_cle,
            "societe_id": societe_id,
        },
    ).first()

    if not row:
        return None

    sorties = row[0]  # déjà un dict (colonne JSONB)
    taux_sal = Decimal(str(sorties.get("taux_salarial", 0)))
    taux_pat = Decimal(str(sorties.get("taux_patronal", 0)))
    return taux_sal, taux_pat


def calculer_cotisation(
    db: Session,
    req: CotisationCalculRequest,
    surcharge_taux: dict | None = None,
    forcer_affectation: bool = False,
    valeur_bareme_taux_simulee: Decimal | None = None,
    societe_id: str | None = None,
) -> CotisationCalculResult:
    """
    Calcule une cotisation pour un collaborateur sur une période donnée.
    Lève HTTPException 404 si la règle ou l'affectation est introuvable.

    Les trois derniers paramètres sont réservés au module Simulation
    (RG-SIM-COTISATION-*, proposition — sans effet, donc sans risque de
    régression, tant qu'ils ne sont pas fournis ; aucun appel réel existant
    ne les utilise) :
      • `surcharge_taux` : {"mode": "AJOUT"|"FORCAGE"|"POURCENTAGE",
        "taux_salarial": Decimal|None, "taux_patronal": Decimal|None} —
        appliquée après résolution normale du taux (fixe ou barème), sur
        CHAQUE composante active de la règle. Voir _appliquer_surcharge_taux.
      • `forcer_affectation=True` : si le collaborateur n'est PAS affecté au
        régime requis, ne lève plus 404 — simule une affectation pour ce
        calcul uniquement (AUCUNE écriture en base), avec un avertissement
        explicite dans la réponse. Permet de simuler « et si ce collaborateur
        était affilié à ce régime ? » sans créer réellement l'affiliation.
      • `valeur_bareme_taux_simulee` : utilisée UNIQUEMENT si
        `forcer_affectation=True` ET que la règle a un `code_bareme_taux`
        (régime à taux choisi, ex. CIMR) — remplace la valeur que
        l'affectation réelle aurait portée (`valeur_bareme_taux`), puisqu'une
        affectation simulée n'en a pas. Sans effet sinon.

    RG-MULTISOCIETE-03 (migration 057/059) : `societe_id` optionnel, transmis
    à `_resoudre_taux_bareme_exact` ET désormais aussi utilisé pour charger
    la règle elle-même (regle_calcul_cotisation.societe_id, migration 059) —
    priorité société spécifique > générique dans les deux cas. Fil bouclé
    depuis `paie_engine.py` (`ctx.societe_id` propagé à l'appel réel de calcul
    de paie) : None (par défaut) = comportement générique uniquement, pour
    les appelants pas encore mis à jour.
    """
    # ── 1. Charger la règle avec ses composantes ─────────────────────────
    # RG-MULTISOCIETE-03 (migration 059) : regle_calcul_cotisation.societe_id
    # (nullable, générique/surcharge — même principe que ContexteCalcul._charger()).
    # Requête d'abord en SQL brut pour appliquer la priorité "spécifique
    # société active > générique" (RG-03), PUIS rechargement ORM par id pour
    # bénéficier de selectinload(composantes) — évite de devoir ajouter
    # societe_id au modèle ORM RegleCalculCotisation (app/models/cotisation.py,
    # non fourni) juste pour ce filtre.
    if societe_id:
        id_regle_gagnante = db.execute(text("""
            SELECT id FROM regle_calcul_cotisation
             WHERE code = :code AND archive = false AND actif = true
               AND (societe_id IS NULL OR societe_id = :societe_id)
             ORDER BY (societe_id IS NULL) ASC
             LIMIT 1
        """), {"code": req.code_regle, "societe_id": societe_id}).scalar()
    else:
        # Comportement identique à avant migration 059 : générique uniquement.
        id_regle_gagnante = db.execute(text("""
            SELECT id FROM regle_calcul_cotisation
             WHERE code = :code AND archive = false AND actif = true
               AND societe_id IS NULL
             LIMIT 1
        """), {"code": req.code_regle}).scalar()

    regle: RegleCalculCotisation | None = (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(RegleCalculCotisation.id == id_regle_gagnante)
        .first()
    ) if id_regle_gagnante else None
    if not regle:
        raise HTTPException(404, f"Règle de cotisation '{req.code_regle}' introuvable ou inactive")

    avertissements: list[str] = []
    composantes_actives = [c for c in regle.composantes if c.actif]
    if not composantes_actives:
        raise HTTPException(400, f"La règle '{regle.code}' n'a aucune composante active")

    # ── 2. Vérifier l'affectation collaborateur ↔ régime ─────────────────
    affectation: CollaborateurRegime | None = None
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
            if forcer_affectation:
                # RG-SIM-COTISATION-01 : affectation SIMULÉE, pour ce calcul
                # uniquement — aucune ligne écrite dans collaborateur_regime.
                # SimpleNamespace plutôt qu'une instance CollaborateurRegime :
                # seuls date_radiation et valeur_bareme_taux sont lus plus
                # bas, pas besoin (et pas souhaitable) d'un vrai objet ORM.
                avertissements.append(
                    f"Collaborateur non affecté au régime '{regle.code_regime}' — "
                    f"affectation SIMULÉE pour ce calcul (RG-SIM-COTISATION-01), "
                    f"aucune écriture en base."
                )
                affectation = SimpleNamespace(
                    date_radiation=None,
                    valeur_bareme_taux=valeur_bareme_taux_simulee,
                )
            else:
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

    # ── 4. Résoudre un éventuel taux variable via barème (ex. CIMR) ──────
    taux_bareme_resolu: tuple[Decimal, Decimal] | None = None

    if regle.code_bareme_taux:
        valeur_choisie = getattr(affectation, "valeur_bareme_taux", None) if affectation else None

        if valeur_choisie is None:
            avertissements.append(
                f"Barème '{regle.code_bareme_taux}' défini sur la règle mais aucune "
                f"valeur choisie sur l'affectation du collaborateur — taux fixes "
                f"des composantes utilisés en repli."
            )
        else:
            taux_bareme_resolu = _resoudre_taux_bareme_exact(
                db, regle.code_bareme_taux, "taux_salarial", Decimal(str(valeur_choisie)), societe_id
            )
            if taux_bareme_resolu is None:
                avertissements.append(
                    f"Valeur {valeur_choisie} introuvable dans le barème "
                    f"'{regle.code_bareme_taux}' — taux fixes des composantes utilisés en repli."
                )
            else:
                avertissements.append(
                    f"Taux résolu via barème '{regle.code_bareme_taux}' pour la valeur "
                    f"{valeur_choisie} : {taux_bareme_resolu[0]}% salarial / "
                    f"{taux_bareme_resolu[1]}% patronal"
                )

    # ── Calculer chaque composante ────────────────────────────────────
    composantes_calc: list[CotisationComposanteResult] = []
    total_sal = D0
    total_pat = D0

    for compo in composantes_actives:
        # Plafonner si plafond défini
        if compo.plafond_mensuel is not None:
            base = min(assiette, Decimal(str(compo.plafond_mensuel)))
        else:
            base = assiette

        if taux_bareme_resolu is not None:
            taux_sal, taux_pat = taux_bareme_resolu
        else:
            taux_sal = Decimal(str(compo.taux_salarial)) if compo.taux_salarial is not None else D0
            taux_pat = Decimal(str(compo.taux_patronal)) if compo.taux_patronal is not None else D0

        # RG-SIM-COTISATION-01 : surcharge de simulation, appliquée APRÈS la
        # résolution normale (fixe ou barème) — jamais active hors simulation.
        if surcharge_taux:
            taux_sal, taux_pat = _appliquer_surcharge_taux(taux_sal, taux_pat, surcharge_taux)

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
