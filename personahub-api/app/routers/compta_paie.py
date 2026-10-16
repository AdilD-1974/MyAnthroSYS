"""
Endpoints du sous-module de comptabilisation de la paie.
Cf. MODULE_COMPTA_PAIE.md §6.

Monté dans app/routers/paie.py (cf. ce fichier, même pattern que
baremes_router/cotisations_router/paie_calcul_router) :

    from app.routers import compta_paie as compta_paie_router
    router.include_router(compta_paie_router.router)  # → /api/v1/paie/compta/...

Le préfixe ci-dessous est donc "/compta" (pas "/api/v1/paie/compta" — ça,
c'était un double-préfixage, corrigé) : paie.py porte déjà prefix="/paie",
et l'app FastAPI porte déjà le préfixe "/api/v1" (déduit du pattern des
commentaires "→ /api/v1/paie/baremes/..." sur les autres sous-routers).
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles, get_societe_active_id

from app.schemas.compta_paie import (
    ControleEffectifOut, ExporterLotIn, FormatExportOut, GenererLotIn,
    GenererLotResultOut, LotCreateIn, LotOut, RubriqueSansImputation,
)
from app.services import comptabilisation_engine as engine
from app.services import export_compta

router = APIRouter(prefix="/compta", tags=["paie-compta"])

# Même trio de rôles que PAIE_ROLES dans app/routers/paie.py. Redéfini ici
# (plutôt qu'importé depuis paie.py) pour éviter un import circulaire : ce
# routeur est lui-même inclus par paie.py au chargement du module.
PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


# RG-MULTISOCIETE-07 (correctif 24/08) : lot_ecriture_paie n'a pas de
# societe_id en propre (catégorie A) -- société déduite via periode_id ->
# calendrier_paie.societe_id. Choke point réutilisé par les 7 endpoints qui
# manipulent un lot_id : sans lui, un lot_id d'une autre société était
# consultable/modifiable/exportable en clair (données comptables).
def _lot_ou_404(db: Session, lot_id: UUID, societe_id: str, for_update: bool = False) -> dict:
    verrou = " FOR UPDATE" if for_update else ""
    lot = db.execute(text(f"""
        SELECT l.* FROM lot_ecriture_paie l
        JOIN calendrier_paie cal ON cal.id = l.periode_id
        WHERE l.id = :id AND cal.societe_id = :sid
        {verrou}
    """), {"id": str(lot_id), "sid": societe_id}).mappings().first()
    if not lot:
        raise HTTPException(404, "Lot introuvable")
    return dict(lot)


def _periode_ou_403(db: Session, periode_id: UUID, societe_id: str) -> None:
    if not db.execute(text(
        "SELECT 1 FROM calendrier_paie WHERE id = :id AND societe_id = :sid"
    ), {"id": str(periode_id), "sid": societe_id}).first():
        raise HTTPException(403, "Période non accessible pour cette société.")


def _auteur(user: dict) -> str:
    """
    require_roles(...) retourne le payload JWT décodé (dict), pas un objet
    User (confirmé par app/core/security.py : `_check` retourne `payload`).
    D'après la forme du token vue en usage réel (sub, email, role, all_roles,
    exp), on trace l'auteur par email, avec repli sur l'id utilisateur (sub).
    """
    return user.get("email") or user.get("sub") or "inconnu"


def _identite_auteur(db: Session, user: dict) -> tuple[str, str | None, str | None]:
    """
    Email (identifiant stable, toujours renseigné) + nom complet et matricule
    du collaborateur correspondant si on le retrouve (affichage uniquement,
    ex. confirmation de régénération côté écran). Le JWT ne porte pas ces deux
    derniers champs (cf. _auteur ci-dessus).

    Jointure confirmée par les logs serveur du 01/08 (endpoint chat, même
    besoin) : profiles.user_id -> profiles.collaborateur_id -> collaborateurs.
    profiles peut porter son propre nom/prénom (COALESCE en priorité) pour
    les comptes sans fiche collaborateur (ex. comptes techniques/admin purs).
    Repli sur l'email seul si aucun profil ne matche (compte sans profile).
    """
    email = _auteur(user)
    uid = user.get("sub")
    if not uid:
        return email, None, None
    row = db.execute(
        text("""
            SELECT COALESCE(p.prenom, c.prenom) AS prenom,
                   COALESCE(p.nom,    c.nom)    AS nom,
                   c.matricule
            FROM profiles p
            LEFT JOIN collaborateurs c ON c.id = p.collaborateur_id
            WHERE p.user_id = CAST(:uid AS uuid)
        """),
        {"uid": uid},
    ).mappings().first()
    if not row or (not row["prenom"] and not row["nom"]):
        return email, None, None
    nom_complet = f"{row['prenom'] or ''} {row['nom'] or ''}".strip() or None
    return email, nom_complet, row["matricule"]


# ---------------------------------------------------------------------------
# Imputations
# ---------------------------------------------------------------------------
# Pas de CRUD custom ici : la table rubrique_paie_imputation a un schéma
# plat compatible avec le proxy générique existant `/api/v1/db/...` (id,
# rubrique_paie_code, part, compte_debit, compte_credit, axe_debit,
# axe_credit, date_debut, date_fin, actif, commentaire) — voir
# RubriqueForm.tsx (onglet Comptabilité), qui l'utilise directement. Seul le rapport
# ci-dessous (agrégation que le proxy générique ne fait pas facilement) est
# ajouté ici.
@router.get("/imputations/manquantes", response_model=list[RubriqueSansImputation])
def imputations_manquantes(
    plan_paie_id: Optional[UUID] = None,
    periode_id: Optional[UUID] = None,
    collaborateur_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    societe_id: str = Depends(get_societe_active_id),
):
    """Rubriques actives (assiette, gain/retenue calculé, cotisation) sans
    imputation paramétrée.

    Si plan_paie_id ET periode_id sont fournis (05/08) : ne renvoie que les
    rubriques ayant un montant non nul sur cette période, triées par montant
    total décroissant, avec montant_salarial/montant_patronal séparés (pas
    sommés — nécessaire pour distinguer une rubrique COT dont seule la part
    patronale, ou seule la part salariale, manque d'imputation).

    Si collaborateur_id est fourni EN PLUS (05/08, bouton du relevé d'un
    agent) : restreint aux lignes de CE collaborateur uniquement, pas toute
    la population du plan/période.

    Même déduplication bulletin/bulletin_historique que
    comptabilisation_engine.py::generer_lot (bulletin_historique.id ==
    bulletin.id pour un même bulletin — sans le NOT EXISTS ci-dessous, un
    bulletin CLOTURE présent dans les deux tables serait compté deux fois,
    comme le bug d'export en double du 01/08).

    Sans plan_paie_id/periode_id : comportement legacy, toutes les rubriques
    sans imputation, montants à None."""
    if plan_paie_id and periode_id:
        _periode_ou_403(db, periode_id, societe_id)
        params: dict = {"plan_paie_id": str(plan_paie_id), "periode_id": str(periode_id)}
        filtre_collab_b = ""
        filtre_collab_bh = ""
        if collaborateur_id:
            params["collaborateur_id"] = str(collaborateur_id)
            filtre_collab_b = "AND b.collaborateur_id = :collaborateur_id"
            filtre_collab_bh = "AND bh.collaborateur_id = :collaborateur_id"
        rows = db.execute(text(f"""
            WITH montants AS (
                SELECT bl.code_rubrique AS rubrique_paie_code,
                       SUM(COALESCE(bl.montant, 0)) AS montant_salarial,
                       SUM(COALESCE(bl.montant_patronal, 0)) AS montant_patronal
                FROM bulletin_ligne bl
                JOIN bulletin b ON b.id = bl.bulletin_id
                WHERE b.plan_paie_id = :plan_paie_id
                  AND b.periode_id = :periode_id
                  AND b.statut IN ('VALIDE', 'CLOTURE')
                  {filtre_collab_b}
                GROUP BY bl.code_rubrique

                UNION ALL

                SELECT bhl.code_rubrique,
                       SUM(COALESCE(bhl.montant, 0)),
                       SUM(COALESCE(bhl.montant_patronal, 0))
                FROM bulletin_historique_ligne bhl
                JOIN bulletin_historique bh ON bh.id = bhl.bulletin_id
                WHERE bh.plan_paie_id = :plan_paie_id
                  AND bh.periode_id = :periode_id
                  AND bh.statut IN ('VALIDE', 'CLOTURE')
                  {filtre_collab_bh}
                  AND NOT EXISTS (SELECT 1 FROM bulletin b2 WHERE b2.id = bh.id)
                GROUP BY bhl.code_rubrique
            )
            SELECT r.code AS rubrique_paie_code, r.libelle, r.code_type AS categorie,
                   SUM(m.montant_salarial) AS montant_salarial,
                   SUM(m.montant_patronal) AS montant_patronal
            FROM rubrique_paie r
            JOIN montants m ON m.rubrique_paie_code = r.code
            WHERE COALESCE(r.archive, false) = false
              AND r.code_type IN ('ASS', 'CALC', 'COT')
              AND NOT EXISTS (
                  SELECT 1 FROM rubrique_paie_imputation i
                  WHERE i.rubrique_paie_code = r.code AND i.actif = true
              )
            GROUP BY r.code, r.libelle, r.code_type
            HAVING SUM(m.montant_salarial) != 0 OR SUM(m.montant_patronal) != 0
            ORDER BY (SUM(m.montant_salarial) + SUM(m.montant_patronal)) DESC
        """), params).mappings().all()
    else:
        rows = db.execute(text("""
            SELECT r.code AS rubrique_paie_code, r.libelle, r.code_type AS categorie,
                   NULL::numeric AS montant_salarial, NULL::numeric AS montant_patronal
            FROM rubrique_paie r
            WHERE COALESCE(r.archive, false) = false
              AND r.code_type IN ('ASS', 'CALC', 'COT')
              AND NOT EXISTS (
                  SELECT 1 FROM rubrique_paie_imputation i
                  WHERE i.rubrique_paie_code = r.code AND i.actif = true
              )
            ORDER BY r.code_type, r.code
        """)).mappings().all()
    return list(rows)


# ---------------------------------------------------------------------------
# Contrôle d'effectif (aperçu, réutilisable sans créer de lot)
# ---------------------------------------------------------------------------
@router.get("/controle-effectif", response_model=ControleEffectifOut)
def controle_effectif(plan_paie_id: UUID, periode_id: UUID, db: Session = Depends(get_db),
                      societe_id: str = Depends(get_societe_active_id)):
    _periode_ou_403(db, periode_id, societe_id)
    c = engine.controler_effectif(db, plan_paie_id, periode_id)
    return ControleEffectifOut(
        plan_paie_id=plan_paie_id, periode_id=periode_id,
        effectif_attendu=c.effectif_attendu, effectif_valide=c.effectif_valide,
        ok=c.ok,
        ecarts=[e.__dict__ for e in c.ecarts],
    )


# ---------------------------------------------------------------------------
# Lots
# ---------------------------------------------------------------------------
@router.post("/lots", response_model=LotOut)
def creer_lot(payload: LotCreateIn, db: Session = Depends(get_db), user: dict = Depends(require_roles(*PAIE_ROLES)),
             societe_id: str = Depends(get_societe_active_id)):
    _periode_ou_403(db, payload.periode_id, societe_id)
    row = db.execute(
        text("""
            INSERT INTO lot_ecriture_paie
                (plan_paie_id, periode_id, mode_generation, journal_code,
                 date_ecriture, numero_piece, cree_par)
            VALUES (:plan_paie_id, :periode_id, :mode_generation, :journal_code,
                    :date_ecriture, :numero_piece, :cree_par)
            ON CONFLICT (plan_paie_id, periode_id, mode_generation)
                -- COALESCE : un rappel de creer_lot() sans journal_code/date/numero_piece
                -- (ex. un simple "récupère-moi le lot existant" côté client) ne doit
                -- jamais écraser les valeurs déjà en base avec NULL.
                DO UPDATE SET
                    journal_code = COALESCE(EXCLUDED.journal_code, lot_ecriture_paie.journal_code),
                    date_ecriture = COALESCE(EXCLUDED.date_ecriture, lot_ecriture_paie.date_ecriture),
                    numero_piece = COALESCE(EXCLUDED.numero_piece, lot_ecriture_paie.numero_piece)
            RETURNING *
        """),
        {**payload.model_dump(mode="json"), "cree_par": _auteur(user)},
    ).mappings().first()
    db.commit()
    return row


# Lecture pure, sans effet de bord — à utiliser côté client pour tout
# rafraîchissement de statut (au lieu de rappeler POST /lots, cf. correctif
# ci-dessus qui protège déjà contre ça, mais GET est plus explicite et moins
# coûteux : pas de transaction d'écriture pour un simple rafraîchissement).
@router.get("/lots/{lot_id}", response_model=LotOut)
def obtenir_lot(lot_id: UUID, db: Session = Depends(get_db), societe_id: str = Depends(get_societe_active_id)):
    return _lot_ou_404(db, lot_id, societe_id)


# 05/08 : suppression réservée aux lots BROUILLON — un lot BROUILLON n'a
# jamais eu de génération réussie (un déséquilibre ne persiste rien, cf.
# generer_lot ci-dessous), donc aucune ligne d'écriture à nettoyer en
# cascade. Un lot GENERE/EXPORTE/COMPTABILISE ne peut PAS être supprimé par
# cette route — le contrôle est fait ici, pas seulement côté écran (l'icône
# de suppression n'apparaît que sur les lots BROUILLON dans
# VueComptabilitePage.tsx, mais un appel direct à l'API doit rester protégé).
@router.delete("/lots/{lot_id}", status_code=204)
def supprimer_lot(
    lot_id: UUID, db: Session = Depends(get_db),
    user: dict = Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    lot = _lot_ou_404(db, lot_id, societe_id)
    if lot["statut"] != "BROUILLON":
        raise HTTPException(409, "Seul un lot au statut BROUILLON peut être supprimé.")
    db.execute(text("DELETE FROM lot_ecriture_paie WHERE id=:id"), {"id": str(lot_id)})
    db.commit()


@router.post("/lots/{lot_id}/generer", response_model=GenererLotResultOut)
def generer_lot(
    lot_id: UUID, payload: GenererLotIn,
    db: Session = Depends(get_db), user: dict = Depends(require_roles("administrateur", "gestionnaire_paie")),
    societe_id: str = Depends(get_societe_active_id),
):
    # SELECT ... FOR UPDATE : verrouille la ligne le temps de la transaction.
    # Sans ça, deux POST /generer quasi simultanés (double-clic avant que le
    # bouton se désactive, retry réseau...) lisent tous les deux le même
    # numero_generation de départ et insèrent CHACUN un jeu complet de lignes
    # sous le même numéro — doublon exact constaté dans les exports. Avec le
    # verrou, la deuxième requête attend que la première commite, puis relit
    # le numero_generation à jour et incrémente correctement à la suite.
    lot = _lot_ou_404(db, lot_id, societe_id, for_update=True)

    auteur_email, auteur_nom, auteur_matricule = _identite_auteur(db, user)

    # 06/08 : le contrôle d'effectif ne bloque plus la génération — décision
    # explicite (l'utilisateur doit pouvoir régénérer librement, y compris
    # pendant le paramétrage/les tests, sans passer par un forçage manuel
    # à chaque fois). On force silencieusement dès que le contrôle échoue,
    # avec un motif par défaut si l'appelant n'en a pas fourni, plutôt que
    # de renvoyer 409 — le lot garde quand même la trace de l'écart
    # (force_par/motif_forcage/controle_ok, cf. plus bas) pour audit.
    try:
        resultat = engine.generer_lot(
            db, lot["plan_paie_id"], lot["periode_id"], lot["mode_generation"],
            forcer=payload.forcer, motif_forcage=payload.motif_forcage,
        )
    except engine.ControleEffectifKO as exc:
        motif = payload.motif_forcage or (
            f"Généré malgré écart d'effectif ({exc.controle.effectif_valide}/"
            f"{exc.controle.effectif_attendu} bulletins validés) — contrôle non bloquant (06/08)."
        )
        resultat = engine.generer_lot(
            db, lot["plan_paie_id"], lot["periode_id"], lot["mode_generation"],
            forcer=True, motif_forcage=motif,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    # Déséquilibre : donnée structurée (pas une exception HTTP) pour que
    # l'écran affiche la ventilation par axe puis par collaborateur —
    # rien n'est persisté, le lot reste en BROUILLON.
    if "desequilibre" in resultat:
        # 05/08 : détail brut compte -> rubrique -> matricule, en plus de la
        # ventilation par axe, pour que l'écran puisse aussi grouper par
        # compte même sans rien persister. matricule/nom résolus ici (les
        # LigneDetail du moteur ne portent que collaborateur_id).
        collab_ids = {str(l.collaborateur_id) for l in resultat["lignes_detail"]}
        noms = {}
        if collab_ids:
            rows = db.execute(
                text("""
                    SELECT id, matricule, nom || ' ' || prenom AS nom_complet
                    FROM collaborateurs WHERE id = ANY(CAST(:ids AS uuid[]))
                """),
                {"ids": list(collab_ids)},
            ).mappings().all()
            noms = {str(r["id"]): (r["matricule"], r["nom_complet"]) for r in rows}

        lignes_brutes = [
            {
                "compte": l.compte,
                "sens": l.sens,
                "montant": l.montant,
                "rubrique_paie_code": l.rubrique_paie_code,
                "part": l.part,
                "axe_analytique": l.axe_analytique,
                "collaborateur_id": str(l.collaborateur_id),
                "matricule": noms.get(str(l.collaborateur_id), (None, None))[0],
                "nom_complet": noms.get(str(l.collaborateur_id), (None, None))[1],
            }
            for l in resultat["lignes_detail"]
        ]

        return GenererLotResultOut(
            lot=None,
            desequilibre=[
                {
                    "axe_analytique": e.axe_analytique,
                    "total_debit": e.total_debit,
                    "total_credit": e.total_credit,
                    "collaborateurs": [c.__dict__ for c in e.collaborateurs],
                    "libelle_uo": e.libelle_uo,
                    "code_uo": e.code_uo,
                    "niveau": e.niveau,
                    "chemin_hierarchique": e.chemin_hierarchique,
                }
                for e in resultat["desequilibre"]
            ],
            # ⚠️ Ce champ n'existe probablement pas encore sur
            # GenererLotResultOut (schemas/compta_paie.py, jamais reçu) — s'il
            # n'est pas déclaré là-bas, Pydantic le filtre silencieusement de
            # la réponse (même symptôme que genere_par_nom précédemment).
            lignes_brutes=lignes_brutes,
        )

    # Persistance transactionnelle du lot + détail + agrégat + historique.
    #
    # ⚠️ 06/08 : changement de politique — table rase à chaque régénération,
    # au lieu de l'historisation précédente (qui gardait toutes les lignes
    # de toutes les générations, numérotées par numero_generation). Les
    # anciennes lignes sont maintenant supprimées avant l'insertion des
    # nouvelles. numero_generation continue d'incrémenter (utile pour
    # lot_ecriture_paie_generation, la table d'audit séparée qui ne
    # contient que des agrégats — pas les lignes elles-mêmes — donc pas
    # affectée par cette suppression), mais ne sert plus à distinguer
    # plusieurs jeux de lignes coexistants : il n'y en a plus qu'un seul.
    nouvelle_generation = (lot["numero_generation"] or 0) + 1

    db.execute(text("DELETE FROM ecriture_ligne_detail WHERE lot_id=:id"), {"id": str(lot_id)})
    db.execute(text("DELETE FROM ecriture_ligne WHERE lot_id=:id"), {"id": str(lot_id)})

    for l in resultat["lignes_detail"]:
        db.execute(
            text("""
                INSERT INTO ecriture_ligne_detail
                    (lot_id, numero_generation, bulletin_id, collaborateur_id,
                     matricule_agent, rubrique_paie_code, part, compte, sens,
                     montant, axe_analytique)
                VALUES (:lot_id, :numero_generation, :bulletin_id, :collaborateur_id,
                        -- Résolu ici plutôt qu'attendu du moteur de calcul (comptabilisation_engine.py) :
                        -- scalaire, jamais NULL sauf collaborateur_id orphelin (n'empêche pas l'insertion).
                        (SELECT matricule FROM collaborateurs WHERE id = :collaborateur_id),
                        :rubrique_paie_code, :part, :compte, :sens,
                        :montant, :axe_analytique)
                -- Garde-fou en plus du verrou FOR UPDATE ci-dessus : si un doublon
                -- survient malgré tout (ex. deux processus applicatifs distincts),
                -- il est silencieusement ignoré plutôt que dupliqué.
                ON CONFLICT ON CONSTRAINT uq_ecriture_ligne_detail_generation DO NOTHING
            """),
            {"lot_id": str(lot_id), "numero_generation": nouvelle_generation, **l.__dict__},
        )

    if resultat["ecritures_globales"] is not None:
        for g in resultat["ecritures_globales"]:
            db.execute(
                text("""
                    INSERT INTO ecriture_ligne (lot_id, numero_generation, compte, sens, montant, axe_analytique)
                    VALUES (:lot_id, :numero_generation, :compte, :sens, :montant, :axe_analytique)
                """),
                {"lot_id": str(lot_id), "numero_generation": nouvelle_generation, **g},
            )

    db.execute(
        text("""
            UPDATE lot_ecriture_paie
            SET statut='GENERE', numero_generation=:numero_generation,
                effectif_attendu=:ea, effectif_valide=:ev,
                controle_ok=:ok, force_par=:force_par, motif_forcage=:motif,
                total_debit=:td, total_credit=:tc, nb_lignes_exclues=:nex,
                genere_le=now(), genere_par=:user,
                genere_par_nom=:nom, genere_par_matricule=:matricule
            WHERE id=:id
            RETURNING *
        """),
        {
            "numero_generation": nouvelle_generation,
            "ea": resultat["controle"].effectif_attendu,
            "ev": resultat["controle"].effectif_valide,
            "ok": resultat["controle"].ok,
            "force_par": _auteur(user) if payload.forcer else None,
            "motif": payload.motif_forcage,
            "td": resultat["total_debit"], "tc": resultat["total_credit"],
            "nex": len(resultat["lignes_exclues"]),
            "user": auteur_email, "nom": auteur_nom, "matricule": auteur_matricule,
            "id": str(lot_id),
        },
    )

    # Table d'audit dédiée : contrairement à lot_ecriture_paie (qui ne garde
    # que l'état de la génération COURANTE), lot_ecriture_paie_generation
    # conserve une ligne par génération passée — sinon la date/l'auteur d'une
    # régénération précédente serait perdu au prochain UPDATE ci-dessus.
    db.execute(
        text("""
            INSERT INTO lot_ecriture_paie_generation
                (lot_id, numero_generation, genere_le, genere_par,
                 genere_par_nom, genere_par_matricule,
                 effectif_attendu, effectif_valide, controle_ok,
                 force_par, motif_forcage, total_debit, total_credit, nb_lignes_exclues)
            VALUES
                (:lot_id, :numero_generation, now(), :user,
                 :nom, :matricule,
                 :ea, :ev, :ok,
                 :force_par, :motif, :td, :tc, :nex)
        """),
        {
            "lot_id": str(lot_id), "numero_generation": nouvelle_generation,
            "ea": resultat["controle"].effectif_attendu,
            "ev": resultat["controle"].effectif_valide,
            "ok": resultat["controle"].ok,
            "force_par": _auteur(user) if payload.forcer else None,
            "motif": payload.motif_forcage,
            "td": resultat["total_debit"], "tc": resultat["total_credit"],
            "nex": len(resultat["lignes_exclues"]),
            "user": auteur_email, "nom": auteur_nom, "matricule": auteur_matricule,
        },
    )
    # ⚠️ Pas d'écriture dans paie_historique ici : sa structure réelle
    # (confirmée le 26/07 : id, periode_id, bulletin_id, collaborateur_id,
    # action, statut_avant, statut_apres, rapport, decision, commentaire,
    # utilisateur_id, created_at) est conçue pour tracer une transition de
    # statut PAR BULLETIN — pas un événement générique par lot. La forcer ici
    # exigerait bulletin_id/collaborateur_id que cet événement n'a pas, avec
    # un risque de contrainte NOT NULL inconnue. La traçabilité de la
    # génération reste couverte nativement par lot_ecriture_paie
    # (genere_le, genere_par, force_par, motif_forcage, controle_ok).
    db.commit()

    lot_final = db.execute(text("SELECT * FROM lot_ecriture_paie WHERE id=:id"), {"id": str(lot_id)}).mappings().first()
    return GenererLotResultOut(lot=lot_final, desequilibre=None)


@router.get("/lots/{lot_id}/generations")
def lister_generations(lot_id: UUID, db: Session = Depends(get_db), societe_id: str = Depends(get_societe_active_id)):
    """Historique des générations d'un lot (audit), la plus récente en premier."""
    _lot_ou_404(db, lot_id, societe_id)
    return db.execute(
        text("""
            SELECT numero_generation, genere_le, genere_par,
                   genere_par_nom, genere_par_matricule,
                   effectif_attendu, effectif_valide, controle_ok,
                   force_par, motif_forcage,
                   total_debit, total_credit, nb_lignes_exclues
            FROM lot_ecriture_paie_generation
            WHERE lot_id=:id
            ORDER BY numero_generation DESC
        """),
        {"id": str(lot_id)},
    ).mappings().all()


@router.get("/lots/{lot_id}/anomalies")
def lister_anomalies(lot_id: UUID, db: Session = Depends(get_db), societe_id: str = Depends(get_societe_active_id)):
    # Les lignes exclues ne sont pas persistées (recalculées à la volée) —
    # à revoir si besoin d'historiser exactement l'état au moment de la
    # génération (ajouter une table ecriture_ligne_exclue si nécessaire).
    lot = _lot_ou_404(db, lot_id, societe_id)
    _, exclues, _ = engine.generer_detail(db, lot["plan_paie_id"], lot["periode_id"])
    return exclues


@router.get("/lots/{lot_id}/anomalies-parametrage")
def lister_anomalies_parametrage(lot_id: UUID, db: Session = Depends(get_db), societe_id: str = Depends(get_societe_active_id)):
    """
    Cohérence axe analytique / nature de compte (ref_imputation_comptable,
    01/08) — endpoint séparé de /anomalies pour ne pas changer la forme de
    réponse existante (liste brute, consommée telle quelle par le front pour
    le compteur "Lignes exclues"). Ne bloque jamais la génération : ce sont
    des signaux de mauvais paramétrage (ex. compte de tiers portant un axe
    analytique par erreur), pas des lignes manquantes.
    """
    lot = _lot_ou_404(db, lot_id, societe_id)
    _, _, anomalies = engine.generer_detail(db, lot["plan_paie_id"], lot["periode_id"])
    return anomalies


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
@router.get("/formats", response_model=list[FormatExportOut])
def lister_formats(db: Session = Depends(get_db)):
    return db.execute(
        text("SELECT code, libelle, description FROM ref_format_export_compta WHERE actif=true ORDER BY libelle")
    ).mappings().all()


@router.post("/lots/{lot_id}/exporter")
def exporter_lot(
    lot_id: UUID, payload: ExporterLotIn,
    db: Session = Depends(get_db), user: dict = Depends(require_roles("administrateur", "gestionnaire_paie")),
    societe_id: str = Depends(get_societe_active_id),
):
    lot = _lot_ou_404(db, lot_id, societe_id)
    if lot["statut"] not in ("GENERE", "EXPORTE", "COMPTABILISE"):
        raise HTTPException(409, "Le lot doit d'abord être généré.")

    # 06/08 : même résolution que _identite_auteur() pour genere_par_nom/
    # genere_par_matricule sur le lot — historique des exports doit lui
    # aussi afficher nom/prénom/matricule, pas seulement l'email.
    auteur_email, auteur_nom, auteur_matricule = _identite_auteur(db, user)

    fmt = db.execute(
        text("SELECT * FROM ref_format_export_compta WHERE code=:code"), {"code": payload.format_code}
    ).mappings().first()
    if not fmt:
        raise HTTPException(404, "Format d'export inconnu")

    # 06/08 : nécessaire à la fois pour le suffixe du nom de fichier
    # (Année_Mois_PER_NuméroPériode, demandé explicitement — pas la date de
    # génération/export) et comme repli plus pertinent que date.today() pour
    # date_ecriture quand le lot n'en a pas de propre.
    periode = db.execute(
        text("SELECT annee, mois, numero_periode, date_fin FROM calendrier_paie WHERE id=:id"),
        {"id": str(lot["periode_id"])},
    ).mappings().first()
    if not periode:
        raise HTTPException(404, "Période introuvable pour ce lot")

    lignes = db.execute(
        text("""
            SELECT el.compte, NULL AS libelle, el.sens, el.montant, el.axe_analytique,
                   NULL AS comp_aux_num, NULL AS comp_aux_lib,
                   ric.intitule_compte AS compte_libelle
            FROM ecriture_ligne el
            LEFT JOIN LATERAL (
                -- LATERAL + LIMIT 1 : garantit UNE seule ligne quel que soit
                -- l'état de ref_imputation_comptable (pas de contrainte
                -- d'unicité sur code_compte avant le 01/08 -> un simple LEFT
                -- JOIN sur un doublon multipliait chaque écriture, cause
                -- exacte du "double la balance" constaté).
                SELECT intitule_compte, necessite_compte_auxiliaire, type_auxiliaire
                FROM ref_imputation_comptable
                WHERE code_compte = el.compte AND actif = true
                ORDER BY code_compte LIMIT 1
            ) ric ON true
            -- Mode GLOBAL : lignes agrégées tous collaborateurs confondus, pas
            -- de notion d'auxiliaire COLLABORATEUR possible ici (01/08).
            WHERE el.lot_id=:id AND el.numero_generation=:gen
        """)
        if lot["mode_generation"] == "GLOBAL" else
        text("""
            SELECT eld.compte, eld.rubrique_paie_code AS libelle, eld.sens,
                   eld.montant, eld.axe_analytique,
                   CASE WHEN ric.necessite_compte_auxiliaire AND ric.type_auxiliaire = 'COLLABORATEUR'
                        THEN eld.matricule_agent END AS comp_aux_num,
                   CASE WHEN ric.necessite_compte_auxiliaire AND ric.type_auxiliaire = 'COLLABORATEUR'
                        THEN c.nom || ' ' || c.prenom END AS comp_aux_lib,
                   ric.intitule_compte AS compte_libelle
            FROM ecriture_ligne_detail eld
            LEFT JOIN LATERAL (
                SELECT intitule_compte, necessite_compte_auxiliaire, type_auxiliaire
                FROM ref_imputation_comptable
                WHERE code_compte = eld.compte AND actif = true
                ORDER BY code_compte LIMIT 1
            ) ric ON true
            LEFT JOIN collaborateurs c ON c.id = eld.collaborateur_id
            WHERE eld.lot_id=:id AND eld.numero_generation=:gen
        """),
        {"id": str(lot_id), "gen": lot["numero_generation"]},
    ).mappings().all()

    contenu, nom_fichier, content_type = export_compta.exporter(
        payload.format_code, [dict(l) for l in lignes], fmt["mapping"],
        journal_code=lot["journal_code"],
        date_ecriture=lot["date_ecriture"] or periode["date_fin"] or date.today(),
        numero_piece=lot["numero_piece"],
        annee=periode["annee"], mois=periode["mois"], numero_periode=periode["numero_periode"],
    )

    db.execute(
        text("""
            INSERT INTO export_ecriture_paie (lot_id, format_code, exporte_par, exporte_par_nom, exporte_par_matricule, nom_fichier)
            VALUES (:lot_id, :format_code, :user, :user_nom, :user_matricule, :nom_fichier)
        """),
        {
            "lot_id": str(lot_id), "format_code": payload.format_code, "nom_fichier": nom_fichier,
            "user": auteur_email, "user_nom": auteur_nom, "user_matricule": auteur_matricule,
        },
    )
    db.execute(text("UPDATE lot_ecriture_paie SET statut='EXPORTE' WHERE id=:id AND statut='GENERE'"), {"id": str(lot_id)})
    db.commit()

    return Response(
        content=contenu, media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{nom_fichier}"'},
    )


# Option A (05/08) : simple tampon date/auteur sur le lot, pas de statut par
# écriture — cf. discussion. Réservé aux lots EXPORTE (respecte le cycle
# BROUILLON -> GENERE -> EXPORTE -> COMPTABILISE, un lot ne devrait pas
# pouvoir être "comptabilisé" avant d'avoir été exporté au moins une fois).
# comptabilise_generation fige le numero_generation courant, pour détecter
# côté écran un décalage si le lot est régénéré après coup.
@router.post("/lots/{lot_id}/comptabiliser", response_model=LotOut)
def comptabiliser_lot(
    lot_id: UUID, db: Session = Depends(get_db),
    user: dict = Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    lot = _lot_ou_404(db, lot_id, societe_id)
    if lot["statut"] != "EXPORTE":
        raise HTTPException(409, "Seul un lot déjà exporté peut être marqué comme comptabilisé.")

    lot_maj = db.execute(
        text("""
            UPDATE lot_ecriture_paie
            SET statut = 'COMPTABILISE',
                comptabilise_le = now(),
                comptabilise_par = :user,
                comptabilise_generation = numero_generation
            WHERE id = :id
            RETURNING *
        """),
        {"id": str(lot_id), "user": _auteur(user)},
    ).mappings().first()
    db.commit()
    return lot_maj
