"""
Endpoints du module Rapports de paie — Phase 1.

À monter dans `app/routers/paie.py` (comme `paie_calcul`, `controles_paie`) :
    from app.routers import rapports_paie as rapports_paie_router
    router.include_router(rapports_paie_router.router)  # → /api/v1/paie/rapports/...
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles, get_societe_active_id
from app.schemas.rapport_paie import (
    JournalApercuRequest,
    JournalApercuResponse,
    JournalGenererRequest,
    RapportJournalConfig,
    RapportTemplateCreate,
    RapportTemplateOut,
)
from app.schemas.rapport_grille import (
    GrilleApercuRequest,
    GrilleApercuResponse,
    GrilleCase,
    GrilleConfig,
    GrilleGenererRequest,
    GrilleMasque,
)
from app.schemas.rapport_bulletin import (
    BulletinApercuRequest,
    BulletinApercuResponse,
    BulletinConfig,
    BulletinConfigUpdate,
    BulletinGenererRequest,
)
from app.services import rapport_engine
from app.services import rapport_grille_engine
from app.services import rapport_bulletin_engine
from app.services import rapport_cnss_bordereau_engine

router = APIRouter(prefix="/rapports", tags=["Rapports de paie"])

# Mêmes rôles que le reste du module Paie (cf. app/routers/paie.py)
PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


# -----------------------------------------------------------------------------
# Templates
# -----------------------------------------------------------------------------

@router.get("/templates", response_model=list[RapportTemplateOut])
def lister_templates(type_rapport: str | None = None, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    sql = "SELECT * FROM rapport_template WHERE actif = true"
    params = {}
    if type_rapport:
        sql += " AND type_rapport = :type_rapport"
        params["type_rapport"] = type_rapport
    rows = db.execute(text(sql), params).mappings().all()
    return [RapportTemplateOut(**r) for r in rows]


@router.post("/templates", response_model=RapportTemplateOut)
def creer_template(payload: RapportTemplateCreate, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    row = db.execute(
        text(
            """
            INSERT INTO rapport_template (code, libelle, libelle_court, type_rapport, description, actif, par_defaut)
            VALUES (:code, :libelle, :libelle_court, :type_rapport, :description, :actif, :par_defaut)
            RETURNING *
            """
        ),
        payload.model_dump(),
    ).mappings().first()
    db.commit()
    return RapportTemplateOut(**row)


@router.patch("/templates/{template_id}", response_model=RapportTemplateOut)
def modifier_template(
    template_id: UUID, payload: RapportTemplateCreate, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))
):
    row = db.execute(
        text(
            """
            UPDATE rapport_template
            SET code = :code, libelle = :libelle, libelle_court = :libelle_court,
                type_rapport = :type_rapport, description = :description,
                actif = :actif, par_defaut = :par_defaut, date_maj = now()
            WHERE id = :id
            RETURNING *
            """
        ),
        {**payload.model_dump(), "id": str(template_id)},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Template introuvable")
    db.commit()
    return RapportTemplateOut(**row)


# -----------------------------------------------------------------------------
# Champs disponibles (palette — pas codée en dur, cf. convention §10 DSL)
# -----------------------------------------------------------------------------

@router.get("/champs-disponibles")
def champs_disponibles(db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    """
    Catalogue des champs snapshot (fixe, structure du JSONB) + rubriques
    actives (dynamique, depuis `rubrique_paie`) pour alimenter la palette
    du designer / de la config Journal.
    """
    rubriques = db.execute(
        text("SELECT code, libelle FROM rubrique_paie WHERE archive = false AND traiter = true ORDER BY code")
    ).mappings().all()

    return {
        "champs_snapshot": [
            # Identité
            {"cle": "identite.matricule", "libelle": "Matricule"},
            {"cle": "identite.civilite", "libelle": "Civilité"},
            {"cle": "identite.nom", "libelle": "Nom"},
            {"cle": "identite.prenom", "libelle": "Prénom"},
            {"cle": "identite.nom_complet", "libelle": "Civilité + Nom + Prénom"},
            {"cle": "identite.cin", "libelle": "CIN"},
            {"cle": "identite.date_naissance", "libelle": "Date de naissance"},
            {"cle": "identite.num_cnss", "libelle": "N° CNSS"},
            {"cle": "identite.num_amo", "libelle": "N° AMO"},
            # Affectation / poste / emploi / métier
            {"cle": "affectation.organisation_libelle", "libelle": "Unité d'organisation"},
            {"cle": "affectation.poste_instance_code", "libelle": "Poste (instance)"},
            {"cle": "affectation.poste_reference_code", "libelle": "Code du poste de référence"},
            {"cle": "affectation.poste_reference_libelle", "libelle": "Poste de référence"},
            {"cle": "affectation.code_classification", "libelle": "Classification"},
            {"cle": "affectation.qualifications_requises", "libelle": "Qualifications requises"},
            {"cle": "affectation.emploi_code", "libelle": "Code emploi"},
            {"cle": "affectation.emploi_libelle", "libelle": "Emploi"},
            {"cle": "affectation.metier_code", "libelle": "Code métier"},
            {"cle": "affectation.metier_libelle", "libelle": "Métier"},
            {"cle": "affectation.metier_famille", "libelle": "Famille de métier"},
            # Contrat
            {"cle": "contrat.code_type_contrat", "libelle": "Type de contrat"},
            {"cle": "contrat.code_statut_contrat", "libelle": "Statut du contrat"},
            {"cle": "contrat.code_temps", "libelle": "Temps de travail"},
            {"cle": "contrat.date_embauche", "libelle": "Date d'embauche"},
            # Situation familiale — code brut (ex. "C") et libellé résolu via
            # ref_situation_familiale (ex. "Célibataire") proposés séparément :
            # certains documents imprimés exigent le code réglementaire,
            # d'autres le libellé lisible. Le libellé n'est disponible dans le
            # snapshot que pour les bulletins calculés depuis l'ajout de la
            # jointure dans rapport_engine.py — NULL pour les antérieurs tant
            # que le backfill (migration dédiée) n'a pas tourné.
            {"cle": "situation_familiale.code", "libelle": "Situation familiale (code)"},
            {"cle": "situation_familiale.libelle", "libelle": "Situation familiale (libellé)"},
            {"cle": "situation_familiale.nb_enfants_a_charge", "libelle": "Nombre d'enfants à charge"},
            {"cle": "situation_familiale.nb_personnes_a_charge", "libelle": "Nombre de personnes à charge"},
            {"cle": "situation_familiale.nb_deductions_fiscales", "libelle": "Nombre de déductions fiscales"},
            # Adresse principale
            {"cle": "adresse.adresse", "libelle": "Adresse"},
            {"cle": "adresse.complement_adresse", "libelle": "Complément d'adresse"},
            {"cle": "adresse.code_postal", "libelle": "Code postal"},
            {"cle": "adresse.code_ville", "libelle": "Ville"},
            {"cle": "adresse.code_region", "libelle": "Région"},
            {"cle": "adresse.code_pays", "libelle": "Pays"},
            {"cle": "adresse.telephone", "libelle": "Téléphone"},
            {"cle": "adresse.email", "libelle": "Email"},
            # Paiement principal / RIB
            {"cle": "paiement.mode_libelle", "libelle": "Mode de paiement"},
            {"cle": "paiement.banque_libelle", "libelle": "Banque"},
            {"cle": "paiement.nom_agence", "libelle": "Agence"},
            {"cle": "paiement.numero_compte", "libelle": "N° de compte (RIB)"},
            {"cle": "paiement.code_iban", "libelle": "IBAN"},
            {"cle": "paiement.code_bic", "libelle": "BIC"},
            {"cle": "paiement.intitule_compte", "libelle": "Intitulé du compte"},
            # Régimes / affiliations — syntaxe "regimes.CODE.champ" (voir
            # rapport_grille_engine._valeur_identite pour le mécanisme).
            # Codes CNSS / AMO_CNSS confirmés dans les logs du moteur de
            # calcul (collaborateur_regime.code_regime). CIMR : code non
            # confirmé — à corriger via l'écran de config si différent
            # (tout code présent dans ref_regime_cotisation fonctionne).
            {"cle": "regimes.CNSS.date_affiliation", "libelle": "CNSS — Date d'affiliation"},
            {"cle": "regimes.CNSS.matricule_organisme", "libelle": "CNSS — Matricule"},
            {"cle": "regimes.AMO_CNSS.date_affiliation", "libelle": "AMO — Date d'affiliation"},
            {"cle": "regimes.AMO_CNSS.matricule_organisme", "libelle": "AMO — Matricule"},
            {"cle": "regimes.CIMR.date_affiliation", "libelle": "CIMR — Date d'affiliation (code non confirmé)"},
            {"cle": "regimes.CIMR.matricule_organisme", "libelle": "CIMR — Matricule (code non confirmé)"},
        ],
        "rubriques": [{"code": r["code"], "libelle": r["libelle"]} for r in rubriques],
        "totaux": [
            {"cle": "total_gains", "libelle": "Total gains"},
            {"cle": "total_retenues", "libelle": "Total retenues"},
            {"cle": "net_a_payer", "libelle": "Net à payer"},
        ],
    }


# -----------------------------------------------------------------------------
# Journal de paie — périmètre libre choisi par le gestionnaire
# -----------------------------------------------------------------------------

def _charger_config(db: Session, template_id: UUID) -> RapportJournalConfig:
    row = db.execute(
        text("SELECT * FROM rapport_journal_config WHERE template_id = :tid"),
        {"tid": str(template_id)},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Configuration de journal introuvable pour ce template")
    return RapportJournalConfig(**row)


@router.post("/journal/apercu", response_model=JournalApercuResponse)
def apercu_journal(payload: JournalApercuRequest, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                   societe_id: str = Depends(get_societe_active_id)):
    config = _charger_config(db, payload.template_id)
    return rapport_engine.construire_journal(db, config, payload.perimetre, societe_id)


@router.post("/journal/generer")
def generer_journal(payload: JournalGenererRequest, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                    societe_id: str = Depends(get_societe_active_id)):
    config = _charger_config(db, payload.template_id)
    resultat = rapport_engine.construire_journal(db, config, payload.perimetre, societe_id)

    if payload.format_export == "EXCEL":
        contenu = rapport_engine.exporter_journal_excel(resultat)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        nom_fichier = "journal_de_paie.xlsx"
    else:
        contenu = rapport_engine.exporter_journal_pdf(resultat, titre="Journal de paie")
        media_type = "application/pdf"
        nom_fichier = "journal_de_paie.pdf"

    db.execute(
        text(
            """
            INSERT INTO rapport_generation_historique (template_id, perimetre, format_export, nb_documents)
            VALUES (:template_id, CAST(:perimetre AS JSONB), :format_export, :nb)
            """
        ),
        {
            "template_id": str(payload.template_id),
            "perimetre": payload.perimetre.model_dump_json(),
            "format_export": payload.format_export,
            "nb": resultat.nb_bulletins,
        },
    )
    db.commit()

    return Response(
        content=contenu,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{nom_fichier}"'},
    )


# -----------------------------------------------------------------------------
# Journal grille (format réglementaire) — configuration des cases + génération
# -----------------------------------------------------------------------------

@router.get("/journal-grille/masques", response_model=list[GrilleMasque])
def lister_masques_grille(_=Depends(require_roles(*PAIE_ROLES))):
    """Masques d'affichage proposés dans l'inspecteur de case (registre unique côté moteur)."""
    return rapport_grille_engine.lister_masques()


@router.get("/journal-grille/config/{template_id}", response_model=list[GrilleCase])
def lire_config_grille(template_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    return rapport_grille_engine.charger_config_grille(db, template_id)


@router.put("/journal-grille/config/{template_id}", response_model=list[GrilleCase])
def sauvegarder_config_grille(
    template_id: UUID, cases: list[GrilleCase], db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))
):
    """Remplace intégralement la config de grille du template (delete + réinsertion)."""
    db.execute(text("DELETE FROM rapport_grille_case WHERE template_id = :tid"), {"tid": str(template_id)})
    for case in cases:
        db.execute(
            text(
                """
                INSERT INTO rapport_grille_case
                    (template_id, ligne, colonne, rowspan, colspan, libelle, type_source,
                     cle_identite, code_rubrique, attribut, valeur_constante, ordre_affichage,
                     masque, texte_avant, texte_apres, valeur_si_vide, condition_affichage)
                VALUES (:tid, :ligne, :colonne, :rowspan, :colspan, :libelle, :type_source,
                        :cle_identite, :code_rubrique, :attribut, :valeur_constante, :ordre,
                        :masque, :texte_avant, :texte_apres, :valeur_si_vide,
                        CAST(:condition AS JSONB))
                """
            ),
            {
                "tid": str(template_id), "ligne": case.ligne, "colonne": case.colonne,
                "rowspan": case.rowspan, "colspan": case.colspan, "libelle": case.libelle,
                "type_source": case.type_source, "cle_identite": case.cle_identite,
                "code_rubrique": case.code_rubrique, "attribut": case.attribut,
                "valeur_constante": case.valeur_constante, "ordre": case.ordre_affichage,
                "masque": case.masque or None, "texte_avant": case.texte_avant or None,
                "texte_apres": case.texte_apres or None,
                # None = tiret par défaut ; "" = laisser vide : on conserve la différence.
                "valeur_si_vide": case.valeur_si_vide,
                "condition": case.condition_affichage.model_dump_json() if case.condition_affichage else None,
            },
        )
    db.commit()
    return rapport_grille_engine.charger_config_grille(db, template_id)


def _libelles_periode(db: Session, perimetre) -> tuple[str, str, str]:
    """Résout mois/dates lisibles pour l'en-tête du PDF, si le périmètre porte une période unique."""
    if getattr(perimetre, "mode", None) == "periode_plan":
        row = db.execute(
            text("SELECT annee, mois, date_debut, date_fin FROM calendrier_paie WHERE id = :pid"),
            {"pid": str(perimetre.periode_id)},
        ).mappings().first()
        if row:
            mois_noms = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                         "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
            libelle = f"{mois_noms[row['mois']]} {row['annee']}"
            return libelle, str(row["date_debut"]), str(row["date_fin"])
    return "", "", ""


@router.post("/journal-grille/apercu", response_model=GrilleApercuResponse)
def apercu_journal_grille(payload: GrilleApercuRequest, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                          societe_id: str = Depends(get_societe_active_id)):
    return rapport_grille_engine.construire_grille_journal(db, payload.template_id, payload.perimetre, societe_id)


@router.post("/journal-grille/generer")
def generer_journal_grille(payload: GrilleGenererRequest, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                           societe_id: str = Depends(get_societe_active_id)):
    resultat = rapport_grille_engine.construire_grille_journal(db, payload.template_id, payload.perimetre, societe_id)
    mois_libelle, periode_debut, periode_fin = _libelles_periode(db, payload.perimetre)
    contenu = rapport_grille_engine.exporter_grille_pdf(resultat, mois_libelle, periode_debut, periode_fin)

    db.execute(
        text(
            """
            INSERT INTO rapport_generation_historique (template_id, perimetre, format_export, nb_documents)
            VALUES (:template_id, CAST(:perimetre AS JSONB), 'PDF', :nb)
            """
        ),
        {
            "template_id": str(payload.template_id),
            "perimetre": payload.perimetre.model_dump_json(),
            "nb": resultat.nb_collaborateurs,
        },
    )
    db.commit()

    return Response(
        content=contenu,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="journal_de_paie.pdf"'},
    )


# -----------------------------------------------------------------------------
# Bulletin de paie — 5 modèles de présentation, en-tête/corps/pied configurables
# -----------------------------------------------------------------------------

@router.get("/bulletin/config/{template_id}", response_model=BulletinConfig)
def lire_config_bulletin(template_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))):
    try:
        return rapport_bulletin_engine.charger_config_bulletin(db, template_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.put("/bulletin/config/{template_id}", response_model=BulletinConfig)
def sauvegarder_config_bulletin(
    template_id: UUID, payload: BulletinConfigUpdate, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES))
):
    rapport_bulletin_engine.sauvegarder_config_bulletin(
        db, template_id, payload.style, payload.entete_config, payload.corps_config, payload.pied_config
    )
    return rapport_bulletin_engine.charger_config_bulletin(db, template_id)


@router.post("/bulletin/apercu", response_model=BulletinApercuResponse)
def apercu_bulletin(payload: BulletinApercuRequest, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                    societe_id: str = Depends(get_societe_active_id)):
    try:
        return rapport_bulletin_engine.construire_bulletin(db, payload.template_id, payload.bulletin_id, societe_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/bulletin/generer")
def generer_bulletin(payload: BulletinGenererRequest, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                     societe_id: str = Depends(get_societe_active_id)):
    try:
        resultat = rapport_bulletin_engine.construire_bulletin(db, payload.template_id, payload.bulletin_id, societe_id)
        config = rapport_bulletin_engine.charger_config_bulletin(db, payload.template_id)
    except ValueError as e:
        raise HTTPException(404, str(e))

    contenu = rapport_bulletin_engine.exporter_bulletin_pdf(resultat, config.style)

    db.execute(
        text(
            """
            INSERT INTO rapport_generation_historique (template_id, perimetre, format_export, nb_documents)
            VALUES (:template_id, CAST(:perimetre AS JSONB), 'PDF', 1)
            """
        ),
        {"template_id": str(payload.template_id), "perimetre": f'{{"bulletin_id": "{payload.bulletin_id}"}}'},
    )
    db.commit()

    return Response(
        content=contenu,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="bulletin_de_paie.pdf"'},
    )


@router.get("/bulletin/dernier")
def dernier_bulletin_collaborateur(
    collaborateur_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    Résout le bulletin le plus récent d'un collaborateur, tous cycles de vie
    confondus (validé / clôturé / précalcul non validé) — utile pour tester
    rapidement un modèle sur une paie réelle sans connaître l'UUID à l'avance.
    Tri par période (année/mois), pas par colonne de date technique (dont on
    n'est pas certain qu'elle existe identiquement sur les 3 tables).

    RG-MULTISOCIETE-07 (migration 057) : filtre societe_id ajouté sur les 3
    branches -- sans lui, un collaborateur_id d'une autre société était
    résoluble ici (aucune vérification d'appartenance auparavant).
    """
    row = db.execute(
        text(
            """
            SELECT b.id, 'VALIDE' AS origine, cal.annee, cal.mois
            FROM public.bulletin b JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE b.collaborateur_id = :cid AND cal.societe_id = :sid
            UNION ALL
            SELECT b.id, 'HISTORIQUE' AS origine, cal.annee, cal.mois
            FROM public.bulletin_historique b JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE b.collaborateur_id = :cid AND cal.societe_id = :sid
            UNION ALL
            SELECT b.id, 'TEMP' AS origine, cal.annee, cal.mois
            FROM public.bulletin_temp b JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE b.collaborateur_id = :cid AND cal.societe_id = :sid
            ORDER BY annee DESC, mois DESC
            LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id), "sid": societe_id},
    ).mappings().first()

    if row is None:
        raise HTTPException(404, "Aucun bulletin trouvé pour ce collaborateur")

    mois_noms = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                 "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
    return {
        "bulletin_id": str(row["id"]),
        "origine": row["origine"],
        "periode_libelle": f"{mois_noms[row['mois']]} {row['annee']}",
    }


# -----------------------------------------------------------------------------
# Bordereau de paiement CNSS (Régime Général + AMO) — bilingue FR/AR
# -----------------------------------------------------------------------------

class BordereauCnssRequest(BaseModel):
    """Payload minimal : les masses salariales sont déjà calculées côté
    frontend (Option A — lues depuis les bulletins réels de la période),
    on ne les recalcule pas ici pour éviter une divergence entre l'écran
    de contrôle et le bordereau."""
    mois: int
    annee: int
    assiette_plafonnee: float
    assiette_non_plafonnee: float


@router.post("/cnss/bordereau")
def generer_bordereau_cnss(
    payload: BordereauCnssRequest, db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    try:
        contenu = rapport_cnss_bordereau_engine.exporter_bordereau_cnss_pdf(
            db, societe_id, payload.mois, payload.annee, payload.assiette_plafonnee, payload.assiette_non_plafonnee
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    return Response(
        content=contenu,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Bordereau_CNSS_{payload.annee}_{payload.mois:02d}.pdf"'},
    )
