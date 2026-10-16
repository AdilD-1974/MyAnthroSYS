"""
virements_service.py
Logique métier du module Virements des salaires & Retenues à la source.

Cycle de vie d'un ordre (migration 063) :
    BROUILLON -> ENREGISTRE -> EN_CONTROLE -> VALIDE -> GENERE -> TRANSMIS
    -> EXECUTE / PARTIEL / REJETE
Le fichier SIMT n'est produit qu'au passage VALIDE -> GENERE, plus à la
création de l'ordre.

⚠️ Hypothèses à vérifier avant intégration (cumulées avec les précédentes,
jamais toutes confirmées par vous) :
 1. Colonnes de `bulletin`/`bulletin_ligne` (id, periode_id, collaborateur_id,
    net_a_payer, rubrique_paie_code, montant, sens) — toujours pas vérifiées
    formellement.
 2. `prets.rubrique_paie_code` — confirmé via pret_service.py.
 3. Session/DB : `from app.core.database import get_db` — confirmé.
 4. Stockage fichier : `storage/virements/{reference_lot}.txt`.
 5. Nature SIMT pour AD_HOC posée à '32' (Standard) par défaut — à ajuster
    si vous préférez '34'.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.simt_500_writer import (
    CompteEmetteur,
    LigneVirementSimt,
    generer_fichier_simt,
)

STORAGE_DIR = Path("storage/virements")
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

NATURE_OPERATION = {"SALAIRE": "34", "RETENUE_TIERS": "32", "PRET_EXTERNE": "35", "AD_HOC": "32"}

# Ordre du cycle — sert à vérifier qu'une transition est bien "d'une étape"
CYCLE = ["BROUILLON", "ENREGISTRE", "EN_CONTROLE", "VALIDE", "GENERE", "TRANSMIS"]


class VirementServiceError(Exception):
    """Erreur métier du module Virements (message affichable à l'utilisateur)."""


# ---------------------------------------------------------------------------
# Référence de lot
# ---------------------------------------------------------------------------

def _generer_reference_lot(db: Session, date_valeur: date) -> str:
    prefixe = f"LOTVIR{date_valeur.strftime('%Y%m')}"
    resultat = db.execute(
        text("SELECT COUNT(*) FROM ordre_virement WHERE reference_lot LIKE :prefixe"),
        {"prefixe": f"{prefixe}%"},
    ).scalar()
    sequence = (resultat or 0) + 1
    return f"{prefixe}{sequence:03d}"


def _libelle_periode(db: Session, periode_id: str) -> str:
    row = db.execute(
        text("SELECT annee, mois FROM calendrier_paie WHERE id = :id"),
        {"id": periode_id},
    ).mappings().first()
    if not row:
        return ""
    mois_fr = [
        "", "JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN",
        "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE",
    ]
    return f"{mois_fr[row['mois']]} {row['annee']}"


# ---------------------------------------------------------------------------
# Constitution des lignes par type d'ordre (inchangé dans le principe)
# ---------------------------------------------------------------------------

def _lignes_salaire(db: Session, periode_id: str) -> list[dict]:
    rows = db.execute(
        text("""
            SELECT
                b.id AS bulletin_id, b.collaborateur_id, b.net_a_payer AS montant,
                c.matricule, c.nom || ' ' || c.prenom AS nom_complet, cp.numero_compte AS rib
            FROM bulletin b
            JOIN calendrier_paie cal ON cal.id = b.periode_id
            JOIN collaborateur_plan_paie cpp
                ON cpp.collaborateur_id = b.collaborateur_id
                AND cpp.plan_paie_id = cal.plan_paie_id
                AND cpp.archive = false
            JOIN collaborateurs c ON c.id = b.collaborateur_id
            JOIN collaborateur_paiements cp
                ON cp.collaborateur_id = b.collaborateur_id
                AND cp.principal = true AND cp.archive = false AND cp.code_mode = 'VIR'
                AND cp.date_debut <= cal.date_fin
                AND (cp.date_fin IS NULL OR cp.date_fin >= cal.date_debut)
            WHERE b.periode_id = :periode_id
                AND UPPER(b.statut) IN ('VALIDE', 'CLOTURE', 'CLOTUREE')
                AND b.net_a_payer > 0
        """),
        {"periode_id": periode_id},
    ).mappings().all()

    sans_rib = [r["nom_complet"] for r in rows if not r["rib"] or len(r["rib"]) != 24]
    if sans_rib:
        raise VirementServiceError(
            "Collaborateur(s) sans RIB valide (24 chiffres) sur leur compte de paiement principal, "
            "à corriger avant de générer : " + ", ".join(sans_rib)
        )

    return [
        {
            "collaborateur_id": r["collaborateur_id"], "bulletin_id": r["bulletin_id"],
            "bulletin_ligne_id": None, "tiers_payeur_id": None, "pret_id": None,
            "montant": float(r["montant"]), "rib": r["rib"], "nom_beneficiaire": r["nom_complet"],
            "reference_transaction": r["matricule"],
            "libelle_motif": f"SALAIRE {_libelle_periode(db, periode_id)}",
            "beneficiaire_type": "COLLABORATEUR_PRINCIPAL",
        }
        for r in rows
    ]


def _lignes_retenues_tiers(db: Session, periode_id: str) -> list[dict]:
    rows = db.execute(
        text("""
            SELECT
                bl.id AS bulletin_ligne_id, bl.bulletin_id, bl.montant,
                b.collaborateur_id, c.matricule,
                rt.id AS retenue_tiers_id, rt.tiers_payeur_id,
                tp.nom AS tiers_nom, tp.rib AS tiers_rib,
                trs.code AS type_retenue, trs.libelle AS type_retenue_libelle
            FROM bulletin_ligne bl
            JOIN bulletin b ON b.id = bl.bulletin_id
            JOIN calendrier_paie cal ON cal.id = b.periode_id
            JOIN collaborateur_plan_paie cpp
                ON cpp.collaborateur_id = b.collaborateur_id
                AND cpp.plan_paie_id = cal.plan_paie_id
                AND cpp.archive = false
            JOIN collaborateurs c ON c.id = b.collaborateur_id
            JOIN retenue_tiers rt ON rt.collaborateur_id = b.collaborateur_id AND rt.statut = 'ACTIF'
            JOIN ref_type_retenue_source trs ON trs.code = rt.type_retenue_source_code AND trs.rubrique_paie_code = bl.code_rubrique
            JOIN tiers_payeur tp ON tp.id = rt.tiers_payeur_id
            WHERE b.periode_id = :periode_id AND bl.montant > 0 AND tp.rib IS NOT NULL
        """),
        {"periode_id": periode_id},
    ).mappings().all()
    return [
        {
            "collaborateur_id": r["collaborateur_id"], "bulletin_id": r["bulletin_id"],
            "bulletin_ligne_id": r["bulletin_ligne_id"], "tiers_payeur_id": r["tiers_payeur_id"],
            "pret_id": None, "montant": float(r["montant"]), "rib": r["tiers_rib"],
            "nom_beneficiaire": r["tiers_nom"], "reference_transaction": r["matricule"],
            "libelle_motif": r["type_retenue_libelle"][:35].upper(),
            "beneficiaire_type": "TIERS_RETENUE",
        }
        for r in rows
    ]


def _lignes_prets_externes(db: Session, periode_id: str) -> list[dict]:
    rows = db.execute(
        text("""
            SELECT
                bl.id AS bulletin_ligne_id, bl.bulletin_id, bl.montant,
                b.collaborateur_id, c.matricule,
                p.id AS pret_id, p.ref_pret, p.organisme_credit,
                p.code_bqe, p.code_guichet, p.no_compte, p.clerib, p.intitule_compte
            FROM bulletin_ligne bl
            JOIN bulletin b ON b.id = bl.bulletin_id
            JOIN calendrier_paie cal ON cal.id = b.periode_id
            JOIN collaborateur_plan_paie cpp
                ON cpp.collaborateur_id = b.collaborateur_id
                AND cpp.plan_paie_id = cal.plan_paie_id
                AND cpp.archive = false
            JOIN collaborateurs c ON c.id = b.collaborateur_id
            JOIN prets p
                ON p.collaborateur_id = b.collaborateur_id AND p.rubrique_paie_code = bl.code_rubrique
                AND p.pret_interne = false AND p.statut IN ('en_cours', 'debloque')
            WHERE b.periode_id = :periode_id AND bl.montant > 0
        """),
        {"periode_id": periode_id},
    ).mappings().all()
    lignes = []
    for r in rows:
        rib = f"{r['code_bqe']}{r['code_guichet']}{r['no_compte']}{r['clerib']}"
        if len(rib) != 24:
            raise VirementServiceError(
                f"RIB de l'organisme de crédit malformé pour le prêt {r['ref_pret']} "
                f"({len(rib)} caractères au lieu de 24)."
            )
        lignes.append({
            "collaborateur_id": r["collaborateur_id"], "bulletin_id": r["bulletin_id"],
            "bulletin_ligne_id": r["bulletin_ligne_id"], "tiers_payeur_id": None, "pret_id": r["pret_id"],
            "montant": float(r["montant"]), "rib": rib,
            "nom_beneficiaire": r["organisme_credit"] or r["intitule_compte"],
            "reference_transaction": r["matricule"], "libelle_motif": f"REMB PRET {r['ref_pret']}",
            "beneficiaire_type": "ORGANISME_CREDIT_PRET",
        })
    return lignes


def _lignes_ad_hoc(db: Session, lignes_saisies: list[dict], libelle_motif: str, plan_paie_id: str | None,
                   societe_id: str) -> list[dict]:
    """lignes_saisies : [{collaborateur_id, montant}, ...] fournies par le
    frontend, quelle que soit la méthode de sélection de la population
    (multi-picker, filtre, import Excel) — le backend ne connaît que le
    résultat final. Si plan_paie_id est fourni, chaque collaborateur doit
    appartenir à ce plan (collaborateur_plan_paie) — pas de repli silencieux.

    RG-MULTISOCIETE-08 (migration 057) : `societe_id` obligatoire -- bug
    corrigé : aucune vérification n'existait auparavant sur l'appartenance
    société de chaque collaborateur_id saisi. Un virement ad-hoc pouvait
    donc payer un collaborateur d'une AUTRE société depuis le compte
    émetteur de la société active (le router valide déjà que le compte
    émetteur appartient à la société active, mais pas les bénéficiaires)."""
    lignes = []
    hors_plan: list[str] = []
    hors_societe: list[str] = []
    for ls in lignes_saisies:
        row = db.execute(
            text("""
                SELECT c.matricule, c.nom || ' ' || c.prenom AS nom_complet, cp.numero_compte AS rib
                FROM collaborateurs c
                JOIN collaborateur_paiements cp
                    ON cp.collaborateur_id = c.id AND cp.principal = true AND cp.actif = true
                    AND cp.archive = false AND cp.code_mode = 'VIR'
                WHERE c.id = :id
                  AND EXISTS (
                      SELECT 1 FROM collaborateur_contrats cc
                       WHERE cc.collaborateur_id = c.id AND cc.societe_id = :sid AND cc.archive = false
                  )
            """),
            {"id": ls["collaborateur_id"], "sid": societe_id},
        ).mappings().first()
        if not row:
            # Volontairement le même message que "sans compte bancaire" --
            # ne pas distinguer "hors société" de "sans RIB" dans l'erreur
            # évite de confirmer l'existence d'un collaborateur d'une autre
            # société à qui n'y a pas accès.
            raise VirementServiceError(
                f"Collaborateur {ls['collaborateur_id']} sans compte bancaire principal actif — exclu."
            )
        if plan_paie_id:
            appartient = db.execute(
                text("""
                    SELECT 1 FROM collaborateur_plan_paie
                    WHERE collaborateur_id = :cid AND plan_paie_id = :pid AND archive = false
                """),
                {"cid": ls["collaborateur_id"], "pid": plan_paie_id},
            ).first()
            if not appartient:
                hors_plan.append(row["nom_complet"])
                continue
        lignes.append({
            "collaborateur_id": ls["collaborateur_id"], "bulletin_id": None, "bulletin_ligne_id": None,
            "tiers_payeur_id": None, "pret_id": None, "montant": float(ls["montant"]), "rib": row["rib"],
            "nom_beneficiaire": row["nom_complet"], "reference_transaction": row["matricule"],
            "libelle_motif": libelle_motif[:35].upper(), "beneficiaire_type": "COLLABORATEUR_PRINCIPAL",
        })
    if hors_plan:
        raise VirementServiceError(
            "Collaborateur(s) n'appartenant pas au plan de paie sélectionné : " + ", ".join(hors_plan)
        )
    return lignes


# ---------------------------------------------------------------------------
# Ventilation par banque destinataire
# ---------------------------------------------------------------------------

def _resoudre_banque_destination(db: Session, rib: str) -> str | None:
    """Déduit le code banque (ref_banque.code) du bénéficiaire à partir des
    3 premiers chiffres de son RIB (= code SIMT de sa banque)."""
    prefixe = rib[:3]
    row = db.execute(
        text("SELECT code FROM ref_banque WHERE code_simt = :prefixe"),
        {"prefixe": prefixe},
    ).mappings().first()
    return row["code"] if row else None


def _comptes_ventilation(db: Session, type_ordre: str) -> list[dict]:
    """Tous les comptes actifs, complets, autorisés pour ce type de virement,
    avec la liste des banques destinataires qu'ils couvrent."""
    rows = db.execute(
        text("""
            SELECT scb.id, scb.code_simt_effectif, scb.rib, scb.raison_sociale_emetteur,
                   scbbd.code_banque_destination
            FROM societe_comptes_bancaires scb
            JOIN societe_compte_bancaire_type_virement sctv
                ON sctv.compte_bancaire_id = scb.id AND sctv.type_virement = :type
            LEFT JOIN societe_compte_bancaire_banque_destination scbbd
                ON scbbd.compte_bancaire_id = scb.id
            WHERE scb.actif = true
                AND scb.code_simt_effectif IS NOT NULL AND scb.rib IS NOT NULL
                AND scb.raison_sociale_emetteur IS NOT NULL
        """),
        {"type": type_ordre},
    ).mappings().all()
    comptes: dict[str, dict] = {}
    for r in rows:
        c = comptes.setdefault(r["id"], {
            "id": r["id"], "code_simt_effectif": r["code_simt_effectif"], "rib": r["rib"],
            "raison_sociale_emetteur": r["raison_sociale_emetteur"], "banques": set(),
        })
        if r["code_banque_destination"]:
            c["banques"].add(r["code_banque_destination"])
    return list(comptes.values())


def _ventiler_lignes(db: Session, type_ordre: str, lignes: list[dict]) -> dict[str, list[dict]]:
    """Répartit les lignes entre les comptes émetteurs selon la banque du
    bénéficiaire. Retourne {compte_id: [lignes]}. Lève une erreur listant les
    bénéficiaires dont la banque n'est couverte par aucun compte — pas de
    repli silencieux sur un compte par défaut."""
    comptes = _comptes_ventilation(db, type_ordre)
    if not comptes:
        raise VirementServiceError(
            "Aucun compte émetteur configuré pour ce type de virement (Comptes émetteurs)."
        )

    par_banque: dict[str, list[str]] = {}
    for c in comptes:
        for banque in c["banques"]:
            par_banque.setdefault(banque, []).append(c["id"])

    groupes: dict[str, list[dict]] = {}
    non_couverts: list[str] = []
    for ligne in lignes:
        banque = _resoudre_banque_destination(db, ligne["rib"])
        comptes_possibles = par_banque.get(banque, []) if banque else []
        if not comptes_possibles:
            non_couverts.append(f"{ligne['nom_beneficiaire']} ({ligne['rib'][:3]}...)")
            continue
        if len(comptes_possibles) > 1:
            raise VirementServiceError(
                f"Banque {banque} couverte par plusieurs comptes émetteurs à la fois "
                f"({len(comptes_possibles)}) — corrigez la configuration dans Comptes émetteurs "
                f"avant de ventiler (une banque ne doit être couverte que par un seul compte "
                f"par type de virement)."
            )
        groupes.setdefault(comptes_possibles[0], []).append(ligne)

    if non_couverts:
        raise VirementServiceError(
            "Bénéficiaires dont la banque n'est couverte par aucun compte émetteur : "
            + ", ".join(non_couverts[:10])
            + (f" (+{len(non_couverts) - 10} autres)" if len(non_couverts) > 10 else "")
        )

    return groupes


# ---------------------------------------------------------------------------
# Création de l'ordre (BROUILLON) — pas de fichier généré ici
# ---------------------------------------------------------------------------

def _persister_ordre(
    db: Session, type_ordre: str, periode_id: str | None, banque_emettrice_id: str,
    date_valeur: date, lignes: list[dict], created_by: str, libelle_motif_manuel: str | None = None,
) -> dict:
    reference_lot = _generer_reference_lot(db, date_valeur)
    ordre_id = str(uuid.uuid4())
    montant_total = sum(l["montant"] for l in lignes)

    db.execute(
        text("""
            INSERT INTO ordre_virement
                (id, type, nature_operation, periode_id, banque_emettrice_id, date_valeur,
                 reference_lot, statut, nb_lignes, montant_total, created_by, libelle_motif_manuel)
            VALUES
                (:id, :type, :nature, :periode_id, :banque_id, :date_valeur, :reference_lot,
                 'BROUILLON', :nb_lignes, :montant_total, :created_by, :libelle_motif_manuel)
        """),
        {
            "id": ordre_id, "type": type_ordre, "nature": NATURE_OPERATION[type_ordre],
            "periode_id": periode_id, "banque_id": banque_emettrice_id, "date_valeur": date_valeur,
            "reference_lot": reference_lot, "nb_lignes": len(lignes), "montant_total": montant_total,
            "created_by": created_by, "libelle_motif_manuel": libelle_motif_manuel,
        },
    )
    for l in lignes:
        db.execute(
            text("""
                INSERT INTO ligne_virement
                    (id, ordre_virement_id, beneficiaire_type, collaborateur_id, tiers_payeur_id,
                     pret_id, bulletin_id, bulletin_ligne_id, montant, rib_beneficiaire_snapshot,
                     nom_beneficiaire_snapshot, libelle_motif)
                VALUES
                    (:id, :ordre_id, :beneficiaire_type, :collaborateur_id, :tiers_payeur_id, :pret_id,
                     :bulletin_id, :bulletin_ligne_id, :montant, :rib, :nom, :libelle)
            """),
            {
                "id": str(uuid.uuid4()), "ordre_id": ordre_id, "beneficiaire_type": l["beneficiaire_type"],
                "collaborateur_id": l["collaborateur_id"], "tiers_payeur_id": l["tiers_payeur_id"],
                "pret_id": l["pret_id"], "bulletin_id": l["bulletin_id"], "bulletin_ligne_id": l["bulletin_ligne_id"],
                "montant": l["montant"], "rib": l["rib"], "nom": l["nom_beneficiaire"],
                "libelle": l["libelle_motif"][:35],
            },
        )
    return {"id": ordre_id, "reference_lot": reference_lot, "nb_lignes": len(lignes), "montant_total": montant_total}


def initier_ordre_virement(
    db: Session, type_ordre: str, periode_id: str, mode: str,
    date_valeur: date, created_by: str, banque_emettrice_id: str | None = None,
) -> list[dict]:
    """mode = 'MANUEL' (un seul compte choisi explicitement, comportement
    historique) ou 'VENTILE' (répartition automatique multi-comptes selon la
    banque du bénéficiaire — peut produire plusieurs ordres/fichiers)."""
    if type_ordre not in NATURE_OPERATION or type_ordre == "AD_HOC":
        raise VirementServiceError(f"Type d'ordre invalide pour cette fonction : {type_ordre}")

    existant = db.execute(
        text("""
            SELECT id FROM ordre_virement
            WHERE periode_id = :periode_id AND type = :type AND statut != 'REJETE'
        """),
        {"periode_id": periode_id, "type": type_ordre},
    ).first()
    if existant:
        raise VirementServiceError("Un ordre de virement de ce type existe déjà pour cette période.")

    constructeurs = {"SALAIRE": _lignes_salaire, "RETENUE_TIERS": _lignes_retenues_tiers, "PRET_EXTERNE": _lignes_prets_externes}
    lignes = constructeurs[type_ordre](db, periode_id)
    if not lignes:
        raise VirementServiceError("Aucune ligne à virer trouvée pour cette période et ce type d'ordre.")

    resultats = []
    if mode == "MANUEL":
        if not banque_emettrice_id:
            raise VirementServiceError("Compte émetteur requis en mode manuel.")
        autorise = db.execute(
            text("""
                SELECT 1 FROM societe_compte_bancaire_type_virement
                WHERE compte_bancaire_id = :id AND type_virement = :type
            """),
            {"id": banque_emettrice_id, "type": type_ordre},
        ).first()
        if not autorise:
            raise VirementServiceError("Ce compte n'est pas autorisé pour ce type de virement.")
        resultats.append(_persister_ordre(db, type_ordre, periode_id, banque_emettrice_id, date_valeur, lignes, created_by))

    elif mode == "VENTILE":
        groupes = _ventiler_lignes(db, type_ordre, lignes)
        for compte_id, lignes_du_compte in groupes.items():
            resultats.append(_persister_ordre(db, type_ordre, periode_id, compte_id, date_valeur, lignes_du_compte, created_by))
    else:
        raise VirementServiceError(f"Mode de génération inconnu : {mode}")

    db.commit()
    return resultats


def creer_ordre_ad_hoc(
    db: Session, banque_emettrice_id: str, date_valeur: date, libelle_motif: str,
    lignes_saisies: list[dict], created_by: str, societe_id: str, plan_paie_id: str | None = None,
) -> dict:
    if not lignes_saisies:
        raise VirementServiceError("Aucune ligne saisie pour ce virement ad-hoc.")
    autorise = db.execute(
        text("""
            SELECT 1 FROM societe_compte_bancaire_type_virement
            WHERE compte_bancaire_id = :id AND type_virement = 'AD_HOC'
        """),
        {"id": banque_emettrice_id},
    ).first()
    if not autorise:
        raise VirementServiceError("Ce compte n'est pas autorisé pour les virements ad-hoc.")
    lignes = _lignes_ad_hoc(db, lignes_saisies, libelle_motif, plan_paie_id, societe_id)
    resultat = _persister_ordre(db, "AD_HOC", None, banque_emettrice_id, date_valeur, lignes, created_by, libelle_motif)
    db.commit()
    return resultat


# ---------------------------------------------------------------------------
# Transitions du workflow de contrôle
# ---------------------------------------------------------------------------

def _transition(db: Session, ordre_id: str, depuis: str | list[str], vers: str, champs_horodatage: dict | None = None) -> None:
    liste_depuis = [depuis] if isinstance(depuis, str) else depuis
    assignations = ", ".join(f"{k} = :{k}" for k in (champs_horodatage or {}))
    sql = f"UPDATE ordre_virement SET statut = :vers" + (f", {assignations}" if assignations else "") + \
          " WHERE id = :id AND statut = ANY(:depuis) RETURNING id"
    resultat = db.execute(
        text(sql),
        {"vers": vers, "id": ordre_id, "depuis": liste_depuis, **(champs_horodatage or {})},
    ).first()
    if not resultat:
        raise VirementServiceError(f"Transition impossible : l'ordre n'est pas à une étape compatible ({'/'.join(liste_depuis)}).")
    db.commit()


def enregistrer_ordre(db: Session, ordre_id: str, utilisateur_id: str) -> None:
    _transition(db, ordre_id, "BROUILLON", "ENREGISTRE",
                {"enregistre_par": utilisateur_id, "enregistre_le": datetime.now()})


def passer_en_controle(db: Session, ordre_id: str, utilisateur_id: str) -> list[dict]:
    _transition(db, ordre_id, "ENREGISTRE", "EN_CONTROLE",
                {"controle_par": utilisateur_id, "controle_le": datetime.now()})
    return _executer_rapprochements(db, ordre_id, utilisateur_id)


def _inserer_controle(db: Session, ordre_id: str, type_controle: str, resultat: str, message: str, utilisateur_id: str) -> dict:
    db.execute(
        text("""
            INSERT INTO ordre_virement_controle (ordre_virement_id, type_controle, resultat, message, controle_par)
            VALUES (:ordre_id, :type, :resultat, :message, :par)
        """),
        {"ordre_id": ordre_id, "type": type_controle, "resultat": resultat, "message": message, "par": utilisateur_id},
    )
    return {"type_controle": type_controle, "resultat": resultat, "message": message}


def _executer_rapprochements(db: Session, ordre_id: str, utilisateur_id: str) -> list[dict]:
    ordre = db.execute(text("SELECT * FROM ordre_virement WHERE id = :id"), {"id": ordre_id}).mappings().first()
    resultats = []

    # 1. Montant total ordre == somme des lignes
    somme_lignes = db.execute(
        text("SELECT COALESCE(SUM(montant), 0) FROM ligne_virement WHERE ordre_virement_id = :id"),
        {"id": ordre_id},
    ).scalar()
    ok = abs(float(somme_lignes) - float(ordre["montant_total"])) < 0.01
    resultats.append(_inserer_controle(
        db, ordre_id, "MONTANT_TOTAL", "OK" if ok else "ERREUR",
        f"Total ordre {ordre['montant_total']} vs somme lignes {somme_lignes}", utilisateur_id,
    ))

    # 2. RIB valides + doublons bénéficiaires
    lignes = db.execute(
        text("SELECT rib_beneficiaire_snapshot FROM ligne_virement WHERE ordre_virement_id = :id"),
        {"id": ordre_id},
    ).mappings().all()
    ribs = [l["rib_beneficiaire_snapshot"] for l in lignes]
    ribs_invalides = [r for r in ribs if not r or len(r) != 24 or not r.isdigit()]
    doublons = len(ribs) - len(set(ribs))
    if ribs_invalides:
        resultats.append(_inserer_controle(db, ordre_id, "RIB_VALIDE", "ERREUR", f"{len(ribs_invalides)} RIB invalide(s)", utilisateur_id))
    else:
        resultats.append(_inserer_controle(db, ordre_id, "RIB_VALIDE", "OK", "Tous les RIB font 24 chiffres", utilisateur_id))
    resultats.append(_inserer_controle(
        db, ordre_id, "DOUBLONS", "ALERTE" if doublons else "OK",
        f"{doublons} RIB en doublon" if doublons else "Aucun doublon", utilisateur_id,
    ))

    # 3. Écart vs période précédente (même type)
    precedent = db.execute(
        text("""
            SELECT montant_total, nb_lignes FROM ordre_virement
            WHERE type = :type AND id != :id AND created_at < :cree_le
            ORDER BY created_at DESC LIMIT 1
        """),
        {"type": ordre["type"], "id": ordre_id, "cree_le": ordre["created_at"]},
    ).mappings().first()
    if precedent and precedent["montant_total"]:
        ecart_pct = abs(float(ordre["montant_total"]) - float(precedent["montant_total"])) / float(precedent["montant_total"]) * 100
        resultats.append(_inserer_controle(
            db, ordre_id, "ECART_PERIODE_PRECEDENTE", "ALERTE" if ecart_pct > 20 else "OK",
            f"Écart de {ecart_pct:.1f}% vs ordre précédent", utilisateur_id,
        ))
    else:
        resultats.append(_inserer_controle(db, ordre_id, "ECART_PERIODE_PRECEDENTE", "OK", "Pas d'ordre précédent comparable", utilisateur_id))

    # 4. Nombre de lignes attendu (uniquement pour SALAIRE, comparé aux bulletins de la période)
    if ordre["type"] == "SALAIRE" and ordre["periode_id"]:
        attendu = db.execute(
            text("SELECT COUNT(*) FROM bulletin WHERE periode_id = :p AND UPPER(statut) IN ('VALIDE','CLOTURE','CLOTUREE') AND net_a_payer > 0"),
            {"p": ordre["periode_id"]},
        ).scalar()
        ok = attendu == ordre["nb_lignes"]
        resultats.append(_inserer_controle(
            db, ordre_id, "NB_LIGNES_ATTENDU", "OK" if ok else "ALERTE",
            f"{ordre['nb_lignes']} lignes générées vs {attendu} bulletins attendus", utilisateur_id,
        ))

    # 5. Compte émetteur toujours actif et complet
    compte = db.execute(
        text("SELECT actif, code_simt_effectif, rib, raison_sociale_emetteur FROM societe_comptes_bancaires WHERE id = :id"),
        {"id": ordre["banque_emettrice_id"]},
    ).mappings().first()
    compte_ok = bool(compte and compte["actif"] and compte["code_simt_effectif"] and compte["rib"] and compte["raison_sociale_emetteur"])
    resultats.append(_inserer_controle(
        db, ordre_id, "COMPTE_EMETTEUR_ACTIF", "OK" if compte_ok else "ERREUR",
        "Compte émetteur actif et complet" if compte_ok else "Compte émetteur désactivé ou incomplet depuis la génération",
        utilisateur_id,
    ))

    db.commit()
    return resultats


def cocher_ligne(db: Session, ligne_id: str, utilisateur_id: str, valeur: bool) -> None:
    db.execute(
        text("""
            UPDATE ligne_virement SET controlee = :v, controlee_par = :par, controlee_le = now()
            WHERE id = :id
        """),
        {"v": valeur, "par": utilisateur_id, "id": ligne_id},
    )
    db.commit()


def valider_ordre(db: Session, ordre_id: str, utilisateur_id: str, forcer_alertes: bool = False) -> None:
    controles = db.execute(
        text("""
            SELECT type_controle, resultat FROM ordre_virement_controle
            WHERE ordre_virement_id = :id
            AND controle_le = (SELECT MAX(controle_le) FROM ordre_virement_controle c2
                                WHERE c2.ordre_virement_id = :id AND c2.type_controle = ordre_virement_controle.type_controle)
        """),
        {"id": ordre_id},
    ).mappings().all()
    erreurs = [c for c in controles if c["resultat"] == "ERREUR"]
    alertes = [c for c in controles if c["resultat"] == "ALERTE"]
    if erreurs:
        raise VirementServiceError(
            f"{len(erreurs)} rapprochement(s) en erreur bloquent la validation : "
            + ", ".join(c["type_controle"] for c in erreurs)
        )
    if alertes and not forcer_alertes:
        raise VirementServiceError(
            f"{len(alertes)} alerte(s) non résolue(s) — validez explicitement (forcer_alertes) pour continuer malgré tout."
        )
    _transition(db, ordre_id, "EN_CONTROLE", "VALIDE", {"valide_par": utilisateur_id, "valide_le": datetime.now()})


def revenir_en_arriere(db: Session, ordre_id: str) -> None:
    """Fait régresser l'ordre d'une étape. Autorisé aussi depuis GENERE vers
    VALIDE (ex. le moteur SIMT a été corrigé après une première génération —
    le fichier sur disque reste inchangé jusqu'à la prochaine génération qui
    l'écrasera). Bloqué en revanche après TRANSMIS (voir signaler_rejet /
    regenerer_ordre_virement pour ce cas, une fois l'ordre réellement envoyé
    à la banque)."""
    ordre = db.execute(text("SELECT statut FROM ordre_virement WHERE id = :id"), {"id": ordre_id}).mappings().first()
    if not ordre:
        raise VirementServiceError("Ordre introuvable.")
    if ordre["statut"] not in ("ENREGISTRE", "EN_CONTROLE", "VALIDE", "GENERE"):
        raise VirementServiceError("Retour en arrière possible uniquement entre ENREGISTRE, EN_CONTROLE, VALIDE et GENERE.")
    precedent = CYCLE[CYCLE.index(ordre["statut"]) - 1]
    db.execute(text("UPDATE ordre_virement SET statut = :s WHERE id = :id"), {"s": precedent, "id": ordre_id})
    db.commit()


def regenerer_lignes_brouillon(db: Session, ordre_id: str) -> dict:
    """Reconstruit les lignes d'un ordre encore en BROUILLON à partir de la
    source (utile si des dossiers/bulletins ont changé entre-temps)."""
    ordre = db.execute(text("SELECT * FROM ordre_virement WHERE id = :id"), {"id": ordre_id}).mappings().first()
    if not ordre or ordre["statut"] != "BROUILLON":
        raise VirementServiceError("Seul un ordre en BROUILLON peut être régénéré à partir de la source.")
    if ordre["type"] == "AD_HOC":
        raise VirementServiceError("Un ordre ad-hoc ne peut pas être régénéré automatiquement (population/montants libres).")

    constructeurs = {"SALAIRE": _lignes_salaire, "RETENUE_TIERS": _lignes_retenues_tiers, "PRET_EXTERNE": _lignes_prets_externes}
    lignes = constructeurs[ordre["type"]](db, ordre["periode_id"])
    db.execute(text("DELETE FROM ligne_virement WHERE ordre_virement_id = :id"), {"id": ordre_id})
    montant_total = 0.0
    for l in lignes:
        montant_total += l["montant"]
        db.execute(
            text("""
                INSERT INTO ligne_virement
                    (id, ordre_virement_id, beneficiaire_type, collaborateur_id, tiers_payeur_id,
                     pret_id, bulletin_id, bulletin_ligne_id, montant, rib_beneficiaire_snapshot,
                     nom_beneficiaire_snapshot, libelle_motif)
                VALUES
                    (:id, :ordre_id, :beneficiaire_type, :collaborateur_id, :tiers_payeur_id, :pret_id,
                     :bulletin_id, :bulletin_ligne_id, :montant, :rib, :nom, :libelle)
            """),
            {
                "id": str(uuid.uuid4()), "ordre_id": ordre_id, "beneficiaire_type": l["beneficiaire_type"],
                "collaborateur_id": l["collaborateur_id"], "tiers_payeur_id": l["tiers_payeur_id"],
                "pret_id": l["pret_id"], "bulletin_id": l["bulletin_id"], "bulletin_ligne_id": l["bulletin_ligne_id"],
                "montant": l["montant"], "rib": l["rib"], "nom": l["nom_beneficiaire"], "libelle": l["libelle_motif"][:35],
            },
        )
    db.execute(
        text("UPDATE ordre_virement SET nb_lignes = :n, montant_total = :m WHERE id = :id"),
        {"n": len(lignes), "m": montant_total, "id": ordre_id},
    )
    db.commit()
    return {"id": ordre_id, "nb_lignes": len(lignes), "montant_total": montant_total}


# ---------------------------------------------------------------------------
# Génération du fichier SIMT — uniquement au passage VALIDE -> GENERE
# ---------------------------------------------------------------------------

def generer_fichier_ordre(db: Session, ordre_id: str) -> dict:
    ordre = db.execute(text("SELECT * FROM ordre_virement WHERE id = :id"), {"id": ordre_id}).mappings().first()
    if not ordre or ordre["statut"] != "VALIDE":
        raise VirementServiceError("Seul un ordre VALIDE peut produire son fichier SIMT.")

    compte_row = db.execute(
        text("SELECT code_banque, code_simt_effectif, rib, raison_sociale_emetteur FROM societe_comptes_bancaires WHERE id = :id"),
        {"id": ordre["banque_emettrice_id"]},
    ).mappings().first()
    if not compte_row or not all([compte_row["code_simt_effectif"], compte_row["rib"], compte_row["raison_sociale_emetteur"]]):
        raise VirementServiceError("Compte émetteur incomplet — impossible de générer le fichier.")

    lignes = db.execute(
        text("""
            SELECT reference_transaction_placeholder, rib_beneficiaire_snapshot, nom_beneficiaire_snapshot, montant, libelle_motif
            FROM (
                SELECT lv.*, c.matricule AS reference_transaction_placeholder
                FROM ligne_virement lv
                LEFT JOIN collaborateurs c ON c.id = lv.collaborateur_id
                WHERE lv.ordre_virement_id = :id
            ) t
        """),
        {"id": ordre_id},
    ).mappings().all()
    if not lignes:
        raise VirementServiceError("Aucune ligne à inclure dans le fichier.")

    compte = CompteEmetteur(
        code_banque=compte_row["code_banque"], code_simt=compte_row["code_simt_effectif"], rib=compte_row["rib"],
        raison_sociale=compte_row["raison_sociale_emetteur"],
    )
    lignes_simt = [
        LigneVirementSimt(
            reference_transaction=l["reference_transaction_placeholder"] or "N/A",
            montant=float(l["montant"]), rib_beneficiaire=l["rib_beneficiaire_snapshot"],
            nom_beneficiaire=l["nom_beneficiaire_snapshot"], libelle_motif=l["libelle_motif"],
        )
        for l in lignes
    ]
    contenu_fichier = generer_fichier_simt(ordre["reference_lot"], compte, ordre["type"], lignes_simt)
    chemin_fichier = STORAGE_DIR / f"{ordre['reference_lot']}.txt"
    chemin_fichier.write_text(contenu_fichier, encoding="ascii", errors="ignore", newline="")

    db.execute(
        text("UPDATE ordre_virement SET statut = 'GENERE', fichier_genere_path = :chemin WHERE id = :id"),
        {"chemin": str(chemin_fichier), "id": ordre_id},
    )
    db.commit()
    return {"id": ordre_id, "fichier_genere_path": str(chemin_fichier)}


# ---------------------------------------------------------------------------
# Transitions post-génération (inchangées)
# ---------------------------------------------------------------------------

def marquer_transmis(db: Session, ordre_id: str) -> None:
    _transition(db, ordre_id, "GENERE", "TRANSMIS")


def marquer_execute(db: Session, ordre_id: str) -> None:
    _transition(db, ordre_id, "TRANSMIS", "EXECUTE")
    db.execute(text("UPDATE ligne_virement SET statut_ligne = 'EXECUTEE' WHERE ordre_virement_id = :id"), {"id": ordre_id})
    db.commit()


def signaler_rejet(db: Session, ordre_id: str, lignes_rejetees: list[dict]) -> None:
    ordre = db.execute(text("SELECT statut FROM ordre_virement WHERE id = :id"), {"id": ordre_id}).mappings().first()
    if not ordre or ordre["statut"] != "TRANSMIS":
        raise VirementServiceError("Seul un ordre TRANSMIS peut recevoir un rejet.")
    ids_rejetees = [l["ligne_id"] for l in lignes_rejetees]
    for l in lignes_rejetees:
        db.execute(
            text("UPDATE ligne_virement SET statut_ligne = 'REJETEE', motif_rejet = :motif WHERE id = :id AND ordre_virement_id = :ordre_id"),
            {"motif": l["motif"], "id": l["ligne_id"], "ordre_id": ordre_id},
        )
    if ids_rejetees:
        db.execute(
            text("UPDATE ligne_virement SET statut_ligne = 'EXECUTEE' WHERE ordre_virement_id = :ordre_id AND id != ALL(CAST(:ids AS uuid[]))"),
            {"ordre_id": ordre_id, "ids": ids_rejetees},
        )
    nb_total = db.execute(text("SELECT COUNT(*) FROM ligne_virement WHERE ordre_virement_id = :id"), {"id": ordre_id}).scalar()
    nouveau_statut = "REJETE" if len(ids_rejetees) == nb_total else "PARTIEL"
    db.execute(text("UPDATE ordre_virement SET statut = :statut WHERE id = :id"), {"statut": nouveau_statut, "id": ordre_id})
    db.commit()


def regenerer_ordre_virement(db: Session, ordre_id: str) -> dict:
    """Régénère un NOUVEAU fichier pour les lignes rejetées d'un ordre déjà
    transmis (distinct de revenir_en_arriere, qui concerne le workflow
    pré-génération)."""
    ordre = db.execute(text("SELECT * FROM ordre_virement WHERE id = :id"), {"id": ordre_id}).mappings().first()
    if not ordre or ordre["statut"] not in ("REJETE", "PARTIEL"):
        raise VirementServiceError("Seul un ordre REJETE ou PARTIEL peut être régénéré.")
    db.execute(text("DELETE FROM ligne_virement WHERE ordre_virement_id = :id AND statut_ligne != 'REJETEE'"), {"id": ordre_id})
    db.execute(text("UPDATE ligne_virement SET statut_ligne = 'GENEREE', motif_rejet = NULL WHERE ordre_virement_id = :id"), {"id": ordre_id})
    db.execute(text("UPDATE ordre_virement SET statut = 'VALIDE' WHERE id = :id"), {"id": ordre_id})
    db.commit()
    return {"id": ordre_id}
