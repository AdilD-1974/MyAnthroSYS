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
from sqlalchemy.orm import Session


# ──────────────────────────────────────────────────────────────
# HELPERS INTERNES
# ──────────────────────────────────────────────────────────────

def _arrondi(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), ROUND_HALF_UP)


def _config(db: Session, code: str) -> Decimal:
    row = db.execute(text("SELECT valeur FROM pret_configuration WHERE code = :c"), {"c": code})
    r = row.scalar()
    return Decimal(str(r)) if r is not None else Decimal("0")


def _audit(
    db: Session,
    pret_id: uuid.UUID,
    action: str,
    operateur: str,
    security_level: int = 0,
    champ: Optional[str] = None,
    ancienne: Optional[str] = None,
    nouvelle: Optional[str] = None,
    contexte: Optional[dict] = None,
) -> None:
    db.execute(
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


def _alerte(db: Session, pret_id: uuid.UUID, type_alerte: str, message: str, destinataire: Optional[str] = None):
    db.execute(
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
    taux_tva: Decimal = Decimal("0"),
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

    # TVA sur intérêts — calculée ici uniformément (même principe que
    # pret_engine.generer_echeancier, utilisé pour la simulation).
    for l in lignes:
        if taux_tva and taux_tva > 0:
            l["mt_tva_interet"] = float(_arrondi(Decimal(str(l["mt_interet"])) * taux_tva / Decimal("100")))
        else:
            l["mt_tva_interet"] = 0.0

    return lignes


# ──────────────────────────────────────────────────────────────
# VÉRIFICATIONS MÉTIER
# ──────────────────────────────────────────────────────────────

def verifier_eligibilite(
    db: Session,
    collaborateur_id: uuid.UUID,
    matricule: str,
    pret_interne: bool,
    montant: Decimal,
    societe_id: str,
    salaire_net: Optional[Decimal] = None,
) -> dict:
    """
    Vérifie l'éligibilité complète selon les règles de la spécification.

    RG-MULTISOCIETE-08 (migration 057) : `societe_id` obligatoire --
    l'enveloppe PLAFOND_INTERNE_ANNUEL doit être calculée par société, pas
    globalement. Bug corrigé : l'ancienne requête sommait `mt_pret` sur
    TOUS les prêts internes toutes sociétés confondues -- une société
    voyait son enveloppe réduite par les prêts d'une autre société.
    """
    erreurs = []

    if pret_interne:
        # RG : plafond global de l'enveloppe interne -- PAR SOCIÉTÉ
        plafond = _config(db, "PLAFOND_INTERNE_ANNUEL")
        row = db.execute(
            text("""
                SELECT COALESCE(SUM(p.mt_pret),0) AS total
                FROM prets p
                WHERE p.pret_interne = TRUE
                  AND p.statut NOT IN ('refuse','annule','solde')
                  AND p.deleted_date IS NULL
                  AND EXTRACT(YEAR FROM p.created_date) = EXTRACT(YEAR FROM NOW())
                  AND EXISTS (
                      SELECT 1 FROM collaborateur_contrats cc
                       WHERE cc.collaborateur_id = p.collaborateur_id
                         AND cc.societe_id = :sid AND cc.archive = false
                  )
            """),
            {"sid": societe_id},
        )
        total_en_cours = Decimal(str(row.scalar() or 0))
        if total_en_cours + montant > plafond:
            erreurs.append(
                f"Enveloppe budgétaire annuelle des prêts internes dépassée "
                f"(encours : {total_en_cours:,.2f} / plafond : {plafond:,.2f})."
            )

    # RG : taux d'endettement global (toutes mensualités / salaire net)
    if salaire_net and salaire_net > 0:
        quotite_max = _config(db, "QUOTITE_SAISISSABLE_MAX")
        row2 = db.execute(
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

def calculer_avantage_nature(
    db: Session,
    montant: Decimal,
    taux_pret: Decimal,
) -> Decimal:
    """
    Si le taux du prêt interne < taux légal de référence,
    retourne l'avantage en nature mensuel à réintégrer.
    """
    taux_legal = _config(db, "TAUX_INTERET_LEGAL")
    if taux_pret >= taux_legal:
        return Decimal("0")
    avantage_annuel = montant * (taux_legal - taux_pret) / 100
    return _arrondi(avantage_annuel / 12)


# ──────────────────────────────────────────────────────────────
# CRÉATION DU PRÊT
# ──────────────────────────────────────────────────────────────

def creer_pret(
    db: Session,
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
    # Rattachement au référentiel de typologie (ref_type_pret) — optionnel
    # pour rester compatible avec les appels existants qui ne le passaient pas.
    type_code: Optional[str] = None,
    taux_tva: Decimal = Decimal("0"),
    # Champs externes
    organisme_credit: Optional[str] = None,
    etab_credit: Optional[str] = None,
    code_bqe: Optional[str] = None,
    no_compte: Optional[str] = None,
    clerib: Optional[str] = None,
    # Date de contraction du prêt (indépendante de la date de saisie) — si
    # fournie, fin_prevue est calculée automatiquement = dt_debut_pret +
    # nb_echeances mois (jamais saisie librement, dossier fonctionnel).
    dt_debut_pret: Optional[date] = None,
) -> dict:
    pret_id = uuid.uuid4()
    fin_prevue = dt_debut_pret + relativedelta(months=nb_echeances) if dt_debut_pret else None

    # RG-PRET-VARPAIE-01 : RecuperationModulesPage.tsx (module Paie) lit ces
    # 3 rubriques directement sur la ligne `prets`, pas sur `ref_type_pret` —
    # elles doivent donc être copiées ici, à la création, sinon la génération
    # des éléments variables de paie échoue systématiquement ("Aucune
    # rubrique associée à ce prêt") même quand le type est correctement
    # paramétré. NB : `prets` ne stocke QUE les codes, pas les libellés
    # (ceux-ci ne vivent que sur ref_type_pret — pas de colonnes
    # rubrique_paie_lib* sur `prets`, contrairement à ref_type_pret).
    rub_code = rub_code_interet = rub_code_tva = None
    if type_code:
        type_row = db.execute(text("""
            SELECT rubrique_paie_code, rubrique_paie_code_interet, rubrique_paie_code_tva
            FROM ref_type_pret WHERE code = :tc
        """), {"tc": type_code}).mappings().first()
        if type_row:
            rub_code = type_row["rubrique_paie_code"]
            rub_code_interet = type_row["rubrique_paie_code_interet"]
            rub_code_tva = type_row["rubrique_paie_code_tva"]

    db.execute(
        text("""
            INSERT INTO prets (
                id, matricule, collaborateur_id, pret_interne, type_code,
                mt_pret, tx_interets, taux_tva, nb_echeance, algo_name, inclure_interets,
                statut, imputable_paie, security_level, created_by,
                organisme_credit, etab_credit, code_bqe, no_compte, clerib,
                dt_debut_pret, fin_prevue,
                rubrique_paie_code, rubrique_paie_code_interet, rubrique_paie_code_tva
            ) VALUES (
                :id, :mat, :cid, :pi, :tc,
                :mt, :tx, :ttva, :nb, CAST(:algo AS pret_algo_enum), :incl,
                'brouillon', FALSE, :sl, :op,
                :org, :etab, :cbq, :nc, :cr,
                :ddp, :fp,
                :rc, :rci, :rct
            )
        """),
        {
            "id": str(pret_id), "mat": matricule, "cid": str(collaborateur_id),
            "pi": pret_interne, "tc": type_code,
            "mt": montant, "tx": taux, "ttva": taux_tva, "nb": nb_echeances,
            "algo": algo, "incl": inclure_interets, "sl": security_level, "op": operateur,
            "org": organisme_credit, "etab": etab_credit, "cbq": code_bqe,
            "nc": no_compte, "cr": clerib,
            "ddp": dt_debut_pret, "fp": fin_prevue,
            "rc": rub_code, "rci": rub_code_interet, "rct": rub_code_tva,
        },
    )
    _audit(db, pret_id, "CREATE", operateur, security_level)
    db.commit()
    row = db.execute(text("SELECT * FROM prets WHERE id = :id"), {"id": str(pret_id)})
    return dict(row.mappings().first())


# ──────────────────────────────────────────────────────────────
# GÉNÉRATION DU TABLEAU D'AMORTISSEMENT EN BASE
# ──────────────────────────────────────────────────────────────

def generer_tableau_amortissement(
    db: Session,
    pret_id: uuid.UUID,
    date_premiere_echeance: date,
    operateur: str,
    security_level: int,
) -> int:
    row = db.execute(
        text("SELECT mt_pret, nb_echeance, tx_interets, algo_name, taux_tva FROM prets WHERE id = :id"),
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
        taux_tva=Decimal(str(p["taux_tva"] or 0)),
    )

    db.execute(
        text("DELETE FROM pret_echeances WHERE pret_id = :pid"), {"pid": str(pret_id)}
    )
    for l in lignes:
        db.execute(
            text("""
                INSERT INTO pret_echeances
                    (pret_id, numero, date_echeance, capital_du, mt_capital, mt_interet, capital_restant, mt_tva_interet)
                VALUES (:pid, :num, :dt, :cdu, :cap, :int, :crest, :tva)
            """),
            {"pid": str(pret_id), "num": l["numero"], "dt": l["date_echeance"],
             "cdu": l["capital_du"], "cap": l["mt_capital"],
             "int": l["mt_interet"], "crest": l["capital_restant"], "tva": l["mt_tva_interet"]},
        )

    # Mise à jour mensualité et fin prévue
    mt_echeance = lignes[0]["mt_capital"] + lignes[0]["mt_interet"]
    fin_prevue = lignes[-1]["date_echeance"]
    db.execute(
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
    _audit(db, pret_id, "TABLEAU_AMORTISSEMENT", operateur, security_level,
                 contexte={"nb_echeances": len(lignes), "date_debut": str(date_premiere_echeance)})
    db.commit()
    return len(lignes)


# ──────────────────────────────────────────────────────────────
# DÉBLOCAGE DES FONDS (SECURITY_LEVEL >= 70)
# ──────────────────────────────────────────────────────────────

def debloquer_pret(
    db: Session,
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

    db.execute(
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
    _audit(db, pret_id, "DEBLOCAGE", operateur, security_level,
                 contexte={"montant": float(montant_debloque), "date": str(date_deblocage)})
    db.commit()


# ──────────────────────────────────────────────────────────────
# SUSPENSION (congé sans solde, maladie longue durée, etc.)
# ──────────────────────────────────────────────────────────────

def suspendre_pret(
    db: Session,
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

    row = db.execute(text("SELECT * FROM prets WHERE id = :id"), {"id": str(pret_id)})
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
        updates["_nb_mois_decale"] = mois_decalage

        # Décaler les échéances planifiées
        db.execute(
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

    db.execute(
        text("""
            UPDATE prets
            SET pret_suspendu = :pret_suspendu,
                imputable_paie = :imputable_paie,
                motif_suspension = CAST(:motif_suspension AS pret_motif_suspension),
                mode_suspension = CAST(:mode_suspension AS pret_suspension_mode),
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

    # Historique des suspensions — jamais alimenté auparavant (trace permanente
    # même une fois la suspension levée, contrairement aux champs courants sur `prets`).
    db.execute(
        text("""
            INSERT INTO pret_suspension_historique (
                pret_id, motif_suspension, mode_suspension, dt_debut_suspension, dt_fin_suspension,
                nb_mois_decale, fin_prevue_avant, fin_prevue_apres, gestionnaire_paie_ref
            ) VALUES (
                :pret_id, CAST(:motif AS pret_motif_suspension), CAST(:mode AS pret_suspension_mode),
                :dt_debut, :dt_fin, :nb_mois_decale, :fin_avant, :fin_apres, :operateur
            )
        """),
        {
            "pret_id": str(pret_id), "motif": motif, "mode": mode,
            "dt_debut": date_debut, "dt_fin": date_fin,
            "nb_mois_decale": updates.get("_nb_mois_decale", 1),
            "fin_avant": pret["fin_prevue"], "fin_apres": updates.get("fin_prevue"),
            "operateur": operateur,
        },
    )

    _alerte(db, pret_id, "SUSPENSION",
                  f"Prêt suspendu ({mode}) — motif : {motif}. Début : {date_debut}.", operateur)
    _audit(db, pret_id, "SUSPENSION", operateur, security_level,
                 contexte={"motif": motif, "mode": mode, "debut": str(date_debut)})
    db.commit()


def reprendre_pret(
    db: Session,
    pret_id: uuid.UUID,
    operateur: str,
    security_level: int,
) -> None:
    """Reprend un prêt suspendu à la fin de la période de suspension."""
    db.execute(
        text("""
            UPDATE prets
            SET pret_suspendu = FALSE, imputable_paie = TRUE,
                statut = 'en_cours', manuel = FALSE,
                modified_by = :op
            WHERE id = :id AND deleted_date IS NULL
        """),
        {"op": operateur, "id": str(pret_id)},
    )
    _audit(db, pret_id, "REPRISE", operateur, security_level)
    db.commit()


# ──────────────────────────────────────────────────────────────
# PRÉLÈVEMENT MENSUEL (hook moteur de paie)
# ──────────────────────────────────────────────────────────────

def prelever_echeance(
    db: Session,
    pret_id: uuid.UUID,
    salaire_net_disponible: Decimal,
    reference_paie: str,
    operateur: str,
    security_level: int,
    commit: bool = True,
) -> dict:
    """
    Prélève l'échéance du mois.
    Respecte la quotité saisissable, gère le reliquat.
    Retourne le montant effectivement prélevé.

    RG-PRET-RECUP-STATUT-01 (Adil DAIA) : une échéance "forcee" reste due au
    même titre qu'une "planifiee" — recherchée elle aussi, pas seulement
    'planifiee' (bug corrigé : une échéance forcée n'était jamais réellement
    prélevée, silencieusement, malgré le contrôle en amont qui la considère
    comme due). ORDER BY numero conservé tel quel : l'échéance la plus
    ancienne est traitée en premier, quel que soit son statut.

    `commit` (RG-PRET-CLOTURE-SIGNATURE-01) : True par défaut (comportement
    historique, appel autonome hors transaction plus large). À `False`
    lorsque l'appelant fait partie d'une transaction externe qu'il committera
    lui-même (ex. clôture de période, paie_calcul.py) — pour que l'ensemble
    reste atomique : si une étape ultérieure de la clôture échoue, ce
    prélèvement doit pouvoir être annulé avec le reste.
    """
    # Récupérer l'échéance due la plus proche (planifiée OU forcée)
    row = db.execute(
        text("""
            SELECT * FROM pret_echeances
            WHERE pret_id = :pid AND statut IN ('planifiee', 'forcee')
            ORDER BY numero ASC LIMIT 1
        """),
        {"pid": str(pret_id)},
    )
    echeance = row.mappings().first()
    if not echeance:
        return {"preleve": 0, "reliquat": 0, "message": "Aucune échéance due (planifiée ou forcée)."}

    pret_row = db.execute(text("SELECT * FROM prets WHERE id = :id"), {"id": str(pret_id)})
    pret = pret_row.mappings().first()

    mt_a_prelever = Decimal(str(echeance["mt_total"])) + Decimal(str(pret["mt_echeance_plus"] or 0))
    mt_preleve = min(mt_a_prelever, salaire_net_disponible)
    reliquat = mt_a_prelever - mt_preleve

    statut_ech = "prelevee" if reliquat == 0 else "reportee"

    db.execute(
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
    # RG-PRET-STATUT-ENUM-01 (Adil DAIA) : `statut` est un type énuméré
    # Postgres (pret_statut_enum), pas du texte — une expression CASE sans
    # cast explicite est refusée à l'affectation (DatatypeMismatch), même si
    # la même expression passe sans problème dans un WHERE (inférence de
    # type implicite que Postgres n'applique pas à un SET). Déjà rencontré
    # et corrigé une fois ailleurs dans le flux de clôture (voir
    # MODULE_PAIE.md, journal des correctifs) — pas encore appliqué ici.
    new_rembourse = Decimal(str(pret["mt_rembourse"])) + mt_preleve
    db.execute(
        text("""
            UPDATE prets
            SET mt_rembourse = :mr,
                mt_echeance_plus = :ep,
                echeance_restant = GREATEST(0, echeance_restant - 1),
                dt_proch_echeance = (
                    SELECT MIN(date_echeance) FROM pret_echeances
                    WHERE pret_id = :pid AND statut IN ('planifiee', 'forcee')
                ),
                statut = (CASE
                    WHEN :mr >= mt_debloque THEN 'solde'
                    ELSE 'en_cours'
                END)::pret_statut_enum,
                modified_by = :op
            WHERE id = :pid
        """),
        {"mr": float(new_rembourse), "ep": float(reliquat), "pid": str(pret_id), "op": operateur},
    )

    if reliquat > 0:
        _alerte(db, pret_id, "SOLDE_INSUFFISANT",
                      f"Prélèvement partiel : {float(mt_preleve):,.2f} / {float(mt_a_prelever):,.2f}. "
                      f"Reliquat {float(reliquat):,.2f} reporté.", operateur)

    _audit(db, pret_id, "PRELEVEMENT", operateur, security_level,
                 contexte={"preleve": float(mt_preleve), "reliquat": float(reliquat), "paie": reference_paie})
    if commit:
        db.commit()

    return {"preleve": float(mt_preleve), "reliquat": float(reliquat), "statut_echeance": statut_ech}


# ──────────────────────────────────────────────────────────────
# FORÇAGE D'ÉCHÉANCE (SECURITY_LEVEL >= 70)
# ──────────────────────────────────────────────────────────────

def forcer_echeance(
    db: Session,
    pret_id: uuid.UUID,
    numero_echeance: int,
    nouveau_montant: Decimal,
    note: str,
    operateur: str,
    security_level: int,
    mode_cascade: str = "reduire_mensualite",
) -> None:
    if security_level < 70:
        raise PermissionError("SECURITY_LEVEL >= 70 requis pour forcer une échéance.")

    row = db.execute(
        text("SELECT capital_du, mt_capital, mt_total FROM pret_echeances WHERE pret_id = :pid AND numero = :num"),
        {"pid": str(pret_id), "num": numero_echeance},
    )
    ech = row.mappings().first()
    if not ech:
        raise ValueError("Échéance introuvable.")

    mt_theorique = Decimal(str(ech["mt_total"]))
    seuil_alerte = mt_theorique * Decimal("0.20")
    if abs(nouveau_montant - mt_theorique) > seuil_alerte:
        _alerte(db, pret_id, "FORCAGE",
                      f"ALERTE : Forçage de l'échéance {numero_echeance} — "
                      f"montant modifié de {float(mt_theorique):,.2f} à {float(nouveau_montant):,.2f} "
                      f"(écart > 20% du montant théorique).", operateur)

    # Le delta forcé s'impute entièrement sur la part capital (l'intérêt de
    # cette échéance reste celui déjà calculé, cohérent avec la logique
    # d'origine — seul mt_capital, donc mt_total et capital_restant, bouge).
    capital_du = Decimal(str(ech["capital_du"]))
    nouveau_mt_capital = Decimal(str(ech["mt_capital"])) + (nouveau_montant - mt_theorique)
    nouveau_capital_restant = capital_du - nouveau_mt_capital

    db.execute(
        text("""
            UPDATE pret_echeances
            SET mt_capital = :mc, capital_restant = :cr, statut = 'forcee', note = :note
            WHERE pret_id = :pid AND numero = :num
        """),
        {"mc": nouveau_mt_capital, "cr": nouveau_capital_restant, "note": note,
         "pid": str(pret_id), "num": numero_echeance},
    )

    # Cascade : la ligne forcée change le capital restant réel à cette date,
    # donc toute la suite du tableau (hors échéances déjà 'prelevee') doit
    # être régénérée pour rester mathématiquement cohérente — sinon les
    # lignes suivantes affichent un restant obsolète (bug corrigé ici).
    suivantes = db.execute(text("""
        SELECT numero, date_echeance FROM pret_echeances
        WHERE pret_id = :pid AND numero > :num AND statut != 'prelevee'
        ORDER BY numero
    """), {"pid": str(pret_id), "num": numero_echeance}).mappings().all()

    if suivantes:
        db.execute(text("""
            DELETE FROM pret_echeances WHERE pret_id = :pid AND numero > :num AND statut != 'prelevee'
        """), {"pid": str(pret_id), "num": numero_echeance})

        if nouveau_capital_restant > 0:
            pret = db.execute(text(
                "SELECT algo_name, tx_interets, taux_tva, mt_echeance FROM prets WHERE id = :id"
            ), {"id": str(pret_id)}).mappings().first()
            taux_annuel_p = Decimal(str(pret["tx_interets"]))
            taux_tva_p = Decimal(str(pret["taux_tva"] or 0))
            date_reprise = suivantes[0]["date_echeance"]

            if mode_cascade == "reduire_duree":
                # Mensualité habituelle du prêt gardée fixe ; on cherche le
                # plus petit nombre d'échéances qui amortit le nouveau
                # capital restant sans dépasser cette mensualité (les
                # échéances de prêt étant monotones décroissantes avec la
                # durée, une recherche incrémentale suffit — pas besoin de
                # formule fermée par algorithme).
                mensualite_cible = Decimal(str(pret["mt_echeance"]))
                nb_essai = 1
                nouvelles_lignes: list[dict] = []
                while nb_essai <= 600:
                    essai = calculer_echeancier(
                        montant=nouveau_capital_restant, nb_echeances=nb_essai,
                        taux_annuel=taux_annuel_p, date_premiere_echeance=date_reprise,
                        algo=pret["algo_name"], taux_tva=taux_tva_p,
                    )
                    premiere_mensualite = Decimal(str(essai[0]["mt_capital"])) + Decimal(str(essai[0]["mt_interet"]))
                    if premiere_mensualite <= mensualite_cible:
                        nouvelles_lignes = essai
                        break
                    nb_essai += 1
                if not nouvelles_lignes:
                    nouvelles_lignes = essai  # sécurité : mensualité cible jamais atteinte, on garde le dernier essai (600 mois)
            else:
                # reduire_mensualite (par défaut) : même nombre d'échéances
                # restantes, montant de chacune réajusté.
                nouvelles_lignes = calculer_echeancier(
                    montant=nouveau_capital_restant, nb_echeances=len(suivantes),
                    taux_annuel=taux_annuel_p, date_premiere_echeance=date_reprise,
                    algo=pret["algo_name"], taux_tva=taux_tva_p,
                )

            for i, l in enumerate(nouvelles_lignes):
                db.execute(text("""
                    INSERT INTO pret_echeances
                        (pret_id, numero, date_echeance, capital_du, mt_capital, mt_interet, capital_restant, mt_tva_interet)
                    VALUES (:pid, :num, :dt, :cdu, :cap, :int, :crest, :tva)
                """), {
                    "pid": str(pret_id), "num": numero_echeance + i + 1, "dt": l["date_echeance"],
                    "cdu": l["capital_du"], "cap": l["mt_capital"], "int": l["mt_interet"],
                    "crest": l["capital_restant"], "tva": l["mt_tva_interet"],
                })
            fin_prevue = nouvelles_lignes[-1]["date_echeance"]
            capital_restant_final = Decimal(str(nouvelles_lignes[-1]["capital_restant"])) if nouvelles_lignes else nouveau_capital_restant
            mt_echeance_final = Decimal(str(nouvelles_lignes[0]["mt_capital"])) + Decimal(str(nouvelles_lignes[0]["mt_interet"])) if nouvelles_lignes else None
            echeance_restant_final = len(nouvelles_lignes)
        else:
            # Le forçage a soldé (ou dépassé) le capital restant — plus
            # rien à régénérer, le prêt est effectivement remboursé.
            fin_prevue = suivantes[0]["date_echeance"]
            capital_restant_final = Decimal("0")
            mt_echeance_final = None
            echeance_restant_final = 0

        db.execute(text("SET LOCAL app.bypass_verrou_financier = 'true'"))
        db.execute(text("""
            UPDATE prets SET fin_prevue = :fp, capital_restant = :cr,
                mt_echeance = COALESCE(:me, mt_echeance),
                echeance_restant = :nb, nb_echeance = sub.numero_dernier_prelevee + :nb
            FROM (SELECT COALESCE(MAX(numero), 0) AS numero_dernier_prelevee FROM pret_echeances
                  WHERE pret_id = :id AND statut = 'prelevee') sub
            WHERE prets.id = :id
        """), {"fp": fin_prevue, "cr": capital_restant_final, "me": mt_echeance_final,
               "nb": echeance_restant_final, "id": str(pret_id)})
    else:
        # L'échéance forcée était la dernière du tableau.
        db.execute(text("SET LOCAL app.bypass_verrou_financier = 'true'"))
        db.execute(text("UPDATE prets SET capital_restant = :cr WHERE id = :id"),
                   {"cr": max(nouveau_capital_restant, Decimal("0")), "id": str(pret_id)})

    db.execute(
        text("UPDATE prets SET forcage = TRUE, modified_by = :op WHERE id = :id"),
        {"op": operateur, "id": str(pret_id)},
    )
    _audit(db, pret_id, "FORCAGE", operateur, security_level,
                 champ="mt_echeance", ancienne=str(mt_theorique), nouvelle=str(nouveau_montant))
    db.commit()


def recalculer_echeancier_manuel(
    db: Session,
    pret_id: uuid.UUID,
    nouveau_capital_restant: Decimal,
    nouveau_nb_echeances: int,
    date_reprise: date,
    motif: str,
    operateur: str,
    security_level: int,
) -> int:
    """Recalcul manuel de la suite de l'échéancier (ex. ajustement métier
    exceptionnel décidé hors système). Les échéances déjà 'prelevee'
    restent INTOUCHÉES — seules celles pas encore traitées sont supprimées
    et régénérées à partir de nouveau_capital_restant, sur
    nouveau_nb_echeances mois, en commençant à date_reprise."""
    if security_level < 70:
        raise PermissionError("SECURITY_LEVEL >= 70 requis pour recalculer manuellement un échéancier.")

    pret = db.execute(
        text("SELECT algo_name, tx_interets, taux_tva FROM prets WHERE id = :id"),
        {"id": str(pret_id)},
    ).mappings().first()
    if not pret:
        raise ValueError("Prêt introuvable.")

    dernier_numero_traite = db.execute(text("""
        SELECT COALESCE(MAX(numero), 0) FROM pret_echeances
        WHERE pret_id = :pid AND statut = 'prelevee'
    """), {"pid": str(pret_id)}).scalar()

    # Supprime uniquement ce qui n'a pas encore été traité — l'historique
    # des échéances déjà prélevées ne doit jamais être perdu.
    db.execute(text("""
        DELETE FROM pret_echeances WHERE pret_id = :pid AND statut != 'prelevee'
    """), {"pid": str(pret_id)})

    nouvelles_lignes = calculer_echeancier(
        montant=nouveau_capital_restant,
        nb_echeances=nouveau_nb_echeances,
        taux_annuel=Decimal(str(pret["tx_interets"])),
        date_premiere_echeance=date_reprise,
        algo=pret["algo_name"],
        taux_tva=Decimal(str(pret["taux_tva"] or 0)),
    )
    for i, l in enumerate(nouvelles_lignes):
        db.execute(text("""
            INSERT INTO pret_echeances
                (pret_id, numero, date_echeance, capital_du, mt_capital, mt_interet, capital_restant, mt_tva_interet)
            VALUES (:pid, :num, :dt, :cdu, :cap, :int, :crest, :tva)
        """), {
            "pid": str(pret_id), "num": dernier_numero_traite + i + 1, "dt": l["date_echeance"],
            "cdu": l["capital_du"], "cap": l["mt_capital"], "int": l["mt_interet"],
            "crest": l["capital_restant"], "tva": l["mt_tva_interet"],
        })

    mt_echeance = Decimal(str(nouvelles_lignes[0]["mt_capital"])) + Decimal(str(nouvelles_lignes[0]["mt_interet"]))
    fin_prevue = nouvelles_lignes[-1]["date_echeance"]
    db.execute(text("SET LOCAL app.bypass_verrou_financier = 'true'"))
    db.execute(text("""
        UPDATE prets
        SET capital_restant = :cr, echeance_restant = :nb, nb_echeance = :nb_total,
            mt_echeance = :me, fin_prevue = :fp, manuel = TRUE, modified_by = :op
        WHERE id = :id
    """), {
        "cr": nouveau_capital_restant, "nb": nouveau_nb_echeances,
        "nb_total": dernier_numero_traite + nouveau_nb_echeances,
        "me": mt_echeance, "fp": fin_prevue, "op": operateur, "id": str(pret_id),
    })

    _alerte(db, pret_id, "RECALCUL_MANUEL",
            f"Échéancier recalculé manuellement à partir du {date_reprise} — "
            f"nouveau capital restant : {float(nouveau_capital_restant):,.2f}, "
            f"{nouveau_nb_echeances} échéance(s) restante(s). Motif : {motif}", operateur)
    _audit(db, pret_id, "RECALCUL_MANUEL", operateur, security_level,
           champ="capital_restant/echeance_restant",
           ancienne=None, nouvelle=f"{nouveau_capital_restant} / {nouveau_nb_echeances}",
           contexte={"motif": motif, "date_reprise": str(date_reprise)})
    db.commit()
    return len(nouvelles_lignes)


# ──────────────────────────────────────────────────────────────
# SOFT DELETE
# ──────────────────────────────────────────────────────────────

def supprimer_pret_logique(
    db: Session,
    pret_id: uuid.UUID,
    operateur: str,
    security_level: int,
) -> None:
    row = db.execute(text("SELECT pret_debloque FROM prets WHERE id = :id"), {"id": str(pret_id)})
    p = row.mappings().first()
    if p and p["pret_debloque"]:
        raise ValueError("Impossible de supprimer un prêt déjà débloqué. Utilisez l'annulation formelle.")

    db.execute(
        text("UPDATE prets SET deleted_date = NOW(), deleted_by = :op, statut = 'annule' WHERE id = :id"),
        {"op": operateur, "id": str(pret_id)},
    )
    _audit(db, pret_id, "DELETE", operateur, security_level)
    db.commit()


# ──────────────────────────────────────────────────────────────
# CALCUL TAUX ENDETTEMENT GLOBAL (multi-prêts)
# ──────────────────────────────────────────────────────────────

def recalculer_taux_endettement(
    db: Session,
    matricule: str,
    salaire_net: Decimal,
) -> Decimal:
    row = db.execute(
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

    db.execute(
        text("UPDATE prets SET tx_endettement_i = :tx WHERE matricule = :mat AND deleted_date IS NULL"),
        {"tx": float(taux), "mat": matricule},
    )
    db.commit()
    return taux
