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
from app.core.security import get_societe_active_id, require_menu_access, roles_from_payload
from app.editions import expressions as ex
from app.editions import service as sv

router = APIRouter(prefix="/editions", tags=["Éditions"])


def utilisateur(payload: dict = Depends(require_menu_access("editions")),
                societe_id: str = Depends(get_societe_active_id)) -> sv.Utilisateur:
    return sv.Utilisateur(payload.get("sub"), str(societe_id), frozenset(roles_from_payload(payload)))


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


class VersionEcriture(BaseModel):
    definition: dict
    note: Optional[str] = None


class Execution(BaseModel):
    parametres: dict = {}
    forme: Optional[str] = None               # mise en forme choisie (« Multiple modèle »)


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
def plans_paie(u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return sv.plans_paie(db, u)


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
    return sv.lister_modeles(db, u, categorie, archives)


@router.post("/modeles", status_code=201)
def creer_modele(corps: ModeleCreation, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _ecriture(db, sv.creer_modele, u, **corps.model_dump())


@router.get("/modeles/{modele_id}")
def lire_modele(modele_id: str, u: sv.Utilisateur = Depends(utilisateur), db: Session = Depends(get_db)):
    return _lecture(db, sv.lire_modele, u, modele_id)


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
