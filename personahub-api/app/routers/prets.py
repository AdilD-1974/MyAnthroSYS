"""
app/routers/prets.py   [REECRIT - couche fine par-dessus app/services/pret_service.py
(deja existant, corrige en synchrone) + app/services/pret_engine.py (simulation
pure) + app/services/pret_eligibilite_engine.py (regles dynamiques par type).]

Point non verifie, a confirmer : la provenance de security_level pour
l'utilisateur courant. Le payload JWT ne le contient pas (confirme) ; je
suppose ici collaborateurs.security_level, a corriger dans
_get_security_level() si la colonne reelle est ailleurs (ex. profiles).
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from uuid import UUID

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload, require_roles
from app.schemas.pret import (
    AlerteOut, BanqueUpdateIn, CategoriePretIn, CategoriePretOut, CreationDirectePretIn, DeblocageIn,
    DemandePretCreate, EcheanceOut, EcheanceSimulee, ForcageEcheanceIn,
    GenererAmortissementIn, ImporterEcheancierIn, PretConfigOut, PretConfigUpdateIn, PretDetailOut,
    PretExterneUpdateIn, PretOut, PretStatsOut, RecalculEcheancierIn, RegleCatalogueOut, RemboursementAnticipeOut,
    ResultatRegleEligibilite, SimulationPretRequest, SimulationPretResponse, SuspensionHistoriqueOut,
    SuspensionIn, SupprimerEcheancesIn, TypePret, TypePretAdminIn, TypePretAdminOut, TypeRegleIn, TypeRegleOut,
    ValidationDecisionIn, VerificationEligibiliteResponse,
)
from app.services import pret_eligibilite_engine, pret_service
from app.services.pret_engine import TrancheMensualite, generer_echeancier

router = APIRouter(prefix="/prets", tags=["Prets & Avances"])

RH_ROLES = ("administrateur", "gestionnaire_rh", "manager")

_PRET_SELECT = """
    SELECT p.*, (c.prenom || ' ' || c.nom) AS collab_nom,
           rtp.libelle AS type_libelle, rtp.icone AS type_icone,
           rtp.couleur AS type_couleur, rtp.rubrique_paie_lib AS rubrique_lib
    FROM public.prets p
    LEFT JOIN public.collaborateurs c ON c.id = p.collaborateur_id
    LEFT JOIN public.ref_type_pret rtp ON rtp.code = p.type_code
"""


def _roles(payload: dict) -> list[str]:
    return payload.get("roles") or payload.get("all_roles") or ([payload["role"]] if payload.get("role") else [])


def _get_security_level(db: Session, payload_jwt: dict) -> int:
    """Niveau de securite de L'OPERATEUR connecte (pas du titulaire du pret !).
    Un administrateur a toujours le niveau maximal, meme si
    collaborateurs.security_level n'est pas renseigne pour son propre compte
    (repli coherent avec le meme choix cote frontend)."""
    if "administrateur" in _roles(payload_jwt):
        return 999
    collaborateur_id = payload_jwt.get("collaborateur_id")
    if not collaborateur_id:
        return 0
    val = db.execute(text(
        "SELECT security_level FROM public.collaborateurs WHERE id = :cid"
    ), {"cid": collaborateur_id}).scalar()
    return int(val) if val is not None else 0


def _matricule(payload: dict) -> str:
    """Matricule de l'operateur - utilise pour l'IDENTITE (filtrer ses
    propres prets en self-service, requeter ses donnees collaborateur).
    Reste strict : un collaborateur sans matricule associe ne peut pas avoir
    de prets, l'erreur doit remonter clairement plutot que de filtrer sur
    une valeur de repli qui ne correspondrait a rien."""
    matricule = payload.get("matricule")
    if not matricule:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Utilisateur sans matricule associe.")
    return matricule


def _identifiant_audit(payload: dict) -> str:
    """Identifiant de l'operateur pour la TRACABILITE uniquement (audit log,
    created_by, matric_decideur...) - jamais pour filtrer/identifier un
    dossier. Repli sur l'email puis le sub si l'operateur n'a pas de
    matricule (ex. compte administrateur systeme sans fiche collaborateur) :
    une action de gestion (valider, debloquer...) ne doit pas etre bloquee
    pour cette seule raison, contrairement au self-service."""
    return payload.get("matricule") or payload.get("email") or payload.get("sub") or "SYSTEME"


def _resolver_noms_operateurs(db: Session, valeurs: set) -> dict:
    """Résout un identifiant d'opérateur (matricule OU email, selon ce que
    _identifiant_audit a stocké) en 'Prénom Nom (matricule)' pour affichage.
    Les valeurs non résolues (ex. 'SYSTEME') restent inchangées."""
    valeurs = {v for v in valeurs if v}
    if not valeurs:
        return {}
    rows = db.execute(text("""
        SELECT cle, affichage FROM (
            SELECT c.matricule AS cle, (c.prenom || ' ' || c.nom || ' (' || c.matricule || ')') AS affichage
            FROM public.collaborateurs c WHERE c.matricule = ANY(:valeurs)
            UNION ALL
            SELECT u.email AS cle, (c.prenom || ' ' || c.nom || ' (' || c.matricule || ')') AS affichage
            FROM public.users u
            JOIN public.profiles p ON p.user_id = u.id
            JOIN public.collaborateurs c ON c.id = p.collaborateur_id
            WHERE u.email = ANY(:valeurs)
        ) t
    """), {"valeurs": list(valeurs)}).mappings().all()
    return {r["cle"]: r["affichage"] for r in rows}


def _appliquer_noms_operateurs(db: Session, pret: dict) -> dict:
    champs = ["matric_decideur", "created_by", "modified_by"]
    noms = _resolver_noms_operateurs(db, {pret.get(c) for c in champs})
    for c in champs:
        if pret.get(c) in noms:
            pret[c] = noms[pret[c]]
    return pret


def _get_pret_or_404(db: Session, pret_id, payload_jwt: dict) -> dict:
    """RG-MULTISOCIETE-08 (migration 057) : prets n'a pas de societe_id en
    propre (catégorie A) -- société déduite via collaborateur_id ->
    collaborateur_contrats.societe_id (contrat actif). Seul point d'accès à
    un prêt par id dans ce fichier (22 appels) -- centraliser ici le
    cloisonnement couvre tous les endpoints /{pret_id}/... d'un coup."""
    societe_id = payload_jwt.get("societe_active_id")
    if not societe_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aucune société active sur ce token — reconnexion requise")
    row = db.execute(text(f"""
        {_PRET_SELECT} WHERE p.id = :id AND p.deleted_date IS NULL
          AND EXISTS (
              SELECT 1 FROM public.collaborateur_contrats cc
               WHERE cc.collaborateur_id = p.collaborateur_id
                 AND cc.societe_id = :sid AND cc.archive = false
          )
    """), {"id": str(pret_id), "sid": societe_id}).mappings().first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pret introuvable.")
    return _appliquer_noms_operateurs(db, dict(row))


def _handle_permission_value_errors(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))


# ---------------------------------------------------------------------------
# Referentiels
# ---------------------------------------------------------------------------

@router.get("/types", response_model=list[TypePret])
def lister_types(initiable_collaborateur: bool | None = None, db: Session = Depends(get_db)):
    query = """
        SELECT rtp.code, rtp.libelle, rtp.description, rtp.categorie_code, rtp.origine_code,
               rtp.taux_annuel_defaut, rtp.duree_max_mois, rtp.montant_max, rtp.algo_defaut,
               rtp.avance_sur_salaire, rtp.justificatif_requis, rtp.icone, rtp.couleur
        FROM public.ref_type_pret rtp
        JOIN public.ref_origine_pret rop ON rop.code = rtp.origine_code
        WHERE rtp.actif = true
    """
    params: dict = {}
    if initiable_collaborateur is not None:
        query += " AND rop.initiable_collaborateur = :initiable"
        params["initiable"] = initiable_collaborateur
    query += " ORDER BY rtp.ordre"
    rows = db.execute(text(query), params).mappings().all()
    return list(rows)


# ---------------------------------------------------------------------------
# Simulation - aucune ecriture
# ---------------------------------------------------------------------------

@router.post("/simulation", response_model=SimulationPretResponse)
def simuler(payload: SimulationPretRequest, db: Session = Depends(get_db)):
    type_pret = db.execute(text(
        "SELECT * FROM public.ref_type_pret WHERE code = :code AND actif = true"
    ), {"code": payload.type_code}).mappings().first()
    if not type_pret:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Type de pret '{payload.type_code}' introuvable ou inactif.")

    # Ces plafonds ne conditionnent que les prêts internes et avances sur
    # salaire — un prêt externe suit les conditions de l'établissement de
    # crédit, pas celles paramétrées ici (dossier fonctionnel).
    est_externe = str(type_pret["origine_code"]).upper() == "EXTERNE"
    if not est_externe:
        if type_pret["montant_max"] and payload.montant > type_pret["montant_max"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                 f"Montant demande ({payload.montant}) superieur au plafond ({type_pret['montant_max']}).")
        if payload.nb_echeance > type_pret["duree_max_mois"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                 f"Duree demandee ({payload.nb_echeance} mois) superieure au maximum ({type_pret['duree_max_mois']} mois).")

    taux_annuel = payload.taux_annuel if payload.taux_annuel is not None else Decimal(str(type_pret["taux_annuel_defaut"]))
    algo_name = payload.algo_name or type_pret["algo_defaut"]
    tranches = [TrancheMensualite(t.ordre, t.montant_mensualite, t.date_debut, t.date_fin) for t in payload.tranches] if payload.tranches else None

    resultat = generer_echeancier(
        montant=payload.montant, taux_annuel=taux_annuel, nb_echeance=payload.nb_echeance,
        algo_name=algo_name, date_premiere_echeance=payload.date_premiere_echeance,
        tranches=tranches, borner_fin_annee_civile=bool(type_pret["avance_sur_salaire"]),
        taux_tva=payload.taux_tva or Decimal("0"),
    )

    return SimulationPretResponse(
        type_code=payload.type_code, algo_name=resultat.algo_name, montant=resultat.montant,
        taux_annuel=resultat.taux_annuel, nb_echeance_demande=resultat.nb_echeance_demande,
        nb_echeance_retenu=resultat.nb_echeance_retenu, mensualite_theorique=resultat.mensualite_theorique,
        cout_total_interets=resultat.cout_total_interets,
        borne_fin_annee_civile_appliquee=resultat.borne_fin_annee_civile_appliquee,
        echeancier=[EcheanceSimulee(**e.__dict__) for e in resultat.echeancier],
        avertissements=resultat.avertissements,
    )


# ---------------------------------------------------------------------------
# Eligibilite - cumule les deux systemes
# ---------------------------------------------------------------------------

@router.post("/eligibilite", response_model=VerificationEligibiliteResponse)
def verifier_eligibilite(payload: DemandePretCreate, db: Session = Depends(get_db), payload_jwt: dict = Depends(get_current_user_payload)):
    matricule = _matricule(payload_jwt)
    collaborateur_id = payload_jwt.get("collaborateur_id")
    societe_id = payload_jwt.get("societe_active_id")
    if not societe_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aucune société active sur ce token — reconnexion requise")

    simulation = simuler(
        SimulationPretRequest(type_code=payload.type_code, montant=payload.montant,
                               nb_echeance=payload.nb_echeance, date_premiere_echeance=payload.date_premiere_echeance),
        db=db,
    )

    salaire_net = db.execute(text(
        "SELECT salaire_net_imposable FROM public.collaborateurs WHERE matricule = :matricule"
    ), {"matricule": matricule}).scalar()

    resultats_dynamiques = pret_eligibilite_engine.verifier_eligibilite(
        db, matricule=matricule, collaborateur_id=collaborateur_id,
        type_code=payload.type_code, montant_demande=payload.montant,
        mensualite_demandee=simulation.mensualite_theorique, date_demande=date.today(),
        derogations_explicites=payload.derogations_regles,
    )
    resultats = [ResultatRegleEligibilite(**r.__dict__) for r in resultats_dynamiques]
    eligible_dynamique = pret_eligibilite_engine.est_eligible(resultats_dynamiques)

    type_pret = db.execute(text("SELECT origine_code FROM public.ref_type_pret WHERE code = :c"), {"c": payload.type_code}).mappings().first()
    origine = db.execute(text("SELECT necessite_organisme_externe FROM public.ref_origine_pret WHERE code = :c"), {"c": type_pret["origine_code"]}).mappings().first() if type_pret else None
    pret_interne = not (origine and origine["necessite_organisme_externe"])

    # RG-MULTISOCIETE-08 : societe_id propagé -- corrige le bug d'enveloppe
    # PLAFOND_INTERNE_ANNUEL agrégée toutes sociétés confondues (pret_service.py).
    verif_financiere = pret_service.verifier_eligibilite(
        db, collaborateur_id=collaborateur_id, matricule=matricule, pret_interne=pret_interne,
        montant=payload.montant, societe_id=societe_id,
        salaire_net=Decimal(str(salaire_net)) if salaire_net else None,
    )
    for erreur in verif_financiere.get("erreurs", []):
        resultats.append(ResultatRegleEligibilite(
            code_regle="VERIFICATION_FINANCIERE", libelle="Verification financiere globale",
            niveau="BLOQUANT", respectee=False, message=erreur, derogation_rh_autorisee=False,
        ))

    return VerificationEligibiliteResponse(eligible=eligible_dynamique and verif_financiere.get("ok", True), resultats=resultats)


# ---------------------------------------------------------------------------
# Demande (self-service)
# ---------------------------------------------------------------------------

@router.post("/demandes", response_model=PretOut, status_code=status.HTTP_201_CREATED)
def soumettre_demande(payload: DemandePretCreate, db: Session = Depends(get_db), payload_jwt: dict = Depends(get_current_user_payload)):
    matricule = _matricule(payload_jwt)
    collaborateur_id = payload_jwt.get("collaborateur_id")
    if not collaborateur_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Utilisateur sans collaborateur_id associe.")
    societe_id = payload_jwt.get("societe_active_id")
    if not societe_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aucune société active sur ce token — reconnexion requise")
    # RG-MULTISOCIETE-08 : le demandeur doit appartenir à la société active
    # de sa propre session (garde-fou de cohérence, même si en pratique un
    # utilisateur ne demande que pour lui-même via son collaborateur_id JWT).
    if not db.execute(text("""
        SELECT 1 FROM public.collaborateur_contrats
         WHERE collaborateur_id = :cid AND societe_id = :sid AND archive = false
    """), {"cid": collaborateur_id, "sid": societe_id}).first():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Collaborateur non rattaché à la société active.")

    type_pret = db.execute(text(
        "SELECT * FROM public.ref_type_pret WHERE code = :code AND actif = true"
    ), {"code": payload.type_code}).mappings().first()
    if not type_pret:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Type de pret '{payload.type_code}' introuvable ou inactif.")

    eligibilite = verifier_eligibilite(payload, db=db, payload_jwt=payload_jwt)
    if not eligibilite.eligible:
        motifs = "; ".join(r.message for r in eligibilite.resultats if r.niveau == "BLOQUANT" and not r.respectee)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Demande non eligible : {motifs}")

    origine = db.execute(text(
        "SELECT mode_gestion FROM public.ref_origine_pret WHERE code = :code"
    ), {"code": type_pret["origine_code"]}).mappings().first()
    statut_initial_workflow = type_pret["workflow_actif"] and origine["mode_gestion"] == "WORKFLOW"

    sl = _get_security_level(db, payload_jwt)
    pret = pret_service.creer_pret(
        db, collaborateur_id=collaborateur_id, matricule=matricule, pret_interne=True,
        montant=payload.montant, nb_echeances=payload.nb_echeance, taux=type_pret["taux_annuel_defaut"],
        algo=type_pret["algo_defaut"], inclure_interets=type_pret["taux_annuel_defaut"] > 0,
        operateur=matricule, security_level=sl, type_code=payload.type_code,
    )

    nouveau_statut = "en_attente_validation" if statut_initial_workflow else "valide"
    db.execute(text("UPDATE public.prets SET statut = :s, objet = :o, motif = :m WHERE id = :id"),
               {"s": nouveau_statut, "o": payload.objet, "m": payload.motif, "id": pret["id"]})
    db.commit()

    # TODO integration workflow generique (ref_workflow/wf_instance/demande)
    # si nouveau_statut == 'en_attente_validation' et type_pret.code_workflow renseigne.

    return PretOut(**_get_pret_or_404(db, pret["id"], payload_jwt))


@router.post("/creation-directe", response_model=PretOut, status_code=status.HTTP_201_CREATED)
def creation_directe(payload: CreationDirectePretIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(get_current_user_payload)):
    """Saisie directe par un Gestionnaire RH/Administrateur - aucun circuit de
    validation declenche, contrairement a /demandes (self-service). Couvre
    les prets externes, les reprises d'historique, ou toute creation directe
    par la RH (dossier fonctionnel section 5.2/5.3)."""
    operateur = _identifiant_audit(payload_jwt)

    societe_id = payload_jwt.get("societe_active_id")
    if not societe_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aucune société active sur ce token — reconnexion requise")

    collaborateur = db.execute(text(
        "SELECT id, matricule FROM public.collaborateurs WHERE id = :cid"
    ), {"cid": str(payload.collaborateur_id)}).mappings().first()
    if not collaborateur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collaborateur introuvable.")
    # RG-MULTISOCIETE-08 : contrairement à /demandes (self-service, le
    # collaborateur_id vient du JWT), ici la RH choisit le collaborateur
    # dans un formulaire -- vérification explicite qu'il appartient bien à
    # la société active, sinon création directe dans une autre société possible.
    if not db.execute(text("""
        SELECT 1 FROM public.collaborateur_contrats
         WHERE collaborateur_id = :cid AND societe_id = :sid AND archive = false
    """), {"cid": str(payload.collaborateur_id), "sid": societe_id}).first():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Collaborateur non rattaché à la société active.")

    type_pret = db.execute(text(
        "SELECT * FROM public.ref_type_pret WHERE code = :code AND actif = true"
    ), {"code": payload.type_code}).mappings().first()
    if not type_pret:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Type de pret '{payload.type_code}' introuvable ou inactif.")

    origine = db.execute(text(
        "SELECT code FROM public.ref_origine_pret WHERE code = :code"
    ), {"code": type_pret["origine_code"]}).mappings().first()
    pret_interne = bool(origine and origine["code"] != "EXTERNE")

    sl = _get_security_level(db, payload_jwt)
    taux = payload.taux_annuel if payload.taux_annuel is not None else type_pret["taux_annuel_defaut"]

    pret = pret_service.creer_pret(
        db, collaborateur_id=collaborateur["id"], matricule=collaborateur["matricule"], pret_interne=pret_interne,
        montant=payload.montant, nb_echeances=payload.nb_echeance, taux=taux,
        algo=type_pret["algo_defaut"], inclure_interets=taux > 0,
        operateur=operateur, security_level=sl, type_code=payload.type_code,
        taux_tva=payload.taux_tva or Decimal("0"),
        organisme_credit=payload.organisme_credit, etab_credit=payload.etab_credit,
        code_bqe=payload.code_bqe, no_compte=payload.no_compte, clerib=payload.clerib,
        dt_debut_pret=payload.dt_debut_pret,
    )

    nouveau_statut_direct = "debloque" if payload.deja_debloque else "valide"
    db.execute(text("""
        UPDATE public.prets SET
            statut = :statut, objet = :objet, motif = :motif, dt_premiere_retenue = :date_premiere,
            mt_debloque = :mt_debloque, dt_deblocage = :dt_deblocage,
            capital_restant = COALESCE(:capital_restant_saisie, capital_restant),
            dt_decision = CURRENT_DATE, matric_decideur = :operateur, modified_by = :operateur,
            ref_pret = COALESCE(:ref_pret, ref_pret), mt_echeance_plus = COALESCE(:mt_echeance_plus, mt_echeance_plus),
            dt_debut_remb = COALESCE(:dt_debut_remb, dt_debut_remb),
            justificatif_fourni = :justificatif_fourni, justificatif_date = :justificatif_date,
            observations_rh = :observations_rh,
            code_guichet = :code_guichet, intitule_compte = :intitule_compte,
            hypotheque = :hypotheque, reconnaissance_dette = :reconnaissance_dette
        WHERE id = :id
    """), {
        "statut": nouveau_statut_direct, "objet": payload.objet, "motif": payload.motif,
        "date_premiere": payload.date_premiere_echeance,
        "mt_debloque": payload.montant_debloque if payload.deja_debloque else None,
        "dt_deblocage": payload.date_deblocage if payload.deja_debloque else None,
        "capital_restant_saisie": payload.capital_restant_saisie,
        "operateur": operateur, "id": pret["id"],
        "ref_pret": payload.ref_pret, "mt_echeance_plus": payload.mt_echeance_plus,
        "dt_debut_remb": payload.dt_debut_remb,
        "justificatif_fourni": payload.justificatif_fourni, "justificatif_date": payload.justificatif_date,
        "observations_rh": payload.observations_rh,
        "code_guichet": payload.code_guichet, "intitule_compte": payload.intitule_compte,
        "hypotheque": payload.hypotheque, "reconnaissance_dette": payload.reconnaissance_dette,
    })
    pret_service._audit(db, pret["id"], "CREATION_DIRECTE", operateur, sl, nouvelle=nouveau_statut_direct)
    db.commit()

    return PretOut(**_get_pret_or_404(db, pret["id"], payload_jwt))


# ---------------------------------------------------------------------------
# Self-service
# ---------------------------------------------------------------------------

@router.get("/mes-prets", response_model=list[PretOut])
def mes_prets(db: Session = Depends(get_db), payload_jwt: dict = Depends(get_current_user_payload)):
    societe_id = payload_jwt.get("societe_active_id")
    if not societe_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aucune société active sur ce token — reconnexion requise")
    rows = db.execute(text(
        f"{_PRET_SELECT} WHERE p.matricule = :matricule AND p.deleted_date IS NULL "
        "AND EXISTS (SELECT 1 FROM public.collaborateur_contrats cc WHERE cc.collaborateur_id = p.collaborateur_id "
        "AND cc.societe_id = :sid AND cc.archive = false) "
        "ORDER BY p.dt_demande DESC"
    ), {"matricule": _matricule(payload_jwt), "sid": societe_id}).mappings().all()
    return [PretOut(**r) for r in rows]


# ---------------------------------------------------------------------------
# Gestion RH / Paie (chemins litteraux avant /{id})
# ---------------------------------------------------------------------------

@router.get("/stats", response_model=PretStatsOut)
def stats(db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    agg = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE statut = 'en_attente_validation') AS en_attente,
            COUNT(*) FILTER (WHERE statut IN ('debloque', 'en_cours')) AS actifs,
            COUNT(*) FILTER (WHERE statut = 'suspendu') AS suspendus,
            COALESCE(SUM(mt_pret) FILTER (WHERE statut IN ('debloque', 'en_cours', 'suspendu')), 0) AS encours_total,
            COALESCE(SUM(capital_restant) FILTER (WHERE statut IN ('debloque', 'en_cours', 'suspendu')), 0) AS capital_restant
        FROM public.prets WHERE deleted_date IS NULL
    """)).mappings().first()

    plafond = db.execute(text("SELECT valeur FROM public.pret_configuration WHERE code = 'PLAFOND_INTERNE_ANNUEL'")).scalar() or Decimal("0")
    utilisee = db.execute(text("""
        SELECT COALESCE(SUM(mt_pret), 0) FROM public.prets
        WHERE pret_interne = true AND deleted_date IS NULL
          AND statut NOT IN ('refuse', 'annule', 'brouillon')
          AND EXTRACT(YEAR FROM dt_demande) = EXTRACT(YEAR FROM CURRENT_DATE)
    """)).scalar()

    plafond_dec, utilisee_dec = Decimal(str(plafond)), Decimal(str(utilisee or 0))
    return PretStatsOut(
        en_attente=agg["en_attente"], actifs=agg["actifs"], suspendus=agg["suspendus"],
        encours_total=agg["encours_total"], capital_restant=agg["capital_restant"],
        plafond_interne_annuel=plafond_dec, enveloppe_interne_utilisee=utilisee_dec,
        enveloppe_disponible=max(Decimal("0"), plafond_dec - utilisee_dec),
    )


@router.get("/alertes", response_model=list[AlerteOut])
def alertes(db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    rows = db.execute(text("""
        SELECT a.id, a.type_alerte, a.message, a.cree_le, a.lue, p.ref_pret, p.matricule
        FROM public.pret_alertes a
        JOIN public.prets p ON p.id = a.pret_id
        ORDER BY a.cree_le DESC LIMIT 200
    """)).mappings().all()
    return [AlerteOut(**r) for r in rows]


@router.patch("/alertes/{alerte_id}/lue", status_code=status.HTTP_204_NO_CONTENT)
def marquer_alerte_lue(alerte_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*RH_ROLES))):
    db.execute(text("UPDATE public.pret_alertes SET lue = true WHERE id = :id"), {"id": str(alerte_id)})
    db.commit()


@router.get("/config", response_model=list[PretConfigOut])
def get_config(db: Session = Depends(get_db), _=Depends(require_roles("administrateur"))):
    rows = db.execute(text("SELECT * FROM public.pret_configuration ORDER BY code")).mappings().all()
    return [PretConfigOut(**r) for r in rows]


@router.put("/config/{code}", response_model=PretConfigOut)
def modifier_config(code: str, payload: PretConfigUpdateIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles("administrateur"))):
    operateur = _identifiant_audit(payload_jwt)
    existe = db.execute(text(
        "SELECT 1 FROM public.pret_configuration WHERE code = :code"
    ), {"code": code}).scalar()
    if not existe:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Paramètre '{code}' introuvable.")
    db.execute(text("""
        UPDATE public.pret_configuration SET valeur = :valeur, modifie_par = :operateur WHERE code = :code
    """), {"valeur": payload.valeur, "operateur": operateur, "code": code})
    db.commit()
    row = db.execute(text(
        "SELECT * FROM public.pret_configuration WHERE code = :code"
    ), {"code": code}).mappings().first()
    return PretConfigOut(**row)


@router.get("", response_model=list[PretOut])
def liste_prets(
    statut: str | None = None, pret_interne: bool | None = None,
    db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES)),
):
    societe_id = payload_jwt.get("societe_active_id")
    if not societe_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aucune société active sur ce token — reconnexion requise")
    query = f"""{_PRET_SELECT} WHERE p.deleted_date IS NULL
        AND EXISTS (SELECT 1 FROM public.collaborateur_contrats cc WHERE cc.collaborateur_id = p.collaborateur_id
                    AND cc.societe_id = :societe_id AND cc.archive = false)"""
    params: dict = {"societe_id": societe_id}
    if statut:
        query += " AND p.statut = :statut"
        params["statut"] = statut
    if pret_interne is not None:
        query += " AND p.pret_interne = :pret_interne"
        params["pret_interne"] = pret_interne
    query += " ORDER BY p.dt_demande DESC"
    rows = db.execute(text(query), params).mappings().all()
    return [PretOut(**r) for r in rows]


# ---------------------------------------------------------------------------
# Paramétrage (admin) — catégories, types de prêt, règles d'éligibilité.
# Chemins littéraux/multi-segments, sans ambiguïté avec /{pret_id} (UUID).
# ---------------------------------------------------------------------------

ADMIN_ROLES = ("administrateur", "gestionnaire_rh")


@router.get("/categories", response_model=list[CategoriePretOut])
def lister_categories_admin(db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    rows = db.execute(text("SELECT * FROM public.ref_categorie_pret ORDER BY ordre")).mappings().all()
    return [CategoriePretOut(**r) for r in rows]


@router.post("/categories", response_model=CategoriePretOut, status_code=status.HTTP_201_CREATED)
def creer_categorie(payload: CategoriePretIn, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    if db.execute(text("SELECT 1 FROM public.ref_categorie_pret WHERE code = :c"), {"c": payload.code}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Le code '{payload.code}' existe déjà.")
    db.execute(text("""
        INSERT INTO public.ref_categorie_pret (code, libelle, description, icone, couleur, ordre, actif)
        VALUES (:code, :libelle, :description, :icone, :couleur, :ordre, :actif)
    """), payload.model_dump())
    db.commit()
    row = db.execute(text("SELECT * FROM public.ref_categorie_pret WHERE code = :c"), {"c": payload.code}).mappings().first()
    return CategoriePretOut(**row)


@router.put("/categories/{code}", response_model=CategoriePretOut)
def modifier_categorie(code: str, payload: CategoriePretIn, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    result = db.execute(text("""
        UPDATE public.ref_categorie_pret SET
            libelle = :libelle, description = :description, icone = :icone,
            couleur = :couleur, ordre = :ordre, actif = :actif, updated_at = now()
        WHERE code = :code
    """), {**payload.model_dump(exclude={"code"}), "code": code})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catégorie introuvable.")
    row = db.execute(text("SELECT * FROM public.ref_categorie_pret WHERE code = :c"), {"c": code}).mappings().first()
    return CategoriePretOut(**row)


@router.get("/types-admin", response_model=list[TypePretAdminOut])
def lister_types_admin(db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    """Variante complète de GET /types (tous les champs, y compris inactifs) — réservée au paramétrage."""
    rows = db.execute(text("SELECT * FROM public.ref_type_pret ORDER BY ordre")).mappings().all()
    return [TypePretAdminOut(**r) for r in rows]


@router.post("/types-admin", response_model=TypePretAdminOut, status_code=status.HTTP_201_CREATED)
def creer_type(payload: TypePretAdminIn, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    if db.execute(text("SELECT 1 FROM public.ref_type_pret WHERE code = :c"), {"c": payload.code}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Le code '{payload.code}' existe déjà.")
    data = payload.model_dump()
    db.execute(text("""
        INSERT INTO public.ref_type_pret (
            code, libelle, description, categorie_code, origine_code, taux_annuel_defaut,
            duree_max_mois, montant_max, anciennete_min_mois, algo_defaut, rubrique_paie_code,
            rubrique_paie_lib, rubrique_paie_code_interet, rubrique_paie_lib_interet,
            rubrique_paie_code_tva, rubrique_paie_lib_tva, imputable_paie,
            nb_max_simultanes, renouvelable, justificatif_requis, double_validation, avance_sur_salaire,
            workflow_actif, code_workflow, autorise_remboursement_anticipe, autorise_suspension,
            report_max_consecutif, mode_amortissement_defaut, priorite_retenue,
            quotite_max_pourcent_override, types_contrat_autorises, icone, couleur, ordre, actif
        ) VALUES (
            :code, :libelle, :description, :categorie_code, :origine_code, :taux_annuel_defaut,
            :duree_max_mois, :montant_max, :anciennete_min_mois, :algo_defaut, :rubrique_paie_code,
            :rubrique_paie_lib, :rubrique_paie_code_interet, :rubrique_paie_lib_interet,
            :rubrique_paie_code_tva, :rubrique_paie_lib_tva, :imputable_paie,
            :nb_max_simultanes, :renouvelable, :justificatif_requis, :double_validation, :avance_sur_salaire,
            :workflow_actif, :code_workflow, :autorise_remboursement_anticipe, :autorise_suspension,
            :report_max_consecutif, :mode_amortissement_defaut, :priorite_retenue,
            :quotite_max_pourcent_override, :types_contrat_autorises, :icone, :couleur, :ordre, :actif
        )
    """), data)
    db.commit()
    row = db.execute(text("SELECT * FROM public.ref_type_pret WHERE code = :c"), {"c": payload.code}).mappings().first()
    return TypePretAdminOut(**row)


@router.put("/types-admin/{code}", response_model=TypePretAdminOut)
def modifier_type(code: str, payload: TypePretAdminIn, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    data = payload.model_dump(exclude={"code"})
    data["code"] = code
    result = db.execute(text("""
        UPDATE public.ref_type_pret SET
            libelle = :libelle, description = :description, categorie_code = :categorie_code,
            origine_code = :origine_code, taux_annuel_defaut = :taux_annuel_defaut,
            duree_max_mois = :duree_max_mois, montant_max = :montant_max,
            anciennete_min_mois = :anciennete_min_mois, algo_defaut = :algo_defaut,
            rubrique_paie_code = :rubrique_paie_code, rubrique_paie_lib = :rubrique_paie_lib,
            rubrique_paie_code_interet = :rubrique_paie_code_interet,
            rubrique_paie_lib_interet = :rubrique_paie_lib_interet,
            rubrique_paie_code_tva = :rubrique_paie_code_tva, rubrique_paie_lib_tva = :rubrique_paie_lib_tva,
            imputable_paie = :imputable_paie,
            nb_max_simultanes = :nb_max_simultanes, renouvelable = :renouvelable,
            justificatif_requis = :justificatif_requis, double_validation = :double_validation,
            avance_sur_salaire = :avance_sur_salaire, workflow_actif = :workflow_actif,
            code_workflow = :code_workflow, autorise_remboursement_anticipe = :autorise_remboursement_anticipe,
            autorise_suspension = :autorise_suspension, report_max_consecutif = :report_max_consecutif,
            mode_amortissement_defaut = :mode_amortissement_defaut, priorite_retenue = :priorite_retenue,
            quotite_max_pourcent_override = :quotite_max_pourcent_override,
            types_contrat_autorises = :types_contrat_autorises, icone = :icone, couleur = :couleur,
            ordre = :ordre, actif = :actif, updated_at = now()
        WHERE code = :code
    """), data)
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Type de prêt introuvable.")
    row = db.execute(text("SELECT * FROM public.ref_type_pret WHERE code = :c"), {"c": code}).mappings().first()
    return TypePretAdminOut(**row)


@router.get("/regles-eligibilite-catalogue", response_model=list[RegleCatalogueOut])
def catalogue_regles(db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    rows = db.execute(text("SELECT * FROM public.ref_type_regle_eligibilite_pret ORDER BY code")).mappings().all()
    return [RegleCatalogueOut(**r) for r in rows]


@router.get("/types-admin/{type_code}/regles", response_model=list[TypeRegleOut])
def lister_regles_type(type_code: str, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    rows = db.execute(text(
        "SELECT * FROM public.pret_type_regle WHERE type_pret_code = :tc ORDER BY ordre"
    ), {"tc": type_code}).mappings().all()
    return [TypeRegleOut(**r) for r in rows]


@router.post("/types-admin/{type_code}/regles", response_model=TypeRegleOut, status_code=status.HTTP_201_CREATED)
def ajouter_regle_type(type_code: str, payload: TypeRegleIn, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    existing = db.execute(text(
        "SELECT 1 FROM public.pret_type_regle WHERE type_pret_code = :tc AND code_regle = :cr"
    ), {"tc": type_code, "cr": payload.code_regle}).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette règle est déjà attachée à ce type.")
    row_id = db.execute(text("""
        INSERT INTO public.pret_type_regle (type_pret_code, code_regle, parametres, niveau, derogation_rh_autorisee, ordre, actif)
        VALUES (:tc, :code_regle, :parametres, :niveau, :derogation_rh_autorisee, :ordre, :actif)
        RETURNING id
    """), {
        "tc": type_code, "code_regle": payload.code_regle, "parametres": json.dumps(payload.parametres),
        "niveau": payload.niveau, "derogation_rh_autorisee": payload.derogation_rh_autorisee,
        "ordre": payload.ordre, "actif": payload.actif,
    }).scalar_one()
    db.commit()
    row = db.execute(text("SELECT * FROM public.pret_type_regle WHERE id = :id"), {"id": row_id}).mappings().first()
    return TypeRegleOut(**row)


@router.put("/types-admin/{type_code}/regles/{regle_id}", response_model=TypeRegleOut)
def modifier_regle_type(type_code: str, regle_id: UUID, payload: TypeRegleIn, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    result = db.execute(text("""
        UPDATE public.pret_type_regle SET
            parametres = :parametres, niveau = :niveau,
            derogation_rh_autorisee = :derogation_rh_autorisee, ordre = :ordre, actif = :actif, updated_at = now()
        WHERE id = :id AND type_pret_code = :tc
    """), {
        "parametres": json.dumps(payload.parametres), "niveau": payload.niveau,
        "derogation_rh_autorisee": payload.derogation_rh_autorisee, "ordre": payload.ordre, "actif": payload.actif,
        "id": str(regle_id), "tc": type_code,
    })
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Règle introuvable pour ce type.")
    row = db.execute(text("SELECT * FROM public.pret_type_regle WHERE id = :id"), {"id": str(regle_id)}).mappings().first()
    return TypeRegleOut(**row)


@router.delete("/types-admin/{type_code}/regles/{regle_id}", status_code=status.HTTP_204_NO_CONTENT)
def retirer_regle_type(type_code: str, regle_id: UUID, db: Session = Depends(get_db), _=Depends(require_roles(*ADMIN_ROLES))):
    db.execute(text(
        "DELETE FROM public.pret_type_regle WHERE id = :id AND type_pret_code = :tc"
    ), {"id": str(regle_id), "tc": type_code})
    db.commit()


@router.get("/{pret_id}", response_model=PretDetailOut)
def detail_pret(pret_id: UUID, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    echeancier = db.execute(text(
        "SELECT * FROM public.pret_echeances WHERE pret_id = :id ORDER BY numero"
    ), {"id": str(pret_id)}).mappings().all()

    sl = _get_security_level(db, payload_jwt)
    audit = []
    if sl >= 70:
        audit_rows = db.execute(text(
            "SELECT * FROM public.pret_audit_log WHERE pret_id = :id ORDER BY horodatage DESC LIMIT 200"
        ), {"id": str(pret_id)}).mappings().all()
        audit = [dict(a) for a in audit_rows]
        noms = _resolver_noms_operateurs(db, {a.get("operateur") for a in audit})
        for a in audit:
            if a.get("operateur") in noms:
                a["operateur"] = noms[a["operateur"]]

    return PretDetailOut(**pret, echeancier=[EcheanceOut(**e) for e in echeancier], audit=audit)


@router.get("/{pret_id}/remboursements-anticipes", response_model=list[RemboursementAnticipeOut])
def remboursements_anticipes(pret_id: UUID, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    """Historique des remboursements anticipés (partiels ou totaux) de ce prêt
    — dossier fonctionnel §4.3.A. Indicateur d'éligibilité : voir
    ref_type_pret.autorise_remboursement_anticipe sur le type du prêt."""
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    rows = db.execute(text(
        "SELECT * FROM public.pret_remboursement_anticipe WHERE pret_id = :id ORDER BY date_remboursement DESC"
    ), {"id": str(pret_id)}).mappings().all()
    return [RemboursementAnticipeOut(**r) for r in rows]


@router.get("/{pret_id}/suspensions", response_model=list[SuspensionHistoriqueOut])
def historique_suspensions(pret_id: UUID, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    """Historique complet des suspensions de ce prêt (dossier fonctionnel
    §4.3.B) — contrairement aux champs courants sur `prets` (écrasés à
    chaque nouvelle suspension), cet historique garde chaque épisode."""
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    rows = db.execute(text(
        "SELECT * FROM public.pret_suspension_historique WHERE pret_id = :id ORDER BY dt_debut_suspension DESC"
    ), {"id": str(pret_id)}).mappings().all()
    return [SuspensionHistoriqueOut(**r) for r in rows]


@router.post("/{pret_id}/valider", response_model=PretOut)
def valider(pret_id: UUID, payload: ValidationDecisionIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    matricule = _identifiant_audit(payload_jwt)
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    if pret["statut"] != "en_attente_validation":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Ce dossier n'est pas en attente de validation (statut actuel : {pret['statut']}).")
    if payload.decision == "refuse" and not payload.motif_decision:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Le motif de refus est obligatoire.")

    nouveau_statut = "valide" if payload.decision == "approuve" else "refuse"
    db.execute(text("""
        UPDATE public.prets SET
            statut = :statut, dt_decision = CURRENT_DATE, ref_decision = :ref_decision,
            motif_decision = :motif_decision, competenc_decideur = :competenc_decideur,
            matric_decideur = :matric_decideur, modified_by = :operateur
        WHERE id = :id
    """), {
        "statut": nouveau_statut, "ref_decision": payload.ref_decision, "motif_decision": payload.motif_decision,
        "competenc_decideur": payload.competenc_decideur, "matric_decideur": matricule,
        "operateur": matricule, "id": str(pret_id),
    })
    pret_service._audit(db, pret_id, f"VALIDATION_{payload.decision.upper()}", matricule,
                         _get_security_level(db, payload_jwt),
                         champ="statut", ancienne=pret["statut"], nouvelle=nouveau_statut)
    db.commit()
    return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))


@router.post("/{pret_id}/generer-amortissement", response_model=list[EcheanceOut])
def generer_amortissement(pret_id: UUID, payload: GenererAmortissementIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    matricule = _identifiant_audit(payload_jwt)
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    if pret["statut"] != "valide":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Le pret doit etre valide avant generation de l'echeancier (statut actuel : {pret['statut']}).")
    sl = _get_security_level(db, payload_jwt)
    _handle_permission_value_errors(pret_service.generer_tableau_amortissement, db, pret_id, payload.date_premiere_echeance, matricule, sl)
    rows = db.execute(text("SELECT * FROM public.pret_echeances WHERE pret_id = :id ORDER BY numero"), {"id": str(pret_id)}).mappings().all()
    return [EcheanceOut(**r) for r in rows]


@router.post("/{pret_id}/debloquer", response_model=PretOut)
def debloquer(pret_id: UUID, payload: DeblocageIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    matricule = _identifiant_audit(payload_jwt)
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    sl = _get_security_level(db, payload_jwt)
    _handle_permission_value_errors(
        pret_service.debloquer_pret, db, pret_id, payload.montant_debloque, payload.date_deblocage,
        payload.no_cheque, payload.banque_emettrice, matricule, sl,
    )
    return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))


@router.post("/{pret_id}/suspendre", response_model=PretOut)
def suspendre(pret_id: UUID, payload: SuspensionIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    matricule = _identifiant_audit(payload_jwt)
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    sl = _get_security_level(db, payload_jwt)
    _handle_permission_value_errors(
        pret_service.suspendre_pret, db, pret_id, payload.motif, payload.mode,
        payload.date_debut, payload.date_fin, matricule, sl,
    )
    return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))


@router.post("/{pret_id}/reprendre", response_model=PretOut)
def reprendre(pret_id: UUID, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    matricule = _identifiant_audit(payload_jwt)
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    sl = _get_security_level(db, payload_jwt)
    _handle_permission_value_errors(pret_service.reprendre_pret, db, pret_id, matricule, sl)
    return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))


@router.post("/{pret_id}/forcer-echeance", response_model=EcheanceOut)
def forcer_echeance(pret_id: UUID, payload: ForcageEcheanceIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    matricule = _identifiant_audit(payload_jwt)
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    sl = _get_security_level(db, payload_jwt)
    _handle_permission_value_errors(
        pret_service.forcer_echeance, db, pret_id, payload.numero_echeance, payload.nouveau_montant,
        payload.note, matricule, sl, payload.mode_cascade,
    )
    row = db.execute(text(
        "SELECT * FROM public.pret_echeances WHERE pret_id = :pid AND numero = :num"
    ), {"pid": str(pret_id), "num": payload.numero_echeance}).mappings().first()
    return EcheanceOut(**row)


@router.post("/{pret_id}/recalculer-echeancier", response_model=PretDetailOut)
def recalculer_echeancier(pret_id: UUID, payload: RecalculEcheancierIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    """Recalcul manuel de la suite de l'échéancier (SL 70+) : les échéances
    déjà 'prelevee' restent intouchées, tout le reste est régénéré à partir
    du nouveau capital restant / nombre d'échéances / date de reprise."""
    matricule = _identifiant_audit(payload_jwt)
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    sl = _get_security_level(db, payload_jwt)
    _handle_permission_value_errors(
        pret_service.recalculer_echeancier_manuel, db, pret_id,
        payload.nouveau_capital_restant, payload.nouveau_nb_echeances, payload.date_reprise,
        payload.motif, matricule, sl,
    )
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    echeancier_rows = db.execute(text(
        "SELECT * FROM public.pret_echeances WHERE pret_id = :id ORDER BY numero"
    ), {"id": str(pret_id)}).mappings().all()
    return PretDetailOut(**pret, echeancier=[EcheanceOut(**e) for e in echeancier_rows], audit=[])


@router.patch("/{pret_id}/banque", response_model=PretOut)
def modifier_banque(pret_id: UUID, payload: BanqueUpdateIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    """Édition des coordonnées bancaires (RIB) après création — utile quand
    le compte vers lequel virer une retenue à la source n'était pas encore
    connu à la création du dossier (dossier fonctionnel — écran Banque)."""
    operateur = _identifiant_audit(payload_jwt)
    _get_pret_or_404(db, pret_id, payload_jwt)  # 404 si absent
    champs = payload.model_dump(exclude_unset=True)
    if not champs:
        return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))
    assignations = ", ".join(f"{c} = :{c}" for c in champs)
    db.execute(text(
        f"UPDATE public.prets SET {assignations}, modified_by = :operateur WHERE id = :id"
    ), {**champs, "operateur": operateur, "id": str(pret_id)})
    db.commit()
    return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))


@router.patch("/{pret_id}/externe", response_model=PretOut)
def modifier_prete_externe(pret_id: UUID, payload: PretExterneUpdateIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    """Édition libre des éléments d'un prêt EXTERNE, à n'importe quel
    moment — y compris après déblocage. Contrairement à un prêt interne,
    aucun moteur d'amortissement ne dépend de ces valeurs ici (l'échéancier
    externe est saisi/importé séparément), donc le verrou habituel du
    trigger ne s'applique pas — on le contourne explicitement."""
    operateur = _identifiant_audit(payload_jwt)
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    if pret["pret_interne"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                             "Cette édition libre n'est disponible que pour les prêts externes.")
    champs = payload.model_dump(exclude_unset=True)
    if not champs:
        return PretOut(**pret)

    # "Situation de début" — ces noms de champs (venus du formulaire, alignés
    # sur CreationDirectePretIn) ne correspondent PAS tous à des colonnes
    # réelles de `prets` : deja_debloque n'existe pas du tout (c'est un simple
    # indicateur), et montant_debloque/date_deblocage/capital_restant_saisie
    # ont des noms de colonnes différents (mt_debloque/dt_deblocage/capital_restant).
    deja_debloque = champs.pop("deja_debloque", None)
    montant_debloque = champs.pop("montant_debloque", None)
    date_deblocage = champs.pop("date_deblocage", None)
    capital_restant_saisie = champs.pop("capital_restant_saisie", None)

    if montant_debloque is not None:
        champs["mt_debloque"] = montant_debloque
    if date_deblocage is not None:
        champs["dt_deblocage"] = date_deblocage
    if capital_restant_saisie is not None:
        champs["capital_restant"] = capital_restant_saisie
    forcer_debloque = deja_debloque is True and not pret["pret_debloque"]
    if forcer_debloque:
        champs["pret_debloque"] = True
        champs["imputable_paie"] = True

    if not champs:
        return PretOut(**pret)

    # fin_prevue n'est jamais saisie directement — recalculée dès que la
    # date de début du prêt ou le nombre d'échéances change (dossier
    # fonctionnel : fin_prevue = dt_debut_pret + nb_echeance mois).
    if "dt_debut_pret" in champs or "nb_echeance" in champs:
        nouvelle_date_debut = champs.get("dt_debut_pret", pret["dt_debut_pret"])
        nouveau_nb = champs.get("nb_echeance", pret["nb_echeance"])
        if nouvelle_date_debut and nouveau_nb:
            champs["fin_prevue"] = nouvelle_date_debut + relativedelta(months=nouveau_nb)

    # statut passé en littéral SQL (comme dans debloquer_pret) plutôt qu'en
    # paramètre lié, pour éviter tout souci de cast vers le type enum PostgreSQL.
    assignations = ", ".join(f"{c} = :{c}" for c in champs)
    if forcer_debloque:
        assignations += ", statut = 'debloque'"
    db.execute(text("SET LOCAL app.bypass_verrou_financier = 'true'"))
    db.execute(text(
        f"UPDATE public.prets SET {assignations}, modified_by = :operateur WHERE id = :id"
    ), {**champs, "operateur": operateur, "id": str(pret_id)})
    pret_service._audit(db, pret_id, "MODIF_PRET_EXTERNE", operateur, _get_security_level(db, payload_jwt),
                         champ=", ".join(champs.keys()), ancienne=None, nouvelle=str(champs))
    db.commit()
    return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))


@router.get("/{pret_id}/echeancier", response_model=list[EcheanceOut])
def echeancier(pret_id: UUID, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    # RG-MULTISOCIETE-08 : cet endpoint n'avait ANCUNE dépendance
    # d'authentification avant ce patch (faille préexistante, sans lien
    # direct avec le multi-société, corrigée au passage) -- require_roles
    # ajouté, et _get_pret_or_404 sert ici uniquement de garde-fou société
    # (résultat non utilisé, l'échéancier est bien lu séparément ensuite).
    _get_pret_or_404(db, pret_id, payload_jwt)
    rows = db.execute(text(
        "SELECT * FROM public.pret_echeances WHERE pret_id = :pret_id ORDER BY numero"
    ), {"pret_id": str(pret_id)}).mappings().all()
    return [EcheanceOut(**r) for r in rows]


@router.post("/{pret_id}/echeancier/importer", response_model=list[EcheanceOut])
def importer_echeancier(pret_id: UUID, payload: ImporterEcheancierIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    """Saisie manuelle ou import d'échéances fournies par l'établissement de
    crédit — réservé aux prêts EXTERNES (l'échéancier des prêts internes est
    toujours calculé par le moteur). Les échéances fournies doivent être
    strictement postérieures (numéro ET date) à la dernière échéance déjà
    enregistrée — on ne peut jamais réécrire le passé ni créer un trou."""
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    if pret["pret_interne"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                             "L'import manuel de l'échéancier n'est disponible que pour les prêts externes.")

    existantes = db.execute(text(
        "SELECT numero, date_echeance FROM public.pret_echeances WHERE pret_id = :id ORDER BY numero"
    ), {"id": str(pret_id)}).mappings().all()
    dernier_numero = existantes[-1]["numero"] if existantes else 0
    derniere_date = existantes[-1]["date_echeance"] if existantes else None

    operateur = _identifiant_audit(payload_jwt)
    capital_restant_courant = Decimal(str(pret["capital_restant"] or pret["mt_pret"]))
    lignes_inserees = []

    for ligne in payload.lignes:
        numero = ligne.numero if ligne.numero is not None else dernier_numero + 1
        if numero <= dernier_numero:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                 f"L'échéance n°{numero} doit être postérieure à la dernière échéance déjà "
                                 f"enregistrée (n°{dernier_numero}) — impossible de réécrire le passé.")
        if derniere_date and ligne.date_echeance <= derniere_date:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                 f"La date de l'échéance n°{numero} ({ligne.date_echeance}) doit être "
                                 f"postérieure à la dernière échéance déjà enregistrée ({derniere_date}).")

        capital_du = capital_restant_courant
        capital_restant_courant = capital_du - ligne.mt_capital
        row = db.execute(text("""
            INSERT INTO public.pret_echeances
                (pret_id, numero, date_echeance, capital_du, mt_capital, mt_interet, capital_restant, mt_tva_interet)
            VALUES (:pid, :num, :dt, :cdu, :cap, :int, :crest, :tva)
            RETURNING *
        """), {
            "pid": str(pret_id), "num": numero, "dt": ligne.date_echeance,
            "cdu": capital_du, "cap": ligne.mt_capital, "int": ligne.mt_interet,
            "crest": capital_restant_courant, "tva": ligne.mt_tva_interet,
        }).mappings().first()
        lignes_inserees.append(dict(row))
        dernier_numero = numero
        derniere_date = ligne.date_echeance

    nb_total = db.execute(text(
        "SELECT COUNT(*) FROM public.pret_echeances WHERE pret_id = :id"
    ), {"id": str(pret_id)}).scalar()
    nb_restantes = db.execute(text(
        "SELECT COUNT(*) FROM public.pret_echeances WHERE pret_id = :id AND statut != 'prelevee'"
    ), {"id": str(pret_id)}).scalar()

    db.execute(text("SET LOCAL app.bypass_verrou_financier = 'true'"))
    db.execute(text("""
        UPDATE public.prets SET
            grille_importee = TRUE, nb_echeance = :nb_total, echeance_restant = :nb_restantes,
            fin_prevue = :fp, capital_restant = :cr, modified_by = :op
        WHERE id = :id
    """), {
        "nb_total": nb_total, "nb_restantes": nb_restantes, "fp": derniere_date,
        "cr": capital_restant_courant, "op": operateur, "id": str(pret_id),
    })
    pret_service._audit(db, pret_id, "IMPORT_ECHEANCIER", operateur, _get_security_level(db, payload_jwt),
                         champ="echeancier", ancienne=None, nouvelle=f"{len(lignes_inserees)} ligne(s) ajoutée(s)")
    db.commit()
    return [EcheanceOut(**r) for r in lignes_inserees]


@router.post("/{pret_id}/echeancier/supprimer", response_model=PretOut)
def supprimer_echeances(pret_id: UUID, payload: SupprimerEcheancesIn, db: Session = Depends(get_db), payload_jwt: dict = Depends(require_roles(*RH_ROLES))):
    """Suppression d'une ou plusieurs échéances PAS ENCORE traitées, pour un
    prêt externe (correction d'une saisie/import erronée). Refuse toute
    échéance déjà 'prelevee', même si elle figure dans la liste demandée."""
    operateur = _identifiant_audit(payload_jwt)
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    if pret["pret_interne"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                             "La suppression manuelle d'échéances n'est disponible que pour les prêts externes.")

    deja_traitees = db.execute(text("""
        SELECT numero FROM public.pret_echeances
        WHERE pret_id = :id AND numero = ANY(:numeros) AND statut = 'prelevee'
    """), {"id": str(pret_id), "numeros": payload.numeros}).scalars().all()
    if deja_traitees:
        raise HTTPException(status.HTTP_409_CONFLICT,
                             f"Impossible : l'échéance n°{deja_traitees[0]} est déjà traitée (statut 'prelevee').")

    supprimees = db.execute(text("""
        DELETE FROM public.pret_echeances WHERE pret_id = :id AND numero = ANY(:numeros)
        RETURNING numero
    """), {"id": str(pret_id), "numeros": payload.numeros}).scalars().all()
    if not supprimees:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aucune des échéances demandées n'a été trouvée.")

    derniere_restante = db.execute(text("""
        SELECT date_echeance, capital_restant FROM public.pret_echeances
        WHERE pret_id = :id ORDER BY numero DESC LIMIT 1
    """), {"id": str(pret_id)}).mappings().first()
    nb_total = db.execute(text(
        "SELECT COUNT(*) FROM public.pret_echeances WHERE pret_id = :id"
    ), {"id": str(pret_id)}).scalar()
    nb_restantes = db.execute(text(
        "SELECT COUNT(*) FROM public.pret_echeances WHERE pret_id = :id AND statut != 'prelevee'"
    ), {"id": str(pret_id)}).scalar()

    db.execute(text("SET LOCAL app.bypass_verrou_financier = 'true'"))
    db.execute(text("""
        UPDATE public.prets SET nb_echeance = :nb_total, echeance_restant = :nb_restantes,
            fin_prevue = :fp, capital_restant = :cr, modified_by = :op
        WHERE id = :id
    """), {
        "nb_total": nb_total, "nb_restantes": nb_restantes,
        "fp": derniere_restante["date_echeance"] if derniere_restante else pret["dt_debut_remb"],
        "cr": derniere_restante["capital_restant"] if derniere_restante else Decimal("0"),
        "op": operateur, "id": str(pret_id),
    })
    pret_service._audit(db, pret_id, "SUPPRESSION_ECHEANCES", operateur, _get_security_level(db, payload_jwt),
                         champ="echeancier", ancienne=str(list(supprimees)), nouvelle=None)
    db.commit()
    return PretOut(**_get_pret_or_404(db, pret_id, payload_jwt))


@router.delete("/{pret_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer(pret_id: UUID, db: Session = Depends(get_db), payload_jwt: dict = Depends(get_current_user_payload)):
    matricule = _identifiant_audit(payload_jwt)
    pret = _get_pret_or_404(db, pret_id, payload_jwt)
    roles = payload_jwt.get("roles") or payload_jwt.get("all_roles") or ([payload_jwt["role"]] if payload_jwt.get("role") else [])
    est_proprietaire = pret["matricule"] == matricule

    if est_proprietaire and pret["statut"] in ("brouillon", "en_attente_validation"):
        pass
    elif any(r in RH_ROLES for r in roles):
        pass
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Action non autorisee sur ce dossier.")

    sl = _get_security_level(db, payload_jwt)
    _handle_permission_value_errors(pret_service.supprimer_pret_logique, db, pret_id, matricule, sl)
