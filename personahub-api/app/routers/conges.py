"""
app/routers/conges.py — Liste des conges (scopee par role, filtres avances)
Auteur : Adil DAIA

Perimetre manager = RG-MGR-POP-01 (identique a useManagerPopulation / "Mon equipe") :
  A. FORCAGE  : collaborateur dont manager_n1_id OU manager_n2_id = le manager
  B. DYNAMIQUE: collaborateurs des UO dont le manager est responsable
                (responsable_id OU poste_responsable_code) + TOUTES les sous-UO
                (descendance recursive), via collaborateur_affectations actives.
  + le manager voit ses propres conges.
admin / gestionnaire_rh -> tous les conges. collaborateur -> les siens.

RG-CONGE-SOURCE-01 (Adil DAIA) : depuis l'ajout de la Saisie directe RH, un
congé peut exister sous DEUX formes distinctes :
  - "circuit"       : une ligne cong_demandes (workflow standard, statut variable)
  - "saisie_directe": une ligne cong_consommation avec demande_id IS NULL
                       (enregistrée directement, sans passer par cong_demandes,
                       toujours au statut "approuvee" côté affichage)
/conges/liste fusionne les deux sources via UNION ALL sur des colonnes
normalisées, avec une colonne `source` permettant au frontend de les distinguer
visuellement (badge "Circuit" vs "Saisie directe").

GET /api/v1/conges/liste — conges filtres (les deux sources).
GET /api/v1/conges/uos   — UO du perimetre (pour le filtre).
"""
from __future__ import annotations

from datetime import date
from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload

router = APIRouter(prefix="/conges", tags=["conges"])

# RG-MULTISOCIETE-08 (migration 057) : cong_demandes/cong_consommation n'ont
# pas de societe_id en propre (catégorie A) -- société déduite via
# collaborateur_id -> collaborateur_contrats.societe_id (contrat actif).
# Appliqué aux DEUX branches (circuit + saisie directe) ET aux DEUX modes
# (voit_tout ET manager) -- la société est une frontière dure, pas un
# périmètre de permission comme le rôle : même administrateur/gestionnaire_rh
# ne doit voir que la société active de sa session.
_SOCIETE_FILTRE_CIRCUIT = """
    AND EXISTS (
        SELECT 1 FROM collaborateur_contrats scc
         WHERE scc.collaborateur_id = cd.collaborateur_id
           AND scc.societe_id = :societe_active AND scc.archive = false
    )
"""
_SOCIETE_FILTRE_DIRECTE = """
    AND EXISTS (
        SELECT 1 FROM collaborateur_contrats scc
         WHERE scc.collaborateur_id = cc.collaborateur_id
           AND scc.societe_id = :societe_active AND scc.archive = false
    )
"""

# CTE population manager (RG-MGR-POP-01)
# Produit : uo_tree (UO du perimetre) et collab_pop (collaborateurs du perimetre)
# NB : pas de trailing comma — c'est le début du WITH clause final, complété
# soit par ", combined AS (...)" (cas manager) soit absent (cas voit_tout).
_POP_CTE = """
WITH RECURSIVE manager AS (SELECT CAST(:moi AS uuid) AS cid),
poste_codes AS (
    SELECT DISTINCT a.code_poste
    FROM collaborateur_affectations a, manager m
    WHERE a.collaborateur_id = m.cid AND a.archive = false
      AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= CURRENT_DATE)
      AND a.code_poste IS NOT NULL
),
direct_uo AS (
    SELECT u.id FROM unites_organisationnelles u, manager m
    WHERE u.actif IS NOT FALSE AND u.responsable_id = m.cid
    UNION
    SELECT u.id FROM unites_organisationnelles u
    WHERE u.actif IS NOT FALSE
      AND u.poste_responsable_code IN (SELECT code_poste FROM poste_codes)
),
uo_tree AS (
    SELECT id FROM direct_uo
    UNION
    SELECT u.id FROM unites_organisationnelles u
    JOIN uo_tree t ON u.parent_id = t.id
    WHERE u.actif IS NOT FALSE
),
collab_pop AS (
    SELECT DISTINCT a.collaborateur_id AS cid
    FROM collaborateur_affectations a
    WHERE a.archive = false AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= CURRENT_DATE)
      AND a.unite_id IN (SELECT id FROM uo_tree)
    UNION
    SELECT DISTINCT a.collaborateur_id
    FROM collaborateur_affectations a, manager m
    WHERE a.archive = false AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= CURRENT_DATE)
      AND (a.manager_n1_id = m.cid OR a.manager_n2_id = m.cid)
    UNION
    SELECT m.cid FROM manager m
)
"""

# ── Branche A : circuit standard (cong_demandes) ────────────────────────────
# {pop_filter} = "" (voit_tout) ou "AND cd.collaborateur_id IN (SELECT cid FROM collab_pop)"
_BRANCHE_CIRCUIT = """
    SELECT
        cd.id, cd.collaborateur_id, cd.code_type_conge, rt.code_famille,
        cd.date_debut, {end_expr} AS date_fin_absence, cd.date_retour,
        cd.debut_demi_journee, cd.fin_demi_journee,
        cd.nbr_jours_calendaires, cd.nbr_jours_decomptes,
        cd.statut, cd.motif_refus,
        cd.commentaire_collaborateur, cd.commentaire_gestionnaire,
        cd.est_report_reliquat, cd.reconduction_numero, cd.piece_jointe_path,
        cd.date_soumission, cd.date_validation, cd.valideur_id,
        rt.libelle AS libelle_type_conge,
        c.nom AS demandeur_nom, c.prenom AS demandeur_prenom, c.matricule AS demandeur_matricule,
        pt.periodes_traitement,
        'circuit' AS source
    FROM cong_demandes cd
    LEFT JOIN ref_type_conge rt ON rt.code = cd.code_type_conge
    LEFT JOIN collaborateurs c ON c.id = cd.collaborateur_id
    -- RG-CONGE-PERIODE-TRAITEMENT-01 : cf. version précédente, inchangé.
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT jsonb_build_object(
                   'periode_id', cp.id,
                   'mois', cp.mois,
                   'annee', cp.annee,
                   'statut_periode', cp.statut,
                   'ev_archive', ev.archive
               )) AS periodes_traitement
        FROM cong_consommation cc
        JOIN element_variable ev
          ON ev.source_table = 'cong_consommation'
         AND cc.id = ANY(ev.source_ids)
        JOIN calendrier_paie cp ON cp.id = ev.periode_id
        WHERE cc.demande_id = cd.id
    ) pt ON true
    WHERE cd.archive = false
    {pop_filter}
"""

# ── Branche B : saisie directe RH (cong_consommation, demande_id IS NULL) ──
# Toujours affichée au statut "approuvee" (consommation = déjà validée).
# date_fin_absence approximée (date_retour - 1 jour) : cong_consommation ne
# stocke pas la date du dernier jour d'absence, seulement date_debut/date_retour.
_BRANCHE_DIRECTE = """
    SELECT
        cc.id, cc.collaborateur_id, cc.code_type_conge, rt2.code_famille,
        cc.date_debut, COALESCE(cc.date_fin_absence, cc.date_retour - INTERVAL '1 day')::date AS date_fin_absence, cc.date_retour,
        cc.debut_demi_journee, cc.fin_demi_journee,
        cc.nbr_jours_calendaires, cc.nbr_jours_decomptes,
        'approuvee' AS statut, NULL AS motif_refus,
        NULL AS commentaire_collaborateur, NULL AS commentaire_gestionnaire,
        NULL AS est_report_reliquat, NULL AS reconduction_numero, NULL AS piece_jointe_path,
        cc.created_at::date AS date_soumission, cc.created_at AS date_validation, NULL AS valideur_id,
        rt2.libelle AS libelle_type_conge,
        c2.nom AS demandeur_nom, c2.prenom AS demandeur_prenom, c2.matricule AS demandeur_matricule,
        pt2.periodes_traitement,
        'saisie_directe' AS source
    FROM cong_consommation cc
    LEFT JOIN ref_type_conge rt2 ON rt2.code = cc.code_type_conge
    LEFT JOIN collaborateurs c2 ON c2.id = cc.collaborateur_id
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT jsonb_build_object(
                   'periode_id', cp2.id,
                   'mois', cp2.mois,
                   'annee', cp2.annee,
                   'statut_periode', cp2.statut,
                   'ev_archive', ev2.archive
               )) AS periodes_traitement
        FROM element_variable ev2
        JOIN calendrier_paie cp2 ON cp2.id = ev2.periode_id
        WHERE ev2.source_table = 'cong_consommation' AND cc.id = ANY(ev2.source_ids)
    ) pt2 ON true
    WHERE cc.demande_id IS NULL AND cc.archive = false AND cc.est_annulee = false
    {pop_filter}
"""

# Filtre UO (UO selectionnees + sous-arbre), appliqué sur le résultat combiné
_UO_FILTRE = """
    AND EXISTS (
        SELECT 1 FROM collaborateur_affectations af
        WHERE af.collaborateur_id = cb.collaborateur_id AND af.archive = false
          AND (af.date_fin_uo IS NULL OR af.date_fin_uo >= CURRENT_DATE)
          AND af.unite_id IN (
              WITH RECURSIVE sel AS (
                  SELECT id FROM unites_organisationnelles
                  WHERE id = ANY(CAST(:uo_ids AS uuid[]))
                  UNION ALL
                  SELECT u.id FROM unites_organisationnelles u
                  JOIN sel s ON u.parent_id = s.id
              )
              SELECT id FROM sel
          )
    )
"""


def _effective_role(db: Session, user_id, payload: dict, role_actif: Optional[str]) -> str:
    """Rôle ACTIF de l'appelant (sélecteur d'espace), validé contre ses rôles réels.
    Évite qu'un multi-rôle (ex. admin + manager) voie tout alors qu'il agit en manager."""
    cand = (role_actif or payload.get("role") or "").strip()
    if cand:
        ok = db.execute(text(
            "SELECT 1 FROM user_roles WHERE user_id = :u AND role = :r LIMIT 1"
        ), {"u": str(user_id), "r": cand}).scalar()
        if ok:
            return cand
    return (payload.get("role") or "").strip()


def _voit_tout(role: str) -> bool:
    return role in ("administrateur", "gestionnaire_rh")


def _moi(db: Session, user_id):
    return db.execute(text("""
        SELECT collaborateur_id FROM profiles
        WHERE user_id = :u AND collaborateur_id IS NOT NULL LIMIT 1
    """), {"u": str(user_id)}).scalar()


@router.get("/liste")
def liste_conges(
    familles: Optional[list[str]] = Query(None),
    types: Optional[list[str]] = Query(None),
    statuts: Optional[list[str]] = Query(None),
    uo_ids: Optional[list[str]] = Query(None),
    date_min: Optional[date] = None,
    date_max: Optional[date] = None,
    q: Optional[str] = None,
    role_actif: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    user_id = payload.get("sub")
    role = _effective_role(db, user_id, payload, role_actif)
    voit_tout = _voit_tout(role)
    moi = _moi(db, user_id)

    # Colonnes de fin réellement présentes sur cong_demandes (schemas variables)
    # -> COALESCE robuste, alias normalisé "date_fin_absence" pour l'UNION.
    end_cols = db.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cong_demandes'
          AND column_name IN ('date_fin_absence', 'date_fin', 'date_retour')
    """)).scalars().all()
    ordered = [c for c in ('date_fin_absence', 'date_fin') if c in end_cols]
    end_expr = "COALESCE(" + ", ".join([f"cd.{c}" for c in ordered] + ["cd.date_debut"]) + ")"

    params: dict[str, Any] = {"moi": str(moi) if moi else None}

    societe_active = payload.get("societe_active_id")
    if not societe_active:
        raise HTTPException(403, detail="Aucune société active sur ce token — reconnexion requise")
    params["societe_active"] = societe_active

    # RG-MULTISOCIETE-08 : le filtre société s'ajoute TOUJOURS, y compris en
    # voit_tout=True -- la société n'est jamais contournée par le rôle.
    pop_filter_circuit = _SOCIETE_FILTRE_CIRCUIT if voit_tout else (
        "AND cd.collaborateur_id IN (SELECT cid FROM collab_pop)" + _SOCIETE_FILTRE_CIRCUIT
    )
    pop_filter_directe = _SOCIETE_FILTRE_DIRECTE if voit_tout else (
        "AND cc.collaborateur_id IN (SELECT cid FROM collab_pop)" + _SOCIETE_FILTRE_DIRECTE
    )

    branche_circuit = _BRANCHE_CIRCUIT.format(end_expr=end_expr, pop_filter=pop_filter_circuit)
    branche_directe = _BRANCHE_DIRECTE.format(pop_filter=pop_filter_directe)

    combined_cte = f"combined AS (\n{branche_circuit}\n    UNION ALL\n{branche_directe}\n)"

    if voit_tout:
        sql = f"WITH {combined_cte}\nSELECT * FROM combined cb WHERE 1=1"
    else:
        # _POP_CTE se termine par "collab_pop AS (...)" sans virgule finale :
        # on enchaîne avec ", combined AS (...)" dans le même WITH.
        sql = _POP_CTE.rstrip() + f",\n{combined_cte}\nSELECT * FROM combined cb WHERE 1=1"

    if familles:
        sql += " AND cb.code_famille = ANY(CAST(:familles AS text[]))"; params["familles"] = familles
    if types:
        sql += " AND cb.code_type_conge = ANY(CAST(:types AS text[]))"; params["types"] = types
    if statuts:
        sql += " AND lower(cb.statut) = ANY(CAST(:statuts AS text[]))"; params["statuts"] = [s.lower() for s in statuts]
    if uo_ids:
        sql += _UO_FILTRE; params["uo_ids"] = uo_ids
    if date_min:
        sql += " AND COALESCE(cb.date_fin_absence, cb.date_debut) >= :dmin"; params["dmin"] = date_min
    if date_max:
        sql += " AND cb.date_debut <= :dmax"; params["dmax"] = date_max
    if q:
        sql += """ AND (cb.demandeur_nom ILIKE :q OR cb.demandeur_prenom ILIKE :q OR cb.demandeur_matricule ILIKE :q
                        OR (cb.demandeur_nom || ' ' || cb.demandeur_prenom) ILIKE :q)"""
        params["q"] = f"%{q}%"

    sql += " ORDER BY cb.date_debut DESC NULLS LAST"

    rows = db.execute(text(sql), params).mappings().all()
    return {
        "scope": "tous" if voit_tout else ("equipe" if moi else "aucun"),
        "total": len(rows),
        "conges": [
            {**dict(r), "statut": (r["statut"] or "").lower(), "periodes_traitement": r["periodes_traitement"] or []}
            for r in rows
        ],
    }


@router.get("/uos")
def uos_perimetre(
    role_actif: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """UO du perimetre (pour le filtre). admin/RH -> toutes ; sinon -> uo_tree.

    RG-MULTISOCIETE-08 : PAS de filtre société ajouté ici -- la structure de
    `unites_organisationnelles` (societe_id direct ? via un établissement ?)
    n'est pas connue (modèle non fourni). Risque résiduel documenté : cet
    endpoint peut remonter des UO d'autres sociétés tant que ce point n'est
    pas tranché avec Adil.
    """
    user_id = payload.get("sub")
    role = _effective_role(db, user_id, payload, role_actif)

    if _voit_tout(role):
        rows = db.execute(text("""
            SELECT id, parent_id, libelle, code, niveau
            FROM unites_organisationnelles
            WHERE actif IS NOT FALSE
            ORDER BY niveau, libelle
        """)).mappings().all()
        return [dict(r) for r in rows]

    moi = _moi(db, user_id)
    rows = db.execute(text(_POP_CTE + """
        SELECT DISTINCT uo.id, uo.parent_id, uo.libelle, uo.code, uo.niveau
        FROM unites_organisationnelles uo
        WHERE uo.actif IS NOT FALSE
          AND uo.id IN (SELECT id FROM uo_tree)
        ORDER BY uo.niveau, uo.libelle
    """), {"moi": str(moi) if moi else None}).mappings().all()
    return [dict(r) for r in rows]


@router.get("/types")
def types_conges(
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """Types de conge avec couleur resolue (type sinon famille) + libelle famille.
    Evite au front de dependre du proxy /db (qui rejette certaines requetes)."""
    rows = db.execute(text("""
        SELECT t.code, t.libelle, t.code_famille,
               f.couleur AS couleur,
               f.libelle AS famille_libelle,
               t.ordre
        FROM ref_type_conge t
        LEFT JOIN ref_famille_conge f ON f.code = t.code_famille
        WHERE t.actif IS NOT FALSE
        ORDER BY t.libelle
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.get("/familles")
def familles_conges(
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """Familles de conge avec couleur."""
    rows = db.execute(text("""
        SELECT code, libelle, couleur
        FROM ref_famille_conge
        ORDER BY libelle
    """)).mappings().all()
    return [dict(r) for r in rows]
