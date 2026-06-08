"""
droits_conge.py — Moteur de calcul des droits de congé.

Auteur  : Adil DAIA
Module  : app/services/droits_conge.py

Modes de calcul supportés :
  FIXE      → droit_*_jours tel que saisi dans le type de congé (comportement actuel)
  BAREME    → grille de tranches paramétrée dans bareme_droit_conge
  FORMULE   → expression Python évaluée (reserved, pas encore exposé en UI)
  PRORATA   → FIXE avec prorata d'ancienneté sur la période courante

Règle de priorité finale :
  droit_effectif = MAX(legal, convention, particulier) en ignorant les NULL.
  Si tout est NULL → 0.
"""

from __future__ import annotations

import math
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)


# ── Profil collaborateur ───────────────────────────────────────────────────────

@dataclass
class ProfilCollaborateur:
    """Snapshot du profil RH utilisé pour le calcul des droits."""
    id: str
    anciennete_mois: int
    categorie_pro: str
    type_contrat: str
    taux_temps_travail: float = 1.0          # 1.0 = temps plein
    date_entree: Optional[date] = None
    date_sortie: Optional[date] = None


# ── Résultat de calcul ─────────────────────────────────────────────────────────

@dataclass
class ResultatDroitConge:
    code_type_conge: str
    libelle: str
    droit_legal:       Optional[float]
    droit_convention:  Optional[float]
    droit_particulier: Optional[float]
    droit_effectif:    float
    mode_calcul:       str
    code_bareme:       Optional[str]
    ancienne_valeur:   Optional[float]
    modifie:           bool


# ── Chargement du profil ───────────────────────────────────────────────────────

def charger_profil(db: Session, id_collaborateur: str) -> Optional[ProfilCollaborateur]:
    """
    Charge le profil RH d'un collaborateur depuis la base.
    Calcule l'ancienneté en mois à partir de la date d'entrée.
    """
    row = db.execute(text("""
        SELECT
            c.id::text,
            c.categorie_pro,
            c.type_contrat,
            c.taux_temps_travail,
            c.date_entree,
            c.date_sortie,
            (
                EXTRACT(YEAR  FROM AGE(NOW(), c.date_entree)) * 12 +
                EXTRACT(MONTH FROM AGE(NOW(), c.date_entree))
            )::int AS anciennete_mois
        FROM collaborateurs c
        WHERE c.id = :id
    """), {"id": id_collaborateur}).fetchone()

    if not row:
        return None

    r = dict(row._mapping)
    return ProfilCollaborateur(
        id=r["id"],
        anciennete_mois=int(r.get("anciennete_mois") or 0),
        categorie_pro=r.get("categorie_pro") or "",
        type_contrat=r.get("type_contrat") or "CDI",
        taux_temps_travail=float(r.get("taux_temps_travail") or 1.0),
        date_entree=r.get("date_entree"),
        date_sortie=r.get("date_sortie"),
    )


# ── Moteur barème ──────────────────────────────────────────────────────────────

def calculer_droit_bareme(
    db: Session,
    code_bareme: str,
    profil: ProfilCollaborateur,
) -> Optional[float]:
    """
    Parcourt les tranches du barème dans l'ordre et retourne la valeur
    de la première tranche qui correspond au profil du collaborateur.
    NULL sur un critère = pas de restriction sur ce critère.
    """
    tranches = db.execute(text("""
        SELECT
            anciennete_min_mois,
            anciennete_max_mois,
            categorie_pro,
            type_contrat,
            temps_travail_min_pct,
            temps_travail_max_pct,
            valeur_jours
        FROM bareme_droit_conge_tranche
        WHERE code_bareme = :code
        ORDER BY ordre, anciennete_min_mois NULLS LAST
    """), {"code": code_bareme}).fetchall()

    if not tranches:
        logger.warning("Barème '%s' introuvable ou sans tranches", code_bareme)
        return None

    for row in tranches:
        t = dict(row._mapping)

        # Vérifier ancienneté
        anc = profil.anciennete_mois
        if t["anciennete_min_mois"] is not None and anc < t["anciennete_min_mois"]:
            continue
        if t["anciennete_max_mois"] is not None and anc >= t["anciennete_max_mois"]:
            continue

        # Vérifier catégorie pro (NULL = toutes)
        if t["categorie_pro"] and t["categorie_pro"] != profil.categorie_pro:
            continue

        # Vérifier type contrat (NULL = tous)
        if t["type_contrat"] and t["type_contrat"] != profil.type_contrat:
            continue

        # Vérifier temps de travail (NULL = sans restriction)
        tt = profil.taux_temps_travail
        if t["temps_travail_min_pct"] is not None and tt < float(t["temps_travail_min_pct"]):
            continue
        if t["temps_travail_max_pct"] is not None and tt > float(t["temps_travail_max_pct"]):
            continue

        return float(t["valeur_jours"])

    # Aucune tranche ne correspond
    logger.info(
        "Aucune tranche du barème '%s' ne correspond au profil (ancienneté=%d mois, cat=%s)",
        code_bareme, profil.anciennete_mois, profil.categorie_pro,
    )
    return None


# ── Arrondi acquisition ────────────────────────────────────────────────────────

def appliquer_arrondi(valeur: float, mode: str) -> float:
    """Arrondi au 0.5j le plus proche selon le mode paramétré."""
    if mode == "SUPERIEUR":
        return math.ceil(valeur * 2) / 2
    elif mode == "INFERIEUR":
        return math.floor(valeur * 2) / 2
    else:   # MATHEMATIQUE
        return round(valeur * 2) / 2


# ── Calcul d'un niveau de droit ───────────────────────────────────────────────

def calculer_droit_niveau(
    db: Session,
    type_conge: dict,
    profil: ProfilCollaborateur,
    niveau: str,   # "legal" | "convention" | "particulier"
) -> Optional[float]:
    """
    Calcule le droit pour un niveau donné (légal, convention, particulier).
    Applique le prorata temps partiel si configuré.
    """
    mode = (type_conge.get(f"mode_calcul_droit_{niveau}") or "FIXE").upper()
    arrondi = (type_conge.get("arrondi_acquisition") or "SUPERIEUR").upper()

    valeur: Optional[float] = None

    if mode == "FIXE":
        raw = type_conge.get(f"droit_{niveau}_jours")
        valeur = float(raw) if raw is not None else None

    elif mode == "BAREME":
        code_bareme = type_conge.get(f"code_bareme_{niveau}")
        if not code_bareme:
            return None
        valeur = calculer_droit_bareme(db, code_bareme, profil)

    elif mode == "PRORATA":
        # Prorata selon la part d'ancienneté dans la période courante.
        # Utile pour les nouvelles arrivées en cours d'exercice.
        raw = type_conge.get(f"droit_{niveau}_jours")
        if raw is None:
            return None
        base = float(raw)
        entree = profil.date_entree
        if entree:
            debut_exercice = date(entree.year, 1, 1)
            jours_exercice = (date(entree.year, 12, 31) - debut_exercice).days + 1
            jours_depuis_entree = (date.today() - entree).days + 1
            ratio = min(jours_depuis_entree / jours_exercice, 1.0)
            valeur = appliquer_arrondi(base * ratio, arrondi)
        else:
            valeur = base

    elif mode == "FORMULE":
        # Réservé pour une future version — évaluation sécurisée d'expressions
        formule = type_conge.get(f"formule_droit_{niveau}")
        if not formule:
            return None
        try:
            ctx = {
                "anciennete": profil.anciennete_mois,
                "anciennete_ans": profil.anciennete_mois / 12,
                "categorie": profil.categorie_pro,
                "contrat": profil.type_contrat,
                "taux_tt": profil.taux_temps_travail,
            }
            valeur = float(eval(formule, {"__builtins__": {}}, ctx))  # noqa: S307
        except Exception as exc:
            logger.error("Erreur évaluation formule '%s' : %s", formule, exc)
            return None

    if valeur is None:
        return None

    # Prorata temps partiel (si activé et temps partiel)
    if (
        type_conge.get("prorata_temps_partiel")
        and profil.taux_temps_travail < 1.0
        and mode != "BAREME"   # BAREME gère déjà le temps partiel via ses tranches
    ):
        valeur = appliquer_arrondi(valeur * profil.taux_temps_travail, arrondi)

    return valeur


# ── Calcul complet pour un type de congé ─────────────────────────────────────

def calculer_droit_type_conge(
    db: Session,
    type_conge: dict,
    profil: ProfilCollaborateur,
) -> tuple[Optional[float], Optional[float], Optional[float], float, str, Optional[str]]:
    """
    Retourne (droit_legal, droit_convention, droit_particulier, droit_effectif, mode, code_bareme).
    Le droit effectif = max non-null des trois niveaux.
    """
    d_leg = calculer_droit_niveau(db, type_conge, profil, "legal")
    d_con = calculer_droit_niveau(db, type_conge, profil, "convention")
    d_par = calculer_droit_niveau(db, type_conge, profil, "particulier")

    valeurs_non_nulles = [v for v in (d_leg, d_con, d_par) if v is not None]
    droit_effectif = max(valeurs_non_nulles) if valeurs_non_nulles else 0.0

    # Mode et barème à historiser (on prend le niveau légal comme référence)
    mode = (type_conge.get("mode_calcul_droit_legal") or "FIXE").upper()
    code_bareme = type_conge.get("code_bareme_legal")

    return d_leg, d_con, d_par, droit_effectif, mode, code_bareme


# ── Recalcul global d'un collaborateur ────────────────────────────────────────

def recalculer_droits_collaborateur(
    db: Session,
    id_collaborateur: str,
    type_evenement: str = "MANUEL",
    created_by: Optional[str] = None,
) -> list[ResultatDroitConge]:
    """
    Recalcule tous les droits de congé d'un collaborateur.
    Met à jour solde_conge et écrit dans histo_recalcul_droits si valeur modifiée.
    Retourne la liste des résultats (modifiés ou non).
    """
    profil = charger_profil(db, id_collaborateur)
    if not profil:
        raise ValueError(f"Collaborateur '{id_collaborateur}' introuvable")

    # Types de congé avec au moins un niveau non-FIXE (les FIXE purs n'ont pas besoin de recalcul)
    # On les inclut quand même pour avoir un résultat complet.
    types_conge = db.execute(text("""
        SELECT * FROM ref_type_conge
        WHERE actif = TRUE
        ORDER BY ordre NULLS LAST, libelle
    """)).fetchall()

    resultats: list[ResultatDroitConge] = []

    for tc_row in types_conge:
        tc = dict(tc_row._mapping)
        code = tc["code"]

        # Ignorer si aucun mode non-FIXE (optimisation)
        modes = [
            (tc.get("mode_calcul_droit_legal") or "FIXE").upper(),
            (tc.get("mode_calcul_droit_convention") or "FIXE").upper(),
            (tc.get("mode_calcul_droit_particulier") or "FIXE").upper(),
        ]
        if all(m == "FIXE" for m in modes):
            continue  # Le FIXE est déjà correct en base, pas besoin de recalcul

        d_leg, d_con, d_par, droit_effectif, mode, code_bareme = \
            calculer_droit_type_conge(db, tc, profil)

        # Solde existant
        solde_row = db.execute(text("""
            SELECT droits_acquis FROM solde_conge
            WHERE id_collaborateur = :collab AND code_type_conge = :code
        """), {"collab": id_collaborateur, "code": code}).fetchone()

        ancienne_valeur: Optional[float] = None
        if solde_row:
            ancienne_valeur = float(solde_row[0]) if solde_row[0] is not None else None

            # Mise à jour du solde
            db.execute(text("""
                UPDATE solde_conge
                SET
                    droits_acquis         = :droits,
                    mode_calcul_applique  = :mode,
                    code_bareme_applique  = :bareme,
                    updated_at            = NOW()
                WHERE id_collaborateur = :collab
                  AND code_type_conge   = :code
            """), {
                "droits": droit_effectif,
                "mode":   mode,
                "bareme": code_bareme,
                "collab": id_collaborateur,
                "code":   code,
            })

        modifie = (ancienne_valeur != droit_effectif)

        # Historique uniquement si modification
        if modifie:
            db.execute(text("""
                INSERT INTO histo_recalcul_droits
                  (id_collaborateur, code_type_conge, type_evenement,
                   date_evenement, ancienne_valeur, nouvelle_valeur,
                   mode_calcul, code_bareme, created_by)
                VALUES
                  (:collab, :code, :evt,
                   CURRENT_DATE, :old, :new,
                   :mode, :bareme, :by)
            """), {
                "collab":  id_collaborateur,
                "code":    code,
                "evt":     type_evenement,
                "old":     ancienne_valeur,
                "new":     droit_effectif,
                "mode":    mode,
                "bareme":  code_bareme,
                "by":      created_by,
            })
            logger.info(
                "Droits recalculés : collab=%s type=%s %s → %.2f j",
                id_collaborateur, code, ancienne_valeur, droit_effectif,
            )

        resultats.append(ResultatDroitConge(
            code_type_conge=code,
            libelle=tc.get("libelle", ""),
            droit_legal=d_leg,
            droit_convention=d_con,
            droit_particulier=d_par,
            droit_effectif=droit_effectif,
            mode_calcul=mode,
            code_bareme=code_bareme,
            ancienne_valeur=ancienne_valeur,
            modifie=modifie,
        ))

    db.commit()
    return resultats


# ── Simulation (sans écriture en base) ────────────────────────────────────────

def simuler_droit(
    db: Session,
    code_bareme: str,
    anciennete_mois: int,
    categorie_pro: str = "",
    type_contrat: str = "CDI",
    taux_temps_travail: float = 1.0,
    arrondi: str = "SUPERIEUR",
) -> dict:
    """
    Simule le droit pour un barème et un profil hypothétique, sans toucher la base.
    Utilisé par le simulateur en UI.
    """
    profil = ProfilCollaborateur(
        id="simulation",
        anciennete_mois=anciennete_mois,
        categorie_pro=categorie_pro,
        type_contrat=type_contrat,
        taux_temps_travail=taux_temps_travail,
    )

    valeur_brute = calculer_droit_bareme(db, code_bareme, profil)
    if valeur_brute is None:
        return {"droit_brut": None, "droit_final": None, "prorata_applique": False}

    prorata_applique = taux_temps_travail < 1.0
    droit_final = (
        appliquer_arrondi(valeur_brute * taux_temps_travail, arrondi)
        if prorata_applique
        else valeur_brute
    )

    return {
        "droit_brut":       valeur_brute,
        "droit_final":      droit_final,
        "prorata_applique": prorata_applique,
        "taux_applique":    taux_temps_travail if prorata_applique else 1.0,
        "arrondi":          arrondi,
    }
