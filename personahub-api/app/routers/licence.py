"""
app/routers/licence.py — Module de gestion des licences
Auteur : Adil DAIA

Endpoints :
  POST /api/v1/licence/snapshot        — déclenche un relevé d'usage (admin)
                                          (appelle la fonction SQL licence_prendre_snapshot)
  GET  /api/v1/licence/usage-courant   — usage temps réel : collaborateurs gérés
                                          + modules actifs vs limite licenciée

Le relevé est volontairement côté serveur (réutilise licence_prendre_snapshot,
même logique que le futur job quotidien). Réservé aux administrateurs.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload

router = APIRouter(prefix="/licence", tags=["licence"])


@router.get("/etat-signature")
def etat_signature(
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    """État de la licence SIGNÉE (fichier .lic vérifié cryptographiquement).

    Source de vérité pour le blocage : signature valide ? falsifiée ? expirée ?
    L'admin ne peut pas modifier la licence sans la clé privée de l'éditeur.

    Effet de bord : si la licence est valide et nouvelle (empreinte jamais vue),
    elle est ajoutée à l'historique automatiquement.
    """
    from app.core.licence_verify import lire_licence
    etat = lire_licence()

    # Enregistrement auto dans l'historique (si valide + empreinte nouvelle)
    if etat.get("valide") and etat.get("empreinte"):
        _enregistrer_historique(db, etat)

    # On ne renvoie pas tout le data brut si falsifié — juste l'essentiel
    return {
        "valide": etat["valide"],
        "raison": etat["raison"],
        "etat_echeance": etat["etat_echeance"],
        "jours_restants": etat["jours_restants"],
        "bloquee": etat["bloquee"],
        "modules": (etat["data"] or {}).get("modules") if etat["valide"] else None,
        "max_collaborateurs": (etat["data"] or {}).get("max_collaborateurs") if etat["valide"] else None,
        "client_nom": (etat["data"] or {}).get("client_nom") if etat["valide"] else None,
        "type_licence": (etat["data"] or {}).get("type_licence") if etat["valide"] else None,
        "date_fin": (etat["data"] or {}).get("date_fin") if etat["valide"] else None,
    }


def _enregistrer_historique(db: Session, etat: dict) -> None:
    """Insère la licence courante dans l'historique si son empreinte est nouvelle.
    Silencieux et sans effet si déjà présente (contrainte UNIQUE sur empreinte)."""
    data = etat.get("data") or {}
    empreinte = etat.get("empreinte")
    if not empreinte:
        return
    try:
        db.execute(text("""
            INSERT INTO licence_historique
                (empreinte, client_nom, type_licence, periodicite, max_collaborateurs,
                 est_full, nb_modules, date_debut, date_fin)
            VALUES
                (:empreinte, :client_nom, :type_licence, :periodicite, :max_collaborateurs,
                 :est_full, :nb_modules, :date_debut, :date_fin)
            ON CONFLICT (empreinte) DO NOTHING
        """), {
            "empreinte": empreinte,
            "client_nom": data.get("client_nom"),
            "type_licence": data.get("type_licence"),
            "periodicite": data.get("periodicite"),
            "max_collaborateurs": data.get("max_collaborateurs"),
            "est_full": bool(data.get("full")),
            "nb_modules": len(data.get("modules") or []),
            "date_debut": data.get("date_debut"),
            "date_fin": data.get("date_fin"),
        })
        db.commit()
    except Exception:
        db.rollback()  # l'historique ne doit jamais casser l'affichage de la licence


@router.get("/historique")
def historique(
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    """Historique des licences activées sur cette installation (plus récente d'abord)."""
    rows = db.execute(text("""
        SELECT client_nom, type_licence, periodicite, max_collaborateurs,
               est_full, nb_modules, date_debut, date_fin, detectee_le
        FROM licence_historique
        ORDER BY detectee_le DESC
    """)).mappings().all()
    return [
        {
            "client_nom": r["client_nom"],
            "type_licence": r["type_licence"],
            "periodicite": r["periodicite"],
            "max_collaborateurs": r["max_collaborateurs"],
            "full": r["est_full"],
            "nb_modules": r["nb_modules"],
            "date_debut": r["date_debut"].isoformat() if r["date_debut"] else None,
            "date_fin": r["date_fin"].isoformat() if r["date_fin"] else None,
            "detectee_le": r["detectee_le"].isoformat() if r["detectee_le"] else None,
        }
        for r in rows
    ]


def _exiger_admin(db: Session, payload: dict) -> None:
    """403 si l'utilisateur courant n'a pas le rôle administrateur."""
    user_id = payload.get("sub") or payload.get("user_id")
    est_admin = db.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM user_roles WHERE user_id = :u AND role = 'administrateur'
        )
    """), {"u": str(user_id)}).scalar()
    if not est_admin:
        raise HTTPException(status_code=403, detail="Action réservée à l'administrateur.")


@router.post("/snapshot")
def prendre_snapshot(
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """Déclenche un relevé d'usage (un point par jour, idempotent)."""
    _exiger_admin(db, payload)
    db.execute(text("SELECT licence_prendre_snapshot()"))
    db.commit()
    row = db.execute(text("""
        SELECT date_snapshot, collaborateurs_geres, modules_actifs
        FROM licence_usage_snapshot
        WHERE date_snapshot = current_date
    """)).mappings().first()
    return dict(row) if row else {"detail": "Relevé effectué."}


@router.get("/usage-courant")
def usage_courant(
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    """Usage temps réel comparé à la limite licenciée."""
    collabs = db.execute(text("""
        SELECT count(*) FROM collaborateurs
        WHERE archive = false AND lower(statut_collaborateur) = 'actif'
    """)).scalar() or 0

    modules_actifs = db.execute(text("""
        SELECT count(*) FROM licence_module WHERE actif = true
    """)).scalar() or 0

    lic = db.execute(text("""
        SELECT max_collaborateurs, type_licence, statut, date_fin, grace_jours
        FROM licence ORDER BY created_at LIMIT 1
    """)).mappings().first()

    max_collabs = (lic or {}).get("max_collaborateurs")
    date_fin = (lic or {}).get("date_fin")
    grace_jours = (lic or {}).get("grace_jours") or 0

    # État calculé à la volée : active / grace / expiree (None si on-premise)
    etat_echeance = None
    jours_restants = None
    if date_fin is not None:
        from datetime import date as _date, timedelta as _td
        today = _date.today()
        jours_restants = (date_fin - today).days
        fin_grace = date_fin + _td(days=grace_jours)
        if today <= date_fin:
            etat_echeance = "active"
        elif today <= fin_grace:
            etat_echeance = "grace"
        else:
            etat_echeance = "expiree"

    return {
        "collaborateurs_geres": collabs,
        "modules_actifs": modules_actifs,
        "max_collaborateurs": max_collabs,
        "depassement": bool(max_collabs is not None and collabs > max_collabs),
        "type_licence": (lic or {}).get("type_licence"),
        "statut": (lic or {}).get("statut"),
        "date_fin": date_fin.isoformat() if date_fin else None,
        "grace_jours": grace_jours,
        "jours_restants": jours_restants,
        "etat_echeance": etat_echeance,
    }


@router.get("/evolution")
def evolution(
    jours: int = 90,
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    """Série temporelle des relevés d'usage (pour le graphique d'évolution).

    Renvoie les snapshots des `jours` derniers jours + la limite licenciée
    (constante, pour tracer la ligne de seuil) et l'échéance.
    """
    rows = db.execute(text("""
        SELECT date_snapshot, collaborateurs_geres, modules_actifs
        FROM licence_usage_snapshot
        WHERE date_snapshot >= current_date - (:j || ' days')::interval
        ORDER BY date_snapshot
    """), {"j": jours}).mappings().all()

    lic = db.execute(text("""
        SELECT max_collaborateurs, type_licence, statut, date_debut, date_fin
        FROM licence ORDER BY created_at LIMIT 1
    """)).mappings().first()

    max_collabs = (lic or {}).get("max_collaborateurs")
    date_fin = (lic or {}).get("date_fin")

    # Jours restants avant échéance (None si on-premise perpétuel).
    # Calcul en Python : date_fin est déjà un objet date.
    jours_restants = None
    if date_fin is not None:
        from datetime import date as _date
        jours_restants = (date_fin - _date.today()).days

    return {
        "points": [
            {
                "date": r["date_snapshot"].isoformat() if hasattr(r["date_snapshot"], "isoformat") else str(r["date_snapshot"]),
                "collaborateurs": r["collaborateurs_geres"],
                "modules": r["modules_actifs"],
            }
            for r in rows
        ],
        "max_collaborateurs": max_collabs,
        "type_licence": (lic or {}).get("type_licence"),
        "date_debut": (lic or {}).get("date_debut").isoformat() if (lic or {}).get("date_debut") else None,
        "date_fin": date_fin.isoformat() if date_fin else None,
        "jours_restants": jours_restants,
    }
