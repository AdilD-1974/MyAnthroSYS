"""
app/services/workflow_engine.py — Moteur d'exécution des workflows
Auteur : Adil DAIA

Responsabilités :
  - Création d'instance lors d'une soumission de demande
  - Résolution dynamique des acteurs (HIERARCHIE_*, UO_*, ROLE, etc.)
  - Exécution des actions par déclencheur (ENTREE/VALIDATION/REJET/TIMEOUT)
  - Gestion des transitions entre étapes
  - Auto-skip si même acteur déjà décidé
  - "Retour pour modification" (statut EN_MODIFICATION)
  - Action TACHE_SYSTEME pour mises à jour métier

Usage typique :
    engine = WorkflowEngine(db)
    instance_id = await engine.start(
        type_objet="CONGE",
        id_objet=demande_uuid,
        demandeur_id=collab_uuid,
        contexte={"famille_conge": "CONGE_PAYE", "categorie_pro": "CP02",
                  "nb_jours": 5, "date_debut": "2026-05-15", ...}
    )
    await engine.decide(
        instance_etape_id=...,
        acteur_id=user_id,
        type_decision="VALIDER",
        commentaire="OK pour moi"
    )
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Optional, Sequence
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ─── Types & helpers ───────────────────────────────────────────────────────────

@dataclass
class Acteur:
    user_id: UUID
    est_observateur: bool = False
    est_fallback: bool = False


def _interpolate(template: str, contexte: dict) -> str:
    """Remplace {variable} par sa valeur dans le contexte."""
    if not template:
        return ""
    out = template
    for k, v in (contexte or {}).items():
        out = out.replace("{" + str(k) + "}", str(v) if v is not None else "")
    return out


# ─── Moteur principal ──────────────────────────────────────────────────────────

class WorkflowEngine:
    """Moteur d'exécution des workflows paramétrables."""

    def __init__(self, db: Session):
        self.db = db

    # ── 1. Démarrage d'une instance ────────────────────────────────────────────
    def _create_demande_header(self, type_objet: str, id_objet, demandeur_id, instance_id) -> None:
        """Crée l'en-tête générique dans le registre `demande` (idempotent).

        Point de création UNIVERSEL : appelé à chaque création d'instance, quel
        que soit le chemin d'entrée (trigger_workflow, start_by_code, start…).
        La table métier (table_objet) est résolue via ref_type_demande, source
        unique de vérité du mapping type → table. N'insère que si le type est
        connu du registre ; sinon ignore silencieusement (non bloquant)."""
        try:
            self.db.execute(text("""
                INSERT INTO demande (
                    type_demande, table_objet, id_objet, demandeur_id,
                    statut, wf_instance_id, date_soumission
                )
                SELECT rtd.code, rtd.table_source, :oid, :dem,
                       'en_attente', :wf, now()
                FROM ref_type_demande rtd
                WHERE rtd.code = :t
                ON CONFLICT (table_objet, id_objet) DO UPDATE
                   SET wf_instance_id = EXCLUDED.wf_instance_id,
                       updated_at = now()
            """), {
                "t": type_objet, "oid": str(id_objet),
                "dem": str(demandeur_id) if demandeur_id else None,
                "wf": str(instance_id) if instance_id else None,
            })
        except Exception as e:
            logger.warning("Création en-tête registre échouée (inst %s): %s", instance_id, e)

    def start(
        self,
        type_objet: str,
        id_objet: UUID,
        demandeur_id: UUID,
        contexte: dict,
    ) -> Optional[UUID]:
        """Trouve le workflow applicable et crée l'instance."""
        wf = self._find_applicable_workflow(type_objet, contexte)
        if not wf:
            logger.warning("Aucun workflow applicable pour %s / %s", type_objet, contexte)
            return None

        # Création de l'instance
        inst_id = self.db.execute(text("""
            INSERT INTO wf_instance (
                id_workflow, code_workflow, version_workflow,
                type_objet, id_objet, statut, demandeur_id, contexte
            ) VALUES (
                :wf_id, :code, :version, :type_objet, :id_objet,
                'EN_COURS', :demandeur, CAST(:contexte AS JSONB)
            ) RETURNING id
        """), {
            "wf_id": wf["id"], "code": wf["code"], "version": wf["version"],
            "type_objet": type_objet, "id_objet": str(id_objet),
            "demandeur": str(demandeur_id),
            "contexte": json.dumps(contexte, default=str),
        }).scalar()

        # Création des enregistrements pour toutes les étapes
        etapes = self._get_etapes(wf["id"])
        for e in etapes:
            self.db.execute(text("""
                INSERT INTO wf_instance_etape (
                    id_instance, id_etape_def, ordre, statut
                ) VALUES (:inst, :etape, :ordre, 'EN_ATTENTE')
            """), {"inst": str(inst_id), "etape": e["id"], "ordre": e["ordre"]})

        # En-tête du registre des demandes (universel, idempotent)
        self._create_demande_header(type_objet, id_objet, demandeur_id, inst_id)

        self.db.commit()
        # Activer la première étape
        self._activate_next_etape(inst_id, demandeur_id, current_ordre=0)
        return inst_id

    def start_by_code(
        self,
        code_workflow: str,
        id_objet: UUID,
        demandeur_id: UUID,
        contexte: dict,
    ) -> Optional[UUID]:
        """Démarre un workflow EXACT par son code (affectation explicite, pas de choix par critères).
        Prend la version ACTIVE la plus récente du workflow de code donné."""
        wf = self.db.execute(text("""
            SELECT id, code, version
            FROM ref_workflow
            WHERE code = :c AND statut = 'ACTIF' AND actif = true
            ORDER BY version DESC
            LIMIT 1
        """), {"c": code_workflow}).mappings().first()
        if not wf:
            logger.warning("Workflow introuvable / inactif : %s", code_workflow)
            return None

        inst_id = self.db.execute(text("""
            INSERT INTO wf_instance (
                id_workflow, code_workflow, version_workflow,
                type_objet, id_objet, statut, demandeur_id, contexte
            ) VALUES (
                :wf_id, :code, :version, :type_objet, :id_objet,
                'EN_COURS', :demandeur, CAST(:contexte AS JSONB)
            ) RETURNING id
        """), {
            "wf_id": wf["id"], "code": wf["code"], "version": wf["version"],
            "type_objet": contexte.get("__type_objet__", code_workflow),
            "id_objet": str(id_objet),
            "demandeur": str(demandeur_id),
            "contexte": json.dumps(contexte, default=str),
        }).scalar()

        etapes = self._get_etapes(wf["id"])
        for e in etapes:
            self.db.execute(text("""
                INSERT INTO wf_instance_etape (
                    id_instance, id_etape_def, ordre, statut
                ) VALUES (:inst, :etape, :ordre, 'EN_ATTENTE')
            """), {"inst": str(inst_id), "etape": e["id"], "ordre": e["ordre"]})

        # En-tête du registre des demandes (universel, idempotent)
        self._create_demande_header(
            contexte.get("__type_objet__", code_workflow), id_objet, demandeur_id, inst_id
        )

        self.db.commit()
        self._activate_next_etape(inst_id, demandeur_id, current_ordre=0)
        self._auto_soumission_demandeur(inst_id, demandeur_id)
        return inst_id

    def _auto_soumission_demandeur(self, instance_id: UUID, demandeur_id: UUID) -> None:
        """Si la 1re étape active est une VALIDATION dont l'unique acteur est le DEMANDEUR
        (étape « soumission »), on la franchit automatiquement : la création de la demande
        VAUT soumission. Active alors l'étape suivante (ex. Validation RH)."""
        cur = self.db.execute(text("""
            SELECT ie.id AS ie_id, e.id AS etape_id, e.type_etape, e.ordre
            FROM wf_instance i
            JOIN wf_instance_etape ie ON ie.id_instance = i.id
            JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
            WHERE i.id = :i AND ie.statut = 'EN_COURS'
            ORDER BY e.ordre ASC LIMIT 1
        """), {"i": str(instance_id)}).mappings().first()
        if not cur or cur["type_etape"] != "VALIDATION":
            return
        # L'étape est-elle portée UNIQUEMENT par le DEMANDEUR ?
        acteurs = self.db.execute(text("""
            SELECT type_acteur FROM ref_workflow_acteur
            WHERE id_etape = :e AND actif = true
        """), {"e": str(cur["etape_id"])}).mappings().all()
        types = {a["type_acteur"] for a in acteurs}
        if types and types.issubset({"DEMANDEUR"}):
            try:
                self.decide(
                    instance_etape_id=cur["ie_id"],
                    acteur_id=demandeur_id,
                    type_decision="VALIDER",
                    commentaire="Soumission automatique à la création de la demande",
                )
            except Exception as e:  # pragma: no cover
                logger.warning("Auto-soumission étape 1 échouée (inst %s): %s", instance_id, e)

    # ── 2. Décision d'un acteur ────────────────────────────────────────────────
    def decide(
        self,
        instance_etape_id: UUID,
        acteur_id: UUID,
        type_decision: str,  # VALIDER / REJETER / RENVOYER / DELEGUER / VISER
        commentaire: Optional[str] = None,
        pieces_jointes: Optional[list] = None,
    ) -> dict:
        """Enregistre la décision d'un acteur et fait avancer le workflow."""
        # Charger le contexte
        ie = self.db.execute(text("""
            SELECT ie.*, i.demandeur_id, i.id AS instance_id, i.contexte,
                   e.id_workflow, e.ordre AS etape_ordre, e.mode_validation,
                   e.code AS etape_code, e.libelle AS etape_libelle
            FROM wf_instance_etape ie
            JOIN wf_instance i ON i.id = ie.id_instance
            JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
            WHERE ie.id = :ie
        """), {"ie": str(instance_etape_id)}).mappings().first()

        if not ie:
            raise ValueError(f"Instance étape {instance_etape_id} introuvable")
        if ie["statut"] not in ("EN_COURS", "EN_ATTENTE"):
            raise ValueError(f"Étape déjà clôturée (statut={ie['statut']})")

        # Enregistrer l'action
        self.db.execute(text("""
            INSERT INTO wf_instance_action (
                id_instance_etape, acteur_id, type_decision,
                commentaire, pieces_jointes
            ) VALUES (
                :ie, :acteur, :td, :comm, CAST(:pj AS JSONB)
            )
        """), {
            "ie": str(instance_etape_id), "acteur": str(acteur_id),
            "td": type_decision, "comm": commentaire,
            "pj": json.dumps(pieces_jointes or []),
        })

        # Compteurs
        if type_decision == "VALIDER":
            self.db.execute(text("UPDATE wf_instance_etape SET nb_validations = nb_validations + 1 WHERE id = :ie"),
                            {"ie": str(instance_etape_id)})
        elif type_decision == "REJETER":
            self.db.execute(text("UPDATE wf_instance_etape SET nb_rejets = nb_rejets + 1 WHERE id = :ie"),
                            {"ie": str(instance_etape_id)})

        self.db.commit()

        # Réévaluer l'état de l'étape
        return self._evaluate_etape(
            instance_etape_id, ie["instance_id"], ie["demandeur_id"],
            ie["etape_ordre"], ie["mode_validation"], type_decision, commentaire
        )

    # ── 3. Modification d'une demande renvoyée ────────────────────────────────
    def admin_retour_etape_precedente(self, instance_id: UUID, motif: str) -> dict:
        """Pouvoir d'administration : ramène l'instance à la DERNIÈRE étape
        réellement franchie (VALIDE/PASSE la plus récente, d'ordre < étape
        courante), avec un motif obligatoire tracé.

        - l'étape courante repasse EN_ATTENTE (compteurs remis à zéro) ;
        - l'étape cible est rouverte EN_COURS (réactivée) ;
        - l'instance repasse EN_COURS (au cas où elle était finalisée) ;
        - une action RETOUR_ADMIN est journalisée sur l'étape courante.
        """
        if not motif or not motif.strip():
            raise ValueError("Le motif du retour est obligatoire.")

        inst = self.db.execute(text("""
            SELECT id, id_etape_courante, demandeur_id, statut
            FROM wf_instance WHERE id = :i
        """), {"i": str(instance_id)}).mappings().first()
        if not inst:
            raise ValueError("Instance introuvable.")

        # Étape courante (et son ordre)
        courante = self.db.execute(text("""
            SELECT ie.id AS ie_id, ie.id_etape_def, e.ordre
            FROM wf_instance_etape ie
            JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
            WHERE ie.id_instance = :i AND ie.id_etape_def = :ec
        """), {"i": str(instance_id), "ec": str(inst["id_etape_courante"])}).mappings().first()
        ordre_courant = courante["ordre"] if courante else None

        # Dernière étape RÉELLEMENT franchie : statut VALIDE/PASSE, ordre < courant,
        # priorité à la plus récemment terminée (date_fin la plus récente).
        cible = self.db.execute(text("""
            SELECT ie.id AS ie_id, ie.id_etape_def, e.ordre, e.type_etape, e.delai_heures
            FROM wf_instance_etape ie
            JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
            WHERE ie.id_instance = :i
              AND ie.statut IN ('VALIDE', 'PASSE')
              AND (:oc IS NULL OR e.ordre < :oc)
            ORDER BY ie.date_fin DESC NULLS LAST, e.ordre DESC
            LIMIT 1
        """), {"i": str(instance_id), "oc": ordre_courant}).mappings().first()

        if not cible:
            raise ValueError("Aucune étape précédente franchie : impossible de revenir en arrière.")

        # 1) Tracer le retour administratif : wf_instance_action exige un
        #    acteur_id NOT NULL (que l'admin n'a pas). On consigne donc le motif
        #    sur l'instance (commentaire_final), horodaté, sans casser le NOT NULL.
        self.db.execute(text("""
            UPDATE wf_instance
            SET commentaire_final = COALESCE(commentaire_final || E'\n', '')
                || '[RETOUR ADMIN ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] ' || :motif
            WHERE id = :i
        """), {"i": str(instance_id), "motif": motif.strip()})

        # 2) Étape courante → EN_ATTENTE (remise à zéro)
        if courante:
            self.db.execute(text("""
                UPDATE wf_instance_etape
                SET statut = 'EN_ATTENTE', nb_validations = 0, nb_rejets = 0,
                    date_debut = NULL, date_fin = NULL
                WHERE id = :ie
            """), {"ie": str(courante["ie_id"])})

        # 3) Étape cible → remise EN_ATTENTE puis réactivée proprement EN_COURS
        self.db.execute(text("""
            UPDATE wf_instance_etape
            SET statut = 'EN_ATTENTE', nb_validations = 0, nb_rejets = 0,
                date_fin = NULL
            WHERE id = :ie
        """), {"ie": str(cible["ie_id"])})

        # 4) Instance repasse EN_COURS
        self.db.execute(text("UPDATE wf_instance SET statut = 'EN_COURS' WHERE id = :i"),
                        {"i": str(instance_id)})
        self.db.commit()

        # 5) Réactiver l'étape cible (gère acteurs, échéance, etc.)
        self._activate_specific_etape(instance_id, cible["id_etape_def"], inst["demandeur_id"])

        return {"status": "retour_effectue", "etape_cible_ordre": cible["ordre"]}

    def resubmit(self, instance_id: UUID) -> None:
        """Le demandeur a modifié sa demande après un RENVOYER. On relance l'étape courante."""
        # Réactiver l'étape courante
        ie = self.db.execute(text("""
            SELECT ie.id, ie.id_etape_def, i.demandeur_id, ie.ordre
            FROM wf_instance i
            JOIN wf_instance_etape ie ON ie.id_instance = i.id
                 AND ie.id_etape_def = i.id_etape_courante
            WHERE i.id = :i
        """), {"i": str(instance_id)}).mappings().first()
        if not ie:
            return
        # Reset les compteurs et le statut de l'étape
        self.db.execute(text("""
            UPDATE wf_instance_etape
            SET statut = 'EN_COURS', nb_validations = 0, nb_rejets = 0,
                date_debut = NOW()
            WHERE id = :ie
        """), {"ie": str(ie["id"])})
        # Repasser l'instance en EN_COURS
        self.db.execute(text("UPDATE wf_instance SET statut = 'EN_COURS' WHERE id = :i"),
                        {"i": str(instance_id)})
        self.db.commit()
        # Re-déclencher les actions ENTREE
        self._trigger_actions(ie["id_etape_def"], "ENTREE", instance_id, ie["demandeur_id"])

    # ── 4. Recherche du workflow applicable ────────────────────────────────────
    def _find_applicable_workflow(self, type_objet: str, contexte: dict) -> Optional[dict]:
        """Trouve le workflow ACTIF dont les criteres matchent le contexte.
        Critères supportés (JSONB) : famille_conge, categories_pro, statut_collab, etc.
        On prend celui dont l'ordre est le plus bas (priorité plus élevée).
        """
        rows = self.db.execute(text("""
            SELECT id, code, version, criteres, ordre
            FROM ref_workflow
            WHERE type_objet = :t AND statut = 'ACTIF' AND actif = true
            ORDER BY ordre ASC, version DESC
        """), {"t": type_objet}).mappings().all()

        for wf in rows:
            crit = wf["criteres"] or {}
            if self._criteres_match(crit, contexte):
                return dict(wf)
        return None

    def _criteres_match(self, criteres: dict, contexte: dict) -> bool:
        """Vérifie chaque critère JSONB contre le contexte."""
        if not criteres:
            return True
        for cle, valeurs_attendues in criteres.items():
            valeur_ctx = contexte.get(cle)
            if isinstance(valeurs_attendues, list):
                if not valeurs_attendues:
                    continue  # liste vide = pas de filtre
                if valeur_ctx not in valeurs_attendues:
                    return False
            elif valeurs_attendues is not None and valeur_ctx != valeurs_attendues:
                return False
        return True

    # ── 5. Activation de la prochaine étape ───────────────────────────────────
    def _activate_next_etape(
        self, instance_id: UUID, demandeur_id: UUID, current_ordre: int
    ) -> None:
        """Active la prochaine étape >current_ordre. Gère auto-skip et CONDITION."""
        next_etape = self.db.execute(text("""
            SELECT ie.id AS ie_id, e.*
            FROM wf_instance_etape ie
            JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
            WHERE ie.id_instance = :i AND e.ordre > :o AND ie.statut = 'EN_ATTENTE'
            ORDER BY e.ordre ASC LIMIT 1
        """), {"i": str(instance_id), "o": current_ordre}).mappings().first()

        if not next_etape:
            self._finalize_with_terminal(instance_id, demandeur_id, "VALIDE")
            return

        # Évaluer condition_sql si présent (et type_etape = CONDITION)
        if next_etape["type_etape"] == "CONDITION" and next_etape["condition_sql"]:
            cond_ok = self._evaluate_condition(next_etape["condition_sql"], instance_id)
            cible_id = next_etape["etape_si_vrai_id"] if cond_ok else next_etape["etape_si_faux_id"]
            # Marquer étape CONDITION comme PASSE et activer la cible
            self.db.execute(text("UPDATE wf_instance_etape SET statut='PASSE' WHERE id=:ie"),
                            {"ie": str(next_etape["ie_id"])})
            if cible_id:
                self._activate_specific_etape(instance_id, cible_id, demandeur_id)
            else:
                self._activate_next_etape(instance_id, demandeur_id, next_etape["ordre"])
            return

        # Auto-skip : même acteur a déjà décidé sur étape précédente ?
        if next_etape["auto_skip_si_deja_decide"]:
            acteurs = self._resolve_etape_acteurs(next_etape["id"], demandeur_id)
            for a in acteurs:
                if a.est_observateur:
                    continue
                last_decision = self._has_already_decided(instance_id, a.user_id)
                if last_decision:
                    # Appliquer la même décision automatiquement
                    self.db.execute(text("""
                        UPDATE wf_instance_etape
                        SET statut = :s, date_debut = NOW(), date_fin = NOW(),
                            nb_validations = CASE WHEN :td = 'VALIDER' THEN 1 ELSE 0 END,
                            nb_rejets = CASE WHEN :td = 'REJETER' THEN 1 ELSE 0 END
                        WHERE id = :ie
                    """), {"ie": str(next_etape["ie_id"]),
                           "s": "VALIDE" if last_decision == "VALIDER" else "REJETE",
                           "td": last_decision})
                    self.db.execute(text("""
                        INSERT INTO wf_instance_action
                            (id_instance_etape, acteur_id, type_decision, commentaire)
                        VALUES (:ie, :a, :td, 'Auto-skip — décision identique étape précédente')
                    """), {"ie": str(next_etape["ie_id"]), "a": str(a.user_id), "td": last_decision})
                    self.db.commit()
                    if last_decision == "VALIDER":
                        self._activate_next_etape(instance_id, demandeur_id, next_etape["ordre"])
                    else:
                        self._finalize_with_terminal(instance_id, demandeur_id, "REJETE")
                    return

        # Activer normalement
        self._activate_specific_etape_record(
            next_etape["ie_id"], next_etape["id"], next_etape["delai_heures"],
            instance_id, demandeur_id, next_etape["type_etape"]
        )

    def _activate_specific_etape(
        self, instance_id: UUID, etape_def_id: UUID, demandeur_id: UUID
    ) -> None:
        ie = self.db.execute(text("""
            SELECT ie.id, e.delai_heures, e.type_etape
            FROM wf_instance_etape ie
            JOIN ref_workflow_etape e ON e.id = ie.id_etape_def
            WHERE ie.id_instance = :i AND ie.id_etape_def = :ed
        """), {"i": str(instance_id), "ed": str(etape_def_id)}).mappings().first()
        if ie:
            self._activate_specific_etape_record(
                ie["id"], etape_def_id, ie["delai_heures"],
                instance_id, demandeur_id, ie["type_etape"]
            )

    def _activate_specific_etape_record(
        self, ie_id: UUID, etape_def_id: UUID, delai_heures: Optional[int],
        instance_id: UUID, demandeur_id: UUID, type_etape: str,
    ) -> None:
        # Résoudre les acteurs et compter les requis
        acteurs = self._resolve_etape_acteurs(etape_def_id, demandeur_id)
        nb_requis = sum(1 for a in acteurs if not a.est_observateur) or 1

        echeance = None
        if delai_heures:
            echeance = datetime.utcnow() + timedelta(hours=delai_heures)

        self.db.execute(text("""
            UPDATE wf_instance_etape
            SET statut = 'EN_COURS', date_debut = NOW(),
                date_echeance = :ech, nb_acteurs_requis = :nb
            WHERE id = :ie
        """), {"ie": str(ie_id), "ech": echeance, "nb": nb_requis})

        self.db.execute(text("""
            UPDATE wf_instance SET id_etape_courante = :ed WHERE id = :i
        """), {"ed": str(etape_def_id), "i": str(instance_id)})

        self.db.commit()

        # Étape AUTOMATIQUE : exécuter actions, puis finaliser si terminale,
        # sinon enchaîner sur la suivante.
        if type_etape == "AUTOMATIQUE":
            self._trigger_actions(etape_def_id, "ENTREE", instance_id, demandeur_id)
            self.db.execute(text("""
                UPDATE wf_instance_etape SET statut = 'PASSE', date_fin = NOW() WHERE id = :ie
            """), {"ie": str(ie_id)})
            self.db.commit()
            term = self.db.execute(text("""
                SELECT est_terminale, statut_final, ordre
                FROM ref_workflow_etape WHERE id = :e
            """), {"e": str(etape_def_id)}).mappings().first()
            # Étape terminale → clôturer l'instance et NE PAS enchaîner.
            # (corrige la cascade qui activait l'étape automatique suivante,
            #  ex. « Demande approuvée » qui débordait sur « Demande refusée »)
            if term and term["est_terminale"]:
                self._finalize_instance(instance_id, term["statut_final"] or "VALIDE")
                return
            self._activate_next_etape(instance_id, demandeur_id, term["ordre"])
        else:
            # Déclencher les actions ENTREE
            self._trigger_actions(etape_def_id, "ENTREE", instance_id, demandeur_id)

    # ── 6. Évaluation de l'étape après une décision ───────────────────────────
    def _evaluate_etape(
        self, ie_id: UUID, instance_id: UUID, demandeur_id: UUID,
        etape_ordre: int, mode_validation: str, type_decision: str, commentaire: Optional[str],
    ) -> dict:
        # Cas RENVOYER — retour au demandeur, étape reste courante
        if type_decision == "RENVOYER":
            self.db.execute(text("UPDATE wf_instance SET statut = 'EN_MODIFICATION' WHERE id = :i"),
                            {"i": str(instance_id)})
            self.db.commit()
            self._trigger_actions_for_instance_etape(ie_id, "REJET", instance_id, demandeur_id)
            return {"resultat": "EN_MODIFICATION", "etape_ordre": etape_ordre}

        # Lire les compteurs actuels
        ie = self.db.execute(text("""
            SELECT nb_acteurs_requis, nb_validations, nb_rejets
            FROM wf_instance_etape WHERE id = :ie
        """), {"ie": str(ie_id)}).mappings().first()
        nb_requis = ie["nb_acteurs_requis"]
        nb_val = ie["nb_validations"]
        nb_rej = ie["nb_rejets"]

        # Cas REJETER selon mode
        if type_decision == "REJETER":
            if mode_validation == "TOUS":
                # Premier rejet bloque
                self._close_etape(ie_id, "REJETE")
                self._trigger_actions_for_instance_etape(ie_id, "REJET", instance_id, demandeur_id)
                self._finalize_with_terminal(instance_id, demandeur_id, "REJETE", commentaire)
                return {"resultat": "REJETE", "etape_ordre": etape_ordre}
            elif mode_validation == "MAJORITE" and nb_rej > nb_requis / 2:
                self._close_etape(ie_id, "REJETE")
                self._trigger_actions_for_instance_etape(ie_id, "REJET", instance_id, demandeur_id)
                self._finalize_with_terminal(instance_id, demandeur_id, "REJETE", commentaire)
                return {"resultat": "REJETE", "etape_ordre": etape_ordre}
            return {"resultat": "EN_COURS", "etape_ordre": etape_ordre}

        # Cas VALIDER selon mode
        if type_decision == "VALIDER":
            close = False
            if mode_validation == "UN_SUFFISANT" and nb_val >= 1:
                close = True
            elif mode_validation == "TOUS" and nb_val >= nb_requis:
                close = True
            elif mode_validation == "MAJORITE" and nb_val > nb_requis / 2:
                close = True

            if close:
                self._close_etape(ie_id, "VALIDE")
                self._trigger_actions_for_instance_etape(ie_id, "VALIDATION", instance_id, demandeur_id)
                self._activate_next_etape(instance_id, demandeur_id, etape_ordre)
                return {"resultat": "ETAPE_VALIDEE", "etape_ordre": etape_ordre}

        return {"resultat": "EN_COURS", "etape_ordre": etape_ordre}

    def _close_etape(self, ie_id: UUID, statut: str) -> None:
        self.db.execute(text("""
            UPDATE wf_instance_etape SET statut = :s, date_fin = NOW() WHERE id = :ie
        """), {"ie": str(ie_id), "s": statut})
        self.db.commit()

    def _finalize_instance(self, instance_id: UUID, statut_final: str, commentaire: Optional[str] = None) -> None:
        self.db.execute(text("""
            UPDATE wf_instance
            SET statut = :s, date_fin = NOW(), commentaire_final = COALESCE(:c, commentaire_final)
            WHERE id = :i
        """), {"i": str(instance_id), "s": statut_final, "c": commentaire})
        self.db.commit()

    def _finalize_with_terminal(
        self, instance_id: UUID, demandeur_id: UUID,
        statut_final: str, commentaire: Optional[str] = None,
    ) -> None:
        """Finalise l'instance en exécutant d'abord les actions de l'étape
        terminale correspondant à `statut_final` (ex. mise à jour du statut
        métier via TACHE_SYSTEME), même si le flux ne l'a pas traversée
        séquentiellement (cas du rejet qui finalise directement).

        Sur le chemin nominal (validation), l'étape terminale est activée
        normalement et ses actions sont déjà jouées : on ne passe donc PAS
        par ici, ce qui évite tout double déclenchement."""
        wf_id = self.db.execute(
            text("SELECT id_workflow FROM wf_instance WHERE id = :i"),
            {"i": str(instance_id)},
        ).scalar()
        term = self.db.execute(text("""
            SELECT e.id AS etape_def_id, ie.id AS ie_id
            FROM ref_workflow_etape e
            JOIN wf_instance_etape ie
              ON ie.id_etape_def = e.id AND ie.id_instance = :i
            WHERE e.id_workflow = :w AND e.actif = true
              AND e.est_terminale = true AND e.statut_final = :sf
            ORDER BY e.ordre ASC LIMIT 1
        """), {"i": str(instance_id), "w": str(wf_id), "sf": statut_final}).mappings().first()
        if term:
            self._trigger_actions(term["etape_def_id"], "ENTREE", instance_id, demandeur_id)
            self.db.execute(text("""
                UPDATE wf_instance_etape SET statut = 'PASSE', date_fin = NOW() WHERE id = :ie
            """), {"ie": str(term["ie_id"])})
            self.db.commit()
        self._finalize_instance(instance_id, statut_final, commentaire)

    # ── 7. Résolution des acteurs ──────────────────────────────────────────────
    def _resolve_etape_acteurs(self, etape_def_id: UUID, demandeur_id: UUID) -> list[Acteur]:
        defs = self.db.execute(text("""
            SELECT id, type_acteur, valeur, est_observateur, ordre_delegation,
                   fallback_type, fallback_valeur
            FROM ref_workflow_acteur
            WHERE id_etape = :e AND actif = true
            ORDER BY ordre_delegation
        """), {"e": str(etape_def_id)}).mappings().all()

        acteurs: list[Acteur] = []
        for d in defs:
            users = self._resolve_acteur_def(d, demandeur_id)
            if users:
                for u in users:
                    acteurs.append(Acteur(user_id=u, est_observateur=d["est_observateur"]))
            elif d["fallback_type"]:
                # Tenter le fallback
                fb = {"type_acteur": d["fallback_type"], "valeur": d["fallback_valeur"]}
                fb_users = self._resolve_acteur_def(fb, demandeur_id)
                for u in fb_users:
                    acteurs.append(Acteur(user_id=u, est_observateur=False, est_fallback=True))
        return acteurs

    def _resolve_acteur_def(self, d: dict, demandeur_id: UUID) -> list[UUID]:
        """Résout un type_acteur en liste d'UUIDs collaborateurs."""
        ta = d["type_acteur"]

        # Types résolus en SQL via wf_resolve_acteur (sauf ROLE/GROUPE/DYNAMIQUE)
        sql_types = {
            "UTILISATEUR_FIXE", "DEMANDEUR", "HIERARCHIE_N1", "HIERARCHIE_N2",
            "UO_RESPONSABLE", "UO_PARENTE_RESPONSABLE",
            "UO_GRAND_PARENTE_RESPONSABLE", "UO_RACINE_RESPONSABLE",
        }
        if ta in sql_types and "id" in d:
            rows = self.db.execute(text("""
                SELECT collaborateur_id FROM wf_resolve_acteur(:a, :dem)
            """), {"a": str(d["id"]), "dem": str(demandeur_id)}).scalars().all()
            return [r for r in rows if r]
        elif ta == "DEMANDEUR":
            return [demandeur_id]
        elif ta == "UTILISATEUR_FIXE":
            return [UUID(d["valeur"])] if d.get("valeur") else []
        elif ta == "ROLE":
            # Utilisateurs ayant ce rôle ET dont le périmètre couvre le demandeur.
            # (wf_collaborateur_dans_perimetre : GLOBAL = sans restriction.)
            rows = self.db.execute(text("""
                SELECT ur.user_id
                FROM user_roles ur
                WHERE ur.role = :r
                  AND wf_collaborateur_dans_perimetre(ur.user_id, :r, :dem)
            """), {"r": d["valeur"], "dem": str(demandeur_id)}).scalars().all()
            return list(rows)
        elif ta == "GROUPE":
            # À adapter selon ta table de groupes
            return []
        elif ta == "DYNAMIQUE":
            try:
                rows = self.db.execute(text(d["valeur"]), {"demandeur": str(demandeur_id)}).scalars().all()
                return [r for r in rows if r]
            except Exception as exc:
                logger.error("Expression DYNAMIQUE invalide : %s", exc)
                return []
        return []

    def _has_already_decided(self, instance_id: UUID, user_id: UUID) -> Optional[str]:
        """Renvoie la dernière décision de cet acteur sur cette instance ou None."""
        return self.db.execute(text("""
            SELECT a.type_decision
            FROM wf_instance_action a
            JOIN wf_instance_etape ie ON ie.id = a.id_instance_etape
            WHERE ie.id_instance = :i
              AND a.acteur_id = :u
              AND a.type_decision IN ('VALIDER','REJETER')
            ORDER BY a.date_action DESC
            LIMIT 1
        """), {"i": str(instance_id), "u": str(user_id)}).scalar()

    # ── 8. Évaluation de conditions SQL ────────────────────────────────────────
    def _evaluate_condition(self, expr: str, instance_id: UUID) -> bool:
        """Évalue une expression SQL booléenne avec accès au contexte de l'instance."""
        ctx = self.db.execute(text("SELECT contexte FROM wf_instance WHERE id = :i"),
                              {"i": str(instance_id)}).scalar() or {}
        if isinstance(ctx, str):
            ctx = json.loads(ctx)
        # Substitution simple : nb_jours > 10 → ctx["nb_jours"] > 10
        try:
            local = dict(ctx)
            return bool(eval(expr, {"__builtins__": {}}, local))
        except Exception as exc:
            logger.error("Expression condition invalide '%s' : %s", expr, exc)
            return False

    # ── 9. Déclenchement des actions ───────────────────────────────────────────
    def _trigger_actions(
        self, etape_def_id: UUID, declencheur: str,
        instance_id: UUID, demandeur_id: UUID,
    ) -> None:
        # Trouver l'instance étape correspondante
        ie_id = self.db.execute(text("""
            SELECT id FROM wf_instance_etape
            WHERE id_instance = :i AND id_etape_def = :ed
        """), {"i": str(instance_id), "ed": str(etape_def_id)}).scalar()
        if ie_id:
            self._trigger_actions_for_instance_etape(ie_id, declencheur, instance_id, demandeur_id)

    def _trigger_actions_for_instance_etape(
        self, ie_id: UUID, declencheur: str,
        instance_id: UUID, demandeur_id: UUID,
    ) -> None:
        # Charger les actions définies
        actions = self.db.execute(text("""
            SELECT a.* FROM ref_workflow_action a
            JOIN wf_instance_etape ie ON ie.id_etape_def = a.id_etape
            WHERE ie.id = :ie AND a.declencheur = :d AND a.actif = true
            ORDER BY a.ordre
        """), {"ie": str(ie_id), "d": declencheur}).mappings().all()

        # Charger contexte instance + résoudre destinataires
        ctx = self.db.execute(text("SELECT contexte FROM wf_instance WHERE id = :i"),
                               {"i": str(instance_id)}).scalar() or {}
        if isinstance(ctx, str):
            ctx = json.loads(ctx)

        for action in actions:
            try:
                with self.db.begin_nested():
                    self._exec_action(action, ie_id, instance_id, demandeur_id, ctx)
            except Exception as exc:
                # L'échec d'une action système ne doit jamais faire tomber toute
                # la décision : le SAVEPOINT est annulé, la transaction reste saine.
                logger.error("Erreur action %s : %s", action["type_action"], exc)

    def _exec_action(
        self, action: dict, ie_id: UUID, instance_id: UUID,
        demandeur_id: UUID, contexte: dict,
    ) -> None:
        config = action["configuration"] or {}
        if isinstance(config, str):
            config = json.loads(config)
        type_action = action["type_action"]

        # Résoudre les destinataires
        destinataires = self._resolve_destinataires(
            config.get("destinataires", []), instance_id, demandeur_id, ie_id
        )

        # Charger le template
        template = None
        tpl_code = config.get("template_code")
        if tpl_code:
            template = self.db.execute(text("""
                SELECT sujet, corps, type_canal FROM ref_workflow_template
                WHERE code = :c AND actif = true
            """), {"c": tpl_code}).mappings().first()

        sujet = _interpolate(template["sujet"] if template else "", contexte) if template else ""
        corps = _interpolate(template["corps"] if template else "", contexte) if template else ""

        # Exécution selon type
        if type_action == "NOTIFICATION_INTERNE":
            for user_id in destinataires:
                self.db.execute(text("""
                    INSERT INTO notifications (user_id, titre, message, lien, lue, created_at)
                    VALUES (:u, :t, :m, :l, false, NOW())
                """), {
                    "u": str(user_id), "t": sujet, "m": corps,
                    "l": f"/workflow/{instance_id}",
                })
            self._log_action(ie_id, "NOTIFICATION_INTERNE", "OK", config, {"recipients": [str(d) for d in destinataires]})

        elif type_action == "EMAIL":
            # À brancher sur le service SMTP
            payload = {"destinataires": [str(d) for d in destinataires], "sujet": sujet, "corps": corps}
            # send_email(...) à implémenter
            self._log_action(ie_id, "EMAIL", "OK", config, payload)

        elif type_action == "SMS":
            payload = {"destinataires": [str(d) for d in destinataires], "message": corps}
            self._log_action(ie_id, "SMS", "OK", config, payload)

        elif type_action == "WEBHOOK":
            # À brancher sur httpx
            self._log_action(ie_id, "WEBHOOK", "OK", config, {"url": config.get("url")})

        elif type_action == "TACHE_SYSTEME":
            self._exec_tache_systeme(config, instance_id, contexte)
            self._log_action(ie_id, "TACHE_SYSTEME", "OK", config, {})

        elif type_action == "GENERER_DOCUMENT":
            self._log_action(ie_id, "GENERER_DOCUMENT", "OK", config, {})

        self.db.commit()

    def _log_action(self, ie_id: UUID, type_action: str, statut: str,
                    payload: dict, reponse: dict) -> None:
        self.db.execute(text("""
            INSERT INTO wf_instance_action (
                id_instance_etape, acteur_id, type_decision,
                type_action_sys, statut_action_sys, payload_envoye, reponse_recue
            ) VALUES (
                :ie,
                '00000000-0000-0000-0000-000000000000'::uuid,
                'SYSTEME', :ta, :s, CAST(:p AS JSONB), CAST(:r AS JSONB)
            )
        """), {
            "ie": str(ie_id), "ta": type_action, "s": statut,
            "p": json.dumps(payload, default=str),
            "r": json.dumps(reponse, default=str),
        })

    def _resolve_destinataires(
        self, raw: list, instance_id: UUID, demandeur_id: UUID, ie_id: UUID,
    ) -> list[UUID]:
        """Convertit ['ACTEUR','DEMANDEUR','ROLE:rh_gestionnaire','ACTEUR_ETAPE:1','email@x.com']
        en liste d'UUID utilisateurs (les emails directs sont gardés tels quels par le service SMTP)."""
        out: list[UUID] = []
        for d in raw:
            if not d:
                continue
            d = d.strip()
            if d == "DEMANDEUR":
                out.append(demandeur_id)
            elif d == "ACTEUR":
                # Acteurs en cours sur l'étape (instance_etape courante)
                rows = self.db.execute(text("""
                    SELECT acteur_id FROM wf_instance_action
                    WHERE id_instance_etape = :ie AND type_decision NOT IN ('SYSTEME')
                """), {"ie": str(ie_id)}).scalars().all()
                out.extend([r for r in rows if r])
            elif d.startswith("ACTEUR_ETAPE:"):
                ordre = int(d.split(":", 1)[1])
                rows = self.db.execute(text("""
                    SELECT a.acteur_id
                    FROM wf_instance_action a
                    JOIN wf_instance_etape ie ON ie.id = a.id_instance_etape
                    WHERE ie.id_instance = :i AND ie.ordre = :o
                      AND a.type_decision IN ('VALIDER','REJETER','RENVOYER')
                    ORDER BY a.date_action DESC LIMIT 1
                """), {"i": str(instance_id), "o": ordre}).scalars().all()
                out.extend([r for r in rows if r])
            elif d.startswith("ROLE:"):
                role = d.split(":", 1)[1]
                rows = self.db.execute(text("""
                    SELECT user_id FROM user_roles WHERE role = :r
                """), {"r": role}).scalars().all()
                out.extend([r for r in rows if r])
            # Les emails littéraux sont laissés au service SMTP
        return out

    def _get_etapes(self, wf_id: UUID) -> list[dict]:
        rows = self.db.execute(text("""
            SELECT id, ordre, type_etape FROM ref_workflow_etape
            WHERE id_workflow = :w AND actif = true
            ORDER BY ordre
        """), {"w": str(wf_id)}).mappings().all()
        return [dict(r) for r in rows]

    # ── 10. Catalogue de tâches systèmes ───────────────────────────────────────
    @staticmethod
    def _ident_ok(name: Optional[str]) -> bool:
        """Valide un identifiant SQL (table/colonne/procédure) interpolé,
        pour empêcher toute injection sur les noms d'objets."""
        return bool(name) and str(name).replace("_", "").isalnum()

    def _table_objet(self, type_objet: str) -> Optional[str]:
        """Résout la table métier d'un type_objet via les déclencheurs configurés
        (générique, pas de table en dur)."""
        return self.db.execute(text("""
            SELECT table_source FROM ref_workflow_declencheur
            WHERE type_objet = :t AND actif = true AND table_source IS NOT NULL
            ORDER BY ordre ASC LIMIT 1
        """), {"t": type_objet}).scalar()

    def _exec_tache_systeme(self, config: dict, instance_id: UUID, contexte: dict) -> None:
        """Exécute une tâche système. Formats de configuration supportés :
          - {"set_statut": "approuvee"}              → MAJ du statut de l'objet métier
          - {"set_statut": "x", "table": "...", "colonne": "..."}  → cibles explicites
          - {"proc": "nom_procedure"}                → appel d'une procédure stockée
          - {"code_tache": "...", "parametres": {}}  → ancien format (compatibilité)

        La table métier est résolue dynamiquement (ref_workflow_declencheur) ou
        fournie dans la config — aucune table codée en dur.
        """
        info = self.db.execute(text("""
            SELECT type_objet, id_objet FROM wf_instance WHERE id = :i
        """), {"i": str(instance_id)}).mappings().first()
        if not info:
            return

        # ── Format builder : mise à jour du statut métier ────────────────────
        if "set_statut" in config:
            statut = config["set_statut"]
            colonne = config.get("colonne", "statut")
            table = config.get("table") or self._table_objet(info["type_objet"])
            if not table:
                logger.warning("set_statut : table introuvable pour type_objet=%s", info["type_objet"])
                return
            if not (self._ident_ok(table) and self._ident_ok(colonne)):
                logger.error("set_statut : identifiant invalide (table=%s, colonne=%s)", table, colonne)
                return
            self.db.execute(
                text(f"UPDATE {table} SET {colonne} = :s WHERE id = :id"),
                {"s": statut, "id": str(info["id_objet"])},
            )
            return

        # ── Format builder : appel d'une procédure stockée ───────────────────
        if "proc" in config:
            proc = config["proc"]
            if not self._ident_ok(proc):
                logger.error("proc : nom de procédure invalide (%s)", proc)
                return
            # On passe l'id de l'objet métier. Une procédure s'appelle via CALL,
            # une fonction via SELECT. On tente CALL dans un SAVEPOINT : si ça
            # échoue (ex. c'est une fonction), on revient au savepoint pour
            # garder la transaction saine, puis on tente SELECT.
            try:
                with self.db.begin_nested():
                    self.db.execute(text(f"CALL {proc}(:id)"), {"id": str(info["id_objet"])})
            except Exception:
                self.db.execute(text(f"SELECT {proc}(:id)"), {"id": str(info["id_objet"])})
            return

        # ── Ancien format (compatibilité ascendante) ─────────────────────────
        code = config.get("code_tache")
        params = config.get("parametres") or {}
        if code == "METTRE_A_JOUR_STATUT_DEMANDE":
            statut = params.get("statut", "approuvee")
            table = self._table_objet(info["type_objet"])
            if table and self._ident_ok(table):
                self.db.execute(
                    text(f"UPDATE {table} SET statut = :s WHERE id = :id"),
                    {"s": statut, "id": str(info["id_objet"])},
                )
        elif code in ("DECREMENTER_SOLDE", "ARCHIVER_DOSSIER"):
            pass  # à adapter au métier
        else:
            logger.warning("Tâche système non reconnue : config=%s", config)
