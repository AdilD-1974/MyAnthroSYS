"""
app/routers/cotisations.py — Endpoints REST pour les cotisations
Auteur : Adil DAIA

Ce sous-router est inclus dans paie.py. Il expose :

  Régimes :
    GET    /paie/cotisation/regimes              → liste
    POST   /paie/cotisation/regimes              → créer
    PATCH  /paie/cotisation/regimes/{code}       → modifier
    DELETE /paie/cotisation/regimes/{code}       → désactiver

  Règles de cotisation (avec composantes) :
    GET    /paie/cotisation/regles               → liste avec composantes
    GET    /paie/cotisation/regles/{id}          → détail
    POST   /paie/cotisation/regles               → créer (entête + composantes)
    PATCH  /paie/cotisation/regles/{id}          → modifier (PATCH partiel)
    DELETE /paie/cotisation/regles/{id}          → archiver

  Affectation collaborateur ↔ régime :
    GET    /paie/cotisation/collaborateurs/{id}/regimes
    POST   /paie/cotisation/collaborateurs/{id}/regimes
    DELETE /paie/cotisation/collaborateurs/{id}/regimes/{code_regime}

  Calcul (moteur) :
    POST   /paie/cotisation/calcul → { collaborateur_id, code_regle, periode_mois, assiette_montant }
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session, selectinload
from uuid import UUID
from typing import List

from app.core.database import get_db
from app.core.security import require_roles, get_societe_active_id
from app.models.cotisation import (
    RefRegimeCotisation,
    RegleCalculCotisation,
    RegleCalculCotisationComposante,
    CollaborateurRegime,
)
from app.schemas.cotisation import (
    RefRegimeCotisationRead, RefRegimeCotisationWrite,
    RegleCotisationRead, RegleCotisationWrite, RegleCotisationUpdate,
    CollaborateurRegimeRead, CollaborateurRegimeWrite,
    CotisationCalculRequest, CotisationCalculResult,
)
from app.services.cotisation_engine import calculer_cotisation


router = APIRouter(prefix="/cotisation", tags=["Cotisations"])

PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


# ═════════════════════════════════════════════════════════════════════════════
# Régimes de cotisation
# ═════════════════════════════════════════════════════════════════════════════
@router.get("/regimes", response_model=List[RefRegimeCotisationRead])
def list_regimes(db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    return (
        db.query(RefRegimeCotisation)
        .order_by(RefRegimeCotisation.ordre, RefRegimeCotisation.code)
        .all()
    )


@router.post("/regimes", response_model=RefRegimeCotisationRead, status_code=201)
def create_regime(
    data: RefRegimeCotisationWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    if db.query(RefRegimeCotisation).filter(RefRegimeCotisation.code == data.code).first():
        raise HTTPException(400, f"Le régime '{data.code}' existe déjà")
    r = RefRegimeCotisation(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.patch("/regimes/{code}", response_model=RefRegimeCotisationRead)
def update_regime(
    code: str,
    data: RefRegimeCotisationWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    r = db.query(RefRegimeCotisation).filter(RefRegimeCotisation.code == code).first()
    if not r:
        raise HTTPException(404, "Régime introuvable")
    for field, value in data.model_dump(exclude_unset=True, exclude={"code"}).items():
        setattr(r, field, value)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/regimes/{code}", status_code=204)
def delete_regime(
    code: str,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    r = db.query(RefRegimeCotisation).filter(RefRegimeCotisation.code == code).first()
    if not r:
        raise HTTPException(404, "Régime introuvable")
    r.actif = False
    db.commit()


# ═════════════════════════════════════════════════════════════════════════════
# Règles de cotisation (entête + composantes)
# ═════════════════════════════════════════════════════════════════════════════
@router.get("/regles", response_model=List[RegleCotisationRead])
def list_regles(db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                societe_id: str = Depends(get_societe_active_id)):
    """
    Liste des règles de cotisation avec leurs composantes (eager-loaded).
    RG-MULTISOCIETE-03 : générique (societe_id NULL) + spécifique à la
    société active -- jamais les règles spécifiques d'une autre société.
    """
    return (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(RegleCalculCotisation.archive == False,  # noqa: E712
                (RegleCalculCotisation.societe_id.is_(None)) | (RegleCalculCotisation.societe_id == societe_id))
        .order_by(RegleCalculCotisation.code)
        .all()
    )


@router.get("/regles/{regle_id}", response_model=RegleCotisationRead)
def get_regle(
    regle_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    regle = (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(RegleCalculCotisation.id == regle_id)
        .first()
    )
    if not regle:
        raise HTTPException(404, "Règle introuvable")
    # RG-MULTISOCIETE-03 : 404 (pas 403) si la règle appartient à une autre
    # société -- ne jamais confirmer son existence à qui n'y a pas accès.
    if regle.societe_id is not None and str(regle.societe_id) != societe_id:
        raise HTTPException(404, "Règle introuvable")
    return regle


@router.post("/regles", response_model=RegleCotisationRead, status_code=201)
def create_regle(
    data: RegleCotisationWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    # RG-MULTISOCIETE-03 (correctif 24/08) : la vérification globale
    # `filter(code == data.code)` bloquait la création d'une surcharge
    # société légitime dès qu'une règle générique du même code existait --
    # la migration 060 a remplacé la contrainte UNIQUE(code) par deux index
    # partiels précisément pour permettre ça. Vérification alignée dessus :
    # un seul générique par code, une seule spécifique par (société, code).
    societe_cible = data.societe_id
    if societe_cible is not None and str(societe_cible) != societe_id:
        raise HTTPException(403, "Impossible de créer une règle pour une autre société que l'active.")
    conflit = (
        db.query(RegleCalculCotisation)
        .filter(RegleCalculCotisation.code == data.code,
                RegleCalculCotisation.societe_id == societe_cible if societe_cible is not None
                else RegleCalculCotisation.societe_id.is_(None))
        .first()
    )
    if conflit:
        cible = "générique" if societe_cible is None else "spécifique à cette société"
        raise HTTPException(400, f"Une règle {cible} avec le code '{data.code}' existe déjà")

    payload = data.model_dump(exclude={"composantes"})
    regle = RegleCalculCotisation(**payload)

    for compo_data in data.composantes:
        regle.composantes.append(
            RegleCalculCotisationComposante(**compo_data.model_dump())
        )

    db.add(regle)
    db.commit()
    db.refresh(regle)
    return regle


@router.patch("/regles/{regle_id}", response_model=RegleCotisationRead)
def update_regle(
    regle_id: UUID,
    data: RegleCotisationUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    PATCH partiel : seuls les champs fournis sont mis à jour.
    Si `composantes` est fourni, on remplace TOUTES les composantes (delete + insert).

    RG-MULTISOCIETE-03 : modifier une règle GÉNÉRIQUE reste possible (elle
    impacte alors toutes les sociétés, comme avant le multi-société) ; modifier
    la règle SPÉCIFIQUE d'une AUTRE société est refusé. `societe_id` n'est pas
    modifiable via ce endpoint (RegleCotisationUpdate ne l'expose pas) --
    une règle ne change pas de portée après coup, elle se recrée.
    """
    regle = (
        db.query(RegleCalculCotisation)
        .options(selectinload(RegleCalculCotisation.composantes))
        .filter(RegleCalculCotisation.id == regle_id)
        .first()
    )
    if not regle:
        raise HTTPException(404, "Règle introuvable")
    if regle.societe_id is not None and str(regle.societe_id) != societe_id:
        raise HTTPException(404, "Règle introuvable")

    update_data = data.model_dump(exclude_unset=True)
    composantes = update_data.pop("composantes", None)

    for field, value in update_data.items():
        setattr(regle, field, value)

    if composantes is not None:
        # Reset des composantes (cascade delete-orphan via la relation)
        regle.composantes.clear()
        db.flush()
        for c in composantes:
            regle.composantes.append(RegleCalculCotisationComposante(**c))

    db.commit()
    db.refresh(regle)
    return regle


@router.delete("/regles/{regle_id}", status_code=204)
def archive_regle(
    regle_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
    societe_id: str = Depends(get_societe_active_id),
):
    regle = db.query(RegleCalculCotisation).filter(RegleCalculCotisation.id == regle_id).first()
    if not regle:
        raise HTTPException(404, "Règle introuvable")
    if regle.societe_id is not None and str(regle.societe_id) != societe_id:
        raise HTTPException(404, "Règle introuvable")
    regle.archive = True
    regle.actif = False
    db.commit()


# ═════════════════════════════════════════════════════════════════════════════
# Affectation collaborateur ↔ régime (immatriculations)
# ═════════════════════════════════════════════════════════════════════════════
# RG-MULTISOCIETE-08 : collaborateurs n'a pas de modèle ORM fiable partagé
# ici (voir échange du 24/08 sur collaborateur.py legacy) -- vérification
# d'appartenance société en SQL brut, sur la vraie table de production.
def _collaborateur_ou_404(db: Session, collaborateur_id: UUID, societe_id: str) -> None:
    ok = db.execute(text(
        "SELECT 1 FROM collaborateurs WHERE id = :cid AND societe_id = :sid"
    ), {"cid": str(collaborateur_id), "sid": societe_id}).first()
    if not ok:
        raise HTTPException(404, "Collaborateur introuvable")


@router.get("/collaborateurs/{collaborateur_id}/regimes", response_model=List[CollaborateurRegimeRead])
def list_collab_regimes(
    collaborateur_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    _collaborateur_ou_404(db, collaborateur_id, societe_id)
    return (
        db.query(CollaborateurRegime)
        .filter(CollaborateurRegime.collaborateur_id == collaborateur_id)
        .all()
    )


@router.post(
    "/collaborateurs/{collaborateur_id}/regimes",
    response_model=CollaborateurRegimeRead,
    status_code=201,
)
def affect_regime(
    collaborateur_id: UUID,
    data: CollaborateurRegimeWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    _collaborateur_ou_404(db, collaborateur_id, societe_id)
    # Vérifier l'unicité
    existing = (
        db.query(CollaborateurRegime)
        .filter(
            CollaborateurRegime.collaborateur_id == collaborateur_id,
            CollaborateurRegime.code_regime == data.code_regime,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            400,
            f"Le collaborateur est déjà affecté au régime '{data.code_regime}'",
        )

    cr = CollaborateurRegime(
        collaborateur_id=collaborateur_id,
        **data.model_dump(),
    )
    db.add(cr)
    db.commit()
    db.refresh(cr)
    return cr


@router.delete(
    "/collaborateurs/{collaborateur_id}/regimes/{code_regime}",
    status_code=204,
)
def remove_collab_regime(
    collaborateur_id: UUID,
    code_regime: str,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    _collaborateur_ou_404(db, collaborateur_id, societe_id)
    cr = (
        db.query(CollaborateurRegime)
        .filter(
            CollaborateurRegime.collaborateur_id == collaborateur_id,
            CollaborateurRegime.code_regime == code_regime,
        )
        .first()
    )
    if not cr:
        raise HTTPException(404, "Affectation introuvable")
    db.delete(cr)
    db.commit()


# ═════════════════════════════════════════════════════════════════════════════
# MOTEUR DE CALCUL
# ═════════════════════════════════════════════════════════════════════════════
@router.post("/calcul", response_model=CotisationCalculResult)
def calculer(
    req: CotisationCalculRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    Calcule une cotisation pour un collaborateur sur une période donnée.

    Le moteur :
      1. Vérifie l'affectation du collaborateur au régime
      2. Applique les options sur l'assiette (négative, prorata)
      3. Calcule chaque composante (taux × base plafonnée)
      4. Applique les min/max
      5. Renvoie le détail composante par composante

    RG-MULTISOCIETE-03 (correctif 24/08) : `societe_id` désormais transmis --
    sans lui, cet endpoint de test/calcul direct ne pouvait résoudre QUE les
    règles/barèmes génériques, jamais une surcharge société, contrairement
    au vrai calcul de paie (paie_engine.py) qui la transmet déjà.
    """
    return calculer_cotisation(db, req, societe_id=societe_id)
