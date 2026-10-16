"""Générateur d'états personnalisés — endpoints FastAPI.

Emplacement : personahub-api/app/routers/etats.py
Enregistré dans main.py (déjà en place, inchangé) :
    from app.routers import etats as etats_router
    app.include_router(etats_router.router, prefix=PREFIX)
    app.include_router(etats_router.ecrans_router, prefix=PREFIX)

Reconstruit à partir de 3 sources de vérité déjà en place et non modifiées
dans cette reconstruction :
  - app/schemas/etat.py        → tous les schémas Pydantic (déjà existants)
  - app/services/rapport_generateur_engine.py → rendu HTML/PDF (déjà existant,
    non modifié : _charger_configuration_etat lit exactement les tables
    gérées ici)
  - personahub-hr/src/pages/configuration/Editions/EtatNouveauPage.tsx et
    EtatsPage.tsx → contrat exact des routes, méthodes et payloads (le
    frontend était déjà fini et attendait ce router)

Tables manipulées, toutes déjà existantes en base (aucune migration requise
pour ce fichier) : etat_definition, etat_champ_selection, etat_corps,
etat_corps_colonne, etat_corps_rubrique, etat_corps_rubrique_colonne,
etat_corps_ligne_speciale, etat_bloc, etat_bloc_rubrique,
etat_bloc_colonne_total, etat_ecran_association, ref_type_source_etat,
ref_champ_disponible_etat, ref_modele_etat, ecran_lancement.

Accès DB en SQL brut (text()), cohérent avec le style déjà en place dans
rapport_engine.py / rapport_grille_engine.py / rapport_generateur_engine.py
pour ce même module — pas de couche ORM introduite ici.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    get_current_user_payload,
    get_societe_active_id,
    require_roles,
    roles_from_payload,
)

from app.schemas.etat import (
    ChampDisponible,
    ChampDisponibleCreate,
    ChampDisponibleUpdate,
    EcranLancementOut,
    EtatBlocColonneTotalIn,
    EtatBlocCreate,
    EtatBlocDetail,
    EtatBlocOut,
    EtatBlocRubriqueIn,
    EtatBlocUpdate,
    EtatChampSelectionIn,
    EtatCorpsColonneIn,
    EtatCorpsCreate,
    EtatCorpsDetail,
    EtatCorpsLigneSpecialeIn,
    EtatCorpsOut,
    EtatCorpsRubriqueIn,
    EtatCorpsUpdate,
    EtatDefinitionCreate,
    EtatDefinitionDetail,
    EtatDefinitionOut,
    EtatDefinitionUpdate,
    EtatEcranAssociationIn,
    EtatMetadonnees,
    FormatSortieEtat,
    ModeDonneeChamp,
    ModeleEtatOut,
    OptionMetadonnee,
    StatutEtat,
    TypeSourceEtatCreate,
    TypeSourceEtatUpdate,
    TypeSourceEtatOut,
    VisibiliteEtat,
)
from app.services import rapport_generateur_engine

router = APIRouter(prefix="/etats", tags=["états"])
ecrans_router = APIRouter(prefix="/ecrans", tags=["états - écrans"])


# --------------------------------------------------------------------------
# Auth / rôles — même pattern que app/routers/requeteur.py
# --------------------------------------------------------------------------
# RG-ETAT-SECU-01 (Adil DAIA) : rôles lus par roles_from_payload(), source unique
# de app.core.security (union de "role", "roles" et "all_roles"). L'ancienne
# lecture ignorait la clé "roles".
def _roles(payload: dict) -> list[str]:
    return sorted(roles_from_payload(payload))


# RG-ETAT-SECU-02 (Adil DAIA) : rôles autorisés à produire un document de paie
# depuis le générateur. Même liste que PAIE_ROLES (paie_calcul.py), recopiée ici
# pour ne pas importer le router de paie (312 Ko) dans ce module.
ROLES_RENDU_PAIE = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")


def _est_admin(payload: dict) -> bool:
    return "administrateur" in _roles(payload)


def _user_id(payload: dict):
    uid = payload.get("user_id") or payload.get("sub")
    return uuid.UUID(uid) if isinstance(uid, str) else uid


def _nouvel_id() -> str:
    return str(uuid.uuid4())


# --------------------------------------------------------------------------
# Accès / visibilité sur un état
# --------------------------------------------------------------------------
def _charger_etat_base(db: Session, etat_id: uuid.UUID) -> dict:
    etat = db.execute(
        text("SELECT * FROM public.etat_definition WHERE id = :id"),
        {"id": str(etat_id)},
    ).mappings().first()
    if etat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "État introuvable")
    return dict(etat)


def _verifier_lecture(etat: dict, payload: dict) -> None:
    if _est_admin(payload):
        return
    if etat["cree_par_user_id"] and str(etat["cree_par_user_id"]) == str(_user_id(payload)):
        return
    if etat["visibilite"] == "GLOBAL":
        return
    # RG-ETAT-SECU-03 (Adil DAIA) : le claim JWT est "societe_active_id" (cf.
    # get_societe_active_id) ; l'ancienne lecture de "societe_id" rendait la
    # visibilité SOCIETE inopérante.
    societe_active = payload.get("societe_active_id") or payload.get("societe_id")
    if etat["visibilite"] == "SOCIETE" and societe_active and etat["societe_id"] and \
            str(etat["societe_id"]) == str(societe_active):
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Accès non autorisé à cet état")


def _verifier_ecriture(etat: dict, payload: dict) -> None:
    if _est_admin(payload):
        return
    if etat["cree_par_user_id"] and str(etat["cree_par_user_id"]) == str(_user_id(payload)):
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Seul le créateur ou un administrateur peut modifier cet état")


def _get_etat_ou_404(db: Session, etat_id: uuid.UUID, payload: dict, ecriture: bool = False) -> dict:
    etat = _charger_etat_base(db, etat_id)
    (_verifier_ecriture if ecriture else _verifier_lecture)(etat, payload)
    return etat


def _get_corps_ou_404(db: Session, etat_id: uuid.UUID, corps_id: uuid.UUID) -> dict:
    corps = db.execute(
        text("SELECT * FROM public.etat_corps WHERE id = :cid AND etat_id = :eid"),
        {"cid": str(corps_id), "eid": str(etat_id)},
    ).mappings().first()
    if corps is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Corps introuvable pour cet état")
    return dict(corps)


def _get_bloc_ou_404(db: Session, corps_id: uuid.UUID, bloc_id: uuid.UUID) -> dict:
    bloc = db.execute(
        text("SELECT * FROM public.etat_bloc WHERE id = :bid AND etat_corps_id = :cid"),
        {"bid": str(bloc_id), "cid": str(corps_id)},
    ).mappings().first()
    if bloc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bloc introuvable pour ce corps")
    return dict(bloc)


# --------------------------------------------------------------------------
# Métadonnées / référentiels (lecture seule, utilisés par l'assistant)
# --------------------------------------------------------------------------
@router.get("/metadonnees", response_model=EtatMetadonnees)
def metadonnees():
    return EtatMetadonnees(
        statuts=[
            OptionMetadonnee(code="BROUILLON", libelle="Brouillon"),
            OptionMetadonnee(code="PUBLIE", libelle="Publié"),
            OptionMetadonnee(code="ARCHIVE", libelle="Archivé"),
        ],
        visibilites=[
            OptionMetadonnee(code="PRIVE", libelle="Privé"),
            OptionMetadonnee(code="SOCIETE", libelle="Société"),
            OptionMetadonnee(code="GLOBAL", libelle="Global"),
        ],
        formats_sortie=[
            OptionMetadonnee(code="PDF", libelle="PDF"),
            OptionMetadonnee(code="EXCEL", libelle="Excel"),
            OptionMetadonnee(code="LES_DEUX", libelle="PDF et Excel"),
        ],
        modes_donnee=[
            OptionMetadonnee(code="PERIODE", libelle="Figé à la période"),
            OptionMetadonnee(code="ACTUEL", libelle="Valeur actuelle"),
        ],
    )


@router.get("/types-source", response_model=list[TypeSourceEtatOut])
def lister_types_source(db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT code, libelle, contexte_requis, actif FROM public.ref_type_source_etat "
             "WHERE actif = true ORDER BY libelle")
    ).mappings().all()
    return [TypeSourceEtatOut(**r) for r in rows]


@router.post("/types-source", response_model=TypeSourceEtatOut, status_code=status.HTTP_201_CREATED)
def creer_type_source(
    body: TypeSourceEtatCreate,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    if not _est_admin(payload):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé aux administrateurs")
    existe = db.execute(
        text("SELECT 1 FROM public.ref_type_source_etat WHERE code = :c"), {"c": body.code}
    ).first()
    if existe:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Le code '{body.code}' existe déjà")
    db.execute(
        text("INSERT INTO public.ref_type_source_etat (code, libelle, contexte_requis, actif) "
             "VALUES (:code, :libelle, CAST(:ctx AS jsonb), true)"),
        {"code": body.code, "libelle": body.libelle, "ctx": _vers_json(body.contexte_requis)},
    )
    db.commit()
    return TypeSourceEtatOut(code=body.code, libelle=body.libelle, contexte_requis=body.contexte_requis, actif=True)


@router.patch("/types-source/{code}", response_model=TypeSourceEtatOut)
def modifier_type_source(
    code: str,
    body: TypeSourceEtatUpdate,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    if not _est_admin(payload):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé aux administrateurs")
    champs = body.model_dump(exclude_unset=True)
    if "contexte_requis" in champs:
        champs["contexte_requis"] = _vers_json(champs["contexte_requis"])
    if champs:
        assignations = ", ".join(
            f"{k} = CAST(:{k} AS jsonb)" if k == "contexte_requis" else f"{k} = :{k}"
            for k in champs
        )
        db.execute(
            text(f"UPDATE public.ref_type_source_etat SET {assignations} WHERE code = :code"),
            {**champs, "code": code},
        )
        db.commit()
    row = db.execute(
        text("SELECT code, libelle, contexte_requis, actif FROM public.ref_type_source_etat WHERE code = :c"),
        {"c": code},
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Type source introuvable")
    return TypeSourceEtatOut(**row)


@router.get("/modeles", response_model=list[ModeleEtatOut])
def lister_modeles(type_source: Optional[str] = Query(default=None), db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT code, libelle, type_source_compatible, actif FROM public.ref_modele_etat "
             "WHERE actif = true ORDER BY libelle")
    ).mappings().all()
    modeles = [ModeleEtatOut(**r) for r in rows]
    if type_source:
        modeles = [m for m in modeles if type_source in m.type_source_compatible]
    return modeles


@router.get("/champs-disponibles", response_model=list[ChampDisponible])
def lister_champs_disponibles(type_source: str = Query(...), db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT champ_code, libelle, mode_donnee_defaut FROM public.ref_champ_disponible_etat "
             "WHERE type_source_code = :ts AND actif = true ORDER BY ordre_affichage"),
        {"ts": type_source},
    ).mappings().all()
    return [ChampDisponible(**r) for r in rows]


@router.post("/champs-disponibles", status_code=status.HTTP_201_CREATED)
def creer_champ_disponible(
    type_source: str = Query(...),
    body: ChampDisponibleCreate = ...,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    if not _est_admin(payload):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé aux administrateurs")
    db.execute(
        text("INSERT INTO public.ref_champ_disponible_etat "
             "(id, type_source_code, champ_code, libelle, mode_donnee_defaut, ordre_affichage, actif) "
             "VALUES (:id, :ts, :code, :libelle, :mode, :ordre, true)"),
        {"id": _nouvel_id(), "ts": type_source, "code": body.champ_code, "libelle": body.libelle,
         "mode": body.mode_donnee_defaut.value, "ordre": body.ordre_affichage},
    )
    db.commit()
    return {"ok": True}


def _vers_json(valeur) -> str:
    import json
    return json.dumps(valeur)


# --------------------------------------------------------------------------
# Écrans de lancement (router séparé, prefix /ecrans — top-level)
# --------------------------------------------------------------------------
@ecrans_router.get("", response_model=list[EcranLancementOut])
def lister_ecrans(db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT code_ecran, libelle, contexte_disponible, chemin_route, actif "
             "FROM public.ecran_lancement WHERE actif = true ORDER BY libelle")
    ).mappings().all()
    return [EcranLancementOut(**r) for r in rows]


# --------------------------------------------------------------------------
# Catalogue etat_definition
# --------------------------------------------------------------------------
@router.get("", response_model=list[EtatDefinitionOut])
def lister_etats(db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload)):
    rows = db.execute(text("SELECT * FROM public.etat_definition ORDER BY updated_at DESC")).mappings().all()
    etats = [dict(r) for r in rows]
    if _est_admin(payload):
        return etats
    uid = str(_user_id(payload))
    societe_id = payload.get("societe_id")
    resultat = []
    for e in etats:
        if e["statut"] == "ARCHIVE" and str(e["cree_par_user_id"]) != uid:
            continue
        if e["visibilite"] == "GLOBAL":
            resultat.append(e)
        elif str(e["cree_par_user_id"]) == uid:
            resultat.append(e)
        elif e["visibilite"] == "SOCIETE" and societe_id and str(e["societe_id"]) == str(societe_id):
            resultat.append(e)
    return resultat


@router.get("/{etat_id}", response_model=EtatDefinitionDetail)
def detail_etat(etat_id: uuid.UUID, db: Session = Depends(get_db),
                 payload: dict = Depends(get_current_user_payload)):
    etat = _get_etat_ou_404(db, etat_id, payload)
    champs = db.execute(
        text("SELECT champ_code, visible, ordre_affichage, mode_donnee FROM public.etat_champ_selection "
             "WHERE etat_id = :id ORDER BY ordre_affichage"),
        {"id": str(etat_id)},
    ).mappings().all()
    ecrans = db.execute(
        text("SELECT code_ecran FROM public.etat_ecran_association WHERE etat_id = :id "
             "ORDER BY ordre_affichage"),
        {"id": str(etat_id)},
    ).scalars().all()
    return EtatDefinitionDetail(**etat, champs=list(champs), ecrans=list(ecrans))


@router.post("", status_code=status.HTTP_201_CREATED)
def creer_etat(
    body: EtatDefinitionCreate,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    existe = db.execute(
        text("SELECT 1 FROM public.etat_definition WHERE code = :c"), {"c": body.code}
    ).first()
    if existe:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Le code '{body.code}' existe déjà")

    nouvel_id = _nouvel_id()
    db.execute(
        text(
            """
            INSERT INTO public.etat_definition
                (id, code, nom, description, societe_id, type_source, modele_code,
                 template_html, pied_de_page_html, afficher_logo, format_sortie,
                 statut, visibilite, cree_par_user_id)
            VALUES
                (:id, :code, :nom, :description, :societe_id, :type_source, :modele_code,
                 :template_html, :pied_de_page_html, :afficher_logo, :format_sortie,
                 'BROUILLON', :visibilite, :cree_par)
            """
        ),
        {
            "id": nouvel_id, "code": body.code, "nom": body.nom, "description": body.description,
            "societe_id": str(body.societe_id) if body.societe_id else None,
            "type_source": body.type_source, "modele_code": body.modele_code,
            "template_html": body.template_html, "pied_de_page_html": body.pied_de_page_html,
            "afficher_logo": body.afficher_logo, "format_sortie": body.format_sortie.value,
            "visibilite": body.visibilite.value, "cree_par": str(_user_id(payload)),
        },
    )
    db.commit()
    return {"id": nouvel_id}


@router.patch("/{etat_id}", response_model=EtatDefinitionOut)
def modifier_etat(
    etat_id: uuid.UUID,
    body: EtatDefinitionUpdate,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    champs = body.model_dump(exclude_unset=True)
    if champs:
        for enum_champ in ("format_sortie", "visibilite", "statut"):
            if enum_champ in champs and champs[enum_champ] is not None:
                champs[enum_champ] = champs[enum_champ].value if hasattr(champs[enum_champ], "value") else champs[enum_champ]
        assignations = ", ".join(f"{k} = :{k}" for k in champs)
        db.execute(
            text(f"UPDATE public.etat_definition SET {assignations}, updated_at = now() WHERE id = :id"),
            {**champs, "id": str(etat_id)},
        )
        db.commit()
    return dict(_charger_etat_base(db, etat_id))


@router.delete("/{etat_id}", status_code=status.HTTP_204_NO_CONTENT)
def archiver_etat(etat_id: uuid.UUID, db: Session = Depends(get_db),
                   payload: dict = Depends(get_current_user_payload)):
    """Archivage logique (le bouton « Archiver » du frontend) — jamais de
    suppression physique, pour ne pas perdre un état déjà référencé par un
    écran de lancement ou un historique de génération."""
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    db.execute(
        text("UPDATE public.etat_definition SET statut = 'ARCHIVE', updated_at = now() WHERE id = :id"),
        {"id": str(etat_id)},
    )
    db.commit()


# --------------------------------------------------------------------------
# etat_champ_selection — remplacement complet de la liste
# --------------------------------------------------------------------------
@router.put("/{etat_id}/champs", status_code=status.HTTP_204_NO_CONTENT)
def remplacer_champs(
    etat_id: uuid.UUID,
    champs: list[EtatChampSelectionIn],
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    db.execute(text("DELETE FROM public.etat_champ_selection WHERE etat_id = :id"), {"id": str(etat_id)})
    for c in champs:
        db.execute(
            text("INSERT INTO public.etat_champ_selection "
                 "(id, etat_id, champ_code, visible, ordre_affichage, mode_donnee) "
                 "VALUES (:id, :etat_id, :champ_code, :visible, :ordre, :mode)"),
            {"id": _nouvel_id(), "etat_id": str(etat_id), "champ_code": c.champ_code,
             "visible": c.visible, "ordre": c.ordre_affichage, "mode": c.mode_donnee.value},
        )
    db.commit()


# --------------------------------------------------------------------------
# etat_corps
# --------------------------------------------------------------------------
@router.get("/{etat_id}/corps", response_model=list[EtatCorpsDetail])
def lister_corps(etat_id: uuid.UUID, db: Session = Depends(get_db),
                  payload: dict = Depends(get_current_user_payload)):
    _get_etat_ou_404(db, etat_id, payload)
    corps_rows = db.execute(
        text("SELECT * FROM public.etat_corps WHERE etat_id = :id ORDER BY ordre_affichage"),
        {"id": str(etat_id)},
    ).mappings().all()

    resultat = []
    for c in corps_rows:
        colonnes = db.execute(
            text("SELECT id, code_colonne, libelle, format, ordre_affichage FROM public.etat_corps_colonne "
                 "WHERE etat_corps_id = :id ORDER BY ordre_affichage"),
            {"id": c["id"]},
        ).mappings().all()

        rubriques_rows = db.execute(
            text("SELECT r.id, r.rubrique_paie_code, r.ordre_affichage, r.libelle_personnalise, "
                 "rp.libelle AS libelle_rubrique "
                 "FROM public.etat_corps_rubrique r "
                 "LEFT JOIN public.rubrique_paie rp ON rp.code = r.rubrique_paie_code "
                 "WHERE r.etat_corps_id = :id ORDER BY r.ordre_affichage"),
            {"id": c["id"]},
        ).mappings().all()
        rubriques = []
        for r in rubriques_rows:
            mappings = db.execute(
                text("SELECT m.attribut, col.code_colonne FROM public.etat_corps_rubrique_colonne m "
                     "JOIN public.etat_corps_colonne col ON col.id = m.etat_corps_colonne_id "
                     "WHERE m.etat_corps_rubrique_id = :rid"),
                {"rid": r["id"]},
            ).mappings().all()
            rubriques.append({
                "id": r["id"], "rubrique_paie_code": r["rubrique_paie_code"],
                "libelle": r["libelle_rubrique"], "libelle_personnalise": r["libelle_personnalise"],
                "ordre_affichage": r["ordre_affichage"],
                "mappings": [dict(m) for m in mappings],
            })

        lignes_speciales = db.execute(
            text("SELECT l.id, l.code_constante, l.libelle, col.code_colonne, l.ordre_affichage "
                 "FROM public.etat_corps_ligne_speciale l "
                 "LEFT JOIN public.etat_corps_colonne col ON col.id = l.etat_corps_colonne_id "
                 "WHERE l.etat_corps_id = :id ORDER BY l.ordre_affichage"),
            {"id": c["id"]},
        ).mappings().all()

        resultat.append(EtatCorpsDetail(
            **{k: v for k, v in c.items()},
            colonnes=list(colonnes), rubriques=rubriques, lignes_speciales=list(lignes_speciales),
        ))
    return resultat


@router.post("/{etat_id}/corps", status_code=status.HTTP_201_CREATED)
def creer_corps(
    etat_id: uuid.UUID,
    body: EtatCorpsCreate,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    nouvel_id = _nouvel_id()
    db.execute(
        text(
            """
            INSERT INTO public.etat_corps
                (id, etat_id, corps_code, libelle, ordre_affichage, visible,
                 couleur_fond, couleur_texte, police, taille_police, gras)
            VALUES
                (:id, :etat_id, :corps_code, :libelle, :ordre, :visible,
                 :couleur_fond, :couleur_texte, :police, :taille_police, :gras)
            """
        ),
        {"id": nouvel_id, "etat_id": str(etat_id), "corps_code": body.corps_code, "libelle": body.libelle,
         "ordre": body.ordre_affichage, "visible": body.visible, "couleur_fond": body.couleur_fond,
         "couleur_texte": body.couleur_texte, "police": body.police,
         "taille_police": body.taille_police, "gras": body.gras},
    )
    db.commit()
    return {"id": nouvel_id}


@router.patch("/{etat_id}/corps/{corps_id}", response_model=EtatCorpsOut)
def modifier_corps(
    etat_id: uuid.UUID, corps_id: uuid.UUID, body: EtatCorpsUpdate,
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    champs = body.model_dump(exclude_unset=True)
    if champs:
        assignations = ", ".join(f"{k} = :{k}" for k in champs)
        db.execute(
            text(f"UPDATE public.etat_corps SET {assignations}, updated_at = now() WHERE id = :id"),
            {**champs, "id": str(corps_id)},
        )
        db.commit()
    return dict(_get_corps_ou_404(db, etat_id, corps_id))


@router.delete("/{etat_id}/corps/{corps_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_corps(
    etat_id: uuid.UUID, corps_id: uuid.UUID,
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    _purger_corps(db, corps_id)
    db.execute(text("DELETE FROM public.etat_corps WHERE id = :id"), {"id": str(corps_id)})
    db.commit()


def _purger_corps(db: Session, corps_id) -> None:
    """Supprime dans l'ordre correct (enfants avant parents) — les FK de ce
    schéma n'ont pas de ON DELETE CASCADE confirmé."""
    bloc_ids = db.execute(
        text("SELECT id FROM public.etat_bloc WHERE etat_corps_id = :id"), {"id": str(corps_id)}
    ).scalars().all()
    for bid in bloc_ids:
        _purger_bloc(db, bid)
    db.execute(text("DELETE FROM public.etat_bloc WHERE etat_corps_id = :id"), {"id": str(corps_id)})

    rub_ids = db.execute(
        text("SELECT id FROM public.etat_corps_rubrique WHERE etat_corps_id = :id"), {"id": str(corps_id)}
    ).scalars().all()
    if rub_ids:
        db.execute(
            text("DELETE FROM public.etat_corps_rubrique_colonne WHERE etat_corps_rubrique_id = ANY(:ids)"),
            {"ids": [str(i) for i in rub_ids]},
        )
    db.execute(text("DELETE FROM public.etat_corps_rubrique WHERE etat_corps_id = :id"), {"id": str(corps_id)})
    db.execute(text("DELETE FROM public.etat_corps_ligne_speciale WHERE etat_corps_id = :id"), {"id": str(corps_id)})
    db.execute(text("DELETE FROM public.etat_corps_colonne WHERE etat_corps_id = :id"), {"id": str(corps_id)})


def _purger_bloc(db: Session, bloc_id) -> None:
    db.execute(text("DELETE FROM public.etat_bloc_rubrique WHERE etat_bloc_id = :id"), {"id": str(bloc_id)})
    db.execute(text("DELETE FROM public.etat_bloc_colonne_total WHERE etat_bloc_id = :id"), {"id": str(bloc_id)})


# --------------------------------------------------------------------------
# etat_corps_colonne — remplacement complet de la liste
# --------------------------------------------------------------------------
@router.put("/{etat_id}/corps/{corps_id}/colonnes", status_code=status.HTTP_204_NO_CONTENT)
def remplacer_colonnes(
    etat_id: uuid.UUID, corps_id: uuid.UUID, colonnes: list[EtatCorpsColonneIn],
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    # Les mappings (etat_corps_rubrique_colonne) et lignes spéciales référencent
    # les colonnes par id -- on les purge avant de remplacer les colonnes,
    # le frontend les renvoie de toute façon après (ordre : colonnes → rubriques).
    rub_ids = db.execute(
        text("SELECT id FROM public.etat_corps_rubrique WHERE etat_corps_id = :id"), {"id": str(corps_id)}
    ).scalars().all()
    if rub_ids:
        db.execute(
            text("DELETE FROM public.etat_corps_rubrique_colonne WHERE etat_corps_rubrique_id = ANY(:ids)"),
            {"ids": [str(i) for i in rub_ids]},
        )
    db.execute(text("DELETE FROM public.etat_bloc_colonne_total WHERE etat_bloc_id IN "
                     "(SELECT id FROM public.etat_bloc WHERE etat_corps_id = :id)"), {"id": str(corps_id)})
    db.execute(text("UPDATE public.etat_corps_ligne_speciale SET etat_corps_colonne_id = NULL "
                     "WHERE etat_corps_id = :id"), {"id": str(corps_id)})
    db.execute(text("DELETE FROM public.etat_corps_colonne WHERE etat_corps_id = :id"), {"id": str(corps_id)})

    for col in colonnes:
        db.execute(
            text("INSERT INTO public.etat_corps_colonne (id, etat_corps_id, code_colonne, libelle, format, ordre_affichage) "
                 "VALUES (:id, :corps_id, :code_colonne, :libelle, :format, :ordre)"),
            {"id": _nouvel_id(), "corps_id": str(corps_id), "code_colonne": col.code_colonne,
             "libelle": col.libelle, "format": col.format.value, "ordre": col.ordre_affichage},
        )
    db.commit()


def _colonne_id(db: Session, corps_id, code_colonne: Optional[str]):
    if not code_colonne:
        return None
    row = db.execute(
        text("SELECT id FROM public.etat_corps_colonne WHERE etat_corps_id = :cid AND code_colonne = :code"),
        {"cid": str(corps_id), "code": code_colonne},
    ).first()
    return str(row[0]) if row else None


def _rubrique_id(db: Session, corps_id, rubrique_paie_code: str):
    row = db.execute(
        text("SELECT id FROM public.etat_corps_rubrique WHERE etat_corps_id = :cid AND rubrique_paie_code = :code"),
        {"cid": str(corps_id), "code": rubrique_paie_code},
    ).first()
    return str(row[0]) if row else None


# --------------------------------------------------------------------------
# etat_corps_rubrique (+ mappings) — remplacement complet de la liste
# --------------------------------------------------------------------------
@router.put("/{etat_id}/corps/{corps_id}/rubriques", status_code=status.HTTP_204_NO_CONTENT)
def remplacer_rubriques(
    etat_id: uuid.UUID, corps_id: uuid.UUID, rubriques: list[EtatCorpsRubriqueIn],
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)

    # Les associations de bloc référencent les rubriques par id -- purgées
    # ici ; le frontend renvoie toujours les blocs juste après (par
    # rubrique_paie_code, pas par id), donc rien n'est perdu côté client.
    db.execute(text("DELETE FROM public.etat_bloc_rubrique WHERE etat_bloc_id IN "
                     "(SELECT id FROM public.etat_bloc WHERE etat_corps_id = :id)"), {"id": str(corps_id)})
    rub_ids = db.execute(
        text("SELECT id FROM public.etat_corps_rubrique WHERE etat_corps_id = :id"), {"id": str(corps_id)}
    ).scalars().all()
    if rub_ids:
        db.execute(
            text("DELETE FROM public.etat_corps_rubrique_colonne WHERE etat_corps_rubrique_id = ANY(:ids)"),
            {"ids": [str(i) for i in rub_ids]},
        )
    db.execute(text("DELETE FROM public.etat_corps_rubrique WHERE etat_corps_id = :id"), {"id": str(corps_id)})

    for r in rubriques:
        rub_id = _nouvel_id()
        db.execute(
            text("INSERT INTO public.etat_corps_rubrique "
                 "(id, etat_corps_id, rubrique_paie_code, ordre_affichage, libelle_personnalise) "
                 "VALUES (:id, :corps_id, :code, :ordre, :libelle_perso)"),
            {"id": rub_id, "corps_id": str(corps_id), "code": r.rubrique_paie_code,
             "ordre": r.ordre_affichage, "libelle_perso": r.libelle_personnalise},
        )
        for m in r.mappings:
            col_id = _colonne_id(db, corps_id, m.code_colonne)
            if col_id is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                     f"Colonne inconnue sur ce corps : {m.code_colonne}")
            db.execute(
                text("INSERT INTO public.etat_corps_rubrique_colonne "
                     "(id, etat_corps_rubrique_id, attribut, etat_corps_colonne_id) "
                     "VALUES (:id, :rid, :attribut, :col_id)"),
                {"id": _nouvel_id(), "rid": rub_id, "attribut": m.attribut.value, "col_id": col_id},
            )
    db.commit()


# --------------------------------------------------------------------------
# etat_corps_ligne_speciale — remplacement complet de la liste
# --------------------------------------------------------------------------
@router.put("/{etat_id}/corps/{corps_id}/lignes-speciales", status_code=status.HTTP_204_NO_CONTENT)
def remplacer_lignes_speciales(
    etat_id: uuid.UUID, corps_id: uuid.UUID, lignes: list[EtatCorpsLigneSpecialeIn],
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    db.execute(text("DELETE FROM public.etat_corps_ligne_speciale WHERE etat_corps_id = :id"),
               {"id": str(corps_id)})
    for l in lignes:
        col_id = _colonne_id(db, corps_id, l.code_colonne)
        db.execute(
            text("INSERT INTO public.etat_corps_ligne_speciale "
                 "(id, etat_corps_id, code_constante, libelle, etat_corps_colonne_id, ordre_affichage) "
                 "VALUES (:id, :corps_id, :code_constante, :libelle, :col_id, :ordre)"),
            {"id": _nouvel_id(), "corps_id": str(corps_id), "code_constante": l.code_constante,
             "libelle": l.libelle, "col_id": col_id, "ordre": l.ordre_affichage},
        )
    db.commit()


# --------------------------------------------------------------------------
# etat_bloc
# --------------------------------------------------------------------------
@router.get("/{etat_id}/corps/{corps_id}/blocs", response_model=list[EtatBlocDetail])
def lister_blocs(etat_id: uuid.UUID, corps_id: uuid.UUID, db: Session = Depends(get_db),
                  payload: dict = Depends(get_current_user_payload)):
    _get_etat_ou_404(db, etat_id, payload)
    _get_corps_ou_404(db, etat_id, corps_id)
    blocs = db.execute(
        text("SELECT * FROM public.etat_bloc WHERE etat_corps_id = :id ORDER BY ordre_affichage"),
        {"id": str(corps_id)},
    ).mappings().all()
    resultat = []
    for b in blocs:
        rubriques = db.execute(
            text("SELECT cr.rubrique_paie_code FROM public.etat_bloc_rubrique br "
                 "JOIN public.etat_corps_rubrique cr ON cr.id = br.etat_corps_rubrique_id "
                 "WHERE br.etat_bloc_id = :id ORDER BY br.ordre_affichage"),
            {"id": b["id"]},
        ).mappings().all()
        colonnes_total = db.execute(
            text("SELECT col.code_colonne FROM public.etat_bloc_colonne_total bct "
                 "JOIN public.etat_corps_colonne col ON col.id = bct.etat_corps_colonne_id "
                 "WHERE bct.etat_bloc_id = :id"),
            {"id": b["id"]},
        ).mappings().all()
        resultat.append(EtatBlocDetail(
            **dict(b), rubriques=list(rubriques), colonnes_total=list(colonnes_total),
        ))
    return resultat


@router.post("/{etat_id}/corps/{corps_id}/blocs", status_code=status.HTTP_201_CREATED)
def creer_bloc(
    etat_id: uuid.UUID, corps_id: uuid.UUID, body: EtatBlocCreate,
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    nouvel_id = _nouvel_id()
    db.execute(
        text(
            """
            INSERT INTO public.etat_bloc
                (id, etat_corps_id, bloc_code, libelle, ordre_affichage, visible,
                 couleur_fond, couleur_texte, police, taille_police, gras,
                 position_libelle, position_total)
            VALUES
                (:id, :corps_id, :bloc_code, :libelle, :ordre, :visible,
                 :couleur_fond, :couleur_texte, :police, :taille_police, :gras,
                 :position_libelle, :position_total)
            """
        ),
        {"id": nouvel_id, "corps_id": str(corps_id), "bloc_code": body.bloc_code, "libelle": body.libelle,
         "ordre": body.ordre_affichage, "visible": body.visible, "couleur_fond": body.couleur_fond,
         "couleur_texte": body.couleur_texte, "police": body.police, "taille_police": body.taille_police,
         "gras": body.gras, "position_libelle": body.position_libelle.value,
         "position_total": body.position_total.value},
    )
    db.commit()
    return {"id": nouvel_id}


@router.patch("/{etat_id}/corps/{corps_id}/blocs/{bloc_id}", response_model=EtatBlocOut)
def modifier_bloc(
    etat_id: uuid.UUID, corps_id: uuid.UUID, bloc_id: uuid.UUID, body: EtatBlocUpdate,
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    _get_bloc_ou_404(db, corps_id, bloc_id)
    champs = body.model_dump(exclude_unset=True)
    if champs:
        for enum_champ in ("position_libelle", "position_total"):
            if enum_champ in champs and champs[enum_champ] is not None:
                champs[enum_champ] = champs[enum_champ].value if hasattr(champs[enum_champ], "value") else champs[enum_champ]
        assignations = ", ".join(f"{k} = :{k}" for k in champs)
        db.execute(
            text(f"UPDATE public.etat_bloc SET {assignations}, updated_at = now() WHERE id = :id"),
            {**champs, "id": str(bloc_id)},
        )
        db.commit()
    return dict(_get_bloc_ou_404(db, corps_id, bloc_id))


@router.delete("/{etat_id}/corps/{corps_id}/blocs/{bloc_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_bloc(
    etat_id: uuid.UUID, corps_id: uuid.UUID, bloc_id: uuid.UUID,
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    _get_bloc_ou_404(db, corps_id, bloc_id)
    _purger_bloc(db, bloc_id)
    db.execute(text("DELETE FROM public.etat_bloc WHERE id = :id"), {"id": str(bloc_id)})
    db.commit()


@router.put("/{etat_id}/corps/{corps_id}/blocs/{bloc_id}/rubriques", status_code=status.HTTP_204_NO_CONTENT)
def remplacer_bloc_rubriques(
    etat_id: uuid.UUID, corps_id: uuid.UUID, bloc_id: uuid.UUID, rubriques: list[EtatBlocRubriqueIn],
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    _get_bloc_ou_404(db, corps_id, bloc_id)
    db.execute(text("DELETE FROM public.etat_bloc_rubrique WHERE etat_bloc_id = :id"), {"id": str(bloc_id)})
    for r in rubriques:
        rub_id = _rubrique_id(db, corps_id, r.rubrique_paie_code)
        if rub_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                 f"Rubrique inconnue sur ce corps : {r.rubrique_paie_code}")
        db.execute(
            text("INSERT INTO public.etat_bloc_rubrique (id, etat_bloc_id, etat_corps_rubrique_id, ordre_affichage) "
                 "VALUES (:id, :bloc_id, :rub_id, :ordre)"),
            {"id": _nouvel_id(), "bloc_id": str(bloc_id), "rub_id": rub_id, "ordre": r.ordre_affichage},
        )
    db.commit()


@router.put("/{etat_id}/corps/{corps_id}/blocs/{bloc_id}/colonnes-total", status_code=status.HTTP_204_NO_CONTENT)
def remplacer_bloc_colonnes_total(
    etat_id: uuid.UUID, corps_id: uuid.UUID, bloc_id: uuid.UUID, colonnes: list[EtatBlocColonneTotalIn],
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    _get_corps_ou_404(db, etat_id, corps_id)
    _get_bloc_ou_404(db, corps_id, bloc_id)
    db.execute(text("DELETE FROM public.etat_bloc_colonne_total WHERE etat_bloc_id = :id"), {"id": str(bloc_id)})
    for c in colonnes:
        col_id = _colonne_id(db, corps_id, c.code_colonne)
        if col_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Colonne inconnue sur ce corps : {c.code_colonne}")
        db.execute(
            text("INSERT INTO public.etat_bloc_colonne_total (id, etat_bloc_id, etat_corps_colonne_id) "
                 "VALUES (:id, :bloc_id, :col_id)"),
            {"id": _nouvel_id(), "bloc_id": str(bloc_id), "col_id": col_id},
        )
    db.commit()


# --------------------------------------------------------------------------
# etat_ecran_association
# --------------------------------------------------------------------------
@router.post("/{etat_id}/ecrans", status_code=status.HTTP_204_NO_CONTENT)
def ajouter_ecrans(
    etat_id: uuid.UUID, body: EtatEcranAssociationIn,
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    existants = set(db.execute(
        text("SELECT code_ecran FROM public.etat_ecran_association WHERE etat_id = :id"), {"id": str(etat_id)}
    ).scalars().all())
    ordre_max = db.execute(
        text("SELECT COALESCE(MAX(ordre_affichage), -1) FROM public.etat_ecran_association WHERE etat_id = :id"),
        {"id": str(etat_id)},
    ).scalar()
    for i, code_ecran in enumerate(body.codes_ecran):
        if code_ecran in existants:
            continue
        db.execute(
            text("INSERT INTO public.etat_ecran_association (id, etat_id, code_ecran, ordre_affichage) "
                 "VALUES (:id, :etat_id, :code_ecran, :ordre)"),
            {"id": _nouvel_id(), "etat_id": str(etat_id), "code_ecran": code_ecran,
             "ordre": ordre_max + 1 + i},
        )
    db.commit()


@router.delete("/{etat_id}/ecrans/{code_ecran}", status_code=status.HTTP_204_NO_CONTENT)
def retirer_ecran(
    etat_id: uuid.UUID, code_ecran: str,
    db: Session = Depends(get_db), payload: dict = Depends(get_current_user_payload),
):
    _get_etat_ou_404(db, etat_id, payload, ecriture=True)
    db.execute(
        text("DELETE FROM public.etat_ecran_association WHERE etat_id = :id AND code_ecran = :code"),
        {"id": str(etat_id), "code": code_ecran},
    )
    db.commit()


# --------------------------------------------------------------------------
# Rendu — délègue entièrement à rapport_generateur_engine.py (inchangé)
# --------------------------------------------------------------------------
@router.get("/{etat_id}/rendu")
def rendre_etat(
    etat_id: uuid.UUID,
    collaborateur_id: uuid.UUID = Query(...),
    periode_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    payload: dict = Depends(require_roles(*ROLES_RENDU_PAIE)),
    societe_id: str = Depends(get_societe_active_id),
):
    _get_etat_ou_404(db, etat_id, payload)
    # RG-ETAT-SECU-04 (Adil DAIA) : le bulletin demandé doit appartenir à la
    # société active (calendrier_paie.societe_id, RG-MULTISOCIETE-07), qu'il soit
    # encore dans `bulletin` ou déjà clôturé dans `bulletin_historique`.
    # Sans ce contrôle, un identifiant de collaborateur et de période suffisait
    # à imprimer le bulletin de n'importe quelle société. Réponse 404 (et non
    # 403) pour ne pas révéler l'existence d'un bulletin d'une autre société.
    appartient = db.execute(
        text(
            """
            SELECT 1 FROM public.bulletin b
            JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE b.collaborateur_id = :cid AND b.periode_id = :pid AND cal.societe_id = :sid
            UNION ALL
            SELECT 1 FROM public.bulletin_historique b
            JOIN public.calendrier_paie cal ON cal.id = b.periode_id
            WHERE b.collaborateur_id = :cid AND b.periode_id = :pid AND cal.societe_id = :sid
            LIMIT 1
            """
        ),
        {"cid": str(collaborateur_id), "pid": str(periode_id), "sid": str(societe_id)},
    ).first()
    if appartient is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Aucun bulletin pour ce collaborateur et cette période dans la société active",
        )
    try:
        contenu = rapport_generateur_engine.generer_pdf_etat_bulletin(db, etat_id, collaborateur_id, periode_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return Response(content=contenu, media_type="application/pdf")
