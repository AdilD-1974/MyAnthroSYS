"""
app/editions/service.py — Cycle de vie des modèles et production des éditions.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Toute la logique métier de l'API /editions vit ici, sans dépendance à FastAPI :
le routeur (app/routers/editions.py) ne fait que traduire HTTP ↔ ces fonctions,
et les tests l'exercent directement sur la base de recette.

Règles :
    RG-EDT-MODELE-01  un modèle est visible s'il est système ou GLOBAL, SOCIETE de la
                      société active, ou PRIVE de son propriétaire ; l'administrateur
                      voit aussi les modèles privés de la société.
    RG-EDT-MODELE-02  un modèle système ne se modifie pas : on le copie ou on lui
                      applique une variante de forme.
    RG-EDT-VERSION-02 un seul brouillon par modèle ; il part de la version publiée.
    RG-EDT-VERSION-03 enregistrement concurrent : le jeton (If-Match) doit être celui
                      de la dernière lecture, sinon 409 et rien n'est écrit.
    RG-EDT-VERSION-04 publier = valider, figer l'empreinte et les dépendances, retirer
                      la version publiée précédente — dans la même transaction.
    RG-EDT-PROD-01    on ne lance que la version publiée (la variante par défaut de la
                      société si elle est publiée) ; l'aperçu accepte le brouillon,
                      avec un filigrane, et n'est pas conservé.
    RG-EDT-PROD-02    chaque lancement laisse une demande et ses documents (empreinte
                      du fichier et des données) : on sait toujours ce qui a été édité.
    RG-EDT-SECU-03    droits : administrateur = tout ; sinon edt_droit (rôle ou
                      utilisateur, sur un modèle, une catégorie ou tout) ; tant qu'aucun
                      droit n'est paramétré pour la société, droits par défaut ci-dessous.
    RG-EDT-SECU-04    un document contenant des données sensibles n'est téléchargé que
                      par un utilisateur qui a ce droit.
    RG-EDT-SECU-05    les documents produits sont rangés hors du dossier publié de l'API.
    RG-EDT-AUDIT-01   création, enregistrement, publication, lancement, aperçu et
                      téléchargement sont tracés dans edt_audit.

SQL standard (pas d'ON CONFLICT ni de RETURNING) : portable SQL Server.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.editions import catalogue as cat
from app.editions import expressions as ex
from app.editions import format as fmt
from app.editions import variantes
from app.editions.definition import Definition
from app.editions.moteur.executeur import DocumentProduit, donnees_brutes, executer, tester_formule
from app.editions.sources import ContexteSecurite, ErreurSource
from app.editions.validation import CatalogueValidation, Rapport, valider

log = logging.getLogger(__name__)

DOSSIER_SYSTEME = Path(__file__).resolve().parent / "modeles_systeme"
# fichier → (code, libellé, catégorie) des modèles livrés avec l'application
MODELES_SYSTEME = {
    "bulletin_classique.json": ("BULLETIN_CLASSIQUE", "Bulletin de paie classique", "BULLETIN"),
}
CATEGORIES = ("BULLETIN", "JOURNAL", "ATTESTATION", "COURRIER", "LISTE", "DECLARATION", "AUTRE")
TYPES_DEPENDANCE = {"SOURCE", "CHAMP", "RUBRIQUE", "CONSTANTE", "MASQUE", "ASSET", "SOUS_MODELE", "TABLE"}
APERCU_MAX_DOCUMENTS = 5
FILIGRANE_APERCU = "APERÇU"

# RG-EDT-SECU-03 : droits par défaut, tant qu'edt_droit est vide pour la société
TOUS = None
DROITS_DEFAUT: dict[str, Optional[tuple[str, ...]]] = {
    "VOIR": TOUS,
    "LANCER": TOUS,
    "CONCEVOIR": ("gestionnaire_rh", "gestionnaire_paie"),
    "PUBLIER": ("gestionnaire_rh", "gestionnaire_paie"),
    "DONNEES_SENSIBLES": ("gestionnaire_rh", "gestionnaire_paie"),
    "DIFFUSER": ("gestionnaire_rh", "gestionnaire_paie"),
    "SIGNER": (),
    "ADMINISTRER": (),
}


# un droit plus fort donne les plus faibles : qui peut lancer ou concevoir un modèle peut le voir
IMPLIQUE = {"VOIR": ("VOIR", "LANCER", "CONCEVOIR", "PUBLIER", "DIFFUSER")}


# ---------------------------------------------------------------------------
# Erreurs métier → codes HTTP dans le routeur
# ---------------------------------------------------------------------------
class ErreurEdition(Exception):
    statut = 400

    def __init__(self, message: str, details: Any = None):
        super().__init__(message)
        self.message = message
        self.details = details
        self.conserver = False          # True : les écritures faites avant l'erreur sont validées


class Introuvable(ErreurEdition):
    statut = 404


class Interdit(ErreurEdition):
    statut = 403


class Conflit(ErreurEdition):
    statut = 409


class Invalide(ErreurEdition):
    statut = 422


# ---------------------------------------------------------------------------
# Utilisateur courant
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Utilisateur:
    id: Optional[str]
    societe_id: str
    roles: frozenset[str] = field(default_factory=frozenset)

    @property
    def admin(self) -> bool:
        return "administrateur" in self.roles


def _uuid(v: Any) -> Optional[str]:
    try:
        return str(uuid.UUID(str(v)))
    except (ValueError, TypeError, AttributeError):
        return None


def _en_liste(sql: str, *noms: str):
    return text(sql).bindparams(*(bindparam(n, expanding=True) for n in noms))


# ---------------------------------------------------------------------------
# Droits — RG-EDT-SECU-03
# ---------------------------------------------------------------------------
def peut(db: Session, u: Utilisateur, permission: str, modele: Optional[dict] = None) -> bool:
    if u.admin:
        return True
    parametres = db.execute(text(
        "SELECT count(*) FROM edt_droit WHERE societe_id IS NULL OR societe_id = :s"),
        {"s": u.societe_id}).scalar()
    if not parametres:
        roles = DROITS_DEFAUT.get(permission, ())
        return True if roles is TOUS else bool(u.roles & set(roles))
    sql = """SELECT 1 FROM edt_droit
             WHERE permission IN :p AND (societe_id IS NULL OR societe_id = :s)
               AND (utilisateur_id = :u OR role_code IN :roles)
               AND (cible = 'TOUT'
                    OR (cible = 'CATEGORIE' AND cible_code = :cat)
                    OR (cible = 'MODELE' AND cible_code = :mid))"""
    return db.execute(_en_liste(sql, "roles", "p"), {
        "p": list(IMPLIQUE.get(permission, (permission,))), "s": u.societe_id, "u": _uuid(u.id),
        "roles": sorted(u.roles) or [""],
        "cat": (modele or {}).get("categorie") or "", "mid": str((modele or {}).get("id") or ""),
    }).first() is not None


def exiger(db: Session, u: Utilisateur, permission: str, modele: Optional[dict] = None) -> None:
    if not peut(db, u, permission, modele):
        raise Interdit(f"Droit « {permission} » requis"
                       + (f" sur le modèle {modele['code']}" if modele else ""))


def contexte_securite(db: Session, u: Utilisateur, modele: Optional[dict] = None) -> ContexteSecurite:
    return ContexteSecurite(u.id, u.societe_id, frozenset(u.roles),
                            donnees_sensibles=peut(db, u, "DONNEES_SENSIBLES", modele))


# ---------------------------------------------------------------------------
# Audit — RG-EDT-AUDIT-01
# ---------------------------------------------------------------------------
def auditer(db: Session, u: Optional[Utilisateur], action: str, objet_type: str,
            objet_id: Optional[str], details: Optional[dict] = None) -> None:
    db.execute(text("""INSERT INTO edt_audit (utilisateur_id, societe_id, action, objet_type, objet_id, details)
                       VALUES (:u, :s, :a, :t, :o, CAST(:d AS jsonb))"""),
               {"u": _uuid(u.id) if u else None, "s": u.societe_id if u else None, "a": action,
                "t": objet_type, "o": _uuid(objet_id), "d": json.dumps(details or {}, default=str)})


# ---------------------------------------------------------------------------
# Lecture des modèles — RG-EDT-MODELE-01
# ---------------------------------------------------------------------------
COLONNES_MODELE = """m.id, m.code, m.libelle, m.description, m.categorie, m.moteur, m.societe_id,
    m.proprietaire_id, m.visibilite, m.est_systeme, m.modele_origine_id, m.version_publiee_id,
    m.archive, m.cree_le, m.modifie_le"""


# RG-EDT-ACTIF-01 / RG-EDT-THEME-01 (migration 078) : actif et classement par société
COLONNES_REGLAGE = "COALESCE(rg.actif, true) AS actif, rg.theme_id, COALESCE(rg.ordre, 0) AS ordre_theme"
JOINTURE_REGLAGE = "LEFT JOIN edt_modele_reglage rg ON rg.modele_id = m.id AND rg.societe_id = :s"


def _visible_sql(u: Utilisateur) -> str:
    admin = " OR (m.visibilite = 'PRIVE' AND m.societe_id = :s)" if u.admin else ""
    return f"""(m.est_systeme = true OR m.visibilite = 'GLOBAL'
                OR (m.visibilite = 'SOCIETE' AND m.societe_id = :s)
                OR (m.visibilite = 'PRIVE' AND m.proprietaire_id = :u){admin})"""


def _propre(row) -> dict:
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, uuid.UUID):
            d[k] = str(v)
    return d


def lister_modeles(db: Session, u: Utilisateur, categorie: Optional[str] = None,
                   archives: bool = False) -> list[dict]:
    filtres = [_visible_sql(u)]
    if not archives:
        filtres.append("m.archive = false")
    if categorie:
        filtres.append("m.categorie = :cat")
    rows = db.execute(text(f"""
        SELECT {COLONNES_MODELE}, {COLONNES_REGLAGE}, v.numero AS numero_publie, v.publie_le,
               (SELECT b.id FROM edt_modele_version b WHERE b.modele_id = m.id
                  AND b.statut IN ('BROUILLON','EN_REVUE')) AS brouillon_id
        FROM edt_modele m LEFT JOIN edt_modele_version v ON v.id = m.version_publiee_id
        {JOINTURE_REGLAGE}
        WHERE {' AND '.join(filtres)}
        ORDER BY m.categorie, m.libelle"""),
        {"s": u.societe_id, "u": _uuid(u.id), "cat": categorie}).mappings().all()
    return [_propre(r) for r in rows if peut(db, u, "VOIR", r)]


def lire_modele(db: Session, u: Utilisateur, modele_id: str) -> dict:
    if not _uuid(modele_id):
        raise Introuvable("Modèle introuvable")
    r = db.execute(text(f"""SELECT {COLONNES_MODELE}, {COLONNES_REGLAGE} FROM edt_modele m {JOINTURE_REGLAGE}
                            WHERE m.id = :id AND {_visible_sql(u)}"""),
                   {"id": modele_id, "s": u.societe_id, "u": _uuid(u.id)}).mappings().first()
    if r is None or not peut(db, u, "VOIR", r):
        raise Introuvable("Modèle introuvable")          # 404 et non 403 : ne révèle pas son existence
    return _propre(r)


COLONNES_VERSION = """id, modele_id, numero, statut, definition, schema_version, empreinte,
    jeton_concurrence, note, cree_par, cree_le, modifie_le, publie_par, publie_le"""


def lister_versions(db: Session, u: Utilisateur, modele_id: str) -> list[dict]:
    lire_modele(db, u, modele_id)
    rows = db.execute(text("""SELECT id, numero, statut, empreinte, note, cree_par, cree_le, modifie_le,
                                     publie_par, publie_le
                              FROM edt_modele_version WHERE modele_id = :m ORDER BY numero DESC"""),
                      {"m": modele_id}).mappings().all()
    return [_propre(r) for r in rows]


def lire_version(db: Session, u: Utilisateur, version_id: str) -> tuple[dict, dict]:
    """(version, modèle) ; 404 si le modèle n'est pas visible."""
    if not _uuid(version_id):
        raise Introuvable("Version introuvable")
    v = db.execute(text(f"SELECT {COLONNES_VERSION} FROM edt_modele_version WHERE id = :id"),
                   {"id": version_id}).mappings().first()
    if v is None:
        raise Introuvable("Version introuvable")
    m = lire_modele(db, u, str(v["modele_id"]))
    v = _propre(v)
    if isinstance(v["definition"], str):
        v["definition"] = json.loads(v["definition"])
    return v, m


# ---------------------------------------------------------------------------
# Création et copie
# ---------------------------------------------------------------------------
def definition_vierge() -> dict:
    """Point de départ d'un modèle sans origine : une liste A4 sur les bulletins."""
    return {
        "schema_version": 1,
        "parametres": [{"code": "periode", "libelle": "Période", "type": "PERIODE"}],
        "jeux": [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"]}],
        "page": {"format": "A4", "orientation": "PORTRAIT", "marges": [12, 12, 12, 12]},
        "bandes": [
            {"id": "entete", "type": "EN_TETE_PAGE", "hauteur": 15, "elements": [
                {"id": "titre", "type": "TEXTE", "x": 0, "y": 0, "l": 186, "h": 8,
                 "valeur": "\"Nouvel état\"", "style": {"gras": True, "taille": 12}}]},
            {"id": "corps", "type": "CORPS", "hauteur": 6, "elements": [
                {"id": "matricule", "type": "CHAMP", "x": 0, "y": 0, "l": 30, "h": 6,
                 "valeur": "identite.matricule"},
                {"id": "nom", "type": "CHAMP", "x": 32, "y": 0, "l": 80, "h": 6,
                 "valeur": "identite.nom + \" \" + identite.prenom"}]},
        ],
    }


def _code_libre(db: Session, code: str, societe_id: Optional[str]) -> bool:
    return db.execute(text("""SELECT 1 FROM edt_modele WHERE code = :c
                              AND (societe_id = :s OR (societe_id IS NULL AND :s IS NULL))"""),
                      {"c": code, "s": societe_id}).first() is None


def _inserer_modele(db: Session, *, code: str, libelle: str, categorie: str, societe_id: Optional[str],
                    proprietaire_id: Optional[str], visibilite: str, est_systeme: bool = False,
                    description: Optional[str] = None, origine_id: Optional[str] = None) -> str:
    mid = str(uuid.uuid4())
    db.execute(text("""INSERT INTO edt_modele (id, code, libelle, description, categorie, societe_id,
                          proprietaire_id, visibilite, est_systeme, modele_origine_id)
                       VALUES (:id, :c, :l, :d, :cat, :s, :p, :v, :sys, :o)"""),
               {"id": mid, "c": code, "l": libelle, "d": description, "cat": categorie, "s": societe_id,
                "p": proprietaire_id, "v": visibilite, "sys": est_systeme, "o": origine_id})
    return mid


def _inserer_version(db: Session, modele_id: str, numero: int, definition: dict, cree_par: Optional[str],
                     statut: str = "BROUILLON", empreinte: Optional[str] = None,
                     note: Optional[str] = None) -> str:
    vid = str(uuid.uuid4())
    db.execute(text("""INSERT INTO edt_modele_version (id, modele_id, numero, statut, definition, schema_version,
                          empreinte, jeton_concurrence, note, cree_par)
                       VALUES (:id, :m, :n, :st, CAST(:d AS jsonb), :sv, :e, :j, :note, :u)"""),
               {"id": vid, "m": modele_id, "n": numero, "st": statut, "d": json.dumps(definition, ensure_ascii=False),
                "sv": int(definition.get("schema_version", 1)), "e": empreinte, "j": str(uuid.uuid4()),
                "note": note, "u": cree_par})
    return vid


def creer_modele(db: Session, u: Utilisateur, *, code: str, libelle: str, categorie: str = "AUTRE",
                 description: Optional[str] = None, visibilite: str = "PRIVE",
                 definition: Optional[dict] = None, origine_id: Optional[str] = None) -> dict:
    """Nouveau modèle de la société active, avec son brouillon n° 1. `origine_id` :
    copie de la version publiée (à défaut la plus récente) d'un modèle visible."""
    exiger(db, u, "CONCEVOIR")
    code = (code or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,59}", code):
        raise Invalide("Code : lettres majuscules, chiffres et _, commençant par une lettre (2 à 60)")
    if categorie not in CATEGORIES:
        raise Invalide(f"Catégorie inconnue : {categorie}")
    if visibilite not in ("PRIVE", "SOCIETE", "GLOBAL") or (visibilite == "GLOBAL" and not u.admin):
        raise Invalide("Visibilité : PRIVE ou SOCIETE (GLOBAL réservé à l'administrateur)")
    if not _code_libre(db, code, u.societe_id):
        raise Conflit(f"Le code {code} est déjà utilisé dans cette société")
    if origine_id:
        origine = lire_modele(db, u, origine_id)
        v = db.execute(text("""SELECT definition FROM edt_modele_version WHERE modele_id = :m
                               ORDER BY CASE WHEN statut = 'PUBLIEE' THEN 0 ELSE 1 END, numero DESC"""),
                       {"m": origine_id}).first()
        if v is None:
            raise Conflit("Le modèle d'origine n'a aucune version")
        definition = v[0] if isinstance(v[0], dict) else json.loads(v[0])
        categorie = categorie if categorie != "AUTRE" else origine["categorie"]
    definition = definition or definition_vierge()
    if not isinstance(definition, dict):
        raise Invalide("La définition est un objet JSON")
    mid = _inserer_modele(db, code=code, libelle=libelle.strip() or code, categorie=categorie,
                          societe_id=u.societe_id, proprietaire_id=_uuid(u.id), visibilite=visibilite,
                          description=description, origine_id=origine_id)
    vid = _inserer_version(db, mid, 1, definition, _uuid(u.id))
    auditer(db, u, "CREATION", "MODELE", mid, {"code": code, "origine": origine_id})
    return {"modele_id": mid, "version_id": vid}


# ---------------------------------------------------------------------------
# Brouillon — RG-EDT-VERSION-02/03
# ---------------------------------------------------------------------------
def _modifiable(db: Session, u: Utilisateur, m: dict) -> None:
    if m["est_systeme"]:
        raise Interdit("Modèle système : le copier ou lui appliquer une variante de forme (RG-EDT-MODELE-02)")
    if m["visibilite"] == "PRIVE" and m["proprietaire_id"] != _uuid(u.id) and not u.admin:
        raise Interdit("Modèle privé d'un autre utilisateur")
    exiger(db, u, "CONCEVOIR", m)


def ouvrir_brouillon(db: Session, u: Utilisateur, modele_id: str) -> dict:
    """Brouillon existant, ou nouveau brouillon copié de la version publiée."""
    m = lire_modele(db, u, modele_id)
    _modifiable(db, u, m)
    b = db.execute(text("""SELECT id FROM edt_modele_version
                           WHERE modele_id = :m AND statut IN ('BROUILLON','EN_REVUE')"""), {"m": modele_id}).first()
    if b:
        return {"version_id": str(b[0]), "cree": False}
    base = db.execute(text("""SELECT definition FROM edt_modele_version WHERE modele_id = :m
                              ORDER BY CASE WHEN statut = 'PUBLIEE' THEN 0 ELSE 1 END, numero DESC"""),
                      {"m": modele_id}).first()
    numero = db.execute(text("SELECT COALESCE(MAX(numero), 0) + 1 FROM edt_modele_version WHERE modele_id = :m"),
                        {"m": modele_id}).scalar()
    definition = (base[0] if isinstance(base[0], dict) else json.loads(base[0])) if base else definition_vierge()
    vid = _inserer_version(db, modele_id, numero, definition, _uuid(u.id))
    auditer(db, u, "BROUILLON", "VERSION", vid, {"modele": m["code"], "numero": numero})
    return {"version_id": vid, "cree": True}


def enregistrer(db: Session, u: Utilisateur, version_id: str, definition: dict, jeton: Optional[str],
                note: Optional[str] = None) -> dict:
    """Écrit le brouillon (même invalide : le designer enregistre un travail en
    cours) et renvoie le nouveau jeton + le rapport de validation."""
    v, m = lire_version(db, u, version_id)
    _modifiable(db, u, m)
    if v["statut"] not in ("BROUILLON", "EN_REVUE"):
        raise Conflit(f"La version n° {v['numero']} est {v['statut'].lower()} : ouvrir un brouillon")
    if not isinstance(definition, dict):
        raise Invalide("La définition est un objet JSON")
    if not jeton or str(jeton) != v["jeton_concurrence"]:
        raise Conflit("Le modèle a été modifié entre-temps : recharger avant d'enregistrer (RG-EDT-VERSION-03)",
                      {"jeton_actuel": v["jeton_concurrence"]})
    nouveau = str(uuid.uuid4())
    res = db.execute(text("""UPDATE edt_modele_version
                             SET definition = CAST(:d AS jsonb), schema_version = :sv, jeton_concurrence = :n,
                                 note = COALESCE(:note, note), modifie_le = CURRENT_TIMESTAMP
                             WHERE id = :id AND jeton_concurrence = :j AND statut IN ('BROUILLON','EN_REVUE')"""),
                     {"d": json.dumps(definition, ensure_ascii=False), "sv": int(definition.get("schema_version", 1)),
                      "n": nouveau, "note": note, "id": version_id, "j": jeton})
    if res.rowcount != 1:                                   # course perdue entre lecture et écriture
        raise Conflit("Le modèle a été modifié entre-temps : recharger avant d'enregistrer (RG-EDT-VERSION-03)")
    db.execute(text("UPDATE edt_modele SET modifie_le = CURRENT_TIMESTAMP WHERE id = :m"), {"m": m["id"]})
    auditer(db, u, "ENREGISTREMENT", "VERSION", version_id, {"modele": m["code"], "numero": v["numero"]})
    rapport = valider(definition, cat.charger(db, u.societe_id))
    return {"jeton": nouveau, **rapport_en_dict(rapport)}


def rapport_en_dict(r: Rapport) -> dict:
    return {"valide": r.valide, "erreurs": [e.en_dict() for e in r.erreurs],
            "dependances": sorted([{"type": t, "code": c} for t, c in r.dependances],
                                  key=lambda x: (x["type"], x["code"]))}


def valider_version(db: Session, u: Utilisateur, version_id: str) -> dict:
    v, _ = lire_version(db, u, version_id)
    return rapport_en_dict(valider(v["definition"], cat.charger(db, u.societe_id)))


# ---------------------------------------------------------------------------
# Publication — RG-EDT-VERSION-04
# ---------------------------------------------------------------------------
def _figer(db: Session, modele_id: str, version_id: str, rapport: Rapport, publie_par: Optional[str],
           empreinte: str) -> None:
    db.execute(text("""UPDATE edt_modele_version SET statut = 'RETIREE'
                       WHERE modele_id = :m AND statut = 'PUBLIEE'"""), {"m": modele_id})
    db.execute(text("""UPDATE edt_modele_version SET statut = 'PUBLIEE', empreinte = :e, publie_par = :u,
                          publie_le = CURRENT_TIMESTAMP, modifie_le = CURRENT_TIMESTAMP WHERE id = :id"""),
               {"e": empreinte, "u": publie_par, "id": version_id})
    db.execute(text("DELETE FROM edt_modele_dependance WHERE version_id = :id"), {"id": version_id})
    for t, c in sorted(rapport.dependances):
        if t in TYPES_DEPENDANCE:
            db.execute(text("INSERT INTO edt_modele_dependance (version_id, type, code) VALUES (:v, :t, :c)"),
                       {"v": version_id, "t": t, "c": c})
    db.execute(text("""UPDATE edt_modele SET version_publiee_id = :v, modifie_le = CURRENT_TIMESTAMP
                       WHERE id = :m"""), {"v": version_id, "m": modele_id})


def publier(db: Session, u: Utilisateur, version_id: str, jeton: Optional[str] = None) -> dict:
    v, m = lire_version(db, u, version_id)
    _modifiable(db, u, m)
    exiger(db, u, "PUBLIER", m)
    if v["statut"] not in ("BROUILLON", "EN_REVUE"):
        raise Conflit(f"La version n° {v['numero']} est déjà {v['statut'].lower()}")
    if jeton and str(jeton) != v["jeton_concurrence"]:
        raise Conflit("Le modèle a été modifié entre-temps : recharger avant de publier (RG-EDT-VERSION-03)")
    rapport = valider(v["definition"], cat.charger(db, u.societe_id))
    if not rapport.valide:
        raise Invalide("Le modèle comporte des erreurs : publication impossible", rapport_en_dict(rapport))
    empreinte = rapport.definition.empreinte()
    _figer(db, m["id"], version_id, rapport, _uuid(u.id), empreinte)
    auditer(db, u, "PUBLICATION", "VERSION", version_id,
            {"modele": m["code"], "numero": v["numero"], "empreinte": empreinte})
    return {"version_id": version_id, "numero": v["numero"], "empreinte": empreinte}


# ---------------------------------------------------------------------------
# Modèles système — installés ou mis à jour au démarrage
# ---------------------------------------------------------------------------
def installer_modeles_systeme(db: Session, dossier: Path = DOSSIER_SYSTEME) -> list[str]:
    """Publie chaque modèle livré : création au premier démarrage, nouvelle
    version publiée quand le fichier livré a changé. Ne valide pas : commit à
    la charge de l'appelant."""
    actions = []
    for fichier, (code, libelle, categorie) in MODELES_SYSTEME.items():
        chemin = dossier / fichier
        if not chemin.exists():
            continue
        d = Definition.model_validate(json.loads(chemin.read_text(encoding="utf-8")))
        brut = d.model_dump(mode="json")
        empreinte = d.empreinte()
        m = db.execute(text("""SELECT id FROM edt_modele WHERE code = :c AND societe_id IS NULL
                               AND est_systeme = true"""), {"c": code}).first()
        if m is None:
            mid = _inserer_modele(db, code=code, libelle=libelle, categorie=categorie, societe_id=None,
                                  proprietaire_id=None, visibilite="GLOBAL", est_systeme=True)
            numero = 1
        else:
            mid = str(m[0])
            actuelle = db.execute(text("""SELECT empreinte FROM edt_modele_version
                                          WHERE modele_id = :m AND statut = 'PUBLIEE'"""), {"m": mid}).first()
            if actuelle and actuelle[0] == empreinte:
                continue
            numero = db.execute(text("SELECT COALESCE(MAX(numero), 0) + 1 FROM edt_modele_version "
                                     "WHERE modele_id = :m"), {"m": mid}).scalar()
        vid = _inserer_version(db, mid, numero, brut, None, note=f"Livré avec l'application ({fichier})")
        rapport = Rapport(definition=d)
        rapport.dependances = {("SOURCE", j.source) for j in d.jeux}
        _figer(db, mid, vid, rapport, None, empreinte)
        auditer(db, None, "INSTALLATION", "VERSION", vid, {"modele": code, "numero": numero})
        actions.append(f"{code} v{numero}")
    return actions


def initialiser(db: Session) -> dict:
    """Démarrage de l'API : catalogue des sources puis modèles système."""
    bilan = cat.synchroniser(db)
    bilan["modeles_systeme"] = installer_modeles_systeme(db)
    return bilan


# ---------------------------------------------------------------------------
# Exécution : aperçu et lancement — RG-EDT-PROD-01/02
# ---------------------------------------------------------------------------
def registre_masques(db: Session, societe_id: str) -> dict:
    """Masques propres à la société (prioritaires) et masques communs."""
    rows = db.execute(text("""SELECT code, libelle, type_donnee, parametres, societe_id FROM edt_masque
                              WHERE actif = true AND (societe_id IS NULL OR societe_id = :s)
                              ORDER BY CASE WHEN societe_id IS NULL THEN 0 ELSE 1 END"""),
                      {"s": societe_id}).mappings().all()
    reg = {}
    for r in rows:
        p = r["parametres"] if isinstance(r["parametres"], dict) else json.loads(r["parametres"])
        reg[r["code"]] = {**p, "type": r["type_donnee"], "libelle": r["libelle"]}
    return reg


def _definition_executable(db: Session, u: Utilisateur, v: dict, avec_variante: bool) -> tuple[Definition, Optional[str]]:
    d = Definition.model_validate(v["definition"])
    if not avec_variante:
        return d, None
    var = db.execute(text("""SELECT vv.id, vv.surcharges FROM edt_variante va
                             JOIN edt_variante_version vv ON vv.id = va.version_publiee_id
                             WHERE va.modele_id = :m AND va.par_defaut = true AND va.archive = false
                               AND (va.societe_id = :s OR va.societe_id IS NULL)
                             ORDER BY CASE WHEN va.societe_id IS NULL THEN 1 ELSE 0 END"""),
                     {"m": v["modele_id"], "s": u.societe_id}).first()
    if var is None:
        return d, None
    surcharges = var[1] if isinstance(var[1], list) else json.loads(var[1])
    res = variantes.appliquer(d, surcharges)
    if res.conflits:
        log.warning("Variante %s : %d surcharge(s) ignorée(s)", var[0], len(res.conflits))
    return res.definition, str(var[0])


def _executer(db: Session, u: Utilisateur, m: dict, v: dict, d: Definition, parametres: dict,
              filigrane: Optional[str] = None, forme: Optional[str] = None) -> tuple[list[DocumentProduit], bool]:
    sec = contexte_securite(db, u, m)
    bruts = {**(parametres or {}), "_modele": m["code"], "_version": v["numero"]}
    try:
        docs = executer(db, d, bruts, sec, registre_masques=registre_masques(db, u.societe_id),
                        racine_fichiers=str(racine_stockage()), filigrane=filigrane, forme=forme)
    except ErreurSource as e:
        raise ErreurEdition(str(e))
    except SQLAlchemyError as e:
        # jamais d'erreur 500 brute : la transaction est annulée et le motif remonte à l'écran
        db.rollback()
        log.exception("Édition %s : erreur de lecture des données", m["code"])
        raise ErreurEdition(f"Lecture des données impossible : {str(getattr(e, 'orig', e)).splitlines()[0][:300]}")
    return docs, sec.donnees_sensibles


def apercu(db: Session, u: Utilisateur, version_id: str, parametres: dict,
           forme: Optional[str] = None) -> tuple[bytes, dict]:
    """PDF filigrané d'une version quelconque (brouillon compris), non conservé :
    les premiers documents sont réunis en un seul fichier."""
    v, m = lire_version(db, u, version_id)
    exiger(db, u, "CONCEVOIR" if v["statut"] != "PUBLIEE" else "LANCER", m)
    try:
        d, _ = _definition_executable(db, u, v, avec_variante=False)
    except Exception as e:                                   # définition invalide (brouillon)
        raise Invalide("Le modèle comporte des erreurs : aperçu impossible", {"message": str(e)[:2000]})
    docs, _ = _executer(db, u, m, v, d, parametres, filigrane=FILIGRANE_APERCU, forme=forme)
    auditer(db, u, "APERCU", "VERSION", version_id, {"modele": m["code"], "documents": len(docs)})
    info = {"documents": len(docs), "affiches": min(len(docs), APERCU_MAX_DOCUMENTS),
            "anomalies": [{"element": a.source_id, "message": a.message}
                          for doc in docs[:APERCU_MAX_DOCUMENTS] for a in doc.anomalies]}
    if not docs:
        raise ErreurEdition("Aucune donnée pour ces paramètres")
    if len(docs) == 1:
        return docs[0].contenu, info
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for doc in docs[:APERCU_MAX_DOCUMENTS]:
        for page in PdfReader(io.BytesIO(doc.contenu)).pages:
            w.add_page(page)
    sortie = io.BytesIO()
    w.write(sortie)
    return sortie.getvalue(), info


def donnees(db: Session, u: Utilisateur, version_id: str, parametres: dict) -> dict:
    """Aperçu tabulaire des données (corps, variables) d'une version, sans mise en page."""
    v, m = lire_version(db, u, version_id)
    exiger(db, u, "CONCEVOIR" if v["statut"] != "PUBLIEE" else "LANCER", m)
    try:
        d = Definition.model_validate(v["definition"])
    except Exception as e:
        raise Invalide("Le modèle comporte des erreurs : aperçu impossible", {"message": str(e)[:2000]})
    try:
        res = donnees_brutes(db, d, parametres or {}, contexte_securite(db, u, m))
    except ErreurSource as e:
        raise ErreurEdition(str(e))
    except SQLAlchemyError as e:
        db.rollback()
        log.exception("Aperçu des données %s", m["code"])
        raise ErreurEdition(f"Lecture des données impossible : {str(getattr(e, 'orig', e)).splitlines()[0][:300]}")
    auditer(db, u, "APERCU_DONNEES", "VERSION", version_id, {"modele": m["code"]})
    return res


def tester(db: Session, u: Utilisateur, definition: dict, formule: str, parametres: dict,
           contexte: Optional[str] = None) -> dict:
    """Assistant de formule : valeur de `formule` sur de vrais documents, avec la
    définition EN COURS (non enregistrée) du designer. Rien n'est écrit."""
    exiger(db, u, "CONCEVOIR")
    if not (formule or "").strip():
        raise Invalide("Formule vide")
    try:
        d = Definition.model_validate(definition)
    except Exception as e:
        raise Invalide("La définition comporte des erreurs de structure : test impossible", {"message": str(e)[:2000]})
    try:
        return tester_formule(db, d, parametres or {}, contexte_securite(db, u), formule, contexte)
    except ErreurSource as e:
        raise ErreurEdition(str(e))
    except SQLAlchemyError as e:
        db.rollback()
        raise ErreurEdition(f"Lecture des données impossible : {str(getattr(e, 'orig', e)).splitlines()[0][:300]}")


def racine_stockage() -> Path:
    """Fichiers lus par les modèles (logos, images) : le dossier storage de l'API."""
    return Path("storage")


def racine_documents() -> Path:
    """RG-EDT-SECU-05 : documents produits, HORS de storage — main.py publie
    storage sans authentification (/api/v1/storage). Ils ne sortent que par
    GET /editions/documents/{id}/fichier, qui contrôle les droits.
    Réglable par la variable d'environnement EDITIONS_DOCUMENTS."""
    return Path(os.environ.get("EDITIONS_DOCUMENTS", "donnees_privees/editions"))


def lancer(db: Session, u: Utilisateur, modele_id: str, parametres: dict, forme: Optional[str] = None) -> dict:
    """Production synchrone (lot 1) de la version publiée : demande + documents
    conservés sous <racine_documents>/<société>/<AAAA>/<MM>/<demande>/."""
    m = lire_modele(db, u, modele_id)
    exiger(db, u, "LANCER", m)
    if not m.get("actif", True):                                              # RG-EDT-ACTIF-01
        raise Conflit("Cet état est désactivé : réactivez-le (indicateur Actif) pour le lancer")
    if not m["version_publiee_id"]:
        raise Conflit("Ce modèle n'a pas de version publiée")
    v, _ = lire_version(db, u, m["version_publiee_id"])
    d, variante_version = _definition_executable(db, u, v, avec_variante=True)
    defaut = d.usages.forme_par_defaut or d.forme_code
    if forme and forme != defaut and not d.usages.formes_au_choix:            # « Autoriser choix Qrp »
        raise Interdit("Cet état n'autorise pas le choix de la mise en forme")
    demande_id = str(uuid.uuid4())
    db.execute(text("""INSERT INTO edt_demande (id, version_id, variante_version_id, parametres, formats, origine,
                          statut, demandeur_id, societe_id, debut)
                       VALUES (:id, :v, :vv, CAST(:p AS jsonb), 'PDF', 'ECRAN', 'EN_COURS', :u, :s, CURRENT_TIMESTAMP)"""),
               {"id": demande_id, "v": v["id"], "vv": variante_version, "p": json.dumps(parametres or {}, default=str),
                "u": _uuid(u.id), "s": u.societe_id})
    try:
        docs, sensible = _executer(db, u, m, v, d, parametres, forme=forme)
    except ErreurEdition as e:
        db.execute(text("""UPDATE edt_demande SET statut = 'ECHEC', fin = CURRENT_TIMESTAMP, erreur = :e
                           WHERE id = :id"""), {"e": e.message[:2000], "id": demande_id})
        auditer(db, u, "LANCEMENT_ECHEC", "DEMANDE", demande_id, {"modele": m["code"], "erreur": e.message})
        e.details = {"demande_id": demande_id}
        e.conserver = True
        raise

    maintenant = datetime.now()
    relatif = Path(u.societe_id) / f"{maintenant:%Y}" / f"{maintenant:%m}" / demande_id
    dossier = racine_documents() / relatif
    dossier.mkdir(parents=True, exist_ok=True)
    produits, noms = [], set()
    for doc in docs:
        nom = doc.nom_fichier
        if nom in noms:                                       # deux documents de même nom : suffixe
            nom = f"{Path(nom).stem}_{len(noms) + 1}{Path(nom).suffix}"
        noms.add(nom)
        (dossier / nom).write_bytes(doc.contenu)
        did = str(uuid.uuid4())
        db.execute(text("""INSERT INTO edt_document (id, demande_id, cle_objet, format, nom_fichier, stockage, sha256,
                              empreinte_donnees, nb_pages, contient_sensible, code_verification)
                           VALUES (:id, :d, :cle, :f, :nom, :st, :sha, :emp, :np, :sens, :code)"""),
                   {"id": did, "d": demande_id, "cle": _uuid(doc.cle_objet), "f": doc.format, "nom": nom,
                    "st": (relatif / nom).as_posix(), "sha": hashlib.sha256(doc.contenu).hexdigest(),
                    "emp": doc.empreinte_donnees, "np": doc.nb_pages, "sens": sensible,
                    "code": secrets.token_hex(8).upper()})
        produits.append({"id": did, "nom_fichier": nom, "nb_pages": doc.nb_pages,
                         "anomalies": [{"element": a.source_id, "message": a.message} for a in doc.anomalies]})
    db.execute(text("""UPDATE edt_demande SET statut = 'TERMINEE', progression = 100, nb_documents = :n,
                          fin = CURRENT_TIMESTAMP WHERE id = :id"""), {"n": len(produits), "id": demande_id})
    auditer(db, u, "LANCEMENT", "DEMANDE", demande_id,
            {"modele": m["code"], "numero": v["numero"], "documents": len(produits), "parametres": parametres})
    return {"demande_id": demande_id, "statut": "TERMINEE", "documents": produits}


def lire_demande(db: Session, u: Utilisateur, demande_id: str) -> dict:
    if not _uuid(demande_id):
        raise Introuvable("Demande introuvable")
    r = db.execute(text("""SELECT d.id, d.version_id, d.parametres, d.origine, d.statut, d.progression,
                                  d.nb_documents, d.demandeur_id, d.cree_le, d.debut, d.fin, d.erreur,
                                  v.numero, m.id AS modele_id, m.code AS modele_code, m.libelle AS modele_libelle
                           FROM edt_demande d JOIN edt_modele_version v ON v.id = d.version_id
                           JOIN edt_modele m ON m.id = v.modele_id
                           WHERE d.id = :id AND d.societe_id = :s"""),
                   {"id": demande_id, "s": u.societe_id}).mappings().first()
    if r is None or (str(r["demandeur_id"]) != _uuid(u.id) and not u.admin):
        raise Introuvable("Demande introuvable")
    docs = db.execute(text("""SELECT id, nom_fichier, format, nb_pages, contient_sensible, genere_le
                              FROM edt_document WHERE demande_id = :d ORDER BY nom_fichier"""),
                      {"d": demande_id}).mappings().all()
    return {**_propre(r), "documents": [_propre(x) for x in docs]}


def fichier_document(db: Session, u: Utilisateur, document_id: str) -> tuple[Path, str]:
    if not _uuid(document_id):
        raise Introuvable("Document introuvable")
    r = db.execute(text("""SELECT doc.stockage, doc.nom_fichier, doc.contient_sensible, doc.sha256,
                                  d.demandeur_id, m.id AS modele_id, m.code, m.categorie
                           FROM edt_document doc JOIN edt_demande d ON d.id = doc.demande_id
                           JOIN edt_modele_version v ON v.id = d.version_id JOIN edt_modele m ON m.id = v.modele_id
                           WHERE doc.id = :id AND d.societe_id = :s"""),
                   {"id": document_id, "s": u.societe_id}).mappings().first()
    if r is None:
        raise Introuvable("Document introuvable")
    modele = {"id": str(r["modele_id"]), "code": r["code"], "categorie": r["categorie"]}
    if str(r["demandeur_id"]) != _uuid(u.id) and not peut(db, u, "LANCER", modele):
        raise Introuvable("Document introuvable")
    if r["contient_sensible"] and not peut(db, u, "DONNEES_SENSIBLES", modele):   # RG-EDT-SECU-04
        raise Interdit("Document contenant des données sensibles")
    chemin = racine_documents() / r["stockage"]
    if not chemin.exists():
        raise Introuvable("Fichier absent du stockage")
    if hashlib.sha256(chemin.read_bytes()).hexdigest() != r["sha256"]:
        raise Conflit("Le fichier a été modifié depuis sa production (empreinte différente)")
    auditer(db, u, "TELECHARGEMENT", "DOCUMENT", document_id, {"fichier": r["nom_fichier"]})
    return chemin, r["nom_fichier"]


# ---------------------------------------------------------------------------
# Aides au designer
# ---------------------------------------------------------------------------
def catalogue_sources(db: Session) -> list[dict]:
    sources = db.execute(text("""SELECT code, libelle, nature, contexte_requis FROM edt_source
                                 WHERE actif = true ORDER BY libelle""")).mappings().all()
    champs = db.execute(text("""SELECT source_code, code, libelle, groupe, type_donnee, masque_defaut, sensible
                                FROM edt_source_champ WHERE actif = true AND visible = true
                                ORDER BY source_code, ordre""")).mappings().all()
    relations = db.execute(text("""SELECT source_code, code, cible_code, cardinalite FROM edt_source_relation
                                   ORDER BY source_code, code""")).mappings().all()
    par_source: dict[str, dict] = {}
    for s in sources:
        ctx = s["contexte_requis"]
        par_source[s["code"]] = {"code": s["code"], "libelle": s["libelle"], "nature": s["nature"],
                                 "contexte_requis": ctx if isinstance(ctx, list) else json.loads(ctx or "[]"),
                                 "champs": [], "relations": []}
    for c in champs:
        if c["source_code"] in par_source:
            par_source[c["source_code"]]["champs"].append(
                {k: c[k] for k in ("code", "libelle", "groupe", "type_donnee", "masque_defaut", "sensible")})
    for r in relations:
        if r["source_code"] in par_source:
            par_source[r["source_code"]]["relations"].append(
                {"code": r["code"], "cible": r["cible_code"], "cardinalite": r["cardinalite"]})
    return list(par_source.values())


def rubriques(db: Session, u: Utilisateur) -> list[dict]:
    """Rubriques utilisables dans [CODE].MT… : libellé d'édition de la société en priorité."""
    rows = db.execute(text("""SELECT code, libelle, libelle_edition, societe_id FROM rubrique_paie
                              WHERE archive = false AND traiter = true AND (societe_id IS NULL OR societe_id = :s)
                              ORDER BY code, CASE WHEN societe_id IS NULL THEN 1 ELSE 0 END"""),
                      {"s": u.societe_id}).mappings().all()
    vues: dict[str, dict] = {}
    for r in rows:
        vues.setdefault(r["code"], {"code": r["code"], "libelle": r["libelle_edition"] or r["libelle"]})
    return list(vues.values())


def masques(db: Session, u: Utilisateur) -> list[dict]:
    return fmt.liste_masques(registre_masques(db, u.societe_id))


def analyser_expression(db: Session, u: Utilisateur, expression: str, source: Optional[str] = None,
                        parametres: Iterable[str] = ()) -> dict:
    """Validation en direct d'une formule (saisie dans le designer)."""
    a = ex.analyser(expression or "", parametres_connus=set(parametres) if parametres else None)
    erreurs = [e.en_dict() for e in a.erreurs]
    if source:
        c: CatalogueValidation = cat.charger(db, u.societe_id)
        for champ in sorted(a.champs):
            if champ.startswith(("var.", "corps.")):
                continue                  # données de l'état : contrôlées à l'enregistrement, avec la définition
            ok = c.champ_existe(source, champ) or (
                champ.startswith("societe.") and c.champ_existe("SOCIETE", champ.split(".", 1)[1]))
            if not ok:
                erreurs.append({"message": f"Champ inconnu dans {source} : {champ}", "debut": None, "fin": None})
        if c.rubriques is not None:
            for r in sorted(a.rubriques - c.rubriques):
                erreurs.append({"message": f"Rubrique inconnue ou archivée : {r}", "debut": None, "fin": None})
    return {"valide": not erreurs, "erreurs": erreurs, "champs": sorted(a.champs),
            "parametres": sorted(a.parametres), "rubriques": sorted(a.rubriques),
            "constantes": sorted(a.constantes), "fonctions": sorted(a.fonctions)}


# ---------------------------------------------------------------------------
# Valeurs proposées pour les paramètres (écran de lancement)
# ---------------------------------------------------------------------------
def periodes(db: Session, u: Utilisateur) -> list[dict]:
    """Périodes de paie de la société active, les plus récentes d'abord, avec
    le nombre de bulletins (en cours ∪ historisés, sans doublon)."""
    rows = db.execute(text("""
        SELECT cal.id, cal.intitule, cal.annee, cal.mois, cal.statut, cal.date_debut, cal.date_fin,
               p.id AS plan_paie_id, p.code AS plan_code, p.libelle AS plan_libelle,
               (SELECT count(*) FROM bulletin b WHERE b.periode_id = cal.id)
             + (SELECT count(*) FROM bulletin_historique h WHERE h.periode_id = cal.id
                  AND NOT EXISTS (SELECT 1 FROM bulletin b2 WHERE b2.id = h.id)) AS nb_bulletins
        FROM calendrier_paie cal LEFT JOIN plan_paie p ON p.id = cal.plan_paie_id
        WHERE cal.societe_id = :s
        ORDER BY cal.annee DESC, cal.mois DESC, p.code"""), {"s": u.societe_id}).mappings().all()
    return [_propre(r) for r in rows]


def plans_paie(db: Session, u: Utilisateur) -> list[dict]:
    rows = db.execute(text("""
        SELECT DISTINCT p.id, p.code, p.libelle FROM plan_paie p
        JOIN calendrier_paie cal ON cal.plan_paie_id = p.id
        WHERE cal.societe_id = :s AND COALESCE(p.actif, true) = true
        ORDER BY p.code"""), {"s": u.societe_id}).mappings().all()
    return [_propre(r) for r in rows]



# ---------------------------------------------------------------- bibliothèque d'images
# RG-EDT-IMAGE-01..03 (Adil DAIA) : images de la société, utilisées par ASSET("CODE").
def _image_err(fn, *a, **k):
    from app.editions import images as im
    try:
        return fn(*a, **k)
    except im.ImageInvalide as e:
        raise Invalide(str(e))


def lister_images(db: Session, u: Utilisateur) -> list[dict]:
    from app.editions import images as im
    exiger(db, u, "VOIR")
    return _image_err(im.lister, u.societe_id)


def deposer_image(db: Session, u: Utilisateur, code: str, contenu: bytes, remplacer: bool = False) -> dict:
    from app.editions import images as im
    exiger(db, u, "CONCEVOIR")
    res = _image_err(im.enregistrer, u.societe_id, code, contenu, remplacer)
    auditer(db, u, "IMAGE_DEPOSEE", "IMAGE", None, {"code": res["code"], "taille": res["taille"], "remplacee": remplacer})
    return res


def supprimer_image(db: Session, u: Utilisateur, code: str) -> None:
    from app.editions import images as im
    exiger(db, u, "CONCEVOIR")
    if not _image_err(im.supprimer, u.societe_id, code):
        raise Introuvable(f"Image « {code} » introuvable")
    auditer(db, u, "IMAGE_SUPPRIMEE", "IMAGE", None, {"code": code.upper()})


def fichier_image(db: Session, u: Utilisateur, code: str):
    from app.editions import images as im
    exiger(db, u, "VOIR")
    p = _image_err(lambda: im.chemin(u.societe_id, im.normaliser_code(code)))
    if not p:
        raise Introuvable(f"Image « {code} » introuvable")
    return p


def fichier_logo(db: Session, u: Utilisateur):
    """Logo de la société active (fiche société), pour le canevas du designer."""
    from pathlib import Path as _P
    from app.editions.images import autorise
    from app.editions.sources import REGISTRE
    exiger(db, u, "VOIR")
    soc = (REGISTRE["SOCIETE"].lire(db, None, contexte_securite(db, u)) or [{}])[0]
    chemin = (soc.get("logo_path") or "").replace("\\", "/")
    if not chemin:
        raise Introuvable("Aucun logo dans la fiche société")
    chemin = chemin[len("storage/"):] if chemin.startswith("storage/") else chemin.lstrip("/")
    p = _P("storage") / chemin
    if not p.is_file() or not autorise(p, _P("storage")):
        raise Introuvable("Logo introuvable")
    return p
