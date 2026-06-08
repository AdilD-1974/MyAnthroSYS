"""
prets.py — Routeur FastAPI du module Gestion des Prêts
app/routers/prets.py

Adapté à security.py : get_current_user_payload → payload JWT (dict)
Clés payload supposées : sub (matricule), role, security_level, collaborateur_id
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user_payload   # ✅ nom exact
from app.services.pret_service import (
    calculer_echeancier,
    calculer_avantage_nature,
    creer_pret,
    debloquer_pret,
    forcer_echeance,
    generer_tableau_amortissement,
    prelever_echeance,
    recalculer_taux_endettement,
    reprendre_pret,
    supprimer_pret_logique,
    suspendre_pret,
    verifier_eligibilite,
)

router = APIRouter(prefix="/prets", tags=["prets"])


# ──────────────────────────────────────────────────────────────
# HELPERS : extraire les infos du payload JWT (dict)
# ──────────────────────────────────────────────────────────────

def _matricule(payload: dict) -> str:
    """Matricule = champ 'sub' du token JWT."""
    return payload.get("sub") or payload.get("matricule") or ""

def _role(payload: dict) -> str:
    return payload.get("role") or payload.get("roles", ["collaborateur"])[0] if isinstance(payload.get("roles"), list) else payload.get("role", "collaborateur")

def _sl(payload: dict) -> int:
    """security_level depuis le payload, défaut 0."""
    return int(payload.get("security_level", 0))

def _collab_id(payload: dict) -> Optional[str]:
    return payload.get("collaborateur_id") or payload.get("collab_id")

def _require_sl(payload: dict, minimum: int, message: str = "Droits insuffisants."):
    if _sl(payload) < minimum:
        raise HTTPException(status.HTTP_403_FORBIDDEN, message)

def _require_role(payload: dict, roles: list[str]):
    if _role(payload) not in roles and _role(payload) != "administrateur":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Rôle insuffisant.")


# ──────────────────────────────────────────────────────────────
# SCHÉMAS PYDANTIC
# ──────────────────────────────────────────────────────────────

class SimulerRequest(BaseModel):
    montant: Decimal = Field(..., gt=0)
    nb_echeances: int = Field(..., ge=1, le=120)
    taux_annuel: Decimal = Field(default=Decimal("0"), ge=0)
    algo: str = Field(default="french_amortissement")
    date_premiere_echeance: Optional[date] = None

class CreerPretRequest(BaseModel):
    pret_interne: bool = True
    montant: Decimal = Field(..., gt=0)
    nb_echeances: int = Field(..., ge=1, le=120)
    taux: Decimal = Field(default=Decimal("0"), ge=0)
    algo: str = Field(default="french_amortissement")
    inclure_interets: bool = True
    organisme_credit: Optional[str] = None
    etab_credit: Optional[str] = None
    code_bqe: Optional[str] = None
    no_compte: Optional[str] = None
    clerib: Optional[str] = None

class GenererAmortissementRequest(BaseModel):
    date_premiere_echeance: date

class DebloquerRequest(BaseModel):
    montant_debloque: Decimal = Field(..., gt=0)
    date_deblocage: date
    no_cheque: Optional[str] = None
    banque_emettrice: Optional[str] = None

class SuspendreRequest(BaseModel):
    motif: str
    mode: str
    date_debut: date
    date_fin: Optional[date] = None

class ValiderRequest(BaseModel):
    decision: str
    ref_decision: Optional[str] = None
    motif_decision: Optional[str] = None
    competenc_decideur: Optional[str] = None

class ForcerEcheanceRequest(BaseModel):
    numero_echeance: int
    nouveau_montant: Decimal = Field(..., gt=0)
    note: str

class PrelevementRequest(BaseModel):
    salaire_net_disponible: Decimal = Field(..., gt=0)
    reference_paie: str
    matricule: Optional[str] = None

class ConfigUpdateRequest(BaseModel):
    valeur: Decimal
    description: Optional[str] = None


# ──────────────────────────────────────────────────────────────
# SIMULATION (tous les rôles)
# ──────────────────────────────────────────────────────────────

@router.post("/simuler")
async def simuler(
    body: SimulerRequest,
    payload: dict = Depends(get_current_user_payload),
):
    from dateutil.relativedelta import relativedelta
    date_debut = body.date_premiere_echeance or (date.today() + relativedelta(months=1))
    lignes = calculer_echeancier(body.montant, body.nb_echeances, body.taux_annuel, date_debut, body.algo)
    total = sum(l["mt_capital"] + l["mt_interet"] for l in lignes)
    return {
        "mensualite": round(lignes[0]["mt_capital"] + lignes[0]["mt_interet"], 2) if lignes else 0,
        "total_rembourse": round(total, 2),
        "cout_credit": round(total - float(body.montant), 2),
        "echeances": lignes,
    }


# ──────────────────────────────────────────────────────────────
# COLLABORATEUR — ses propres prêts
# ──────────────────────────────────────────────────────────────

@router.get("/mes-prets")
async def mes_prets(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    rows = await db.execute(
        text("""
            SELECT p.*, c.prenom || ' ' || c.nom AS collab_nom
            FROM prets p
            LEFT JOIN collaborateurs c ON c.id = p.collaborateur_id
            WHERE p.matricule = :mat AND p.deleted_date IS NULL
            ORDER BY p.created_date DESC
        """),
        {"mat": _matricule(payload)},
    )
    return [dict(r) for r in rows.mappings()]


@router.get("/mes-prets/{pret_id}/echeances")
async def mes_echeances(
    pret_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    row = await db.execute(
        text("SELECT matricule FROM prets WHERE id = :id AND deleted_date IS NULL"),
        {"id": str(pret_id)},
    )
    p = row.mappings().first()
    if not p or p["matricule"] != _matricule(payload):
        raise HTTPException(403, "Accès non autorisé.")
    rows = await db.execute(
        text("SELECT * FROM pret_echeances WHERE pret_id = :pid ORDER BY numero"),
        {"pid": str(pret_id)},
    )
    return [dict(r) for r in rows.mappings()]


@router.post("/demandes", status_code=status.HTTP_201_CREATED)
async def soumettre_demande(
    body: CreerPretRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    mat = _matricule(payload)
    collab_id = _collab_id(payload)

    elig = await verifier_eligibilite(
        db,
        uuid.UUID(collab_id) if collab_id else uuid.uuid4(),
        mat,
        body.pret_interne,
        body.montant,
    )
    if not elig["ok"]:
        raise HTTPException(400, detail=elig["erreurs"])

    pret = await creer_pret(
        db,
        uuid.UUID(collab_id) if collab_id else uuid.uuid4(),
        mat,
        body.pret_interne, body.montant, body.nb_echeances,
        body.taux, body.algo, body.inclure_interets,
        operateur=mat, security_level=_sl(payload),
        organisme_credit=body.organisme_credit,
        etab_credit=body.etab_credit,
        code_bqe=body.code_bqe,
        no_compte=body.no_compte,
        clerib=body.clerib,
    )
    return pret


# ──────────────────────────────────────────────────────────────
# GESTION RH (SL 20+)
# ──────────────────────────────────────────────────────────────

@router.get("/gestion/prets")
async def liste_prets(
    statut: Optional[str] = Query(None),
    pret_interne: Optional[bool] = Query(None),
    matricule: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 20)
    clauses = ["p.deleted_date IS NULL"]
    params: dict = {}

    if _sl(payload) < 50:
        collab_id = _collab_id(payload)
        if collab_id:
            clauses.append("c.manager_id = :mgr")
            params["mgr"] = collab_id

    if statut:
        clauses.append("p.statut = :statut::pret_statut_enum")
        params["statut"] = statut
    if pret_interne is not None:
        clauses.append("p.pret_interne = :pi")
        params["pi"] = pret_interne
    if matricule:
        clauses.append("p.matricule = :mat")
        params["mat"] = matricule

    where = " AND ".join(clauses)
    rows = await db.execute(
        text(f"""
            SELECT p.*, c.prenom || ' ' || c.nom AS collab_nom, c.matricule AS mat_collab
            FROM prets p
            LEFT JOIN collaborateurs c ON c.id = p.collaborateur_id
            WHERE {where}
            ORDER BY p.created_date DESC
        """),
        params,
    )
    return [dict(r) for r in rows.mappings()]


@router.get("/gestion/prets/{pret_id}")
async def detail_pret(
    pret_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 20)
    row = await db.execute(
        text("""
            SELECT p.*, c.prenom || ' ' || c.nom AS collab_nom,
                   c.matricule AS mat_collab, c.date_entree
            FROM prets p
            LEFT JOIN collaborateurs c ON c.id = p.collaborateur_id
            WHERE p.id = :id AND p.deleted_date IS NULL
        """),
        {"id": str(pret_id)},
    )
    p = row.mappings().first()
    if not p:
        raise HTTPException(404, "Prêt introuvable.")
    ech_rows = await db.execute(
        text("SELECT * FROM pret_echeances WHERE pret_id = :pid ORDER BY numero"),
        {"pid": str(pret_id)},
    )
    audit_rows = await db.execute(
        text("SELECT * FROM pret_audit_log WHERE pret_id = :pid ORDER BY horodatage DESC LIMIT 50"),
        {"pid": str(pret_id)},
    )
    return {
        **dict(p),
        "echeancier": [dict(e) for e in ech_rows.mappings()],
        "audit": [dict(a) for a in audit_rows.mappings()],
    }


@router.post("/gestion/prets/{pret_id}/amortissement")
async def generer_amortissement(
    pret_id: uuid.UUID,
    body: GenererAmortissementRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50)
    nb = await generer_tableau_amortissement(
        db, pret_id, body.date_premiere_echeance,
        _matricule(payload), _sl(payload),
    )
    return {"ok": True, "nb_echeances": nb}


@router.post("/gestion/prets/{pret_id}/valider")
async def valider_pret(
    pret_id: uuid.UUID,
    body: ValiderRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50, "SECURITY_LEVEL >= 50 requis pour valider un prêt.")

    row = await db.execute(text("SELECT mt_pret FROM prets WHERE id = :id"), {"id": str(pret_id)})
    p = row.mappings().first()
    if not p:
        raise HTTPException(404, "Prêt introuvable.")

    seuil_row = await db.execute(
        text("SELECT valeur FROM pret_configuration WHERE code = 'SEUIL_DOUBLE_VALIDATION'")
    )
    seuil = float(seuil_row.scalar() or 0)
    if float(p["mt_pret"]) > seuil and _sl(payload) < 70:
        raise HTTPException(403, f"Prêt > {seuil:,.0f} MAD : double validation requise (SL >= 70).")

    nouveau_statut = "valide" if body.decision == "approuve" else "refuse"
    mat = _matricule(payload)
    await db.execute(
        text("""
            UPDATE prets
            SET statut = :st::pret_statut_enum,
                dt_decision = CURRENT_DATE,
                ref_decision = :ref,
                motif_decision = :mot,
                matric_decideur = :md,
                competenc_decideur = :cd,
                controled_date = NOW(),
                controled_by = :op,
                modified_by = :op
            WHERE id = :id
        """),
        {
            "st": nouveau_statut, "ref": body.ref_decision, "mot": body.motif_decision,
            "md": mat, "cd": body.competenc_decideur, "op": mat, "id": str(pret_id),
        },
    )
    from app.services.pret_service import _audit
    await _audit(db, pret_id, "DECISION", mat, _sl(payload), contexte={"decision": body.decision})
    await db.commit()
    return {"ok": True, "statut": nouveau_statut}


@router.post("/gestion/prets/{pret_id}/suspendre")
async def suspendre(
    pret_id: uuid.UUID,
    body: SuspendreRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50)
    await suspendre_pret(
        db, pret_id, body.motif, body.mode,
        body.date_debut, body.date_fin,
        _matricule(payload), _sl(payload),
    )
    return {"ok": True}


@router.post("/gestion/prets/{pret_id}/reprendre")
async def reprendre(
    pret_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50)
    await reprendre_pret(db, pret_id, _matricule(payload), _sl(payload))
    return {"ok": True}


# ──────────────────────────────────────────────────────────────
# FINANCE / PAIE (SL 70+)
# ──────────────────────────────────────────────────────────────

@router.post("/gestion/prets/{pret_id}/debloquer")
async def debloquer(
    pret_id: uuid.UUID,
    body: DebloquerRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    await debloquer_pret(
        db, pret_id, body.montant_debloque, body.date_deblocage,
        body.no_cheque, body.banque_emettrice,
        _matricule(payload), _sl(payload),
    )
    return {"ok": True}


@router.post("/gestion/prets/{pret_id}/prelever")
async def prelever(
    pret_id: uuid.UUID,
    body: PrelevementRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 70)
    result = await prelever_echeance(
        db, pret_id, body.salaire_net_disponible,
        body.reference_paie, _matricule(payload), _sl(payload),
    )
    if body.matricule:
        await recalculer_taux_endettement(db, body.matricule, body.salaire_net_disponible)
    return result


@router.post("/gestion/prets/{pret_id}/forcer-echeance")
async def forcer(
    pret_id: uuid.UUID,
    body: ForcerEcheanceRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    await forcer_echeance(
        db, pret_id, body.numero_echeance,
        body.nouveau_montant, body.note,
        _matricule(payload), _sl(payload),
    )
    return {"ok": True}


@router.delete("/gestion/prets/{pret_id}")
async def supprimer(
    pret_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50)
    try:
        await supprimer_pret_logique(db, pret_id, _matricule(payload), _sl(payload))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ──────────────────────────────────────────────────────────────
# STATS & ALERTES
# ──────────────────────────────────────────────────────────────

@router.get("/gestion/stats")
async def stats(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 20)
    row = await db.execute(
        text("""
            SELECT
                COUNT(*) FILTER (WHERE statut = 'en_attente_validation') AS en_attente,
                COUNT(*) FILTER (WHERE statut IN ('debloque','en_cours'))  AS actifs,
                COUNT(*) FILTER (WHERE statut = 'suspendu')               AS suspendus,
                COUNT(*) FILTER (WHERE statut = 'solde')                  AS soldes,
                COUNT(*) FILTER (WHERE statut = 'refuse')                 AS refuses,
                COALESCE(SUM(mt_debloque)   FILTER (WHERE statut IN ('debloque','en_cours')), 0) AS encours_total,
                COALESCE(SUM(capital_restant) FILTER (WHERE statut IN ('debloque','en_cours')), 0) AS capital_restant,
                COALESCE(SUM(mt_rembourse)  FILTER (WHERE statut IN ('debloque','en_cours','solde')), 0) AS total_rembourse,
                COALESCE(SUM(mt_debloque)   FILTER (WHERE pret_interne = TRUE AND statut NOT IN ('refuse','annule','solde') AND EXTRACT(YEAR FROM created_date) = EXTRACT(YEAR FROM NOW())), 0) AS enveloppe_interne_utilisee
            FROM prets WHERE deleted_date IS NULL
        """)
    )
    s = dict(row.mappings().first())
    plafond_row = await db.execute(
        text("SELECT valeur FROM pret_configuration WHERE code = 'PLAFOND_INTERNE_ANNUEL'")
    )
    plafond = float(plafond_row.scalar() or 0)
    s["plafond_interne_annuel"] = plafond
    s["enveloppe_disponible"] = plafond - float(s.get("enveloppe_interne_utilisee", 0))
    return s


@router.get("/gestion/alertes")
async def alertes(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50)
    rows = await db.execute(
        text("""
            SELECT a.*, p.ref_pret, p.matricule
            FROM pret_alertes a
            JOIN prets p ON p.id = a.pret_id
            WHERE a.lue = FALSE
            ORDER BY a.cree_le DESC LIMIT 50
        """)
    )
    return [dict(r) for r in rows.mappings()]


@router.post("/gestion/alertes/{alerte_id}/lue")
async def marquer_alerte_lue(
    alerte_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50)
    await db.execute(text("UPDATE pret_alertes SET lue = TRUE WHERE id = :id"), {"id": str(alerte_id)})
    await db.commit()
    return {"ok": True}


@router.get("/gestion/audit/{pret_id}")
async def audit_pret(
    pret_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 70)
    rows = await db.execute(
        text("SELECT * FROM pret_audit_log WHERE pret_id = :pid ORDER BY horodatage DESC"),
        {"pid": str(pret_id)},
    )
    return [dict(r) for r in rows.mappings()]


# ──────────────────────────────────────────────────────────────
# CONFIGURATION (SL 90+)
# ──────────────────────────────────────────────────────────────

@router.get("/config")
async def get_config(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 50)
    rows = await db.execute(text("SELECT * FROM pret_configuration ORDER BY code"))
    return [dict(r) for r in rows.mappings()]


@router.put("/config/{code}")
async def update_config(
    code: str,
    body: ConfigUpdateRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _require_sl(payload, 90, "SECURITY_LEVEL >= 90 requis pour modifier la configuration.")
    await db.execute(
        text("""
            UPDATE pret_configuration
            SET valeur = :v, description = COALESCE(:d, description),
                modifie_par = :op, modifie_le = NOW()
            WHERE code = :code
        """),
        {"v": body.valeur, "d": body.description, "op": _matricule(payload), "code": code},
    )
    await db.commit()
    return {"ok": True}
