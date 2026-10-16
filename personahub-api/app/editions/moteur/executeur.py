"""
app/editions/moteur/executeur.py — Pipeline d'exécution d'une édition.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

    paramètres → jeu principal → jeux secondaires → éclatement → mise en page → PDF

RG-EDT-SECU-02 (Adil DAIA) : chaque paramètre est contrôlé contre le périmètre de
    l'utilisateur avant exécution (une période d'une autre société est refusée).
    Seuls les paramètres déclarés par le modèle sont transmis aux sources, plus
    « bulletin » pour l'aperçu d'un bulletin précis.
RG-EDT-SECU-01 (Adil DAIA) : les champs sensibles sont masqués à la lecture, avec
    la liste du catalogue (administrable) ou, à défaut, celle du fournisseur.
"""
from __future__ import annotations

import hashlib
from decimal import Decimal
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.editions import expressions as ex
from app.editions import format as fmt
from app.editions.definition import Definition, Jeu, Tableau
from app.editions.moteur.mise_en_page import Anomalie, Composeur, Contexte, composer
from app.editions.moteur.rendu_pdf import RenduPDF
from app.editions.sources import REGISTRE, ContexteSecurite, ErreurSource
from app.editions.sources.paie import _rubriques_paie, constantes_a_date, index_rubriques

log = logging.getLogger(__name__)
PARAMETRES_RESERVES = ("bulletin",)


@dataclass
class DocumentProduit:
    nom_fichier: str
    contenu: bytes
    format: str
    cle_objet: Optional[str]
    nb_pages: int
    empreinte_donnees: str
    anomalies: list[Anomalie] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Paramètres
# ---------------------------------------------------------------------------
def resoudre_parametres(db: Session, d: Definition, bruts: dict, sec: ContexteSecurite) -> dict:
    res: dict[str, Any] = {}
    for p in d.parametres:
        v = bruts.get(p.code)
        if (v is None or v == "" or v == []) and p.defaut:
            v = ex.evaluer(p.defaut, ex.ResolverEdition())
        if v is None or v == "" or v == []:
            if p.obligatoire:
                raise ErreurSource(f"Paramètre obligatoire manquant : {p.libelle}")
            continue
        if p.type == "PERIODE":
            v = _periode(db, v, sec)
        elif p.type == "DATE" and isinstance(v, str):
            v = date.fromisoformat(v[:10])
        elif p.type in ("ANNEE", "NOMBRE"):
            v = int(v) if p.type == "ANNEE" else v
        elif p.multiple and not isinstance(v, list):
            v = [v]
        res[p.code] = v
    for cle in PARAMETRES_RESERVES:
        if bruts.get(cle):
            res[cle] = str(bruts[cle])
    return res


def _periode(db: Session, v: Any, sec: ContexteSecurite) -> dict:
    ident = v.get("id") if isinstance(v, dict) else v
    row = db.execute(text("""
        SELECT id, intitule, annee, mois, date_debut, date_fin, plan_paie_id
        FROM calendrier_paie WHERE id = :id AND societe_id = :s"""), {"id": str(ident), "s": sec.societe_id}
    ).mappings().first()
    if row is None:
        raise ErreurSource("Période introuvable dans la société active")          # RG-EDT-SECU-02
    p = {k: (str(x) if k in ("id", "plan_paie_id") and x is not None else x) for k, x in dict(row).items()}
    p["code"] = f"{p['annee']}-{int(p['mois']):02d}"
    return p


# ---------------------------------------------------------------------------
# Jeux de données
# ---------------------------------------------------------------------------
def _appliquer_jeu(jeu: Jeu, lignes: list[dict], parametres: dict, societe: dict,
                   parent: Optional[dict] = None) -> list[dict]:
    """Champs calculés, filtres et tri d'un jeu (en mémoire au lot 1 ; les filtres
    seront poussés en SQL quand la traduction des formules sera livrée)."""
    resultat = []
    for l in lignes:
        base = {**(parent or {}), **l, "societe": societe}
        r = ex.ResolverEdition(ligne=base, parametres=parametres)
        for c in jeu.calculs:
            l[c.code] = base[c.code] = ex.evaluer(c.expression, r)
        if all(_vrai(ex.evaluer(f, r)) for f in jeu.filtres):
            resultat.append(l)
    for t in reversed(jeu.tri):
        resultat.sort(key=lambda l: _cle_tri(_lire(l, t.champ)), reverse=(t.sens == "DESC"))
    return resultat


def _lire(ligne: dict, chemin: str) -> Any:
    if chemin in ligne:
        return ligne[chemin]
    v: Any = ligne
    for p in chemin.split("."):
        v = v.get(p) if isinstance(v, dict) else None
    return v


def _cle_tri(v: Any):
    if v is None:
        return (1, "")
    if isinstance(v, (int, float)) or hasattr(v, "is_finite"):
        return (0, float(v))
    return (0, str(v).lower()) if not isinstance(v, (date, datetime)) else (0, v.isoformat())


def _vrai(v: Any) -> bool:
    if v is None or v == "":
        return False
    if isinstance(v, bool):
        return v
    try:
        return float(v) != 0
    except (TypeError, ValueError):
        return bool(v)


def _sensibles(db: Session, source: str) -> Optional[set[str]]:
    try:
        from app.editions import catalogue
        s = catalogue.champs_sensibles(db, source)
        connus = db.execute(text("SELECT count(*) FROM edt_source_champ WHERE source_code = :s"),
                            {"s": source}).scalar()
        return s if connus else None
    except Exception:
        db.rollback()
        return None


# ---------------------------------------------------------------------------
# Exécution
# ---------------------------------------------------------------------------
@dataclass
class Preparation:
    """Tout ce qu'il faut pour composer : données lues, une seule fois par demande."""
    definition: Definition
    parametres: dict
    lignes: list[dict]
    contexte: dict           # arguments communs de Contexte (hors définition et lignes)


def _preparer(db: Session, d: Definition, parametres_bruts: dict, sec: ContexteSecurite, *,
              registre_masques: Optional[dict], racine_fichiers: str, contexte_fixe: Optional[dict],
              forme: Optional[str]) -> Preparation:
    try:
        d = d.avec_forme(forme or d.usages.forme_par_defaut)     # « Multiple modèle »
    except ValueError as e:
        raise ErreurSource(str(e))
    parametres = resoudre_parametres(db, d, parametres_bruts, sec)
    principal = d.jeu_principal()
    if principal is None or principal.source not in REGISTRE:
        raise ErreurSource("Jeu principal absent ou source inconnue")

    societe = REGISTRE["SOCIETE"].lire(db, None, sec)[0]
    f = REGISTRE[principal.source]
    lignes = f.lire(db, parametres, sec)
    f.masquer(lignes, sec, _sensibles(db, principal.source))
    lignes = _appliquer_jeu(principal, lignes, parametres, societe)

    enfants: dict[str, dict[Any, list[dict]]] = {}
    for jeu in d.jeux:
        if jeu.role != "SECONDAIRE" or jeu.source not in REGISTRE:
            continue
        fe = REGISTRE[jeu.source]
        groupes = fe.lire_enfants(db, [l["id"] for l in lignes], sec, parametres)
        par_parent = {}
        for l in lignes:
            lot = groupes.get(l["id"], [])
            fe.masquer(lot, sec, _sensibles(db, jeu.source))
            par_parent[l["id"]] = _appliquer_jeu(jeu, lot, parametres, societe, parent=l)
        enfants[jeu.code] = par_parent

    rubriques = index_rubriques(db, lignes) if principal.source == "BULLETIN" and lignes else {}
    periode = parametres.get("periode")
    a_date = periode["date_fin"] if isinstance(periode, dict) else date.today()
    constantes = constantes_a_date(db, sec.societe_id, a_date)

    # paramétrage des rubriques citées dans les plans de lignes et les corps (libellés, ne_editer_si_*)
    codes = {lr.code.strip().upper() for b in d.bandes for el in b.elements if isinstance(el, Tableau)
             for s in el.sections for lr in s.rubriques}
    codes |= {a.rubrique.strip().upper() for c in d.corps for a in c.affectations if a.rubrique}
    parametrage = _rubriques_paie(db, codes, sec.societe_id) if codes else {}
    libelles = {code: (r.get("libelle_edition") or r.get("libelle")) for code, r in parametrage.items()}

    logo = societe.get("logo_path")
    fixe = {"CHARTE.logo": _chemin_relatif(logo) if logo else None, **(contexte_fixe or {})}
    return Preparation(d, parametres, lignes, dict(
        enfants=enfants, parametres=parametres, societe=societe, constantes=constantes, rubriques=rubriques,
        contexte_fixe=fixe, registre_masques=registre_masques, racine_fichiers=racine_fichiers,
        libelles_rubriques=libelles, parametrage_rubriques=parametrage))


def executer(db: Session, d: Definition, parametres_bruts: dict, sec: ContexteSecurite, *,
             registre_masques: Optional[dict] = None, racine_fichiers: str = "storage",
             filigrane: Optional[str] = None, contexte_fixe: Optional[dict] = None,
             forme: Optional[str] = None) -> list[DocumentProduit]:
    prep = _preparer(db, d, parametres_bruts, sec, registre_masques=registre_masques,
                     racine_fichiers=racine_fichiers, contexte_fixe=contexte_fixe, forme=forme)
    d, parametres, lignes = prep.definition, prep.parametres, prep.lignes
    societe = prep.contexte["societe"]

    # éclatement : un document par valeur du champ, dans l'ordre du jeu
    if d.sortie.eclatement:
        documents: dict[Any, list[dict]] = {}
        for l in lignes:
            documents.setdefault(_lire(l, d.sortie.eclatement), []).append(l)
        lots = list(documents.items())
    else:
        lots = [(None, lignes)]

    produits = []
    for cle, lot in lots:
        ctx = Contexte(definition=d, lignes=lot, **prep.contexte)
        pages, anomalies = composer(ctx)
        r = ex.ResolverEdition(ligne={**(lot[0] if lot else {}), "societe": societe}, parametres=parametres)
        try:
            nom = ex.evaluer(d.sortie.nom_fichier, r)
        except ex.ErreurFormule:
            nom = "edition"
        nom = _nom_fichier(nom) + ".pdf"
        meta = {"titre": nom[:-4], "sujet": "PersonaHub HR",
                "modele": parametres_bruts.get("_modele", ""), "version": parametres_bruts.get("_version", "")}
        pdf = RenduPDF(d.page, meta, racine_fichiers, filigrane=filigrane).rendre(pages)
        empreinte = hashlib.sha256(json.dumps(lot, default=str, sort_keys=True).encode()).hexdigest()
        produits.append(DocumentProduit(nom, pdf, "PDF", None if cle is None else str(cle),
                                        len(pages), empreinte, anomalies))
    return produits


def _json(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return {("gras" if k == "_gras" else k): _json(x) for k, x in v.items() if k == "_gras" or not str(k).startswith("_")}
    if isinstance(v, (list, tuple)):
        return [_json(x) for x in v]
    return v


def donnees_brutes(db: Session, d: Definition, parametres_bruts: dict, sec: ContexteSecurite, *,
                   max_lignes: int = 5) -> dict:
    """Aperçu tabulaire (RG-EDT-DONNEES-01) : corps et variables des premières
    lignes principales, sans aucune mise en page. Vérifier le contenu avant le format."""
    prep = _preparer(db, d, parametres_bruts, sec, registre_masques=None, racine_fichiers="storage",
                     contexte_fixe=None, forme=None)
    resultat = []
    for l in prep.lignes[:max_lignes]:
        comp = Composeur(Contexte(definition=prep.definition, lignes=[l], **prep.contexte))
        donnees = comp._donnees(l)
        ident = l.get("identite") or {}
        resultat.append({
            "id": str(l.get("id")),
            "titre": " ".join(str(x) for x in (l.get("matricule"), ident.get("nom"), ident.get("prenom")) if x),
            "corps": _json(donnees["corps"]),
            "variables": _json(donnees["var"]),
            "anomalies": [{"element": a.source_id, "message": a.message} for a in comp.anomalies],
        })
    return {"nb_lignes": len(prep.lignes), "lignes": resultat}


def _chemin_relatif(p: str) -> str:
    p = p.replace("\\", "/")
    return p[len("storage/"):] if p.startswith("storage/") else p.lstrip("/")


def _nom_fichier(v: Any) -> str:
    s = re.sub(r"[^\w\-. ]+", "_", str(v or "edition"), flags=re.UNICODE).strip(" ._")
    return s[:120] or "edition"


def tester_formule(db: Session, d: Definition, parametres_bruts: dict, sec: ContexteSecurite, formule: str,
                   contexte: Optional[str] = None, max_lignes: int = 3) -> dict:
    """Assistant de formule : la valeur d'une formule sur les premiers documents,
    dans le contexte du document (défaut) ou de la 1re ligne d'un corps (« corps:<code> »)."""
    prep = _preparer(db, d, parametres_bruts, sec, registre_masques=None, racine_fichiers="storage",
                     contexte_fixe=None, forme=None)
    resultats = []
    for l in prep.lignes[:max_lignes]:
        comp = Composeur(Contexte(definition=prep.definition, lignes=[l], **prep.contexte))
        enfant = None
        if contexte and contexte.startswith("corps:"):
            lignes_corps = comp._donnees(l)["corps"].get(contexte[6:].split(",")[0]) or []
            enfant = lignes_corps[0] if isinstance(lignes_corps, list) and lignes_corps else {}
        r = comp._resolver(l, {}, 1, 1, enfant)
        ident = l.get("identite") or {}
        titre = " ".join(str(x) for x in (l.get("matricule"), ident.get("nom"), ident.get("prenom")) if x)
        try:
            v = ex.evaluer(formule, r)
            resultats.append({"titre": titre, "valeur": _json(v), "texte": fmt.texte_par_defaut(v),
                              "type": type(v).__name__ if v is not None else "VIDE", "manques": r.manques, "erreur": None})
        except ex.ErreurFormule as err:
            resultats.append({"titre": titre, "valeur": None, "texte": "", "type": "ERREUR", "manques": r.manques,
                              "erreur": err.message})
    return {"nb_lignes": len(prep.lignes), "resultats": resultats}
