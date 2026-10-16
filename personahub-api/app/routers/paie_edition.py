"""
Édition du bulletin de paie (PDF).
Auteur : (intégration proposée pour PersonaHub HR)

À monter dans app/routers/paie.py aux côtés des autres routeurs paie
(même convention que paie_calcul.py : pas de prefix ici, paie.py l'ajoute
lui-même au montage) :

    from app.routers import paie_edition
    router.include_router(paie_edition.router)
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles, get_societe_active_id
from app.routers.paie_calcul import _lire_bulletins, PAIE_ROLES
from app.services.bulletin_pdf import generer_pdf_bulletin

router = APIRouter(tags=["Paie — Édition bulletin"])


def _charger_identite_collaborateur(db: Session, collaborateur_id) -> dict:
    """
    Infos d'identité affichées sur le bulletin, en plus de ce que renvoie
    déjà `_lire_bulletins` (qui ne porte que `matricule`).

    ⚠️ À VÉRIFIER : je n'ai vu dans paie_calcul.py que `collaborateurs.nom`
    et `collaborateurs.prenom` confirmés (utilisés dans /bulletins/recherche).
    Complétez/corrigez les colonnes ci-dessous (CIN, CNSS, date d'embauche...)
    selon le schéma réel de `collaborateurs` / `collaborateur_contrats` /
    `collaborateur_affectations`.
    """
    row = db.execute(text("""
        SELECT c.nom, c.prenom,
               c.cin,
               c.num_cnss,
               c.code_situation_familiale,
               k.code_type_contrat,
               k.date_debut AS date_embauche
          FROM public.collaborateurs c
          LEFT JOIN public.collaborateur_contrats k
                 ON k.collaborateur_id = c.id
                AND k.date_debut = (
                    SELECT MIN(date_debut) FROM public.collaborateur_contrats
                     WHERE collaborateur_id = c.id
                )
         WHERE c.id = :id
    """), {"id": str(collaborateur_id)}).mappings().first()
    if not row:
        return {}
    d = dict(row)
    if d.get("date_embauche"):
        d["date_embauche"] = d["date_embauche"].isoformat()
    return d


def _charger_societe_bulletin(db: Session, societe_id: str) -> dict:
    """
    RG-MULTISOCIETE-07 (correctif 24/08) : en-tête société RÉELLE du
    bulletin, pour bulletin_pdf.py (qui utilisait jusqu'ici un dictionnaire
    codé en dur "SOLGEIS" identique sur TOUS les bulletins, quelle que soit
    la vraie société). Le n° CNSS employeur vient de `societe_affiliations`
    (RG-09, déjà l'emplacement prévu -- confirmé le 24/08), pas de `societes`
    elle-même.
    """
    soc = db.execute(text("""
        SELECT raison_sociale, adresse, registre_commerce, identifiant_fiscal, patente
          FROM public.societes WHERE id = :id
    """), {"id": societe_id}).mappings().first()
    if not soc:
        return {}
    cnss = db.execute(text("""
        SELECT numero_affiliation FROM public.societe_affiliations
         WHERE societe_id = :id AND code_type_affiliation = 'CNSS'
         ORDER BY date_adhesion DESC NULLS LAST LIMIT 1
    """), {"id": societe_id}).scalar()
    return {
        "raison_sociale": soc["raison_sociale"],
        "activite": None,
        "adresse": soc["adresse"],
        "rc": soc["registre_commerce"],
        "if_fiscal": soc["identifiant_fiscal"],
        "patente": soc["patente"],
        "cnss": cnss,
    }


@router.get("/bulletins/{bulletin_id}/pdf")
def telecharger_bulletin_pdf(
    bulletin_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    Génère et renvoie le PDF du bulletin — quelle que soit son origine
    (TEMP précalcul, VALIDE, HISTORIQUE archivé). Réutilise `_lire_bulletins`,
    la même fonction que `GET /paie/bulletins/{id}` : mêmes lignes, mêmes
    totaux que ce qu'affiche TraitementPaiePage.tsx, aucun recalcul.

    RG-MULTISOCIETE-07 (correctif 24/08) : `societe_id` transmis à
    `_lire_bulletins` -- sans lui, cette fonction retombe sur son
    comportement "non filtré" (prévu pour compat descendante) et
    N'IMPORTE QUEL bulletin_id, de n'importe quelle société, était
    téléchargeable en PDF.
    """
    trouve = _lire_bulletins(db, bulletin_id=bulletin_id, societe_id=societe_id)
    bulletin = trouve[0] if trouve else None
    if not bulletin:
        raise HTTPException(404, "Bulletin introuvable")

    bulletin["_collaborateur_detail"] = _charger_identite_collaborateur(db, bulletin["collaborateur_id"])
    bulletin["_societe_detail"] = _charger_societe_bulletin(db, societe_id)

    # Libellé de période (mois/année) — _lire_bulletins ne le porte pas.
    periode = db.execute(text("""
        SELECT mois, annee, intitule FROM public.calendrier_paie WHERE id = :id
    """), {"id": str(bulletin["periode_id"])}).mappings().first()
    if periode:
        MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
        bulletin["_periode_libelle"] = periode["intitule"] or f"{MOIS[periode['mois']]} {periode['annee']}"

    try:
        pdf_bytes = generer_pdf_bulletin(bulletin)
    except Exception as exc:
        raise HTTPException(500, f"Erreur de génération du PDF : {exc}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="bulletin_{bulletin["matricule"] or bulletin_id}.pdf"'},
    )
