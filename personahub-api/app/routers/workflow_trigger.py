"""
app/routers/workflow_trigger.py — Déclenchement GÉNÉRIQUE de workflow (no-code).

OPTION A : le déclencheur HONORE l'affectation (le circuit choisi en config),
au lieu de re-choisir un workflow par critères.

POST /api/v1/workflow/trigger  { table_source, id, evenement? }
  Pour chaque déclencheur actif (table_source, evenement), trié par ordre :
    1. évalue condition_sql (éligibilité)
    2. exécute code_workflow_sql → le CODE du workflow affecté (type → famille…)
    3. exécute contexte_sql → dict de contexte (utile aux conditions internes)
    4. lit le demandeur (champ_demandeur)
    5. engine.start_by_code(code_workflow, id, demandeur, contexte)
  S'arrête au premier workflow démarré.

  Repli : si code_workflow_sql est NULL, on retombe sur l'ancien routage par
  type_objet + critères (engine.start), pour compatibilité.
"""
from __future__ import annotations

from uuid import UUID
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload
from app.services.workflow_engine import WorkflowEngine

router = APIRouter(prefix="/workflow", tags=["workflow"])


class TriggerIn(BaseModel):
    table_source: str = Field(..., description="Table métier, ex. 'cong_demandes'")
    id: UUID = Field(..., description="Id de la ligne source (l'objet métier)")
    evenement: str = Field("SOUMISSION", description="SOUMISSION | CREATION | ...")


def _fetch_declencheurs(db: Session, table_source: str, evenement: str) -> list[dict]:
    rows = db.execute(text("""
        SELECT code, type_objet, condition_sql, contexte_sql, champ_demandeur,
               code_workflow_sql, ordre
        FROM ref_workflow_declencheur
        WHERE table_source = :ts AND evenement = :ev AND actif = true
        ORDER BY ordre ASC
    """), {"ts": table_source, "ev": evenement}).mappings().all()
    return [dict(r) for r in rows]


def _create_demande_header(db: Session, type_objet: str, table_source: str,
                           id_objet, demandeur_id, instance_id) -> None:
    """Crée l'en-tête générique dans le registre `demande` (idempotent).

    Centralise la création : toute demande naît via trigger_workflow, donc
    c'est ici qu'on enregistre l'en-tête, lié à l'instance de workflow.
    Le type_objet doit exister dans ref_type_demande ; sinon on ignore
    silencieusement (le registre ne connaît pas encore ce type)."""
    try:
        db.execute(text("""
            INSERT INTO demande (
                type_demande, table_objet, id_objet, demandeur_id,
                statut, wf_instance_id, date_soumission
            )
            SELECT :t, :tbl, :oid, :dem, 'en_attente', :wf, now()
            WHERE EXISTS (SELECT 1 FROM ref_type_demande WHERE code = :t)
            ON CONFLICT (table_objet, id_objet) DO UPDATE
               SET wf_instance_id = EXCLUDED.wf_instance_id,
                   updated_at = now()
        """), {
            "t": type_objet, "tbl": table_source,
            "oid": str(id_objet), "dem": str(demandeur_id) if demandeur_id else None,
            "wf": str(instance_id) if instance_id else None,
        })
    except Exception:
        # Le registre n'est pas bloquant pour le démarrage du workflow.
        pass


@router.post("/trigger")
def trigger_workflow(payload: TriggerIn, db: Session = Depends(get_db),
                     _user=Depends(get_current_user_payload)):
    decls = _fetch_declencheurs(db, payload.table_source, payload.evenement)
    if not decls:
        return {"declenchements": [], "message": "Aucun déclencheur paramétré"}

    engine = WorkflowEngine(db)
    resultats: list[dict] = []

    for d in decls:
        # 1) Éligibilité
        if d["condition_sql"]:
            try:
                ok = db.execute(text(d["condition_sql"]), {"id": str(payload.id)}).first()
            except Exception as e:
                raise HTTPException(400, f"condition_sql invalide ({d['code']}): {e}")
            if not ok:
                resultats.append({"declencheur": d["code"], "statut": "non_eligible"})
                continue

        # 2) Contexte (clés utiles aux conditions internes du workflow)
        contexte: dict[str, Any] = {}
        if d["contexte_sql"]:
            try:
                ctx_row = db.execute(text(d["contexte_sql"]), {"id": str(payload.id)}).mappings().first()
            except Exception as e:
                raise HTTPException(400, f"contexte_sql invalide ({d['code']}): {e}")
            contexte = {k: v for k, v in dict(ctx_row or {}).items()}

        # 3) Demandeur
        champ = d["champ_demandeur"]
        if not champ.replace("_", "").isalnum():
            raise HTTPException(400, f"champ_demandeur invalide: {champ}")
        dem = db.execute(
            text(f"SELECT {champ} AS demandeur FROM {payload.table_source} WHERE id = :id"),
            {"id": str(payload.id)},
        ).mappings().first()
        if not dem or not dem["demandeur"]:
            resultats.append({"declencheur": d["code"], "statut": "sans_demandeur"})
            continue

        # 4) Code du workflow AFFECTÉ (Option A)
        code_workflow: Optional[str] = None
        if d.get("code_workflow_sql"):
            try:
                row = db.execute(text(d["code_workflow_sql"]), {"id": str(payload.id)}).first()
            except Exception as e:
                raise HTTPException(400, f"code_workflow_sql invalide ({d['code']}): {e}")
            code_workflow = row[0] if row else None

        # 5) Démarrage
        if code_workflow:
            contexte["__type_objet__"] = d.get("type_objet") or code_workflow
            instance_id = engine.start_by_code(
                code_workflow=code_workflow,
                id_objet=payload.id,
                demandeur_id=dem["demandeur"],
                contexte=contexte,
            )
            mode = "affectation"
        else:
            instance_id = engine.start(
                type_objet=d["type_objet"],
                id_objet=payload.id,
                demandeur_id=dem["demandeur"],
                contexte=contexte,
            )
            mode = "criteres"

        if instance_id:
            _create_demande_header(
                db,
                type_objet=d.get("type_objet") or code_workflow,
                table_source=payload.table_source,
                id_objet=payload.id,
                demandeur_id=dem["demandeur"],
                instance_id=instance_id,
            )
            resultats.append({
                "declencheur": d["code"], "statut": "demarre", "mode": mode,
                "code_workflow": code_workflow, "instance_id": str(instance_id),
                "contexte": {k: v for k, v in contexte.items() if k != "__type_objet__"},
            })
            break
        else:
            resultats.append({
                "declencheur": d["code"],
                "statut": "aucun_workflow_applicable" if mode == "criteres" else "workflow_introuvable",
                "code_workflow": code_workflow,
            })

    return {"declenchements": resultats}


@router.get("/instance-of/{table_source}/{id}")
def instance_of(table_source: str, id: UUID, db: Session = Depends(get_db),
                _user=Depends(get_current_user_payload)):
    """Retrouve l'instance de workflow liée à un objet métier (la plus récente)."""
    if not table_source.replace("_", "").isalnum():
        raise HTTPException(400, "table_source invalide")
    row = db.execute(text("""
        SELECT id, code_workflow, statut, id_etape_courante, date_debut, date_fin
        FROM wf_instance
        WHERE id_objet = :id
        ORDER BY date_debut DESC NULLS LAST
        LIMIT 1
    """), {"id": str(id)}).mappings().first()
    if not row:
        return {"instance": None}
    return {"instance": dict(row)}
