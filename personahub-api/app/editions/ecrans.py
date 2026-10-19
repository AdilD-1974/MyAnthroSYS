"""
app/editions/ecrans.py — Lancement des éditions depuis les menus métier.
Auteur : Adil DAIA — 19/10/2026 (migration 077)

Un état conçu dans les éditions ne se lance pas seulement depuis la bibliothèque :
il est proposé dans le menu où l'utilisateur en a besoin (bulletins dans la paie…).

    RG-EDT-ECRAN-01  un modèle est proposé dans un ou plusieurs écrans, par société
                     (edt_modele_ecran).
    RG-EDT-ECRAN-02  un modèle créé est rattaché d'office aux écrans de sa catégorie.
    RG-EDT-ECRAN-03  un écran sans rattachement dans la société propose les modèles
                     publiés de sa catégorie (le bulletin système marche d'emblée).
    RG-EDT-ECRAN-04  un seul modèle par défaut par écran et par société ; à défaut,
                     un modèle de la société passe avant un modèle système.
    RG-EDT-ECRAN-05  l'écran transmet son contexte (période, collaborateur, bulletin…) ;
                     il remplit les paramètres du modèle selon leur TYPE, quel que soit
                     leur code. Les paramètres saisis à l'écran priment.
    RG-EDT-ECRAN-06  seul un modèle proposé sur l'écran peut y être lancé, et seulement
                     sa version publiée (RG-EDT-PROD-01) ; les droits fins restent ceux
                     du modèle (LANCER, DONNEES_SENSIBLES).
"""
from __future__ import annotations

import io
import json
import logging
import uuid
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.editions import service as sv
from app.editions.definition import Definition

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Référentiel des écrans
# ---------------------------------------------------------------------------
def _ecran(db: Session, code_ecran: str) -> dict:
    r = db.execute(text("""SELECT code_ecran, libelle, contexte_disponible, chemin_route, categorie_edition,
                                  module_libelle
                           FROM ecran_lancement WHERE code_ecran = :c AND actif = true"""),
                   {"c": code_ecran}).mappings().first()
    if r is None:
        raise sv.Introuvable("Écran de lancement inconnu")
    return _propre_ecran(r)


def _propre_ecran(r) -> dict:
    d = dict(r)
    ctx = d.get("contexte_disponible")
    d["contexte_disponible"] = ctx if isinstance(ctx, list) else json.loads(ctx or "[]")
    return d


def lister_ecrans(db: Session, u: sv.Utilisateur) -> list[dict]:
    rows = db.execute(text("""SELECT code_ecran, libelle, contexte_disponible, chemin_route, categorie_edition,
                                     module_libelle
                              FROM ecran_lancement WHERE actif = true
                              ORDER BY module_libelle NULLS LAST, libelle""")).mappings().all()
    return [_propre_ecran(r) for r in rows]


# ---------------------------------------------------------------------------
# Rattachements d'un modèle
# ---------------------------------------------------------------------------
def ecrans_du_modele(db: Session, u: sv.Utilisateur, modele_id: str) -> list[dict]:
    m = sv.lire_modele(db, u, modele_id)
    rows = db.execute(text("""SELECT me.code_ecran, me.par_defaut, e.libelle, e.module_libelle, e.chemin_route
                              FROM edt_modele_ecran me JOIN ecran_lancement e ON e.code_ecran = me.code_ecran
                              WHERE me.modele_id = :m AND me.societe_id = :s
                              ORDER BY e.module_libelle NULLS LAST, e.libelle"""),
                      {"m": m["id"], "s": u.societe_id}).mappings().all()
    if rows:
        return [dict(r) | {"implicite": False} for r in rows]
    # RG-EDT-ECRAN-03 : sans rattachement explicite, les écrans de la catégorie qui n'ont
    # aucun rattachement dans la société le proposent quand même
    rows = db.execute(text("""SELECT e.code_ecran, false AS par_defaut, e.libelle, e.module_libelle, e.chemin_route
                              FROM ecran_lancement e
                              WHERE e.actif = true AND e.categorie_edition = :cat
                                AND NOT EXISTS (SELECT 1 FROM edt_modele_ecran x
                                                WHERE x.code_ecran = e.code_ecran AND x.societe_id = :s)
                              ORDER BY e.libelle"""),
                      {"cat": m["categorie"], "s": u.societe_id}).mappings().all()
    return [dict(r) | {"implicite": True} for r in rows]


def rattacher(db: Session, u: sv.Utilisateur, modele_id: str, ecrans: list[dict]) -> list[dict]:
    """Remplace les écrans du modèle pour la société active. `ecrans` : [{code_ecran, par_defaut}]."""
    m = sv.lire_modele(db, u, modele_id)
    sv.exiger(db, u, "PUBLIER", m)
    codes = []
    for e in ecrans or []:
        code = str(e.get("code_ecran") or "")
        if code in codes:
            continue
        _ecran(db, code)
        codes.append(code)
    db.execute(text("DELETE FROM edt_modele_ecran WHERE modele_id = :m AND societe_id = :s"),
               {"m": m["id"], "s": u.societe_id})
    for i, e in enumerate(ecrans or []):
        code = str(e.get("code_ecran") or "")
        if code not in codes:
            continue
        codes.remove(code)                                   # un doublon n'est écrit qu'une fois
        defaut = bool(e.get("par_defaut"))
        if defaut:                                           # RG-EDT-ECRAN-04
            db.execute(text("""UPDATE edt_modele_ecran SET par_defaut = false
                               WHERE societe_id = :s AND code_ecran = :c"""), {"s": u.societe_id, "c": code})
        db.execute(text("""INSERT INTO edt_modele_ecran (id, modele_id, code_ecran, societe_id, par_defaut, ordre)
                           VALUES (:id, :m, :c, :s, :d, :o)"""),
                   {"id": str(uuid.uuid4()), "m": m["id"], "c": code, "s": u.societe_id, "d": defaut, "o": i})
    sv.auditer(db, u, "ECRANS", "MODELE", m["id"], {"ecrans": ecrans})
    return ecrans_du_modele(db, u, modele_id)


def creer_modele(db: Session, u: sv.Utilisateur, **kw) -> dict:
    """Création (service) + RG-EDT-ECRAN-02. Sans la migration 077, la création réussit quand même."""
    res = sv.creer_modele(db, u, **kw)
    m = sv.lire_modele(db, u, res["modele_id"])
    try:
        with db.begin_nested():
            rattacher_par_categorie(db, u, m["id"], m["categorie"])
    except SQLAlchemyError:
        log.warning("Rattachement aux menus impossible (migration 077 appliquée ?)", exc_info=True)
    return res


def rattacher_par_categorie(db: Session, u: sv.Utilisateur, modele_id: str, categorie: str) -> None:
    """RG-EDT-ECRAN-02 : à la création, rattachement aux écrans de la catégorie.
    Un écran qui n'avait encore aucun rattachement garde aussi les modèles déjà publiés
    de sa catégorie (sinon le nouveau modèle masquerait le bulletin système)."""
    ecrans = db.execute(text("""SELECT code_ecran FROM ecran_lancement
                                WHERE actif = true AND categorie_edition = :cat"""),
                        {"cat": categorie}).scalars().all()
    for code in ecrans:
        vide = db.execute(text("SELECT 1 FROM edt_modele_ecran WHERE societe_id = :s AND code_ecran = :c"),
                          {"s": u.societe_id, "c": code}).first() is None
        if vide:
            for ancien in _modeles_categorie(db, u, categorie):
                _inserer(db, ancien["id"], code, u.societe_id)
        _inserer(db, modele_id, code, u.societe_id)


def _inserer(db: Session, modele_id: str, code: str, societe_id: str) -> None:
    if db.execute(text("""SELECT 1 FROM edt_modele_ecran WHERE modele_id = :m AND code_ecran = :c
                          AND societe_id = :s"""), {"m": modele_id, "c": code, "s": societe_id}).first():
        return
    ordre = db.execute(text("SELECT count(*) FROM edt_modele_ecran WHERE societe_id = :s AND code_ecran = :c"),
                       {"s": societe_id, "c": code}).scalar() or 0
    db.execute(text("""INSERT INTO edt_modele_ecran (id, modele_id, code_ecran, societe_id, par_defaut, ordre)
                       VALUES (:id, :m, :c, :s, false, :o)"""),
               {"id": str(uuid.uuid4()), "m": modele_id, "c": code, "s": societe_id, "o": int(ordre)})


def _modeles_categorie(db: Session, u: sv.Utilisateur, categorie: str) -> list[dict]:
    return [m for m in sv.lister_modeles(db, u, categorie) if m["version_publiee_id"]]


# ---------------------------------------------------------------------------
# Modèles proposés sur un écran
# ---------------------------------------------------------------------------
def fiche_lancement(db: Session, m: dict) -> Optional[dict]:
    """Ce qu'il faut à un écran pour lancer le modèle : paramètres et mises en forme de la version publiée."""
    v = db.execute(text("SELECT numero, definition FROM edt_modele_version WHERE id = :v"),
                   {"v": m["version_publiee_id"]}).mappings().first()
    if v is None:
        return None
    d = v["definition"] if isinstance(v["definition"], dict) else json.loads(v["definition"])
    usages = d.get("usages") or {}
    formes = []
    if usages.get("formes_au_choix"):
        formes = [{"code": d.get("forme_code") or "standard", "libelle": d.get("forme_libelle") or "Mise en forme standard"}] \
            + [{"code": f.get("code"), "libelle": f.get("libelle")} for f in d.get("formes") or []]
    return {
        "id": m["id"], "code": m["code"], "libelle": m["libelle"], "description": m.get("description"),
        "categorie": m["categorie"], "est_systeme": m["est_systeme"], "numero_publie": v["numero"],
        "par_defaut": False, "ordre": 0,
        "parametres": d.get("parametres") or [], "formes": formes,
        "forme_par_defaut": usages.get("forme_par_defaut") or d.get("forme_code"),
    }


def modeles_ecran(db: Session, u: sv.Utilisateur, code_ecran: str) -> dict:
    """Modèles lançables sur l'écran (publiés, visibles, droit LANCER), le défaut en tête,
    avec leurs paramètres et leurs mises en forme au choix."""
    e = _ecran(db, code_ecran)
    rattaches = db.execute(text("""SELECT modele_id, par_defaut, ordre FROM edt_modele_ecran
                                   WHERE societe_id = :s AND code_ecran = :c"""),
                           {"s": u.societe_id, "c": code_ecran}).mappings().all()
    infos = {str(r["modele_id"]): r for r in rattaches}
    if rattaches:
        candidats = [m for m in sv.lister_modeles(db, u) if m["id"] in infos and m["version_publiee_id"]]
    elif e["categorie_edition"]:                                              # RG-EDT-ECRAN-03
        candidats = _modeles_categorie(db, u, e["categorie_edition"])
    else:
        candidats = []
    sortie = []
    for m in candidats:
        if not m.get("actif", True) or not sv.peut(db, u, "LANCER", m):     # RG-EDT-ACTIF-01
            continue
        f = fiche_lancement(db, m)
        if f is None:
            continue
        r = infos.get(m["id"])
        sortie.append({**f, "par_defaut": bool(r and r["par_defaut"]), "ordre": int(r["ordre"]) if r else 0})
    # RG-EDT-ECRAN-04 : défaut, puis modèles de la société avant les modèles système
    sortie.sort(key=lambda x: (not x["par_defaut"], x["est_systeme"], x["ordre"], x["libelle"].lower()))
    return {"ecran": e, "modeles": sortie, "defaut": sortie[0]["id"] if sortie else None}


# ---------------------------------------------------------------------------
# Contexte de l'écran → paramètres du modèle — RG-EDT-ECRAN-05
# ---------------------------------------------------------------------------
def parametres_depuis_contexte(d: Definition, contexte: dict, saisis: Optional[dict] = None) -> dict:
    ctx = {k: v for k, v in (contexte or {}).items() if v not in (None, "", [])}
    res: dict[str, Any] = {}
    collabs = ctx.get("collaborateur_ids") or ([ctx["collaborateur_id"]] if ctx.get("collaborateur_id") else [])
    for p in d.parametres:
        if p.code in ctx:
            res[p.code] = ctx[p.code]
        elif p.type == "PERIODE" and ctx.get("periode_id"):
            res[p.code] = ctx["periode_id"]
        elif p.type == "COLLABORATEUR" and collabs:
            res[p.code] = list(collabs) if p.multiple else collabs[0]
        elif p.type == "PLAN_PAIE" and ctx.get("plan_paie_id"):
            res[p.code] = [ctx["plan_paie_id"]] if p.multiple else ctx["plan_paie_id"]
        elif p.type == "ANNEE" and ctx.get("annee"):
            res[p.code] = int(ctx["annee"])
        elif p.type == "DATE" and ctx.get("date"):
            res[p.code] = ctx["date"]
    if ctx.get("bulletin_id"):                       # paramètre réservé : un bulletin précis
        res["bulletin"] = str(ctx["bulletin_id"])
    for k, v in (saisis or {}).items():
        if v not in (None, "", []):
            res[k] = v
    return res


def lancer(db: Session, u: sv.Utilisateur, code_ecran: str, modele_id: Optional[str], contexte: dict,
           parametres: Optional[dict] = None, forme: Optional[str] = None) -> dict:
    proposes = modeles_ecran(db, u, code_ecran)
    ids = [m["id"] for m in proposes["modeles"]]
    if not ids:
        raise sv.Conflit("Aucun modèle d'édition publié n'est proposé sur cet écran : "
                         "publiez un modèle de la catégorie ou rattachez-en un à ce menu")
    choisi = modele_id or proposes["defaut"]
    if choisi not in ids:                                                     # RG-EDT-ECRAN-06
        raise sv.Interdit("Ce modèle n'est pas proposé sur cet écran")
    m = sv.lire_modele(db, u, choisi)
    v, _ = sv.lire_version(db, u, m["version_publiee_id"])
    d = Definition.model_validate(v["definition"])
    bruts = parametres_depuis_contexte(d, contexte, parametres)
    res = sv.lancer(db, u, choisi, bruts, forme)
    if not res["documents"]:
        raise sv.ErreurEdition("Aucun document : pas de bulletin définitif pour ce choix "
                               "(un précalcul doit d'abord être enregistré)")
    return {**res, "modele": {"id": m["id"], "code": m["code"], "libelle": m["libelle"]}}


# ---------------------------------------------------------------------------
# Tous les documents d'une demande en un seul PDF (impression en série)
# ---------------------------------------------------------------------------
def pdf_demande(db: Session, u: sv.Utilisateur, demande_id: str) -> tuple[bytes, str]:
    dem = sv.lire_demande(db, u, demande_id)
    fichiers = [sv.fichier_document(db, u, d["id"])[0] for d in dem["documents"] if d["format"] == "PDF"]
    if not fichiers:
        raise sv.Introuvable("Aucun document PDF dans cette demande")
    nom = f"{dem['modele_code'].lower()}_{str(demande_id)[:8]}.pdf"
    if len(fichiers) == 1:
        return fichiers[0].read_bytes(), nom
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for f in fichiers:
        for page in PdfReader(str(f)).pages:
            w.add_page(page)
    sortie = io.BytesIO()
    w.write(sortie)
    return sortie.getvalue(), nom
