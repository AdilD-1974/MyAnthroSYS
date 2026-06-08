# app/services/workflow_tache_bridge.py
# ------------------------------------------------------------
# Pont Workflow → Tâches (action TACHE_SYSTEME)
# À appeler depuis workflow_engine.py lors de l'exécution
# d'une action de type TACHE_SYSTEME dans un process BPMN.
#
# INTÉGRATION dans workflow_engine.py :
#
#   from app.services.workflow_tache_bridge import executer_action_tache_systeme
#
#   # Dans votre switch/match sur action.type :
#   elif action.type == "TACHE_SYSTEME":
#       await executer_action_tache_systeme(db, action, instance, contexte)
# ------------------------------------------------------------
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.services.tache_service import create_tache_depuis_workflow

logger = logging.getLogger(__name__)


async def executer_action_tache_systeme(
    db: Session,
    action: Any,          # votre objet WfAction / dict de config
    instance: Any,        # votre objet WfInstance
    contexte: dict,       # variables de contexte du workflow (ex: collaborateur_id, demande_id…)
) -> dict:
    """
    Exécute une action TACHE_SYSTEME dans le moteur de workflow.

    La configuration de l'action (action.params ou action["params"]) doit contenir :
    {
        "titre":          "Valider la demande de congé de {{prenom}} {{nom}}",
        "description":    "...",    // optionnel, supporte {{variables}}
        "priorite":       "haute",  // optionnel, défaut "normale"
        "delai_jours":    2,        // optionnel : échéance = aujourd'hui + N jours
        "assignataires":  [         // optionnel
            { "role_workflow": "manager" }   // résolu via contexte
        ]
    }

    Le contexte doit contenir au minimum :
    {
        "collaborateur_id":  "...",  // propriétaire de la tâche
        "demande_id":        "...",  // optionnel
        "manager_id":        "...",  // optionnel, pour assignation
        "prenom":            "...",  // variables de substitution
        "nom":               "...",
        ...
    }
    """
    try:
        params = _get_params(action)

        # ── Résolution du titre et description (substitution {{var}}) ──
        titre       = _substituer(params.get("titre", "Tâche workflow"), contexte)
        description = _substituer(params.get("description", ""), contexte) or None

        # ── Propriétaire ──
        proprietaire_id = (
            contexte.get("proprietaire_id")
            or contexte.get("collaborateur_id")
            or contexte.get("gestionnaire_id")
        )
        if not proprietaire_id:
            logger.error(f"[workflow_tache_bridge] Aucun proprietaire_id dans le contexte pour instance {instance.id}")
            return {"erreur": "proprietaire_id manquant dans le contexte"}

        # ── Échéance ──
        delai = params.get("delai_jours")
        date_echeance: date | None = None
        if delai is not None:
            date_echeance = date.today() + timedelta(days=int(delai))

        # ── Assignataires ──
        assignations = _resoudre_assignataires(params.get("assignataires", []), contexte)

        # ── Création ──
        tache = create_tache_depuis_workflow(
            db,
            titre=titre,
            description=description,
            proprietaire_id=proprietaire_id,
            instance_id=str(instance.id),
            etape_id=str(getattr(action, "etape_id", None) or ""),
            date_echeance=date_echeance,
            priorite=params.get("priorite", "normale"),
            assignations=assignations,
            demande_id=contexte.get("demande_id"),
        )

        logger.info(
            f"[workflow_tache_bridge] Tâche créée id={tache['id']} "
            f"pour instance={instance.id} titre='{titre}'"
        )
        return {"tache_id": tache["id"], "statut": "ok"}

    except Exception as e:
        logger.error(f"[workflow_tache_bridge] Erreur création tâche: {e}", exc_info=True)
        return {"erreur": str(e)}


# ─── Helpers ─────────────────────────────────────────────────

def _get_params(action) -> dict:
    """Extrait params depuis un objet ou un dict."""
    if isinstance(action, dict):
        return action.get("params", action)
    return getattr(action, "params", {}) or {}


def _substituer(template: str, contexte: dict) -> str:
    """Remplace {{variable}} par la valeur dans le contexte."""
    import re
    def replacer(m):
        key = m.group(1).strip()
        return str(contexte.get(key, m.group(0)))
    return re.sub(r"\{\{(\w+)\}\}", replacer, template)


def _resoudre_assignataires(assignataires_config: list, contexte: dict) -> list[dict]:
    """
    Résout les assignataires définis par rôle workflow vers des collaborateur_id.

    Mapping supporté :
      "role_workflow": "manager"         → contexte["manager_id"]
      "role_workflow": "gestionnaire_rh" → contexte["gestionnaire_rh_id"]
      "collaborateur_id": "uuid-direct"  → utilisé tel quel
    """
    role_map = {
        "manager":          "manager_id",
        "gestionnaire_rh":  "gestionnaire_rh_id",
        "gestionnaire_paie":"gestionnaire_paie_id",
        "collaborateur":    "collaborateur_id",
    }

    resolved = []
    for a in assignataires_config:
        collab_id = a.get("collaborateur_id")
        if not collab_id:
            rw = a.get("role_workflow", "")
            ctx_key = role_map.get(rw)
            collab_id = contexte.get(ctx_key) if ctx_key else None

        if collab_id:
            resolved.append({
                "collaborateur_id": collab_id,
                "role": a.get("role", "responsable"),
            })

    return resolved


# ────────────────────────────────────────────────────────────
# EXEMPLE DE CONFIGURATION DANS UN WORKFLOW BPMN (YAML/JSON)
# ────────────────────────────────────────────────────────────
#
# etapes:
#   - id: validation_manager
#     type: TACHE_SYSTEME
#     params:
#       titre: "Valider la demande de congé de {{prenom}} {{nom}}"
#       description: "Demande du {{date_debut}} au {{date_fin}}. Merci de traiter sous 2 jours ouvrés."
#       priorite: haute
#       delai_jours: 2
#       assignataires:
#         - role_workflow: manager
#
# ────────────────────────────────────────────────────────────
