from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import date, datetime
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db
from app.core.security import get_current_user_payload, require_roles
from app.models.collaborateur import Collaborateur, Contrat
from app.models.absences import DemandeConge, TypeConge
from app.models.mouvement import Depart
from app.models.organisation import Organisation, Poste

router = APIRouter(prefix="/dashboard", tags=["Tableau de bord"])


class KpiItem(BaseModel):
    label: str
    value: int | float
    variation: Optional[float] = None  # % variation vs période précédente
    detail: Optional[str] = None


class DashboardKpis(BaseModel):
    collaborateurs_actifs: KpiItem
    contrats_en_cours: KpiItem
    conges_en_attente: KpiItem
    departs_ce_mois: KpiItem
    organisations: KpiItem
    postes: KpiItem
    conges_approuves_mois: KpiItem
    taux_absenteisme: KpiItem


class RepartitionItem(BaseModel):
    label: str
    count: int


@router.get("/kpis", response_model=DashboardKpis)
def get_kpis(
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """
    Retourne les KPIs principaux du tableau de bord.
    Les managers reçoivent des KPIs filtrés à leur équipe (à étendre avec la population manager).
    """
    now = datetime.utcnow()
    debut_mois = date(now.year, now.month, 1)

    # Collaborateurs actifs
    nb_actifs = db.query(func.count(Collaborateur.id)).filter(
        Collaborateur.archive == False,
        Collaborateur.statut_collaborateur == "actif"
    ).scalar() or 0

    # Contrats en cours (pas de date de fin ou date future)
    nb_contrats = db.query(func.count(Contrat.id)).filter(
        Contrat.est_actif == True,
        (Contrat.date_fin == None) | (Contrat.date_fin >= date.today())
    ).scalar() or 0

    # Congés en attente de validation
    nb_attente = db.query(func.count(DemandeConge.id)).filter(
        DemandeConge.statut == "en_attente"
    ).scalar() or 0

    # Départs ce mois
    nb_departs = db.query(func.count(Depart.id)).filter(
        Depart.date_depart >= debut_mois,
        Depart.statut != "annule"
    ).scalar() or 0

    # Organisations actives
    nb_orgs = db.query(func.count(Organisation.id)).filter(Organisation.actif == True).scalar() or 0

    # Postes actifs
    nb_postes = db.query(func.count(Poste.id)).filter(Poste.actif == True).scalar() or 0

    # Congés approuvés ce mois
    nb_approuves = db.query(func.count(DemandeConge.id)).filter(
        DemandeConge.statut == "approuvee",
        DemandeConge.date_debut >= debut_mois,
    ).scalar() or 0

    # Taux d'absentéisme simplifié (jours pris / (actifs * jours ouvrés du mois) * 100)
    jours_pris = db.query(func.sum(DemandeConge.nombre_jours)).filter(
        DemandeConge.statut == "approuvee",
        DemandeConge.date_debut >= debut_mois,
    ).scalar() or 0
    jours_ouvres = 22  # approximation
    taux = round(float(jours_pris) / max(nb_actifs * jours_ouvres, 1) * 100, 2) if nb_actifs else 0

    return DashboardKpis(
        collaborateurs_actifs=KpiItem(label="Collaborateurs actifs", value=nb_actifs),
        contrats_en_cours=KpiItem(label="Contrats en cours", value=nb_contrats),
        conges_en_attente=KpiItem(label="Congés en attente", value=nb_attente, detail="À valider"),
        departs_ce_mois=KpiItem(label="Départs ce mois", value=nb_departs),
        organisations=KpiItem(label="Organisations", value=nb_orgs),
        postes=KpiItem(label="Postes actifs", value=nb_postes),
        conges_approuves_mois=KpiItem(label="Congés approuvés", value=nb_approuves, detail="Ce mois"),
        taux_absenteisme=KpiItem(label="Taux d'absentéisme", value=taux, detail="% ce mois"),
    )


@router.get("/repartition/statuts", response_model=list[RepartitionItem])
def repartition_statuts(
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh")),
):
    """Répartition des collaborateurs par statut."""
    rows = db.query(
        Collaborateur.statut_collaborateur,
        func.count(Collaborateur.id)
    ).filter(Collaborateur.archive == False).group_by(Collaborateur.statut_collaborateur).all()
    return [RepartitionItem(label=r[0], count=r[1]) for r in rows]


@router.get("/repartition/conges", response_model=list[RepartitionItem])
def repartition_conges(
    annee: int = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh", "manager")),
):
    """Répartition des congés par type pour l'année en cours."""
    annee = annee or datetime.utcnow().year
    rows = db.query(
        TypeConge.libelle,
        func.count(DemandeConge.id)
    ).join(DemandeConge, DemandeConge.type_conge_id == TypeConge.id).filter(
        extract("year", DemandeConge.date_debut) == annee,
        DemandeConge.statut == "approuvee",
    ).group_by(TypeConge.libelle).all()
    return [RepartitionItem(label=r[0], count=r[1]) for r in rows]
