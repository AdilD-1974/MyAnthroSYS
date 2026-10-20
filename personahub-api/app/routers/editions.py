"""
app/routers/editions.py — API de la plateforme d'éditions unifiée (/api/v1/editions).
Auteur : Adil DAIA — lot 1 (16/10/2026)

Routeur mince : traduit HTTP ↔ app/editions/service.py, où vivent les règles
(RG-EDT-MODELE/VERSION/PROD/SECU/AUDIT). Accès au module par la matrice des
menus (menu « editions », migration 075) ; droits fins par modèle dans le service.

Enregistrement dans app/main.py :
    from app.routers import editions as editions_router
    app.include_router(editions_router.router, prefix=PREFIX)

Concurrence (RG-EDT-VERSION-03) : GET d'une version renvoie l'en-tête ETag = jeton ;
PUT et publier exigent If-Match avec ce jeton, sinon 409.
"""
from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from sqlalchemy import bindparam, text

from app.core.security import (get_current_user_payload, get_societe_active_id, require_menu_access,
                               roles_from_payload)
from app.editions import expressions as ex
from app.editions import ecrans as ec
from app.editions import service as sv
from app.editions import themes as th

router = APIRouter(prefix="/editions", tags=["Éditions"])


def utilisateur(payload: dict = Depends(require_menu_access("editions")),
                societe_id: str = Depends(get_societe_active_id)) -> sv.Utilisateur:
    return sv.Utilisateur(payload.get("sub"), str(societe_id), frozenset(roles_from_payload(payload)))


# RG-EDT-ECRAN-06 : les écrans métier (paie…) lancent les éditions sans exiger le menu
# « Éditions » : gestionnaires, administrateur, ou rôle ayant un menu d'édition métier.
ROLES_METIER = {"administrateur", "gestionnaire_rh", "gestionnaire_paie"}
MENUS_METIER = ("editions", "paie_edition_bulletins")


def utilisateur_metier(payload: dict = Depends(get_current_user_payload),
                       societe_id: str = Depends(get_societe_active_id),
                       db: Session = Depends(get_db)) -> sv.Utilisateur:
    roles = set(roles_from_payload(payload))
    if not roles & ROLES_METIER:
        ok = roles and db.execute(text("""SELECT 1 FROM menu_role mr JOIN menu_items m ON m.id = mr.menu_id
                                          WHERE m.code IN :menus AND m.actif = true AND mr.role IN :roles"""
                                       ).bindparams(bindparam("menus", expanding=True), bindparam("roles", expanding=True)),
                                  {"menus": list(MENUS_METIER), "roles": sorted(roles)}).first()
        if not ok:
            raise HTTPException(status_code=403, detail={"message": "Accès refusé aux éditions de cet écran"})
    return sv.Utilisateur(payload.get("sub"), str(societe_id), frozenset(roles))


def _http(e: sv.ErreurEdition) -> HTTPException:
    detail: Any = {"message": e.message}
    if e.details is not None:
        detail["details"] = e.details
    return HTTPException(status_code=e.statut, detail=detail)


def _ecriture(db: Session, fn, *args, **kwargs):
    """Exécute une écriture du service dans une transaction : commit si succès."""
    try:
        res = fn(db, *args, **kwargs)
        db.commit()
        return res
    except sv.ErreurEdition as e:
        # un échec de production reste tracé (demande en ECHEC) : on valide quand même
        db.commit() if e.conserver else db.rollback()
        raise _http(e)
    except Exception:
        db.rollback()
        raise


def _lecture(db: Session, fn, *args, **kwargs):
    try:
        return fn(db, *args, **kwargs)
    except sv.ErreurEdition as e:
        raise _http(e)


# ---------------------------------------------------------------- schémas d'entrée
class ModeleCreation(BaseModel):
    code: str = Field(min_length=2, max_length=60)
    libelle: str = Field(min_length=1, max_length=200)
    categorie: str = "AUTRE"
    description: Optional[str] = None
    visibilite: str = "PRIVE"
    definition: Optional[dict] = None
    origine_id: Optional[str] = None


class ModeleModification(BaseModel):
    libelle: Optional[str] = None
    description: Optional[str] = None
    categorie: Optional[str] = None
    visibilite: Optional[str] = None


class VersionEcriture(BaseModel):
    definition: dict
    note: Optional[str] = None


class Execution(BaseModel):
    parametres: dict = {}
    forme: Optional[str] = None               # mise en forme choisie (« Multiple modèle »)


class LancementEcran(BaseModel):
    modele_id: Optional[str] = None           # sinon le modèle par défaut de l'écran
    contexte: dict = {}                       # periode_id, collaborateur_id(s), bulletin_id, plan_paie_id…
    parametres: dict = {}                     # saisis à l'écran : priment sur le contexte
    forme: Optional[str] = None


class ThemeEcriture(BaseModel):
    libelle: Optional[str] = None
    module: str = "PAIE"
    parent_id: Optional[str] = ""             # "" : inchangé (modification) ; None : racine
    ordre: Optional[int] = None
    actif: Optional[bool] = None


class Reglage(BaseModel):
    actif: Optional[bool] = None
    theme_id: Optional[str] = ""              # "" : inchangé ; None : thème de la catégorie
    ordre: Optional[int] = None


class LancementMenu(BaseModel):
    modele_id: str
    parametres: dict = {}
    forme: Optional[str] = None


class Rattachements(BaseModel):
    ecrans: list[dict] = []                   # [{code_ecran, par_defaut}]


class ExpressionAnalyse(BaseModel):
    expression: str = ""
    source: Optional[str] = None
    parametres: list[str] = []


# ---------------------------------------------------------------- aides au designer
@router.get("/catalogue")
def catalogue(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return {"sources": sv.catalogue_sources(db)}


@router.get("/fonctions")
def fonctions(u: sv.Utilisateur = Depends(utilisateur)):
    return ex.catalogue()


@router.get("/polices")
def polices(u: sv.Utilisateur = Depends(utilisateur)):
    """Polices utilisables : 3 polices PDF standard + polices TrueType du serveur (RG-EDT-RENDU-02)."""
    from app.editions.moteur.texte import polices_disponibles
    return polices_disponibles()


@router.get("/masques")
def masques(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return sv.masques(db, u)


@router.get("/rubriques")
def rubriques(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return sv.rubriques(db, u)


@router.post("/expressions/analyser")
def analyser(corps: ExpressionAnalyse, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return sv.analyser_expression(db, u, corps.expression, corps.source, corps.parametres)


@router.get("/parametres/periodes")
def periodes(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return sv.periodes(db, u)


@router.get("/parametres/plans-paie")
def plans_paie(annee: Optional[int] = Query(None), u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return sv.plans_paie(db, u, annee)


@router.get("/parametres/collaborateurs")
def collaborateurs_payes(annee: Optional[int] = Query(None, ge=1900, le=2200), mois: Optional[int] = Query(None, ge=1, le=12),
                         periodes: Optional[str] = Query(None, description="identifiants séparés par des virgules"),
                         u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    """RG-EDT-LANCEMENT-01 : salariés payés dans l'année / le mois / les périodes choisis."""
    import re
    ids = [x.strip() for x in (periodes or "").split(",") if re.fullmatch(r"[0-9a-fA-F-]{36}", x.strip())][:200]
    return sv.collaborateurs_payes(db, u, annee, mois, ids)


class TestFormule(BaseModel):
    definition: dict
    formule: str
    parametres: dict = {}
    contexte: Optional[str] = None            # « corps:<code> » : 1re ligne du corps


@router.post("/formules/tester")
def tester_formule(corps: TestFormule, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    """Valeur d'une formule sur les premiers documents (définition en cours, non enregistrée)."""
    try:
        return sv.tester(db, u, corps.definition, corps.formule, corps.parametres, corps.contexte)
    except sv.ErreurEdition as e:
        db.rollback()
        raise _http(e)
    finally:
        db.rollback()                         # lecture seule


# ---------------------------------------------------------------- modèles
@router.get("/modeles")
def lister_modeles(categorie: Optional[str] = None, archives: bool = False,
                   u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return th.avec_theme(db, u, sv.lister_modeles(db, u, categorie, archives))


@router.post("/modeles", status_code=201)
def creer_modele(corps: ModeleCreation, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, ec.creer_modele, u, **corps.model_dump())


@router.get("/modeles/{modele_id}")
def lire_modele(modele_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.lire_modele, u, modele_id)


@router.patch("/modeles/{modele_id}")
def modifier_modele(modele_id: str, corps: ModeleModification, u: sv.Utilisateur = Depends(utilisateur),
                    db: Session = Depends(get_db)):
    """Libellé, description, catégorie (type) et visibilité du modèle."""
    return _ecriture(db, ec.modifier_modele, u, modele_id, **corps.model_dump(exclude_none=True))


class Archivage(BaseModel):
    archive: bool = True


@router.post("/modeles/{modele_id}/archivage")
def archiver(modele_id: str, corps: Archivage, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    """Archiver / désarchiver (réversible)."""
    return _ecriture(db, sv.archiver_modele, u, modele_id, corps.archive)


@router.delete("/modeles/{modele_id}", status_code=204)
def supprimer(modele_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    """Suppression définitive d'un modèle jamais publié."""
    _ecriture(db, sv.supprimer_modele, u, modele_id)
    return Response(status_code=204)


@router.get("/modeles/{modele_id}/versions")
def versions(modele_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.lister_versions, u, modele_id)


@router.post("/modeles/{modele_id}/brouillon")
def brouillon(modele_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, sv.ouvrir_brouillon, u, modele_id)


@router.post("/modeles/{modele_id}/demandes", status_code=201)
def lancer(modele_id: str, corps: Execution, u: sv.Utilisateur = Depends(utilisateur),
           db: Session = Depends(get_db)):
    """Production synchrone de la version publiée (lot 1 ; file d'attente au lot 4)."""
    return _ecriture(db, sv.lancer, u, modele_id, corps.parametres, corps.forme)


# ---------------------------------------------------------------- versions
@router.get("/versions/{version_id}")
def lire_version(version_id: str, response: Response, u: sv.Utilisateur = Depends(utilisateur),
                 db: Session = Depends(get_db)):
    v, m = _lecture(db, sv.lire_version, u, version_id)
    response.headers["ETag"] = f'"{v["jeton_concurrence"]}"'
    return {**v, "modele": m}


def _jeton(if_match: Optional[str]) -> Optional[str]:
    return if_match.strip().strip('"').removeprefix("W/").strip('"') if if_match else None


@router.put("/versions/{version_id}")
def enregistrer(version_id: str, corps: VersionEcriture, response: Response,
                if_match: Optional[str] = Header(None, alias="If-Match"),
                u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    res = _ecriture(db, sv.enregistrer, u, version_id, corps.definition, _jeton(if_match), corps.note)
    response.headers["ETag"] = f'"{res["jeton"]}"'
    return res


@router.post("/versions/{version_id}/valider")
def valider(version_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.valider_version, u, version_id)


@router.post("/versions/{version_id}/publier")
def publier(version_id: str, if_match: Optional[str] = Header(None, alias="If-Match"),
            u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, sv.publier, u, version_id, _jeton(if_match))


@router.post("/versions/{version_id}/apercu")
def apercu(version_id: str, corps: Execution, u: sv.Utilisateur = Depends(utilisateur),
           db: Session = Depends(get_db)):
    pdf, info = _ecriture(db, sv.apercu, u, version_id, corps.parametres, corps.forme)
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": 'inline; filename="apercu.pdf"',
        "X-Edition-Documents": str(info["documents"]),
        "X-Edition-Affiches": str(info["affiches"]),
        "X-Edition-Anomalies": str(len(info["anomalies"])),
        "Cache-Control": "no-store",
    })


@router.post("/versions/{version_id}/donnees")
def donnees(version_id: str, corps: Execution, u: sv.Utilisateur = Depends(utilisateur),
            db: Session = Depends(get_db)):
    """Aperçu tabulaire : corps et variables des premiers documents, sans mise en page."""
    return _ecriture(db, sv.donnees, u, version_id, corps.parametres)


# ---------------------------------------------------------------- production
@router.get("/demandes/{demande_id}")
def lire_demande(demande_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.lire_demande, u, demande_id)


@router.get("/documents/{document_id}/fichier")
def fichier(document_id: str, telecharger: bool = Query(False), u: sv.Utilisateur = Depends(utilisateur),
            db: Session = Depends(get_db)):
    chemin, nom = _ecriture(db, sv.fichier_document, u, document_id)
    mode = "attachment" if telecharger else "inline"
    return FileResponse(chemin, media_type="application/pdf", headers={
        "Content-Disposition": f"{mode}; filename*=UTF-8''{quote(nom)}", "Cache-Control": "private, no-store"})


# ---------------------------------------------------------------- bibliothèque d'images
# RG-EDT-IMAGE-01..03 : images de la société (cachet, signature…), utilisées par ASSET("CODE")
@router.get("/images")
def images(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.lister_images, u)


@router.post("/images", status_code=201)
async def deposer_image(fichier: UploadFile = File(...), code: str = Form(...), remplacer: bool = Form(False),
                        u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    from app.editions.images import TAILLE_MAX
    contenu = await fichier.read(TAILLE_MAX + 1)
    return _ecriture(db, sv.deposer_image, u, code, contenu, remplacer)


@router.delete("/images/{code}", status_code=204)
def supprimer_image(code: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    _ecriture(db, sv.supprimer_image, u, code)
    return Response(status_code=204)


@router.get("/images/{code}/fichier")
def fichier_image(code: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    p = _lecture(db, sv.fichier_image, u, code)
    return FileResponse(p, media_type="image/png" if p.suffix == ".png" else "image/jpeg",
                        headers={"Cache-Control": "private, no-store"})


@router.get("/logo")
def logo(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    """Logo de la société active (canevas du designer)."""
    p = _lecture(db, sv.fichier_logo, u)
    types = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp"}
    return FileResponse(p, media_type=types.get(p.suffix.lower(), "application/octet-stream"), headers={"Cache-Control": "private, no-store"})


# ---------------------------------------------------------------- menus métier (RG-EDT-ECRAN-01..06)
@router.get("/ecrans")
def ecrans(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    """Écrans (menus) où un modèle peut être proposé."""
    return _lecture(db, ec.lister_ecrans, u)


@router.get("/modeles/{modele_id}/ecrans")
def ecrans_du_modele(modele_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, ec.ecrans_du_modele, u, modele_id)


@router.put("/modeles/{modele_id}/ecrans")
def rattacher(modele_id: str, corps: Rattachements, u: sv.Utilisateur = Depends(utilisateur),
              db: Session = Depends(get_db)):
    return _ecriture(db, ec.rattacher, u, modele_id, corps.ecrans)


@router.get("/ecrans/{code_ecran}/modeles")
def modeles_ecran(code_ecran: str, u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    """Modèles publiés proposés sur un écran métier, le défaut en tête."""
    return _lecture(db, ec.modeles_ecran, u, code_ecran)


@router.post("/ecrans/{code_ecran}/demandes", status_code=201)
def lancer_ecran(code_ecran: str, corps: LancementEcran, u: sv.Utilisateur = Depends(utilisateur_metier),
                 db: Session = Depends(get_db)):
    return _ecriture(db, ec.lancer, u, code_ecran, corps.modele_id, corps.contexte, corps.parametres, corps.forme)


@router.get("/ecrans/demandes/{demande_id}/pdf")
def pdf_demande(demande_id: str, telecharger: bool = Query(False), u: sv.Utilisateur = Depends(utilisateur_metier),
                db: Session = Depends(get_db)):
    """Tous les documents d'une demande réunis en un PDF, pour l'impression en série."""
    contenu, nom = _ecriture(db, ec.pdf_demande, u, demande_id)
    mode = "attachment" if telecharger else "inline"
    return Response(contenu, media_type="application/pdf", headers={
        "Content-Disposition": f"{mode}; filename*=UTF-8''{quote(nom)}", "Cache-Control": "private, no-store"})


@router.get("/ecrans/documents/{document_id}/fichier")
def fichier_ecran(document_id: str, telecharger: bool = Query(False), u: sv.Utilisateur = Depends(utilisateur_metier),
                  db: Session = Depends(get_db)):
    """Un document produit depuis un écran métier (mêmes contrôles que /documents/{id}/fichier)."""
    chemin, nom = _ecriture(db, sv.fichier_document, u, document_id)
    mode = "attachment" if telecharger else "inline"
    return FileResponse(chemin, media_type="application/pdf", headers={
        "Content-Disposition": f"{mode}; filename*=UTF-8''{quote(nom)}", "Cache-Control": "private, no-store"})


# ---------------------------------------------------------------- thèmes, actif, menus en arbre (RG-EDT-THEME/ACTIF/MENU)
@router.get("/themes")
def themes(module: Optional[str] = None, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, th.lister_themes, u, module)


@router.post("/themes", status_code=201)
def creer_theme(corps: ThemeEcriture, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, th.creer_theme, u, libelle=corps.libelle or "", module=corps.module,
                     parent_id=corps.parent_id or None, ordre=corps.ordre)


@router.patch("/themes/{theme_id}")
def modifier_theme(theme_id: str, corps: ThemeEcriture, u: sv.Utilisateur = Depends(utilisateur),
                   db: Session = Depends(get_db)):
    return _ecriture(db, th.modifier_theme, u, theme_id, libelle=corps.libelle, parent_id=corps.parent_id,
                     ordre=corps.ordre, actif=corps.actif)


@router.delete("/themes/{theme_id}", status_code=204)
def supprimer_theme(theme_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    _ecriture(db, th.supprimer_theme, u, theme_id)
    return Response(status_code=204)


@router.put("/modeles/{modele_id}/reglage")
def regler_modele(modele_id: str, corps: Reglage, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    """Actif, thème et ordre du modèle pour la société active."""
    return _ecriture(db, th.regler_modele, u, modele_id, actif=corps.actif, theme_id=corps.theme_id, ordre=corps.ordre)


@router.get("/menus/{module}")
def menu_module(module: str, tout: bool = Query(False), u: sv.Utilisateur = Depends(utilisateur_metier),
                db: Session = Depends(get_db)):
    """Arborescence des états d'un module (Paie › Éditions de la paie)."""
    return _lecture(db, th.arbre, u, module.upper(), tout)


@router.post("/menus/{module}/demandes", status_code=201)
def lancer_menu(module: str, corps: LancementMenu, u: sv.Utilisateur = Depends(utilisateur_metier),
                db: Session = Depends(get_db)):
    return _ecriture(db, th.lancer, u, module.upper(), corps.modele_id, corps.parametres, corps.forme)


# ---------------------------------------------------------------- filtres de population (RG-EDT-FILTRE-01..03)
@router.get("/filtres")
def filtres(u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    """UO de la société (arbre) et valeurs des critères proposés au lancement."""
    from app.editions import population
    return population.valeurs(db, u.societe_id)


# ---------------------------------------------------------------- dictionnaire des données (RG-EDT-DICO-01..08)
class DicoChamp(BaseModel):
    code: Optional[str] = None
    libelle: Optional[str] = None
    groupe: Optional[str] = None
    type_donnee: Optional[str] = None
    masque_defaut: Optional[str] = None
    sensible: Optional[bool] = None
    visible: Optional[bool] = None
    description: Optional[str] = None
    reinitialiser: bool = False
    definition: Optional[dict] = None          # modification d'un champ ajouté
    # création : définition à plat
    mode: Optional[str] = None
    colonne: Optional[str] = None
    cle_ligne: Optional[str] = None
    table_cible: Optional[str] = None
    colonne_cle: Optional[str] = None
    colonne_valeur: Optional[str] = None
    colonne_date_debut: Optional[str] = None
    colonne_date_fin: Optional[str] = None
    date_reference: Optional[str] = None
    agregat: Optional[str] = None
    colonne_ordre: Optional[str] = None
    conditions: list[dict] = []


class DicoSource(BaseModel):
    code: Optional[str] = None
    libelle: Optional[str] = None
    description: Optional[str] = None
    table_principale: str
    colonne_cle: Optional[str] = None
    colonne_societe: Optional[str] = None
    colonne_collaborateur: Optional[str] = None
    conditions: list[dict] = []
    colonnes: list[str] = []                   # création : colonnes à proposer comme champs


class DicoRelation(BaseModel):
    source: str
    cible: str
    code: Optional[str] = None
    libelle: Optional[str] = None
    cle_source: str
    cle_cible: str
    cardinalite: str = "PLUSIEURS"


class DicoTest(BaseModel):
    definition: dict
    cles: list[str] = []


@router.get("/dictionnaire")
def dictionnaire(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.dictionnaire, u)


@router.get("/dictionnaire/tables")
def dictionnaire_tables(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.dictionnaire_tables, u)


@router.get("/dictionnaire/tables/{table}/apercu")
def dictionnaire_apercu_table(table: str, colonnes: str = "", u: sv.Utilisateur = Depends(utilisateur),
                              db: Session = Depends(get_db)):
    return _lecture(db, sv.dictionnaire_apercu_table, u, table, [c for c in colonnes.split(",") if c])


@router.post("/dictionnaire/sources")
def dictionnaire_creer_source(corps: DicoSource, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "creer_source", corps.model_dump())


@router.put("/dictionnaire/sources/{source}")
def dictionnaire_modifier_source(source: str, corps: DicoSource, u: sv.Utilisateur = Depends(utilisateur),
                                 db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "modifier_source", source, corps.model_dump())


@router.delete("/dictionnaire/sources/{source}")
def dictionnaire_supprimer_source(source: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "supprimer_source", source)


@router.get("/dictionnaire/sources/{source}/apercu")
def dictionnaire_apercu_source(source: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.dictionnaire_apercu_source, u, source)


@router.post("/dictionnaire/sources/{source}/champs")
def dictionnaire_creer_champ(source: str, corps: DicoChamp, u: sv.Utilisateur = Depends(utilisateur),
                             db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "creer_champ", source, corps.model_dump(exclude_none=True))


@router.post("/dictionnaire/sources/{source}/tester")
def dictionnaire_tester(source: str, corps: DicoTest, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.dictionnaire_tester_champ, u, source, corps.definition, corps.cles)


@router.put("/dictionnaire/sources/{source}/champs/{code}")
def dictionnaire_modifier_champ(source: str, code: str, corps: DicoChamp, u: sv.Utilisateur = Depends(utilisateur),
                                db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "modifier_champ", source, code, corps.model_dump(exclude_unset=True))


@router.delete("/dictionnaire/sources/{source}/champs/{code}")
def dictionnaire_supprimer_champ(source: str, code: str, u: sv.Utilisateur = Depends(utilisateur),
                                 db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "supprimer_champ", source, code)


@router.post("/dictionnaire/relations")
def dictionnaire_creer_relation(corps: DicoRelation, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "creer_relation", corps.model_dump())


@router.delete("/dictionnaire/relations/{source}/{code}")
def dictionnaire_supprimer_relation(source: str, code: str, u: sv.Utilisateur = Depends(utilisateur),
                                    db: Session = Depends(get_db)):
    return _ecriture(db, sv.dictionnaire_ecrire, u, "supprimer_relation", source, code)


# ---------------------------------------------------------------- écrans générés dans la navigation (RG-EDT-NAV-02..04)
class EcranNavigation(BaseModel):
    type: str                                  # MODELE | DOSSIER
    id: str                                    # id ou code de l'état ; id du dossier
    libelle: Optional[str] = None


@router.get("/navigation")
def ecran_navigation(type: str, id: str, u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    return _lecture(db, sv.ecran_navigation, u, type.upper(), id)


@router.post("/navigation")
def generer_ecran_navigation(corps: EcranNavigation, u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    return _ecriture(db, sv.generer_ecran_navigation, u, corps.type.upper(), corps.id, corps.libelle)


@router.delete("/navigation")
def retirer_ecran_navigation(type: str, id: str, u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    return _ecriture(db, sv.retirer_ecran_navigation, u, type.upper(), id)


class PublicationNavigation(BaseModel):
    module: str = "PAIE"
    avec_etats: bool = True


@router.post("/navigation/publier")
def publier_navigation(corps: PublicationNavigation, u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    """RG-EDT-NAV-05 : dossiers (et états) du menu d'éditions → sous-menus de « Éditions de la paie »."""
    return _ecriture(db, th.publier_navigation, u, corps.module.upper(), corps.avec_etats)



# ---------------------------------------------------------------- accès aux états par les rôles (RG-EDT-ACCES-01..03)
class AccesEtat(BaseModel):
    type: str                                  # MODELE | DOSSIER
    id: str
    roles: list[str] = []


@router.get("/acces")
def acces_etat(type: str, id: str, u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    return _lecture(db, th.acces_menu, u, type.upper(), id)


@router.put("/acces")
def regler_acces_etat(corps: AccesEtat, u: sv.Utilisateur = Depends(utilisateur_metier), db: Session = Depends(get_db)):
    return _ecriture(db, th.regler_acces_menu, u, corps.type.upper(), corps.id, corps.roles)
