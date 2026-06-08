"""
pret_service.py — Logique métier du module Gestion des Prêts
app/services/pret_service.py

Couvre :
  - Calcul d'échéancier (linéaire, amortissement français, in fine)
  - Vérification éligibilité (plafond global, quotité saisissable, taux endettement)
  - Génération du tableau d'amortissement en base
  - Gestion des suspensions (gel / hors-paie)
  - Prélèvement mensuel (avec gestion du reliquat et priorité)
  - Calcul avantage en nature
  - Piste d'audit automatique
"""
from __future__ import annotations

import json
import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from dateutil.relativedelta import relativedelta
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# ──────────────────────────────────────────────────────────────
# HELPERS INTERNES
# ──────────────────────────────────────────────────────────────

def _arrondi(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), ROUND_HALF_UP)


async def _config(db: AsyncSession, code: str) -> Decimal:
    row = await db.execute(text("SELECT valeur FROM pret_configuration WHERE code = :c"), {"c": code})
    r = row.scalar()
    return Decimal(str(r)) if r is not None else Decimal("0")


async def _audit(
    db: AsyncSession,
    pret_id: uuid.UUID,
    action: str,
    operateur: str,
    security_level: int = 0,
    champ: Optional[str] = None,
    ancienne: Optional[str] = None,
    nouvelle: Optional[str] = None,
    contexte: Optional[dict] = None,
) -> None:
    await db.execute(
        text("""
            INSERT INTO pret_audit_log
                (pret_id, action, champ, ancienne_valeur, nouvelle_valeur,
                 operateur, security_level_operateur, contexte)
            VALUES (:pid, :act, :champ, :anc, :nouv, :op, :sl, :ctx)
        """),
        {
            "pid": str(pret_id), "act": action, "champ": champ,
            "anc": ancienne, "nouv": nouvelle, "op": operateur,
            "sl": security_level, "ctx": json.dumps(contexte) if contexte else None,
        },
    )


async def _alerte(db: AsyncSession, pret_id: uuid.UUID, type_alerte: str, message: str, destinataire: Optional[str] = None):
    await db.execute(
        text("INSERT INTO pret_alertes (pret_id, type_alerte, message, destinataire) VALUES (:pid, :ta, :msg, :dest)"),
        {"pid": str(pret_id), "ta": type_alerte, "msg": message, "dest": destinataire},
    )


# ──────────────────────────────────────────────────────────────
# CALCUL D'ÉCHÉANCIER
# ──────────────────────────────────────────────────────────────

def calculer_echeancier(
    montant: Decimal,
    nb_echeances: int,
    taux_annuel: Decimal,
    date_premiere_echeance: date,
    algo: str = "french_amortissement",
) -> list[dict]:
    """
    Retourne la liste des lignes du tableau d'amortissement.
    algo: 'french_amortissement' | 'lineaire' | 'in_fine'
    """
    lignes = []
    capital_restant = montant
    taux_mensuel = taux_annuel / 12 / 100 if taux_annuel > 0 else Decimal("0")

    if algo == "french_amortissement" and taux_mensuel > 0:
        # Mensualité constante
        mensualite = _arrondi(
            montant * taux_mensuel / (1 - (1 + taux_mensuel) ** (-nb_echeances))
        )
        for i in range(nb_echeances):
            interet = _arrondi(capital_restant * taux_mensuel)
            capital = _arrondi(mensualite - interet)
            if i == nb_echeances - 1:
                capital = capital_restant  # ajustement dernière ligne
            capital_restant_apres = capital_restant - capital
            lignes.append({
                "numero": i + 1,
                "date_echeance": date_premiere_echeance + relativedelta(months=i),
                "capital_du": float(capital_restant),
                "mt_capital": float(capital),
                "mt_interet": float(interet),
                "capital_restant": float(max(Decimal("0"), capital_restant_apres)),
            })
            capital_restant -= capital

    elif algo == "lineaire" or taux_mensuel == 0:
        capital_par_mois = _arrondi(montant / nb_echeances)
        for i in range(nb_echeances):
            capital = capital_par_mois if i < nb_echeances - 1 else capital_restant
            interet = _arrondi(capital_restant * taux_mensuel)
            capital_restant -= capital
            lignes.append({
                "numero": i + 1,
                "date_echeance": date_premiere_echeance + relativedelta(months=i),
                "capital_du": float(capital_restant + capital),
                "mt_capital": float(capital),
                "mt_interet": float(interet),
                "capital_restant": float(max(Decimal("0"), capital_restant)),
            })

    elif algo == "in_fine":
        # Intérêts mensuels, capital remboursé en une seule fois à la fin
        for i in range(nb_echeances):
            interet = _arrondi(montant * taux_mensuel)
            capital = montant if i == nb_echeances - 1 else Decimal("0")
            lignes.append({
                "numero": i + 1,
                "date_echeance": date_premiere_echeance + relativedelta(months=i),
                "capital_du": float(montant),
                "mt_capital": float(capital),
                "mt_interet": float(interet),
                "capital_restant": float(montant - capital),
            })

    return lignes


# ──────────────────────────────────────────────────────────────
# VÉRIFICATIONS MÉTIER
# ──────────────────────────────────────────────────────────────

async def verifier_eligibilite(
    db: AsyncSession,
    collaborateur_id: uuid.UUID,
    matricule: str,
    pret_interne: bool,
    montant: Decimal,
    salaire_net: Optional[Decimal] = None,
) -> dict:
    """
    Vérifie l'éligibilité complète selon les règles de la spécification.
    """
    erreurs = []

    if pret_interne:
        # RG : plafond global de l'enveloppe interne
        plafond = await _config(db, "PLAFOND_INTERNE_ANNUEL")
        row = await db.execute(
            text("""
                SELECT COALESCE(SUM(mt_pret),0) AS total
                FROM prets
                WHERE pret_interne = TRUE
                  AND statut NOT IN ('refuse','annule','solde')
                  AND deleted_date IS NULL
                  AND EXTRACT(YEAR FROM created_date) = EXTRACT(YEAR FROM NOW())
            """)
        )
        total_en_cours = Decimal(str(row.scalar() or 0))
        if total_en_cours + montant > plafond:
            erreurs.append(
                f"Enveloppe budgétaire annuelle des prêts internes dépassée "
                f"(encours : {total_en_cours:,.2f} / plafond : {plafond:,.2f})."
            )

    # RG : taux d'endettement global (toutes mensualités / salaire net)
    if salaire_net and salaire_net > 0:
        quotite_max = await _config(db, "QUOTITE_SAISISSABLE_MAX")
        row2 = await db.execute(
            text("""
                SELECT COALESCE(SUM(mt_echeance),0) AS total_mens
                FROM prets
                WHERE matricule = :mat
                  AND statut IN ('debloque','en_cours')
                  AND imputable_paie = TRUE
                  AND deleted_date IS NULL
            """),
            {"mat": matricule},
        )
        mens_existantes = Decimal(str(row2.scalar() or 0))
        # Mensualité estimée du nouveau prêt
        if mens_existantes > salaire_net * quotite_max / 100:
            erreurs.append(
                f"Taux d'endettement déjà à la limite légale "
                f"({float(quotite_max)}% du salaire net = {float(salaire_net * quotite_max / 100):,.2f})."
            )

    if erreurs:
        return {"ok": False, "erreurs": erreurs}
    return {"ok": True}


# ──────────────────────────────────────────────────────────────
# CALCUL AVANTAGE EN NATURE (prêts internes à taux préférentiel)
# ──────────────────────────────────────────────────────────────

async def calculer_avantage_nature(
    db: AsyncSession,
    montant: Decimal,
    taux_pret: Decimal,
) -> Decimal:
    """
    Si le taux du prêt interne < taux légal de référence,
    retourne l'avantage en nature mensuel à réintégrer.
    """
    taux_legal = await _config(db, "TAUX_INTERET_LEGAL")
    if taux_pret >= taux_legal:
        return Decimal("0")
    avantage_annuel = montant * (taux_legal - taux_pret) / 100
    return _arrondi(avantage_annuel / 12)


# ──────────────────────────────────────────────────────────────
# CRÉATION DU PRÊT
# ──────────────────────────────────────────────────────────────

async def creer_pret(
    db: AsyncSession,
    collaborateur_id: uuid.UUID,
    matricule: str,
    pret_interne: bool,
    montant: Decimal,
    nb_echeances: int,
    taux: Decimal,
    algo: str,
    inclure_interets: bool,
    operateur: str,
    security_level: int,
    # Champs externes
    organisme_credit: Optional[str] = None,
    etab_credit: Optional[str] = None,
    code_bqe: Optional[str] = None,
    no_compte: Optional[str] = None,
    clerib: Optional[str] = None,
) -> dict:
    pret_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO prets (
                id, matricule, collaborateur_id, pret_interne,
                mt_pret, tx_interets, nb_echeance, algo_name, inclure_interets,
                statut, imputable_paie, security_level, created_by,
                organisme_credit, etab_credit, code_bqe, no_compte, clerib
            ) VALUES (
                :id, :mat, :cid, :pi,
                :mt, :tx, :nb, :algo::pret_algo_enum, :incl,
                'brouillon', FALSE, :sl, :op,
                :org, :etab, :cbq, :nc, :cr
            )
        """),
        {
            "id": str(pret_id), "mat": matricule, "cid": str(collaborateur_id),
            "pi": pret_interne, "mt": montant, "tx": taux, "nb": nb_echeances,
            "algo": algo, "incl": inclure_interets, "sl": security_level, "op": operateur,
            "org": organisme_credit, "etab": etab_credit, "cbq": code_bqe,
            "nc": no_compte, "cr": clerib,
        },
    )
    await _audit(db, pret_id, "CREATE", operateur, security_level)
    await db.commit()
    row = await db.execute(text("SELECT * FROM prets WHERE id = :id"), {"id": str(pret_id)})
    return dict(row.mappings().first())


# ──────────────────────────────────────────────────────────────
# GÉNÉRATION DU TABLEAU D'AMORTISSEMENT EN BASE
# ──────────────────────────────────────────────────────────────

async def generer_tableau_amortissement(
    db: AsyncSession,
    pret_id: uuid.UUID,
    date_premiere_echeance: date,
    operateur: str,
    security_level: int,
) -> int:
    row = await db.execute(
        text("SELECT mt_pret, nb_echeance, tx_interets, algo_name FROM prets WHERE id = :id"),
        {"id": str(pret_id)},
    )
    p = row.mappings().first()
    if not p:
        raise ValueError("Prêt introuvable.")

    lignes = calculer_echeancier(
        Decimal(str(p["mt_pret"])),
        p["nb_echeance"],
        Decimal(str(p["tx_interets"])),
        date_premiere_echeance,
        p["algo_name"],
    )

    await db.execute(
        text("DELETE FROM pret_echeances WHERE pret_id = :pid"), {"pid": str(pret_id)}
    )
    for l in lignes:
        await db.execute(
            text("""
                INSERT INTO pret_echeances
                    (pret_id, numero, date_echeance, capital_du, mt_capital, mt_interet, capital_restant)
                VALUES (:pid, :num, :dt, :cdu, :cap, :int, :crest)
            """),
            {"pid": str(pret_id), "num": l["numero"], "dt": l["date_echeance"],
             "cdu": l["capital_du"], "cap": l["mt_capital"],
             "int": l["mt_interet"], "crest": l["capital_restant"]},
        )

    # Mise à jour mensualité et fin prévue
    mt_echeance = lignes[0]["mt_capital"] + lignes[0]["mt_interet"]
    fin_prevue = lignes[-1]["date_echeance"]
    await db.execute(
        text("""
            UPDATE prets
            SET mt_echeance = :me, fin_prevue = :fp, dt_debut_remb = :ddr,
                dt_proch_echeance = :dpe, echeance_restant = :nb, modified_by = :op
            WHERE id = :id
        """),
        {
            "me": mt_echeance, "fp": fin_prevue,
            "ddr": date_premiere_echeance, "dpe": date_premiere_echeance,
            "nb": len(lignes), "op": operateur, "id": str(pret_id),
        },
    )
    await _audit(db, pret_id, "TABLEAU_AMORTISSEMENT", operateur, security_level,
                 contexte={"nb_echeances": len(lignes), "date_debut": str(date_premiere_echeance)})
    await db.commit()
    return len(lignes)


# ──────────────────────────────────────────────────────────────
# DÉBLOCAGE DES FONDS (SECURITY_LEVEL >= 70)
# ──────────────────────────────────────────────────────────────

async def debloquer_pret(
    db: AsyncSession,
    pret_id: uuid.UUID,
    montant_debloque: Decimal,
    date_deblocage: date,
    no_cheque: Optional[str],
    banque_emettrice: Optional[str],
    operateur: str,
    security_level: int,
) -> None:
    if security_level < 70:
        raise PermissionError("SECURITY_LEVEL >= 70 requis pour débloquer un prêt.")

    await db.execute(
        text("""
            UPDATE prets
            SET pret_debloque = TRUE, imputable_paie = TRUE,
                statut = 'debloque', mt_debloque = :md,
                dt_deblocage = :dd, no_cheque = :nc,
                banque_emettrice = :be, modified_by = :op
            WHERE id = :id AND deleted_date IS NULL
        """),
        {
            "md": montant_debloque, "dd": date_deblocage, "nc": no_cheque,
            "be": banque_emettrice, "op": operateur, "id": str(pret_id),
        },
    )
    await _audit(db, pret_id, "DEBLOCAGE", operateur, security_level,
                 contexte={"montant": float(montant_debloque), "date": str(date_deblocage)})
    await db.commit()


# ──────────────────────────────────────────────────────────────
# SUSPENSION (congé sans solde, maladie longue durée, etc.)
# ──────────────────────────────────────────────────────────────

async def suspendre_pret(
    db: AsyncSession,
    pret_id: uuid.UUID,
    motif: str,
    mode: str,                     # 'gel_echeance' | 'hors_paie'
    date_debut: date,
    date_fin: Optional[date],
    operateur: str,
    security_level: int,
) -> None:
    if security_level < 50:
        raise PermissionError("SECURITY_LEVEL >= 50 requis pour suspendre un prêt.")

    row = await db.execute(text("SELECT * FROM prets WHERE id = :id"), {"id": str(pret_id)})
    pret = row.mappings().first()
    if not pret:
        raise ValueError("Prêt introuvable.")

    updates = {
        "pret_suspendu": True,
        "imputable_paie": False,
        "motif_suspension": motif,
        "mode_suspension": mode,
        "dt_debut_suspension": date_debut,
        "dt_fin_suspension": date_fin,
        "modified_by": operateur,
        "id": str(pret_id),
    }

    if mode == "gel_echeance" and date_fin and pret["fin_prevue"]:
        mois_decalage = (
            (date_fin.year - date_debut.year) * 12 + date_fin.month - date_debut.month
        )
        nouvelle_fin = pret["fin_prevue"] + relativedelta(months=mois_decalage)
        updates["fin_prevue"] = nouvelle_fin
        updates["statut"] = "suspendu"

        # Décaler les échéances planifiées
        await db.execute(
            text("""
                UPDATE pret_echeances
                SET date_echeance = date_echeance + :decalage * INTERVAL '1 month'
                WHERE pret_id = :pid AND statut = 'planifiee'
            """),
            {"pid": str(pret_id), "decalage": mois_decalage},
        )
    elif mode == "hors_paie":
        updates["manuel"] = True
        updates["statut"] = "suspendu"

    await db.execute(
        text("""
            UPDATE prets
            SET pret_suspendu = :pret_suspendu,
                imputable_paie = :imputable_paie,
                motif_suspension = :motif_suspension::pret_motif_suspension,
                mode_suspension = :mode_suspension::pret_suspension_mode,
                dt_debut_suspension = :dt_debut_suspension,
                dt_fin_suspension = :dt_fin_suspension,
                statut = COALESCE(:statut, statut),
                fin_prevue = COALESCE(:fin_prevue, fin_prevue),
                manuel = COALESCE(:manuel, manuel),
                modified_by = :modified_by
            WHERE id = :id AND deleted_date IS NULL
        """),
        {**updates, "statut": updates.get("statut"), "fin_prevue": updates.get("fin_prevue"),
         "manuel": updates.get("manuel")},
    )

    await _alerte(db, pret_id, "SUSPENSION",
                  f"Prêt suspendu ({mode}) — motif : {motif}. Début : {date_debut}.", operateur)
    await _audit(db, pret_id, "SUSPENSION", operateur, security_level,
                 contexte={"motif": motif, "mode": mode, "debut": str(date_debut)})
    await db.commit()


async def reprendre_pret(
    db: AsyncSession,
    pret_id: uuid.UUID,
    operateur: str,
    security_level: int,
) -> None:
    """Reprend un prêt suspendu à la fin de la période de suspension."""
    await db.execute(
        text("""
            UPDATE prets
            SET pret_suspendu = FALSE, imputable_paie = TRUE,
                statut = 'en_cours', manuel = FALSE,
                modified_by = :op
            WHERE id = :id AND deleted_date IS NULL
        """),
        {"op": operateur, "id": str(pret_id)},
    )
    await _audit(db, pret_id, "REPRISE", operateur, security_level)
    await db.commit()


# ──────────────────────────────────────────────────────────────
# PRÉLÈVEMENT MENSUEL (hook moteur de paie)
# ──────────────────────────────────────────────────────────────

async def prelever_echeance(
    db: AsyncSession,
    pret_id: uuid.UUID,
    salaire_net_disponible: Decimal,
    reference_paie: str,
    operateur: str,
    security_level: int,
) -> dict:
    """
    Prélève l'échéance du mois.
    Respecte la quotité saisissable, gère le reliquat.
    Retourne le montant effectivement prélevé.
    """
    # Récupérer l'échéance planifiée la plus proche
    row = await db.execute(
        text("""
            SELECT * FROM pret_echeances
            WHERE pret_id = :pid AND statut = 'planifiee'
            ORDER BY numero ASC LIMIT 1
        """),
        {"pid": str(pret_id)},
    )
    echeance = row.mappings().first()
    if not echeance:
        return {"preleve": 0, "reliquat": 0, "message": "Aucune échéance planifiée."}

    pret_row = await db.execute(text("SELECT * FROM prets WHERE id = :id"), {"id": str(pret_id)})
    pret = pret_row.mappings().first()

    mt_a_prelever = Decimal(str(echeance["mt_total"])) + Decimal(str(pret["mt_echeance_plus"] or 0))
    mt_preleve = min(mt_a_prelever, salaire_net_disponible)
    reliquat = mt_a_prelever - mt_preleve

    statut_ech = "prelevee" if reliquat == 0 else "reportee"

    await db.execute(
        text("""
            UPDATE pret_echeances
            SET statut = :st, date_prelevement = CURRENT_DATE,
                mt_preleve = :mp, reliquat = :rel, reference_paie = :ref
            WHERE id = :eid
        """),
        {"st": statut_ech, "mp": float(mt_preleve), "rel": float(reliquat),
         "ref": reference_paie, "eid": str(echeance["id"])},
    )

    # Mise à jour du prêt
    new_rembourse = Decimal(str(pret["mt_rembourse"])) + mt_preleve
    await db.execute(
        text("""
            UPDATE prets
            SET mt_rembourse = :mr,
                mt_echeance_plus = :ep,
                echeance_restant = GREATEST(0, echeance_restant - 1),
                dt_proch_echeance = (
                    SELECT MIN(date_echeance) FROM pret_echeances
                    WHERE pret_id = :pid AND statut = 'planifiee'
                ),
                statut = CASE
                    WHEN :mr >= mt_debloque THEN 'solde'
                    ELSE 'en_cours'
                END,
                modified_by = :op
            WHERE id = :pid
        """),
        {"mr": float(new_rembourse), "ep": float(reliquat), "pid": str(pret_id), "op": operateur},
    )

    if reliquat > 0:
        await _alerte(db, pret_id, "SOLDE_INSUFFISANT",
                      f"Prélèvement partiel : {float(mt_preleve):,.2f} / {float(mt_a_prelever):,.2f}. "
                      f"Reliquat {float(reliquat):,.2f} reporté.", operateur)

    await _audit(db, pret_id, "PRELEVEMENT", operateur, security_level,
                 contexte={"preleve": float(mt_preleve), "reliquat": float(reliquat), "paie": reference_paie})
    await db.commit()

    return {"preleve": float(mt_preleve), "reliquat": float(reliquat), "statut_echeance": statut_ech}


# ──────────────────────────────────────────────────────────────
# FORÇAGE D'ÉCHÉANCE (SECURITY_LEVEL >= 70)
# ──────────────────────────────────────────────────────────────

async def forcer_echeance(
    db: AsyncSession,
    pret_id: uuid.UUID,
    numero_echeance: int,
    nouveau_montant: Decimal,
    note: str,
    operateur: str,
    security_level: int,
) -> None:
    if security_level < 70:
        raise PermissionError("SECURITY_LEVEL >= 70 requis pour forcer une échéance.")

    row = await db.execute(
        text("SELECT mt_total FROM pret_echeances WHERE pret_id = :pid AND numero = :num"),
        {"pid": str(pret_id), "num": numero_echeance},
    )
    ech = row.mappings().first()
    if not ech:
        raise ValueError("Échéance introuvable.")

    mt_theorique = Decimal(str(ech["mt_total"]))
    seuil_alerte = mt_theorique * Decimal("0.20")
    if abs(nouveau_montant - mt_theorique) > seuil_alerte:
        await _alerte(db, pret_id, "FORCAGE",
                      f"ALERTE : Forçage de l'échéance {numero_echeance} — "
                      f"montant modifié de {float(mt_theorique):,.2f} à {float(nouveau_montant):,.2f} "
                      f"(écart > 20% du montant théorique).", operateur)

    await db.execute(
        text("""
            UPDATE pret_echeances
            SET mt_capital = mt_capital + (:nv - mt_total),
                statut = 'forcee', note = :note
            WHERE pret_id = :pid AND numero = :num
        """),
        {"nv": float(nouveau_montant), "note": note, "pid": str(pret_id), "num": numero_echeance},
    )
    await db.execute(
        text("UPDATE prets SET forcage = TRUE, modified_by = :op WHERE id = :id"),
        {"op": operateur, "id": str(pret_id)},
    )
    await _audit(db, pret_id, "FORCAGE", operateur, security_level,
                 champ="mt_echeance", ancienne=str(mt_theorique), nouvelle=str(nouveau_montant))
    await db.commit()


# ──────────────────────────────────────────────────────────────
# SOFT DELETE
# ──────────────────────────────────────────────────────────────

async def supprimer_pret_logique(
    db: AsyncSession,
    pret_id: uuid.UUID,
    operateur: str,
    security_level: int,
) -> None:
    row = await db.execute(text("SELECT pret_debloque FROM prets WHERE id = :id"), {"id": str(pret_id)})
    p = row.mappings().first()
    if p and p["pret_debloque"]:
        raise ValueError("Impossible de supprimer un prêt déjà débloqué. Utilisez l'annulation formelle.")

    await db.execute(
        text("UPDATE prets SET deleted_date = NOW(), deleted_by = :op, statut = 'annule' WHERE id = :id"),
        {"op": operateur, "id": str(pret_id)},
    )
    await _audit(db, pret_id, "DELETE", operateur, security_level)
    await db.commit()


# ──────────────────────────────────────────────────────────────
# CALCUL TAUX ENDETTEMENT GLOBAL (multi-prêts)
# ──────────────────────────────────────────────────────────────

async def recalculer_taux_endettement(
    db: AsyncSession,
    matricule: str,
    salaire_net: Decimal,
) -> Decimal:
    row = await db.execute(
        text("""
            SELECT COALESCE(SUM(mt_echeance),0) AS total
            FROM prets
            WHERE matricule = :mat
              AND statut IN ('debloque','en_cours')
              AND imputable_paie = TRUE
              AND deleted_date IS NULL
        """),
        {"mat": matricule},
    )
    total = Decimal(str(row.scalar() or 0))
    if salaire_net <= 0:
        return Decimal("0")
    taux = (total / salaire_net * 100).quantize(Decimal("0.01"), ROUND_HALF_UP)

    await db.execute(
        text("UPDATE prets SET tx_endettement_i = :tx WHERE matricule = :mat AND deleted_date IS NULL"),
        {"tx": float(taux), "mat": matricule},
    )
    await db.commit()
    return taux
