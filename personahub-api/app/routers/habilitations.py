"""
app/routers/habilitations.py — Gestion des périmètres d'habilitation
Auteur : Adil DAIA

Un gestionnaire ne gère qu'une POPULATION de collaborateurs, définie par une ou
plusieurs RÈGLES. Plusieurs règles sur un même gestionnaire se cumulent (OU).

Modèle d'une règle :
  - est_global = true  → tous les collaborateurs (aucune condition)
  - sinon : N CONDITIONS combinées en ET, chaque condition portant
            1..N VALEURS combinées en OU.
    Ex. (SOCIETE ∈ {X,Y}) ET (CATEGORIE_PRO ∈ {cadre}) ET (TYPE_CONTRAT ∈ {CDI,CDD})

Types de condition :
  UO, SOCIETE, ETABLISSEMENT, TYPE_CONTRAT, STATUT,
  CLASSIFICATION, CATEGORIE_PRO, COLLEGE, CATEGORIE_EMPLOI
  (GLOBAL n'est plus un type de condition : c'est le flag est_global.)

Valeur stockée selon le type :
  - UO / SOCIETE / ETABLISSEMENT  → UUID de l'entité
  - TYPE_CONTRAT / STATUT / CLASSIFICATION / CATEGORIE_PRO / COLLEGE / CATEGORIE_EMPLOI
                                  → code du référentiel
  inclure_sous_uo : par condition, pertinent uniquement pour UO.

⚠️ Ce routeur ne fait que la GESTION des règles (CRUD + sélecteurs). L'APPLICATION
   effective (filtrage de la population, avec l'intersection ET / l'union OU) se fait
   dans le résolveur, ailleurs. Les règles ne restreignent rien tant qu'il n'interprète
   pas cette structure.

Endpoints (réservés administrateur) :
  GET    /api/v1/habilitations                  — liste (option ?user_id= & ?role=)
  POST   /api/v1/habilitations                  — créer une règle (en-tête + conditions)
  PUT    /api/v1/habilitations/{id}             — remplacer une règle
  DELETE /api/v1/habilitations/{id}             — supprimer une règle (cascade)
  PATCH  /api/v1/habilitations/{id}/toggle      — activer / désactiver
  GET    /api/v1/habilitations/gestionnaires    — users ayant un rôle de gestion
  GET    /api/v1/habilitations/uos              — UO (sélecteur)
  GET    /api/v1/habilitations/societes         — sociétés (sélecteur)
  GET    /api/v1/habilitations/etablissements   — établissements (sélecteur)
  GET    /api/v1/habilitations/types-contrat    — types de contrat (sélecteur)
  GET    /api/v1/habilitations/statuts          — statuts collaborateur (sélecteur)
  GET    /api/v1/habilitations/classifications  — classifications (sélecteur)
  GET    /api/v1/habilitations/categories-pro   — catégories professionnelles (sélecteur)
  GET    /api/v1/habilitations/colleges         — collèges (sélecteur)
  GET    /api/v1/habilitations/categories-emploi— catégories d'emploi (sélecteur)
"""
from __future__ import annotations

from typing import Optional, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles

router = APIRouter(prefix="/habilitations", tags=["habilitations"])

# Rôles considérés comme « de gestion » (peuvent porter un périmètre)
ROLES_GESTION = ("administrateur", "gestionnaire_rh", "gestionnaire_paie", "manager")

# Types de CONDITION acceptés (GLOBAL n'en est plus un : c'est est_global).
TYPES_CONDITION = (
    "UO", "SOCIETE", "ETABLISSEMENT", "TYPE_CONTRAT", "STATUT",
    "CLASSIFICATION", "CATEGORIE_PRO", "COLLEGE", "CATEGORIE_EMPLOI",
)


# ─── Schémas ────────────────────────────────────────────────────────────────

class ConditionIn(BaseModel):
    type_critere: str = Field(..., description="UO | SOCIETE | ETABLISSEMENT | TYPE_CONTRAT | STATUT | CLASSIFICATION | CATEGORIE_PRO | COLLEGE | CATEGORIE_EMPLOI")
    valeurs: list[str] = Field(default_factory=list, description="1..N valeurs (combinées en OU)")
    inclure_sous_uo: bool = False  # pertinent uniquement si type_critere = UO


class HabilitationIn(BaseModel):
    user_id: UUID
    role: str = Field(..., description="gestionnaire_rh | gestionnaire_paie | manager | administrateur")
    est_global: bool = False
    conditions: list[ConditionIn] = Field(default_factory=list)


class HabilitationUpdate(BaseModel):
    """Le gestionnaire (user_id) ne change pas en édition."""
    role: str
    est_global: bool = False
    conditions: list[ConditionIn] = Field(default_factory=list)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _valider_conditions(est_global: bool, conditions: list[ConditionIn]) -> None:
    """Règles de validation communes à la création et à l'édition."""
    if est_global:
        return  # une règle globale n'a pas de condition
    if not conditions:
        raise HTTPException(400, "Une règle non globale doit comporter au moins une condition")
    for i, c in enumerate(conditions, start=1):
        tc = c.type_critere.upper()
        if tc not in TYPES_CONDITION:
            raise HTTPException(400, f"Condition {i} : type « {c.type_critere} » invalide")
        valeurs = [v for v in (c.valeurs or []) if v]
        if not valeurs:
            raise HTTPException(400, f"Condition {i} ({tc}) : au moins une valeur est requise")


def _inserer_conditions(db: Session, perimetre_id: str, conditions: list[ConditionIn]) -> None:
    """Insère les conditions et leurs valeurs pour une règle donnée."""
    for c in conditions:
        tc = c.type_critere.upper()
        inclure = c.inclure_sous_uo if tc == "UO" else False
        cond = db.execute(text("""
            INSERT INTO habilitation_condition (perimetre_id, type_critere, inclure_sous_uo)
            VALUES (:pid, :tc, :sous)
            RETURNING id
        """), {"pid": perimetre_id, "tc": tc, "sous": inclure}).first()
        cond_id = str(cond[0])
        # Valeurs distinctes non vides
        for v in {v for v in (c.valeurs or []) if v}:
            db.execute(text("""
                INSERT INTO habilitation_condition_valeur (condition_id, valeur)
                VALUES (:cid, :val)
            """), {"cid": cond_id, "val": v})


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", dependencies=[Depends(require_roles("administrateur"))])
def list_habilitations(
    user_id: Optional[UUID] = None,
    role: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Liste les règles, reconstruites en arbre règle → conditions → valeurs.

    Une seule requête : LEFT JOIN en cascade, puis assemblage en Python.
    Le libellé de chaque valeur est résolu selon le type de sa condition
    (comparaison en TEXTE pour éviter tout cast ::uuid sur des codes).
    """
    where = ["1=1"]
    params: dict[str, Any] = {}
    if user_id:
        where.append("hp.user_id = :uid")
        params["uid"] = str(user_id)
    if role:
        where.append("hp.role = :role")
        params["role"] = role

    rows = db.execute(text(f"""
        SELECT hp.id            AS perimetre_id,
               hp.user_id, hp.role, hp.actif, hp.created_at, hp.est_global,
               p.nom AS gest_nom, p.prenom AS gest_prenom,
               hc.id            AS condition_id,
               hc.type_critere, hc.inclure_sous_uo,
               hcv.id           AS valeur_id,
               hcv.valeur,
               COALESCE(
                   uo.libelle, soc.raison_sociale, etab.libelle, rtc.libelle,
                   rcl.libelle, rcp.libelle, rco.libelle, rce.libelle,
                   hcv.valeur
               ) AS valeur_libelle,
               uo.code AS uo_code
        FROM habilitation_perimetre hp
        LEFT JOIN profiles p ON p.user_id = hp.user_id
        LEFT JOIN habilitation_condition hc ON hc.perimetre_id = hp.id
        LEFT JOIN habilitation_condition_valeur hcv ON hcv.condition_id = hc.id
        LEFT JOIN unites_organisationnelles uo
               ON hc.type_critere = 'UO'             AND uo.id::text  = hcv.valeur
        LEFT JOIN societes soc
               ON hc.type_critere = 'SOCIETE'        AND soc.id::text = hcv.valeur
        LEFT JOIN etablissements etab
               ON hc.type_critere = 'ETABLISSEMENT'  AND etab.id::text = hcv.valeur
        LEFT JOIN ref_type_contrat rtc
               ON hc.type_critere = 'TYPE_CONTRAT'   AND rtc.code     = hcv.valeur
        LEFT JOIN ref_classification rcl
               ON hc.type_critere = 'CLASSIFICATION' AND rcl.code     = hcv.valeur
        LEFT JOIN ref_categorie_professionnelle rcp
               ON hc.type_critere = 'CATEGORIE_PRO'  AND rcp.code     = hcv.valeur
        LEFT JOIN ref_college rco
               ON hc.type_critere = 'COLLEGE'        AND rco.code     = hcv.valeur
        LEFT JOIN ref_categorie_emploi rce
               ON hc.type_critere = 'CATEGORIE_EMPLOI' AND rce.code   = hcv.valeur
        WHERE {' AND '.join(where)}
        ORDER BY p.nom NULLS LAST, hp.created_at, hc.id, hcv.id
    """), params).mappings().all()

    rules: dict[str, dict] = {}
    order: list[str] = []
    for r in rows:
        pid = str(r["perimetre_id"])
        if pid not in rules:
            rules[pid] = {
                "id": pid,
                "user_id": str(r["user_id"]),
                "role": r["role"],
                "actif": r["actif"],
                "created_at": r["created_at"],
                "est_global": r["est_global"],
                "gest_nom": r["gest_nom"],
                "gest_prenom": r["gest_prenom"],
                "_conditions": {},  # condition_id -> condition
            }
            order.append(pid)
        if r["condition_id"] is not None:
            conds = rules[pid]["_conditions"]
            cid = str(r["condition_id"])
            if cid not in conds:
                conds[cid] = {
                    "id": cid,
                    "type_critere": r["type_critere"],
                    "inclure_sous_uo": r["inclure_sous_uo"],
                    "valeurs": [],
                }
            if r["valeur_id"] is not None:
                conds[cid]["valeurs"].append({
                    "valeur": r["valeur"],
                    "libelle": r["valeur_libelle"],
                    "uo_code": r["uo_code"],
                })

    out = []
    for pid in order:
        rule = rules[pid]
        rule["conditions"] = list(rule.pop("_conditions").values())
        out.append(rule)
    return out


@router.post("", status_code=201, dependencies=[Depends(require_roles("administrateur"))])
def create_habilitation(payload: HabilitationIn, db: Session = Depends(get_db)):
    """Crée une règle : en-tête + conditions (ET) + valeurs (OU)."""
    _valider_conditions(payload.est_global, payload.conditions)

    # Une seule règle globale active par (gestionnaire, rôle)
    if payload.est_global:
        dup = db.execute(text("""
            SELECT 1 FROM habilitation_perimetre
            WHERE user_id = :uid AND role = :role AND est_global = true AND actif
        """), {"uid": str(payload.user_id), "role": payload.role}).first()
        if dup:
            raise HTTPException(409, "Ce gestionnaire a déjà un périmètre global actif pour ce rôle")

    # En-tête. type_critere legacy = 'GLOBAL' ou 'COMPOSE' (colonne conservée, NOT NULL éventuel).
    tc_legacy = "GLOBAL" if payload.est_global else "COMPOSE"
    row = db.execute(text("""
        INSERT INTO habilitation_perimetre
            (user_id, role, type_critere, valeur, inclure_sous_uo, actif, est_global)
        VALUES (:uid, :role, :tc, NULL, false, true, :glob)
        RETURNING id
    """), {"uid": str(payload.user_id), "role": payload.role,
           "tc": tc_legacy, "glob": payload.est_global}).first()
    perimetre_id = str(row[0])

    if not payload.est_global:
        _inserer_conditions(db, perimetre_id, payload.conditions)

    db.commit()
    return {"id": perimetre_id, "detail": "Règle de périmètre créée"}


@router.put("/{habil_id}", dependencies=[Depends(require_roles("administrateur"))])
def update_habilitation(habil_id: UUID, payload: HabilitationUpdate, db: Session = Depends(get_db)):
    """Remplace intégralement une règle (rôle, est_global, conditions/valeurs)."""
    current = db.execute(text("""
        SELECT user_id FROM habilitation_perimetre WHERE id = :id
    """), {"id": str(habil_id)}).first()
    if not current:
        raise HTTPException(404, "Règle introuvable")

    _valider_conditions(payload.est_global, payload.conditions)

    # Purge des conditions existantes (les valeurs partent en cascade)
    db.execute(text("DELETE FROM habilitation_condition WHERE perimetre_id = :id"),
               {"id": str(habil_id)})

    tc_legacy = "GLOBAL" if payload.est_global else "COMPOSE"
    db.execute(text("""
        UPDATE habilitation_perimetre
           SET role = :role, est_global = :glob, type_critere = :tc, valeur = NULL
         WHERE id = :id
    """), {"id": str(habil_id), "role": payload.role,
           "glob": payload.est_global, "tc": tc_legacy})

    if not payload.est_global:
        _inserer_conditions(db, str(habil_id), payload.conditions)

    db.commit()
    return {"id": str(habil_id), "detail": "Règle de périmètre modifiée"}


@router.delete("/{habil_id}", status_code=204,
               dependencies=[Depends(require_roles("administrateur"))])
def delete_habilitation(habil_id: UUID, db: Session = Depends(get_db)):
    """Supprime une règle (conditions + valeurs en cascade)."""
    db.execute(text("DELETE FROM habilitation_perimetre WHERE id = :id"),
               {"id": str(habil_id)})
    db.commit()


@router.patch("/{habil_id}/toggle",
              dependencies=[Depends(require_roles("administrateur"))])
def toggle_habilitation(habil_id: UUID, db: Session = Depends(get_db)):
    """Active / désactive une règle."""
    row = db.execute(text("""
        UPDATE habilitation_perimetre SET actif = NOT actif
        WHERE id = :id RETURNING actif
    """), {"id": str(habil_id)}).first()
    if not row:
        raise HTTPException(404, "Règle introuvable")
    db.commit()
    return {"id": str(habil_id), "actif": row[0]}


@router.get("/gestionnaires",
            dependencies=[Depends(require_roles("administrateur"))])
def list_gestionnaires(db: Session = Depends(get_db)):
    """Liste les utilisateurs ayant au moins un rôle de gestion, avec leurs rôles."""
    rows = db.execute(text("""
        SELECT ur.user_id,
               p.nom, p.prenom,
               array_agg(DISTINCT ur.role) AS roles
        FROM user_roles ur
        LEFT JOIN profiles p ON p.user_id = ur.user_id
        WHERE ur.role = ANY(:roles)
        GROUP BY ur.user_id, p.nom, p.prenom
        ORDER BY p.nom NULLS LAST
    """), {"roles": list(ROLES_GESTION)}).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["roles"] = [x for x in (d.get("roles") or []) if x in ROLES_GESTION]
        out.append(d)
    return out


@router.get("/uos", dependencies=[Depends(require_roles("administrateur"))])
def list_uos(db: Session = Depends(get_db)):
    """Liste les UO actives pour le sélecteur (id, code, libellé, parent)."""
    rows = db.execute(text("""
        SELECT id, code, libelle, parent_id, type_uo, niveau
        FROM unites_organisationnelles
        WHERE actif = true
        ORDER BY niveau, libelle
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.get("/societes", dependencies=[Depends(require_roles("administrateur"))])
def list_societes(db: Session = Depends(get_db)):
    """Liste les sociétés actives pour le sélecteur (valeur stockée = id)."""
    rows = db.execute(text("""
        SELECT id, raison_sociale AS libelle
        FROM societes
        WHERE actif = true
        ORDER BY raison_sociale
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.get("/etablissements", dependencies=[Depends(require_roles("administrateur"))])
def list_etablissements(db: Session = Depends(get_db)):
    """Liste les établissements actifs pour le sélecteur (valeur stockée = id)."""
    rows = db.execute(text("""
        SELECT id, code, libelle, societe_id
        FROM etablissements
        WHERE actif = true
        ORDER BY libelle
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.get("/types-contrat", dependencies=[Depends(require_roles("administrateur"))])
def list_types_contrat(db: Session = Depends(get_db)):
    """Liste les types de contrat (valeur stockée = code, pour matcher contrats.type_contrat)."""
    rows = db.execute(text("""
        SELECT code, libelle
        FROM ref_type_contrat
        WHERE actif = true
        ORDER BY ordre, libelle
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.get("/statuts", dependencies=[Depends(require_roles("administrateur"))])
def list_statuts(db: Session = Depends(get_db)):
    """Liste les valeurs distinctes de statut_collaborateur réellement présentes."""
    rows = db.execute(text("""
        SELECT DISTINCT statut_collaborateur AS code
        FROM collaborateurs
        WHERE statut_collaborateur IS NOT NULL AND archive = false
        ORDER BY statut_collaborateur
    """)).mappings().all()
    return [{"code": r["code"], "libelle": r["code"]} for r in rows]


# ── Référentiels "population" ────────────────────────────────────────────────
# Tous partagent la structure code/libelle/actif/ordre (comme ref_classification).
# La valeur stockée dans la condition = le `code` du référentiel.

def _list_referentiel(db: Session, table: str) -> list[dict]:
    """Liste générique d'un référentiel code/libelle actif, trié par ordre.

    ⚠️ Suppose la structure standard (actif, ordre). Si l'un de ces référentiels
    n'a pas ces colonnes, l'endpoint renverra 500 → retirer le filtre/tri ici.
    Le nom de table est figé en dur (jamais issu d'une entrée utilisateur).
    """
    rows = db.execute(text(f"""
        SELECT code, libelle
        FROM {table}
        WHERE actif = true
        ORDER BY ordre, libelle
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.get("/classifications", dependencies=[Depends(require_roles("administrateur"))])
def list_classifications(db: Session = Depends(get_db)):
    """Référentiel de classification (valeur stockée = code)."""
    return _list_referentiel(db, "ref_classification")


@router.get("/categories-pro", dependencies=[Depends(require_roles("administrateur"))])
def list_categories_pro(db: Session = Depends(get_db)):
    """Catégories professionnelles / CSP (valeur stockée = code)."""
    return _list_referentiel(db, "ref_categorie_professionnelle")


@router.get("/colleges", dependencies=[Depends(require_roles("administrateur"))])
def list_colleges(db: Session = Depends(get_db)):
    """Collèges (valeur stockée = code)."""
    return _list_referentiel(db, "ref_college")


@router.get("/categories-emploi", dependencies=[Depends(require_roles("administrateur"))])
def list_categories_emploi(db: Session = Depends(get_db)):
    """Catégories d'emploi (valeur stockée = code)."""
    return _list_referentiel(db, "ref_categorie_emploi")
