"""
conges_admin.py — Endpoints RPC pour les fonctions SQL liées aux congés
─────────────────────────────────────────────────────────────────────────────
Le frontend (CompteurCongesPage) appelle ces routes pour déclencher les
fonctions PL/pgSQL côté base. Inspiré du style Supabase /rpc/<fn>.

Endpoints :
  • POST /api/v1/rpc/generate_droits_proportionnels
       body : { p_collaborateur_id, p_date_entree, p_exercice }
       → retourne le nombre de droits générés (int)
  • POST /api/v1/rpc/recalculate_cong_solde
       body : { p_collaborateur_id, p_code_type_conge, p_exercice }
       → retourne null

Intégration dans main.py :
  from app.routers import conges_admin as conges_admin_router
  app.include_router(conges_admin_router.router, prefix=PREFIX)
"""
from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload


router = APIRouter(prefix="/rpc", tags=["rpc-conges"])


# ──────────────────────────────────────────────────────────────────────────
# Schémas Pydantic — calqués sur les paramètres des fonctions PL/pgSQL
# ──────────────────────────────────────────────────────────────────────────
class GenerateDroitsBody(BaseModel):
    p_collaborateur_id: UUID
    p_date_entree: date
    p_exercice: Optional[int] = None


class RecalculateSoldeBody(BaseModel):
    p_collaborateur_id: UUID
    p_code_type_conge: str
    p_exercice: int


# ──────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────
@router.post("/generate_droits_proportionnels")
def generate_droits_proportionnels(
    body: GenerateDroitsBody,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user_payload),
):
    """
    Appelle public.generate_droits_proportionnels(uuid, date, integer).
    Retourne le nombre de droits générés (entier).
    """
    try:
        count = db.execute(
            text("""
                SELECT public.generate_droits_proportionnels(
                    CAST(:p_collaborateur_id AS uuid),
                    CAST(:p_date_entree      AS date),
                    CAST(:p_exercice         AS integer)
                )
            """),
            {
                "p_collaborateur_id": str(body.p_collaborateur_id),
                "p_date_entree":      body.p_date_entree.isoformat(),
                "p_exercice":         body.p_exercice,
            },
        ).scalar()
        db.commit()
        return int(count or 0)
    except Exception as e:
        db.rollback()
        # On remonte le message Postgres tel quel (utile pour debug côté UI)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/recalculate_cong_solde")
def recalculate_cong_solde(
    body: RecalculateSoldeBody,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user_payload),
):
    """
    Appelle public.recalculate_cong_solde(uuid, varchar, integer).
    Recalcule et upsert le solde dans cong_solde. Retourne null.
    """
    try:
        db.execute(
            text("""
                SELECT public.recalculate_cong_solde(
                    CAST(:p_collaborateur_id AS uuid),
                    CAST(:p_code_type_conge  AS varchar),
                    CAST(:p_exercice         AS integer)
                )
            """),
            {
                "p_collaborateur_id": str(body.p_collaborateur_id),
                "p_code_type_conge":  body.p_code_type_conge,
                "p_exercice":         body.p_exercice,
            },
        )
        db.commit()
        return None
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
