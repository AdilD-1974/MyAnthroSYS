"""
app/routers/depart_processus.py — Processus de départ (config + association + suivi)

CONFIG (RH/admin) :
  GET    /depart-processus/catalogue        -> traitements disponibles (whitelist)
  GET    /depart-processus                  -> liste des processus (étapes + traitements)
  POST   /depart-processus                  -> créer un processus vide
  PUT    /depart-processus/{id}             -> upsert complet (étapes + traitements)
  DELETE /depart-processus/{id}             -> supprimer

ASSOCIATION & SUIVI :
  POST   /depart-processus/associer         {depart_id, processus_id}
         -> mode=PROCESSUS + instancie le suivi par étape (trace mode_decide_*)
  POST   /depart-processus/saisie-directe   {depart_id}
         -> mode=SAISIE_DIRECTE (trace mode_decide_*), supprime le suivi
  GET    /depart-processus/suivi/{depart_id}
         -> processus + étapes + complétion des traitements + statut de suivi
  PATCH  /depart-processus/suivi-etape/{suivi_id}  {statut, commentaire}
         -> met à jour une étape ; VALIDATION exige le rôle requis

A placer dans app/routers/depart_processus.py, puis dans main.py :
    from app.routers import depart_processus as depart_processus_router
    app.include_router(depart_processus_router.router, prefix=PREFIX)
"""
from __future__ import annotations

from typing import Optional, Any
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload

router = APIRouter(prefix="/depart-processus", tags=["depart-processus"])

# ── Catalogue des traitements (whitelist) : code -> (libellé, type) ──────────
# type : bool | date | num | text  (sert au calcul de complétion)
CATALOGUE: dict[str, tuple[str, str]] = {
    "date_notification": ("Date de notification", "date"),
    "reference_decision": ("Référence décision", "text"),
    "date_entretien_prealable": ("Entretien préalable", "date"),
    "decision_finale": ("Décision finale", "text"),
    "preavis_date_debut": ("Début préavis", "date"),
    "preavis_date_fin": ("Fin préavis", "date"),
    "preavis_duree_jours": ("Durée préavis (j)", "num"),
    "preavis_categorie": ("Catégorie préavis", "text"),
    "preavis_effectue": ("Préavis effectué", "bool"),
    "preavis_dispense": ("Préavis dispensé", "bool"),
    "cnss_radiation_date": ("Radiation CNSS", "date"),
    "cnss_derniere_declaration": ("Dernière déclaration CNSS", "text"),
    "amo_cloture_date": ("Clôture AMO", "date"),
    "amo_attestation_delivree": ("Attestation AMO délivrée", "bool"),
    "indemnite_total": ("Total indemnités", "num"),
    "solde_conges_jours": ("Solde congés (j)", "num"),
    "base_calcul_salaire": ("Base calcul salaire", "num"),
    "doc_attestation_travail": ("Attestation de travail", "bool"),
    "doc_recu_stc": ("Reçu solde de tout compte", "bool"),
    "doc_radiation_cnss": ("Radiation CNSS (doc)", "bool"),
    "doc_attestation_amo": ("Attestation AMO (doc)", "bool"),
    "doc_certificat_conges": ("Certificat de congés", "bool"),
    "doc_lettre_notification": ("Lettre de notification", "bool"),
    "doc_accord_amiable": ("Accord amiable", "bool"),
    "doc_pv_entretien": ("PV d'entretien", "bool"),
    "doc_recu_materiel": ("Reçu de matériel", "bool"),
    "materiel_badge_restitue": ("Badge restitué", "bool"),
    "materiel_ordinateur_restitue": ("Ordinateur restitué", "bool"),
    "materiel_vehicule_restitue": ("Véhicule restitué", "bool"),
    "materiel_telephone_restitue": ("Téléphone restitué", "bool"),
    "acces_si_desactive": ("Accès SI désactivé", "bool"),
    "acces_email_desactive": ("Email désactivé", "bool"),
}

ETAPE_TYPES = {"CHECKLIST", "VALIDATION", "SAISIE"}
SUIVI_STATUTS = {"A_FAIRE", "EN_COURS", "FAIT", "NON_APPLICABLE"}


# ── Rôles ───────────────────────────────────────────────────────────────────
def _role(db: Session, payload: dict, role_actif: Optional[str]) -> str:
    cand = (role_actif or payload.get("role") or "").strip()
    if cand:
        ok = db.execute(text(
            "SELECT 1 FROM user_roles WHERE user_id = :u AND role = :r LIMIT 1"
        ), {"u": str(payload.get("sub")), "r": cand}).scalar()
        if ok:
            return cand
    return (payload.get("role") or "").strip()


def _require_rh_admin(role: str):
    if role not in ("administrateur", "gestionnaire_rh"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Réservé au gestionnaire RH et à l'administrateur.")


def _treatment_done(value: Any, ttype: str) -> bool:
    if ttype == "bool":
        return value is True
    if ttype == "num":
        return value is not None
    # date / text
    return value is not None and str(value).strip() != ""


# ════════════════════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════════════════════
@router.get("/catalogue")
def catalogue(payload: dict = Depends(get_current_user_payload)):
    return [{"code": k, "libelle": v[0], "type": v[1]} for k, v in CATALOGUE.items()]


def _load_processus(db: Session, processus_id: Optional[str] = None) -> list[dict]:
    where = "WHERE p.id = :pid" if processus_id else ""
    params = {"pid": processus_id} if processus_id else {}
    procs = db.execute(text(f"""
        SELECT p.id, p.code, p.libelle, p.description, p.actif, p.ordre
        FROM depart_processus p {where} ORDER BY p.ordre, p.libelle
    """), params).mappings().all()
    out = []
    for p in procs:
        etapes = db.execute(text("""
            SELECT e.id, e.code, e.libelle, e.description, e.type, e.validation_role, e.ordre
            FROM depart_processus_etape e WHERE e.processus_id = :pid
            ORDER BY e.ordre, e.libelle
        """), {"pid": str(p["id"])}).mappings().all()
        etapes_out = []
        for e in etapes:
            traits = db.execute(text("""
                SELECT id, code_traitement, libelle, obligatoire, ordre
                FROM depart_processus_traitement WHERE etape_id = :eid
                ORDER BY ordre
            """), {"eid": str(e["id"])}).mappings().all()
            etapes_out.append({**dict(e), "traitements": [dict(t) for t in traits]})
        out.append({**dict(p), "etapes": etapes_out})
    return out


@router.get("")
@router.get("/")
def liste_processus(db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    return _load_processus(db)


@router.post("", status_code=201)
@router.post("/", status_code=201)
def creer_processus(body: dict, role_actif: Optional[str] = Query(None),
                    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    _require_rh_admin(_role(db, payload, role_actif))
    code = (body.get("code") or "").strip()
    libelle = (body.get("libelle") or "").strip()
    if not code or not libelle:
        raise HTTPException(400, "code et libelle requis.")
    try:
        row = db.execute(text("""
            INSERT INTO depart_processus (code, libelle, description, actif, ordre)
            VALUES (:c, :l, :d, COALESCE(:a, true), COALESCE(:o, 0)) RETURNING id
        """), {"c": code, "l": libelle, "d": body.get("description"),
               "a": body.get("actif"), "o": body.get("ordre")}).first()
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(400, f"Création impossible : {exc}") from exc
    return _load_processus(db, str(row[0]))[0]


@router.put("/{processus_id}")
def upsert_processus(processus_id: str, body: dict, role_actif: Optional[str] = Query(None),
                     db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    """Remplace le processus + ses étapes + traitements (édition complète)."""
    _require_rh_admin(_role(db, payload, role_actif))
    exists = db.execute(text("SELECT 1 FROM depart_processus WHERE id = :id"), {"id": processus_id}).scalar()
    if not exists:
        raise HTTPException(404, "Processus introuvable.")
    try:
        db.execute(text("""
            UPDATE depart_processus
            SET libelle = :l, description = :d, actif = COALESCE(:a, true),
                ordre = COALESCE(:o, 0), updated_at = now()
            WHERE id = :id
        """), {"id": processus_id, "l": (body.get("libelle") or "").strip(),
               "d": body.get("description"), "a": body.get("actif"), "o": body.get("ordre")})

        # Remplacer les étapes (cascade supprime les traitements)
        db.execute(text("DELETE FROM depart_processus_etape WHERE processus_id = :id"), {"id": processus_id})

        for i, e in enumerate(body.get("etapes") or []):
            etype = (e.get("type") or "CHECKLIST").upper()
            if etype not in ETAPE_TYPES:
                etype = "CHECKLIST"
            er = db.execute(text("""
                INSERT INTO depart_processus_etape
                    (processus_id, code, libelle, description, type, validation_role, ordre)
                VALUES (:p, :c, :l, :d, :t, :vr, :o) RETURNING id
            """), {"p": processus_id, "c": (e.get("code") or f"E{i+1}").strip(),
                   "l": (e.get("libelle") or f"Étape {i+1}").strip(), "d": e.get("description"),
                   "t": etype, "vr": e.get("validation_role"), "o": e.get("ordre", i)}).first()
            eid = str(er[0])
            for j, tr in enumerate(e.get("traitements") or []):
                code_t = (tr.get("code_traitement") or "").strip()
                if code_t not in CATALOGUE:
                    continue  # whitelist
                db.execute(text("""
                    INSERT INTO depart_processus_traitement
                        (etape_id, code_traitement, libelle, obligatoire, ordre)
                    VALUES (:e, :c, :l, COALESCE(:ob, true), :o)
                """), {"e": eid, "c": code_t,
                       "l": (tr.get("libelle") or CATALOGUE[code_t][0]).strip(),
                       "ob": tr.get("obligatoire"), "o": tr.get("ordre", j)})
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(400, f"Enregistrement impossible : {exc}") from exc
    return _load_processus(db, processus_id)[0]


@router.delete("/{processus_id}", status_code=204)
def supprimer_processus(processus_id: str, role_actif: Optional[str] = Query(None),
                        db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    _require_rh_admin(_role(db, payload, role_actif))
    db.execute(text("DELETE FROM depart_processus WHERE id = :id"), {"id": processus_id})
    db.commit()
    return None


# ════════════════════════════════════════════════════════════════════════════
# ASSOCIATION & SUIVI
# ════════════════════════════════════════════════════════════════════════════
@router.post("/associer")
def associer(body: dict, role_actif: Optional[str] = Query(None),
             db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    role = _role(db, payload, role_actif)
    _require_rh_admin(role)
    depart_id = body.get("depart_id")
    processus_id = body.get("processus_id")
    if not depart_id or not processus_id:
        raise HTTPException(400, "depart_id et processus_id requis.")
    uid = str(payload.get("sub"))
    now = datetime.now(timezone.utc)
    try:
        db.execute(text("""
            UPDATE collaborateur_departs
            SET mode_traitement = 'PROCESSUS', processus_id = :p,
                mode_decide_par = CAST(:u AS uuid), mode_decide_le = :n, updated_at = :n
            WHERE id = :d
        """), {"p": processus_id, "u": uid, "n": now, "d": depart_id})
        # Instancier le suivi (une ligne par étape), sans doublon
        db.execute(text("""
            INSERT INTO depart_etape_suivi (depart_id, etape_id, statut)
            SELECT :d, e.id, 'A_FAIRE'
            FROM depart_processus_etape e
            WHERE e.processus_id = :p
            ON CONFLICT (depart_id, etape_id) DO NOTHING
        """), {"d": depart_id, "p": processus_id})
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(400, f"Association impossible : {exc}") from exc
    return get_suivi(depart_id, role_actif, db, payload)


@router.post("/saisie-directe")
def saisie_directe(body: dict, role_actif: Optional[str] = Query(None),
                   db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    role = _role(db, payload, role_actif)
    _require_rh_admin(role)
    depart_id = body.get("depart_id")
    if not depart_id:
        raise HTTPException(400, "depart_id requis.")
    uid = str(payload.get("sub"))
    now = datetime.now(timezone.utc)
    try:
        db.execute(text("DELETE FROM depart_etape_suivi WHERE depart_id = :d"), {"d": depart_id})
        db.execute(text("""
            UPDATE collaborateur_departs
            SET mode_traitement = 'SAISIE_DIRECTE', processus_id = NULL,
                mode_decide_par = CAST(:u AS uuid), mode_decide_le = :n, updated_at = :n
            WHERE id = :d
        """), {"u": uid, "n": now, "d": depart_id})
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(400, f"Opération impossible : {exc}") from exc
    return {"depart_id": depart_id, "mode_traitement": "SAISIE_DIRECTE", "processus": None, "etapes": []}


@router.get("/suivi/{depart_id}")
def get_suivi(depart_id: str, role_actif: Optional[str] = Query(None),
              db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    dep = db.execute(text("SELECT * FROM collaborateur_departs WHERE id = :id"),
                     {"id": depart_id}).mappings().first()
    if not dep:
        raise HTTPException(404, "Départ introuvable.")

    mode = dep.get("mode_traitement") or "SAISIE_DIRECTE"
    processus_id = dep.get("processus_id")
    if not processus_id:
        return {"depart_id": depart_id, "mode_traitement": mode, "processus": None, "etapes": []}

    proc = db.execute(text("SELECT id, code, libelle FROM depart_processus WHERE id = :id"),
                      {"id": str(processus_id)}).mappings().first()
    etapes = db.execute(text("""
        SELECT id, code, libelle, description, type, validation_role, ordre
        FROM depart_processus_etape WHERE processus_id = :p ORDER BY ordre, libelle
    """), {"p": str(processus_id)}).mappings().all()
    suivi_rows = db.execute(text("""
        SELECT id, etape_id, statut, fait_par, fait_le, commentaire
        FROM depart_etape_suivi WHERE depart_id = :d
    """), {"d": depart_id}).mappings().all()
    suivi_by_etape = {str(s["etape_id"]): dict(s) for s in suivi_rows}

    etapes_out = []
    for e in etapes:
        traits = db.execute(text("""
            SELECT id, code_traitement, libelle, obligatoire, ordre
            FROM depart_processus_traitement WHERE etape_id = :e ORDER BY ordre
        """), {"e": str(e["id"])}).mappings().all()
        traits_out = []
        for t in traits:
            code_t = t["code_traitement"]
            ttype = CATALOGUE.get(code_t, ("", "text"))[1]
            val = dep.get(code_t)
            traits_out.append({**dict(t), "type": ttype, "valeur": val,
                               "fait": _treatment_done(val, ttype)})

        suivi = suivi_by_etape.get(str(e["id"]))
        if e["type"] == "VALIDATION":
            etape_fait = bool(suivi and suivi.get("statut") == "FAIT")
        else:
            oblig = [x for x in traits_out if x["obligatoire"]]
            cible = oblig if oblig else traits_out
            etape_fait = len(cible) > 0 and all(x["fait"] for x in cible)

        etapes_out.append({
            **dict(e),
            "traitements": traits_out,
            "suivi": suivi,
            "fait": etape_fait,
        })

    return {
        "depart_id": depart_id,
        "mode_traitement": mode,
        "processus": dict(proc) if proc else None,
        "etapes": etapes_out,
    }


@router.patch("/suivi-etape/{suivi_id}")
def maj_suivi_etape(suivi_id: str, body: dict, role_actif: Optional[str] = Query(None),
                    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    role = _role(db, payload, role_actif)
    row = db.execute(text("""
        SELECT s.id, s.depart_id, s.etape_id, e.type, e.validation_role
        FROM depart_etape_suivi s
        JOIN depart_processus_etape e ON e.id = s.etape_id
        WHERE s.id = :id
    """), {"id": suivi_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Suivi d'étape introuvable.")

    statut = (body.get("statut") or "").upper()
    if statut and statut not in SUIVI_STATUTS:
        raise HTTPException(400, f"Statut invalide. Attendu : {', '.join(sorted(SUIVI_STATUTS))}.")

    # Validation : exige le rôle requis (ou admin)
    if row["type"] == "VALIDATION" and statut == "FAIT":
        req = row["validation_role"]
        if role != "administrateur" and req and role != req:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                detail=f"Validation réservée au rôle : {req}.")
    else:
        _require_rh_admin(role)

    uid = str(payload.get("sub"))
    now = datetime.now(timezone.utc)
    fait = statut == "FAIT"
    db.execute(text("""
        UPDATE depart_etape_suivi
        SET statut = COALESCE(:st, statut),
            commentaire = COALESCE(:cm, commentaire),
            fait_par = CASE WHEN :fait THEN CAST(:u AS uuid) ELSE fait_par END,
            fait_le  = CASE WHEN :fait THEN :n ELSE fait_le END
        WHERE id = :id
    """), {"st": statut or None, "cm": body.get("commentaire"),
           "fait": fait, "u": uid, "n": now, "id": suivi_id})
    db.commit()
    return get_suivi(str(row["depart_id"]), role_actif, db, payload)
