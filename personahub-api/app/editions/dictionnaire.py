"""
app/editions/dictionnaire.py — Dictionnaire des données configurable des éditions.
Auteur : Adil DAIA — 20/10/2026 — RG-EDT-DICO-01..08

L'administrateur associe lui-même les informations dans le configurateur (écran « Dictionnaire
des données ») ; aucune requête SQL n'est saisie : il choisit des tables et des colonnes
existantes, contrôlées contre information_schema, et le moteur écrit la requête.

RG-EDT-DICO-01 (Adil DAIA) : champ ajouté à une source (système ou personnalisée), mode
    RECHERCHE : une valeur de la ligne (ex. qualification.code_grade, collaborateur_id) est
    cherchée dans une colonne d'une table ; on en lit une autre colonne. Table historisée :
    ligne en vigueur à la date de référence (fin de la période de la ligne, sinon du
    paramètre, sinon aujourd'hui). Plusieurs lignes : première, dernière (colonne d'ordre),
    nombre, somme ou liste. Conditions fixes possibles (archive = false…). Lecture en bloc :
    une requête par champ pour toutes les lignes.
RG-EDT-DICO-02 (Adil DAIA) : source personnalisée = une table principale, une colonne clé, un
    filtre société obligatoire (colonne société de la table, ou collaborateur rattaché à la
    société) sauf pour un référentiel commun (table ref_* sans colonne société). Ses champs
    sont des colonnes de la table (mode COLONNE) ou des recherches (mode RECHERCHE).
RG-EDT-DICO-03 (Adil DAIA) : relation vers une source personnalisée : valeur de la ligne
    parente (chemin) = colonne de la table de la source cible ; sert aux jeux secondaires.
RG-EDT-DICO-04 (Adil DAIA) : gestion des champs existants : libellé, groupe, masque, visibilité
    et sensibilité réglés ici ne sont plus écrasés par la synchronisation ; « Réinitialiser »
    rend les valeurs du code.
RG-EDT-DICO-05 (Adil DAIA) : tables et colonnes interdites : comptes, mots de passe, jetons,
    sessions, tables techniques et tables des éditions elles-mêmes.
RG-EDT-DICO-06 (Adil DAIA) : configurer exige le droit ADMINISTRER ; consulter, CONCEVOIR.
RG-EDT-DICO-07 (Adil DAIA) : un champ, une source ou une relation utilisé par un modèle ne
    peut être supprimé (liste des modèles concernés renvoyée).
RG-EDT-DICO-08 (Adil DAIA) : les champs ajoutés passent par le masquage des champs sensibles
    comme les autres (RG-EDT-SECU-01).
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.editions.sources.base import REGISTRE, ContexteSecurite, ErreurSource, Fournisseur, Ligne, propre

MODES = ("COLONNE", "RECHERCHE")
AGREGATS = ("PREMIER", "DERNIER", "NB", "SOMME", "LISTE")
OPERATEURS = ("=", "<>", "<", "<=", ">", ">=", "VIDE", "NON_VIDE")
TYPES = ("TEXTE", "NOMBRE", "MONTANT", "DATE", "BOOLEEN", "IMAGE")
MAX_LIGNES_SOURCE = 50000

TABLES_INTERDITES = re.compile(
    r"^(users?|user_.*|.*(token|password|passwd|secret|session|otp|jwt|refresh|credential|api_key).*|"
    r"alembic_version|edt_.*|pg_.*|sql_.*|menu_role|.*_audit|audit_.*)$", re.I)
COLONNES_INTERDITES = re.compile(r"(password|passwd|mot_de_passe|hash|secret|token|salt|otp)", re.I)
CODE_SOURCE = re.compile(r"^[A-Z][A-Z0-9_]{1,40}$")
CODE_CHAMP = re.compile(r"^[a-z][a-z0-9_]{0,40}(\.[a-z][a-z0-9_]{0,40}){0,3}$")
CHEMIN = re.compile(r"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,4}$")


class ErreurDictionnaire(Exception):
    def __init__(self, message: str, details: Any = None):
        super().__init__(message)
        self.message, self.details = message, details


# ---------------------------------------------------------------------------
# Structure de la base (liste blanche)
# ---------------------------------------------------------------------------
def _type_donnee(type_pg: str) -> str:
    t = (type_pg or "").lower()
    if t in ("numeric", "decimal", "money", "double precision", "real"):
        return "MONTANT"
    if t in ("integer", "bigint", "smallint"):
        return "NOMBRE"
    if t.startswith("date") or t.startswith("timestamp"):
        return "DATE"
    if t == "boolean":
        return "BOOLEEN"
    return "TEXTE"


def tables(db: Session) -> list[dict]:
    """Tables lisibles (RG-EDT-DICO-05), avec leurs colonnes et les indices utiles au configurateur."""
    lignes = db.execute(text("""
        SELECT c.table_name, c.column_name, c.data_type, c.ordinal_position
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY c.table_name, c.ordinal_position""")).mappings().all()
    res: dict[str, dict] = {}
    for r in lignes:
        nom = r["table_name"]
        if TABLES_INTERDITES.match(nom):
            continue
        t = res.setdefault(nom, {"nom": nom, "colonnes": []})
        if not COLONNES_INTERDITES.search(r["column_name"]):
            t["colonnes"].append({"nom": r["column_name"], "type": r["data_type"], "type_donnee": _type_donnee(r["data_type"])})
    for t in res.values():
        noms = {c["nom"] for c in t["colonnes"]}
        t["a_societe"] = "societe_id" in noms
        t["a_collaborateur"] = "collaborateur_id" in noms
        t["referentiel"] = t["nom"].startswith("ref_")
    return sorted(res.values(), key=lambda t: t["nom"])


def _colonnes(db: Session, table: str) -> dict[str, str]:
    """Colonnes autorisées d'une table autorisée, sinon erreur."""
    if not table or TABLES_INTERDITES.match(table):
        raise ErreurDictionnaire(f"Table non autorisée : {table or '—'}")
    rows = db.execute(text("""SELECT column_name, data_type FROM information_schema.columns
                              WHERE table_schema = current_schema() AND table_name = :t"""), {"t": table}).all()
    if not rows:
        raise ErreurDictionnaire(f"Table inconnue : {table}")
    return {r[0]: r[1] for r in rows if not COLONNES_INTERDITES.search(r[0])}


def _col(colonnes: dict[str, str], nom: Optional[str], role: str, table: str, obligatoire: bool = True) -> Optional[str]:
    if not nom:
        if obligatoire:
            raise ErreurDictionnaire(f"{role} : colonne à choisir")
        return None
    if nom not in colonnes:
        raise ErreurDictionnaire(f"{role} : colonne « {nom} » absente de la table {table}")
    return nom


def _q(nom: str) -> str:
    """Identifiant SQL entre guillemets (déjà contrôlé contre information_schema)."""
    return '"' + nom.replace('"', '""') + '"'


def _conditions_sql(conds: list[dict], colonnes: dict[str, str], table: str, alias: str = "t") -> tuple[str, dict]:
    morceaux, valeurs = [], {}
    for i, c in enumerate(conds or []):
        col = _col(colonnes, c.get("colonne"), "Condition", table)
        op = c.get("operateur") or "="
        if op not in OPERATEURS:
            raise ErreurDictionnaire(f"Condition : opérateur inconnu {op}")
        if op == "VIDE":
            morceaux.append(f"{alias}.{_q(col)} IS NULL")
        elif op == "NON_VIDE":
            morceaux.append(f"{alias}.{_q(col)} IS NOT NULL")
        else:
            valeurs[f"cv{i}"] = "" if c.get("valeur") is None else str(c.get("valeur"))
            morceaux.append(f"{alias}.{_q(col)} {op} :cv{i}")
    return (" AND ".join(morceaux), valeurs)


# ---------------------------------------------------------------------------
# Lecture : champs RECHERCHE (RG-EDT-DICO-01)
# ---------------------------------------------------------------------------
def _lire(ligne: Any, chemin: str) -> Any:
    if isinstance(ligne, dict) and chemin in ligne:
        return ligne[chemin]
    v = ligne
    for p in chemin.split("."):
        v = v.get(p) if isinstance(v, dict) else None
    return v


def _poser(ligne: dict, chemin: str, valeur: Any) -> None:
    *parents, fin = chemin.split(".")
    d = ligne
    for p in parents:
        if not isinstance(d.get(p), dict):
            d[p] = {}
        d = d[p]
    d[fin] = valeur


def _date(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}", v):
        return date.fromisoformat(v[:10])
    return None


def date_reference(ligne: dict, parametres: Optional[dict], mode: str) -> date:
    if mode == "AUJOURDHUI":
        return date.today()
    d = _date(_lire(ligne, "periode.date_fin"))
    if d:
        return d
    p = (parametres or {}).get("periode")
    if isinstance(p, dict) and _date(p.get("date_fin")):
        return _date(p.get("date_fin"))
    if (parametres or {}).get("annee"):
        return min(date(int(parametres["annee"]), 12, 31), date.today())
    return date.today()


def _valeur_agregee(rangs: list[dict], ch: dict) -> Any:
    if not rangs:
        return Decimal(0) if ch["agregat"] in ("NB", "SOMME") else None
    ag = ch["agregat"]
    if ag == "NB":
        return Decimal(len(rangs))
    if ag == "SOMME":
        total = Decimal(0)
        for r in rangs:
            v = r["v"]
            if v is not None:
                try:
                    total += Decimal(str(v))
                except Exception:
                    pass
        return total
    if ch.get("colonne_ordre"):
        rangs = sorted(rangs, key=lambda r: (r.get("o") is None, r.get("o") if r.get("o") is not None else 0))
    if ag == "LISTE":
        vus, res = set(), []
        for r in rangs:
            s = "" if r["v"] is None else str(r["v"])
            if s and s not in vus:
                vus.add(s)
                res.append(s)
        return ", ".join(res)
    r = rangs[-1] if ag == "DERNIER" else rangs[0]
    return propre(r["v"])


def _lire_recherche(db: Session, ch: dict, cles: set[str], sec: ContexteSecurite) -> dict[str, list[dict]]:
    table = ch["table_cible"]
    colonnes = _colonnes(db, table)
    cle = _col(colonnes, ch["colonne_cle"], "Colonne correspondante", table)
    val = _col(colonnes, ch.get("colonne_valeur"), "Colonne à lire", table, obligatoire=ch["agregat"] != "NB") or cle
    dd = _col(colonnes, ch.get("colonne_date_debut"), "Date de début", table, obligatoire=False)
    df = _col(colonnes, ch.get("colonne_date_fin"), "Date de fin", table, obligatoire=False)
    od = _col(colonnes, ch.get("colonne_ordre"), "Colonne d'ordre", table, obligatoire=False)
    select = [f"CAST(t.{_q(cle)} AS text) AS k", f"t.{_q(val)} AS v"]
    if dd:
        select.append(f"t.{_q(dd)} AS dd")
    if df:
        select.append(f"t.{_q(df)} AS df")
    if od:
        select.append(f"t.{_q(od)} AS o")
    where = [f"CAST(t.{_q(cle)} AS text) IN :cles"]
    valeurs: dict[str, Any] = {"cles": sorted(cles)}
    if "societe_id" in colonnes:                       # RG-EDT-SOURCE-03 : société active ou commun
        where.append("(t.societe_id IS NULL OR CAST(t.societe_id AS text) = :soc)")
        valeurs["soc"] = sec.societe_id
    sql_c, v_c = _conditions_sql(ch.get("conditions") or [], colonnes, table)
    if sql_c:
        where.append(sql_c)
        valeurs.update(v_c)
    q = text(f"SELECT {', '.join(select)} FROM {_q(table)} t WHERE {' AND '.join(where)}").bindparams(
        bindparam("cles", expanding=True))
    res: dict[str, list[dict]] = defaultdict(list)
    for r in db.execute(q, valeurs).mappings():
        res[r["k"]].append(dict(r))
    return res


def _en_vigueur(rangs: list[dict], a_date: date, ch: dict) -> list[dict]:
    if not ch.get("colonne_date_debut") and not ch.get("colonne_date_fin"):
        return rangs
    ok = []
    for r in rangs:
        d1, d2 = _date(r.get("dd")), _date(r.get("df"))
        if (d1 is None or d1 <= a_date) and (d2 is None or d2 >= a_date):
            ok.append(r)
    if ch.get("colonne_date_debut") and ch["agregat"] in ("PREMIER", "DERNIER") and not ch.get("colonne_ordre"):
        ok.sort(key=lambda r: _date(r.get("dd")) or date.min)
        return ok[-1:]                                   # la plus récente en vigueur
    return ok


def present(db: Session) -> bool:
    """Migration 081 passée ? (sans erreur SQL : un rollback annulerait la demande d'édition en cours)"""
    return db.execute(text("""SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                              AND table_name IN ('edt_champ_perso', 'edt_source_perso')""")).scalar() == 2


def definitions_champs(db: Session, source: str, modes: tuple[str, ...] = MODES) -> list[dict]:
    rows = db.execute(text("""
        SELECT p.*, c.type_donnee FROM edt_champ_perso p
        JOIN edt_source_champ c ON c.source_code = p.source_code AND c.code = p.code AND c.actif = true
        WHERE p.source_code = :s ORDER BY c.ordre, p.code"""), {"s": source}).mappings().all()
    res = []
    for r in rows:
        d = dict(r)
        if d["mode"] not in modes:
            continue
        if isinstance(d.get("conditions"), str):
            d["conditions"] = json.loads(d["conditions"] or "[]")
        res.append(d)
    return res


def _convertir(v: Any, type_donnee: str) -> Any:
    if v is None:
        return None
    if type_donnee in ("NOMBRE", "MONTANT") and not isinstance(v, Decimal):
        try:
            return Decimal(str(v))
        except Exception:
            return v
    return propre(v)


def completer(db: Session, source: str, lignes: list[Ligne], parametres: Optional[dict],
              sec: ContexteSecurite) -> list[Ligne]:
    """Ajoute aux lignes les champs RECHERCHE déclarés pour la source (une requête par champ)."""
    if not lignes:
        return lignes
    if not present(db):                                # migration 081 non passée : rien à ajouter
        return lignes
    champs = definitions_champs(db, source, ("RECHERCHE",))
    for ch in champs:
        cles = {str(v) for v in (_lire(l, ch["cle_ligne"]) for l in lignes) if v not in (None, "")}
        trouves = _lire_recherche(db, ch, cles, sec) if cles else {}
        for l in lignes:
            k = _lire(l, ch["cle_ligne"])
            rangs = trouves.get(str(k), []) if k not in (None, "") else []
            rangs = _en_vigueur(rangs, date_reference(l, parametres, ch["date_reference"]), ch)
            _poser(l, ch["code"], _convertir(_valeur_agregee(rangs, ch), ch["type_donnee"]))
    return lignes


# ---------------------------------------------------------------------------
# Sources personnalisées (RG-EDT-DICO-02)
# ---------------------------------------------------------------------------
class FournisseurPerso(Fournisseur):
    perso = True
    nature = "PERSONNALISEE"

    def __init__(self, d: dict, libelle: str):
        self.d = d
        self.code = d["code"]
        self.libelle = libelle

    def _requete(self, db: Session, sec: ContexteSecurite, parametres: Optional[dict],
                 filtre_colonne: Optional[str] = None, valeurs_filtre: Optional[list[str]] = None) -> list[Ligne]:
        d = self.d
        table = d["table_principale"]
        colonnes = _colonnes(db, table)
        cle = _col(colonnes, d["colonne_cle"], "Colonne clé", table)
        champs = definitions_champs(db, self.code, ("COLONNE",))
        select = {"__id": cle}
        for ch in champs:
            select[ch["code"]] = _col(colonnes, ch["colonne"], f"Champ {ch['code']}", table)
        collab = _col(colonnes, d.get("colonne_collaborateur"), "Colonne collaborateur", table, obligatoire=False)
        if collab:
            select["__collab"] = collab
        sql_select = ", ".join(f"t.{_q(c)} AS {_q(a)}" for a, c in select.items())
        where, valeurs = _filtre_societe(db, d, colonnes, table, sec)
        sql_c, v_c = _conditions_sql(d.get("conditions") or [], colonnes, table)
        if sql_c:
            where.append(sql_c)
            valeurs.update(v_c)
        expansions = []
        ids = (parametres or {}).get("collaborateurs") or (parametres or {}).get("collaborateur")
        if collab and ids:
            ids = ids if isinstance(ids, list) else [ids]
            where.append(f"CAST(t.{_q(collab)} AS text) IN :collabs")
            valeurs["collabs"] = [str(x.get("id") if isinstance(x, dict) else x) for x in ids]
            expansions.append("collabs")
        if filtre_colonne:
            fc = _col(colonnes, filtre_colonne, "Clé de la relation", table)
            where.append(f"CAST(t.{_q(fc)} AS text) IN :rel")
            valeurs["rel"] = valeurs_filtre or [""]
            expansions.append("rel")
            sql_select += f", CAST(t.{_q(fc)} AS text) AS \"__rel\""
        q = text(f"SELECT {sql_select} FROM {_q(table)} t"
                 + (f" WHERE {' AND '.join(where)}" if where else "")
                 + f" ORDER BY t.{_q(cle)} LIMIT {MAX_LIGNES_SOURCE}")
        if expansions:
            q = q.bindparams(*(bindparam(n, expanding=True) for n in expansions))
        types = {ch["code"]: ch["type_donnee"] for ch in champs}
        lignes = []
        for r in db.execute(q, valeurs).mappings():
            l: Ligne = {"id": str(propre(r["__id"]))}
            if collab:
                l["collaborateur_id"] = None if r["__collab"] is None else str(propre(r["__collab"]))
            if filtre_colonne:
                l["__rel"] = r["__rel"]
            for code in types:
                if code != "id":
                    _poser(l, code, _convertir(r[code], types[code]))
            lignes.append(l)
        return lignes

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        return completer(db, self.code, self._requete(db, sec, parametres), parametres, sec)

    def lire_par(self, db: Session, colonne: str, valeurs: list[str], sec: ContexteSecurite,
                 parametres: Optional[dict] = None) -> dict[str, list[Ligne]]:
        """Jeu secondaire relié par une relation (RG-EDT-DICO-03), regroupé par valeur de la clé."""
        lignes = self._requete(db, sec, parametres, colonne, sorted({str(v) for v in valeurs if v not in (None, "")}))
        completer(db, self.code, lignes, parametres, sec)
        res: dict[str, list[Ligne]] = defaultdict(list)
        for l in lignes:
            res[l.pop("__rel")].append(l)
        return res

    def lire_enfants(self, db, cles, sec, parametres=None):
        colonne = self.d.get("colonne_collaborateur") or self.d["colonne_cle"]
        return self.lire_par(db, colonne, [str(c) for c in cles], sec, parametres)


def _filtre_societe(db: Session, d: dict, colonnes: dict[str, str], table: str,
                    sec: ContexteSecurite) -> tuple[list[str], dict]:
    """RG-EDT-SOURCE-03 appliqué aux sources personnalisées."""
    soc = d.get("colonne_societe")
    if soc:
        _col(colonnes, soc, "Colonne société", table)
        return [f"CAST(t.{_q(soc)} AS text) = :soc"], {"soc": sec.societe_id}
    collab = d.get("colonne_collaborateur")
    if collab and _collaborateurs_par_societe(db):
        _col(colonnes, collab, "Colonne collaborateur", table)
        return [f"t.{_q(collab)} IN (SELECT c.id FROM collaborateurs c WHERE CAST(c.societe_id AS text) = :soc)"], \
            {"soc": sec.societe_id}
    if table.startswith("ref_") and "societe_id" not in colonnes:
        return [], {}
    raise ErreurDictionnaire("Filtre société obligatoire : choisissez la colonne société de la table, "
                             "ou la colonne collaborateur (rattaché à la société)")


def _collaborateurs_par_societe(db: Session) -> bool:
    return db.execute(text("""SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                              AND table_name = 'collaborateurs' AND column_name IN ('id', 'societe_id')
                              HAVING count(*) = 2""")).first() is not None


def actualiser_registre(db: Session) -> None:
    """Met les sources personnalisées actives dans le registre des fournisseurs (lecture à chaque
    production : une modification du dictionnaire s'applique sans redémarrer l'API)."""
    if not present(db):
        return
    rows = db.execute(text("""SELECT p.*, s.libelle FROM edt_source_perso p
                              JOIN edt_source s ON s.code = p.code AND s.actif = true""")).mappings().all()
    actuels = set()
    for r in rows:
        d = dict(r)
        if isinstance(d.get("conditions"), str):
            d["conditions"] = json.loads(d["conditions"] or "[]")
        REGISTRE[d["code"]] = FournisseurPerso(d, d["libelle"])
        actuels.add(d["code"])
    for code in [c for c, f in REGISTRE.items() if getattr(f, "perso", False) and c not in actuels]:
        del REGISTRE[code]


def relation(db: Session, source: str, code: Optional[str]) -> Optional[dict]:
    if not code:
        return None
    if not present(db):
        return None
    r = db.execute(text("""SELECT source_code, code, cible_code, cle_source, cle_cible, cardinalite, perso
                           FROM edt_source_relation WHERE source_code = :s AND code = :c"""),
                   {"s": source, "c": code}).mappings().first()
    return dict(r) if r else None


# ---------------------------------------------------------------------------
# Consultation (RG-EDT-DICO-06 : CONCEVOIR)
# ---------------------------------------------------------------------------
def consulter(db: Session) -> list[dict]:
    sources = db.execute(text("""SELECT code, libelle, nature, contexte_requis, fournisseur FROM edt_source
                                 WHERE actif = true ORDER BY libelle""")).mappings().all()
    persos = {r["code"]: dict(r) for r in db.execute(text("SELECT * FROM edt_source_perso")).mappings()}
    defs = defaultdict(dict)
    for r in db.execute(text("SELECT * FROM edt_champ_perso")).mappings():
        d = dict(r)
        defs[d["source_code"]][d["code"]] = _propre_def(d)
    champs = db.execute(text("""SELECT source_code, code, libelle, groupe, type_donnee, masque_defaut, sensible, visible,
                                       perso, libelle_modifie, groupe_modifie, description, ordre
                                FROM edt_source_champ WHERE actif = true ORDER BY source_code, ordre, code""")).mappings().all()
    relations = db.execute(text("""SELECT source_code, code, cible_code, cardinalite, cle_source, cle_cible, perso, libelle
                                   FROM edt_source_relation ORDER BY source_code, code""")).mappings().all()
    res: dict[str, dict] = {}
    for s in sources:
        ctx = s["contexte_requis"]
        res[s["code"]] = {"code": s["code"], "libelle": s["libelle"], "nature": s["nature"],
                          "perso": s["code"] in persos,
                          "contexte_requis": ctx if isinstance(ctx, list) else json.loads(ctx or "[]"),
                          "definition": _propre_def(persos[s["code"]]) if s["code"] in persos else None,
                          "champs": [], "relations": []}
    for c in champs:
        if c["source_code"] in res:
            d = {k: c[k] for k in ("code", "libelle", "groupe", "type_donnee", "masque_defaut", "sensible", "visible",
                                   "perso", "libelle_modifie", "groupe_modifie", "description")}
            d["definition"] = defs[c["source_code"]].get(c["code"])
            res[c["source_code"]]["champs"].append(d)
    for r in relations:
        if r["source_code"] in res:
            res[r["source_code"]]["relations"].append(
                {"code": r["code"], "cible": r["cible_code"], "cardinalite": r["cardinalite"], "cle_source": r["cle_source"],
                 "cle_cible": r["cle_cible"], "perso": r["perso"], "libelle": r["libelle"]})
    return list(res.values())


def _propre_def(d: dict) -> dict:
    res = {}
    for k, v in d.items():
        if k in ("cree_le", "modifie_le", "cree_par", "id"):
            continue
        if k == "conditions" and isinstance(v, str):
            v = json.loads(v or "[]")
        res[k] = str(v) if hasattr(v, "hex") and not isinstance(v, (int, str)) else v
    return res


# ---------------------------------------------------------------------------
# Usage par les modèles (RG-EDT-DICO-07)
# ---------------------------------------------------------------------------
def modeles_utilisant(db: Session, source: Optional[str] = None, champ: Optional[str] = None,
                      relation_code: Optional[str] = None) -> list[str]:
    rows = db.execute(text("""SELECT DISTINCT m.code, m.libelle, CAST(v.definition AS text) AS d
                              FROM edt_modele_version v JOIN edt_modele m ON m.id = v.modele_id""")).mappings().all()
    res = []
    for r in rows:
        d = r["d"] or ""
        try:
            defn = json.loads(d)
        except ValueError:
            continue
        sources = {j.get("source") for j in defn.get("jeux", [])}
        if source and source not in sources:
            continue
        if champ and not re.search(r"(?<![\w.])" + re.escape(champ) + r"(?![\w])", d):
            continue
        if relation_code and not any(j.get("relation") == relation_code for j in defn.get("jeux", [])):
            continue
        if f"{r['libelle']} ({r['code']})" not in res:
            res.append(f"{r['libelle']} ({r['code']})")
    return res


# ---------------------------------------------------------------------------
# Configuration (RG-EDT-DICO-06 : ADMINISTRER)
# ---------------------------------------------------------------------------
def slug(texte: str) -> str:
    t = unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", t)).strip("_") or "champ"


def _source(db: Session, code: str) -> dict:
    r = db.execute(text("SELECT code, libelle, nature FROM edt_source WHERE code = :c AND actif = true"),
                   {"c": code}).mappings().first()
    if not r:
        raise ErreurDictionnaire(f"Source inconnue : {code}")
    d = dict(r)
    d["perso"] = db.execute(text("SELECT 1 FROM edt_source_perso WHERE code = :c"), {"c": code}).first() is not None
    return d


def _verifier_champ(db: Session, source: dict, c: dict) -> dict:
    mode = c.get("mode") or "RECHERCHE"
    if mode not in MODES:
        raise ErreurDictionnaire(f"Mode inconnu : {mode}")
    if mode == "COLONNE":
        if not source["perso"]:
            raise ErreurDictionnaire("Une colonne de table ne s'ajoute qu'à une source personnalisée ; "
                                     "pour une source système, choisissez « Rechercher dans une table »")
        sp = db.execute(text("SELECT table_principale FROM edt_source_perso WHERE code = :c"), {"c": source["code"]}).scalar()
        _col(_colonnes(db, sp), c.get("colonne"), "Colonne", sp)
        return {"mode": mode, "colonne": c["colonne"]}
    cle_ligne = (c.get("cle_ligne") or "").strip()
    if not CHEMIN.match(cle_ligne):
        raise ErreurDictionnaire("Valeur de la ligne servant de clé : à choisir parmi les champs de la source")
    table = c.get("table_cible") or ""
    colonnes = _colonnes(db, table)
    agregat = c.get("agregat") or "PREMIER"
    if agregat not in AGREGATS:
        raise ErreurDictionnaire(f"Agrégat inconnu : {agregat}")
    d = {"mode": mode, "cle_ligne": cle_ligne, "table_cible": table,
         "colonne_cle": _col(colonnes, c.get("colonne_cle"), "Colonne correspondante", table),
         "colonne_valeur": _col(colonnes, c.get("colonne_valeur"), "Colonne à lire", table, obligatoire=agregat != "NB"),
         "colonne_date_debut": _col(colonnes, c.get("colonne_date_debut"), "Date de début", table, obligatoire=False),
         "colonne_date_fin": _col(colonnes, c.get("colonne_date_fin"), "Date de fin", table, obligatoire=False),
         "colonne_ordre": _col(colonnes, c.get("colonne_ordre"), "Colonne d'ordre", table, obligatoire=False),
         "date_reference": c.get("date_reference") if c.get("date_reference") in ("PERIODE", "AUJOURDHUI") else "PERIODE",
         "agregat": agregat, "conditions": c.get("conditions") or []}
    _conditions_sql(d["conditions"], colonnes, table)
    return d


def _type_auto(db: Session, source: dict, d: dict, demande: Optional[str]) -> str:
    if demande in TYPES:
        return demande
    if d["mode"] == "RECHERCHE" and d["agregat"] == "NB":
        return "NOMBRE"
    if d["mode"] == "RECHERCHE" and d["agregat"] == "LISTE":
        return "TEXTE"
    if d["mode"] == "COLONNE":
        table = db.execute(text("SELECT table_principale FROM edt_source_perso WHERE code = :c"), {"c": source["code"]}).scalar()
        return _type_donnee(_colonnes(db, table)[d["colonne"]])
    return _type_donnee(_colonnes(db, d["table_cible"]).get(d["colonne_valeur"] or d["colonne_cle"], "text"))


def creer_champ(db: Session, source_code: str, c: dict, utilisateur_id: Optional[str]) -> dict:
    source = _source(db, source_code)
    code = (c.get("code") or "").strip()
    if not CODE_CHAMP.match(code):
        raise ErreurDictionnaire("Code du champ : lettres minuscules, chiffres et _, groupes séparés par un point (ex. complement.grade)")
    if db.execute(text("SELECT 1 FROM edt_source_champ WHERE source_code = :s AND code = :c"), {"s": source_code, "c": code}).first():
        raise ErreurDictionnaire(f"Le champ {code} existe déjà dans la source {source['libelle']}")
    if code == "id" or any(code.startswith(p + ".") for p in ("id",)):
        raise ErreurDictionnaire("Code réservé : id")
    libelle = (c.get("libelle") or "").strip()
    if not libelle:
        raise ErreurDictionnaire("Libellé du champ obligatoire")
    d = _verifier_champ(db, source, c)
    type_donnee = _type_auto(db, source, d, c.get("type_donnee"))
    ordre = db.execute(text("SELECT COALESCE(max(ordre), 0) + 1 FROM edt_source_champ WHERE source_code = :s"),
                       {"s": source_code}).scalar()
    db.execute(text("""INSERT INTO edt_source_champ (source_code, code, libelle, groupe, type_donnee, chemin, masque_defaut,
                                                     sensible, visible, perso, libelle_modifie, groupe_modifie, description, ordre)
                       VALUES (:s, :c, :l, :g, :t, :c, :m, :sens, true, true, true, true, :desc, :o)"""),
               {"s": source_code, "c": code, "l": libelle, "g": (c.get("groupe") or "Compléments").strip(), "t": type_donnee,
                "m": c.get("masque_defaut") or None, "sens": bool(c.get("sensible")), "desc": c.get("description") or None,
                "o": ordre})
    _ecrire_def(db, source_code, code, d, utilisateur_id, nouveau=True)
    return {"source": source_code, "code": code, "type_donnee": type_donnee}


def _ecrire_def(db: Session, source: str, code: str, d: dict, utilisateur_id: Optional[str], nouveau: bool) -> None:
    v = {"s": source, "c": code, "u": utilisateur_id, **{k: d.get(k) for k in (
        "mode", "colonne", "cle_ligne", "table_cible", "colonne_cle", "colonne_valeur", "colonne_date_debut",
        "colonne_date_fin", "colonne_ordre")}, "dr": d.get("date_reference") or "PERIODE", "ag": d.get("agregat") or "PREMIER",
        "cond": json.dumps(d.get("conditions") or [])}
    if nouveau:
        db.execute(text("""INSERT INTO edt_champ_perso (source_code, code, mode, colonne, cle_ligne, table_cible, colonne_cle,
                               colonne_valeur, colonne_date_debut, colonne_date_fin, date_reference, agregat, colonne_ordre,
                               conditions, cree_par)
                           VALUES (:s, :c, :mode, :colonne, :cle_ligne, :table_cible, :colonne_cle, :colonne_valeur,
                               :colonne_date_debut, :colonne_date_fin, :dr, :ag, :colonne_ordre, CAST(:cond AS jsonb),
                               CAST(:u AS uuid))"""), v)
    else:
        db.execute(text("""UPDATE edt_champ_perso SET mode = :mode, colonne = :colonne, cle_ligne = :cle_ligne,
                               table_cible = :table_cible, colonne_cle = :colonne_cle, colonne_valeur = :colonne_valeur,
                               colonne_date_debut = :colonne_date_debut, colonne_date_fin = :colonne_date_fin,
                               date_reference = :dr, agregat = :ag, colonne_ordre = :colonne_ordre,
                               conditions = CAST(:cond AS jsonb), modifie_le = now()
                           WHERE source_code = :s AND code = :c"""), v)


def modifier_champ(db: Session, source_code: str, code: str, c: dict, utilisateur_id: Optional[str]) -> dict:
    """Champ existant (système ou ajouté) : libellé, groupe, masque, visibilité, sensibilité, description ;
    champ ajouté : aussi sa définition de lecture. reinitialiser=True rend les valeurs du code (système)."""
    source = _source(db, source_code)
    r = db.execute(text("SELECT * FROM edt_source_champ WHERE source_code = :s AND code = :c AND actif = true"),
                   {"s": source_code, "c": code}).mappings().first()
    if not r:
        raise ErreurDictionnaire(f"Champ inconnu : {code}")
    if c.get("reinitialiser"):
        if r["perso"]:
            raise ErreurDictionnaire("Un champ ajouté n'a pas de valeurs d'origine")
        f = REGISTRE.get(source_code)
        decl = next((x for x in (f.champs() if f else []) if x.code == code), None)
        if decl:
            db.execute(text("""UPDATE edt_source_champ SET libelle = :l, groupe = :g, masque_defaut = :m, sensible = :sens,
                                   visible = true, libelle_modifie = false, groupe_modifie = false
                               WHERE source_code = :s AND code = :c"""),
                       {"s": source_code, "c": code, "l": decl.libelle, "g": decl.groupe, "m": decl.masque_defaut,
                        "sens": decl.sensible})
        return {"ok": True}
    maj, v = [], {"s": source_code, "c": code}
    if "libelle" in c and (c["libelle"] or "").strip() and c["libelle"].strip() != r["libelle"]:
        maj += ["libelle = :l", "libelle_modifie = true"]
        v["l"] = c["libelle"].strip()
    if "groupe" in c and (c["groupe"] or "").strip() != (r["groupe"] or ""):
        maj += ["groupe = :g", "groupe_modifie = true"]
        v["g"] = (c["groupe"] or "").strip() or None
    for cle, col in (("masque_defaut", "masque_defaut"), ("description", "description")):
        if cle in c:
            maj.append(f"{col} = :{cle}")
            v[cle] = c[cle] or None
    for cle in ("visible", "sensible"):
        if cle in c and c[cle] is not None:
            maj.append(f"{cle} = :{cle}")
            v[cle] = bool(c[cle])
    if r["perso"] and c.get("type_donnee") in TYPES:
        maj.append("type_donnee = :t")
        v["t"] = c["type_donnee"]
    if maj:
        db.execute(text(f"UPDATE edt_source_champ SET {', '.join(maj)} WHERE source_code = :s AND code = :c"), v)
    if r["perso"] and c.get("definition"):
        d = _verifier_champ(db, source, c["definition"])
        _ecrire_def(db, source_code, code, d, utilisateur_id, nouveau=False)
    return {"ok": True}


def supprimer_champ(db: Session, source_code: str, code: str) -> None:
    r = db.execute(text("SELECT perso FROM edt_source_champ WHERE source_code = :s AND code = :c"),
                   {"s": source_code, "c": code}).first()
    if not r:
        raise ErreurDictionnaire(f"Champ inconnu : {code}")
    if not r[0]:
        raise ErreurDictionnaire("Un champ système ne se supprime pas : masquez-le (Visible)")
    if code == "id":
        raise ErreurDictionnaire("L'identifiant d'une source personnalisée ne se supprime pas")
    usages = modeles_utilisant(db, source=source_code, champ=code)
    if usages:
        raise ErreurDictionnaire(f"Champ utilisé par {len(usages)} modèle(s)", usages)
    db.execute(text("DELETE FROM edt_champ_perso WHERE source_code = :s AND code = :c"), {"s": source_code, "c": code})
    db.execute(text("DELETE FROM edt_source_champ WHERE source_code = :s AND code = :c"), {"s": source_code, "c": code})


def _verifier_source(db: Session, s: dict) -> dict:
    table = s.get("table_principale") or ""
    colonnes = _colonnes(db, table)
    d = {"table_principale": table,
         "colonne_cle": _col(colonnes, s.get("colonne_cle") or ("id" if "id" in colonnes else None), "Colonne clé", table),
         "colonne_societe": _col(colonnes, s.get("colonne_societe"), "Colonne société", table, obligatoire=False),
         "colonne_collaborateur": _col(colonnes, s.get("colonne_collaborateur"), "Colonne collaborateur", table, obligatoire=False),
         "conditions": s.get("conditions") or [], "description": s.get("description") or None}
    if "societe_id" in colonnes and not d["colonne_societe"]:
        raise ErreurDictionnaire("La table a une colonne société : elle doit servir de filtre société")
    _filtre_societe(db, d, colonnes, table, ContexteSecurite(None, "00000000-0000-0000-0000-000000000000"))
    _conditions_sql(d["conditions"], colonnes, table)
    return d


def creer_source(db: Session, s: dict, utilisateur_id: Optional[str]) -> dict:
    code = (s.get("code") or "").strip().upper()
    if not CODE_SOURCE.match(code):
        raise ErreurDictionnaire("Code de la source : majuscules, chiffres et _ (ex. PRETS)")
    if code in REGISTRE and not getattr(REGISTRE[code], "perso", False) or \
            db.execute(text("SELECT 1 FROM edt_source WHERE code = :c"), {"c": code}).first():
        raise ErreurDictionnaire(f"La source {code} existe déjà")
    libelle = (s.get("libelle") or "").strip()
    if not libelle:
        raise ErreurDictionnaire("Libellé de la source obligatoire")
    d = _verifier_source(db, s)
    db.execute(text("""INSERT INTO edt_source (code, libelle, nature, fournisseur, contexte_requis)
                       VALUES (:c, :l, 'PERSONNALISEE', 'dictionnaire', CAST('[]' AS jsonb))"""), {"c": code, "l": libelle})
    db.execute(text("""INSERT INTO edt_source_perso (code, description, table_principale, colonne_cle, colonne_societe,
                           colonne_collaborateur, conditions, cree_par)
                       VALUES (:c, :description, :table_principale, :colonne_cle, :colonne_societe, :colonne_collaborateur,
                           CAST(:cond AS jsonb), CAST(:u AS uuid))"""),
               {"c": code, "u": utilisateur_id, "cond": json.dumps(d["conditions"]),
                **{k: d[k] for k in ("description", "table_principale", "colonne_cle", "colonne_societe", "colonne_collaborateur")}})
    db.execute(text("""INSERT INTO edt_source_champ (source_code, code, libelle, groupe, type_donnee, chemin, perso, ordre)
                       VALUES (:c, 'id', 'Identifiant', 'Ligne', 'TEXTE', 'id', true, 0)"""), {"c": code})
    if d["colonne_collaborateur"]:
        db.execute(text("""INSERT INTO edt_source_champ (source_code, code, libelle, groupe, type_donnee, chemin, perso, ordre)
                           VALUES (:c, 'collaborateur_id', 'Collaborateur (identifiant)', 'Ligne', 'TEXTE',
                                   'collaborateur_id', true, 1)"""), {"c": code})
    colonnes = _colonnes(db, d["table_principale"])
    for col in s.get("colonnes") or []:                # champs créés d'office pour les colonnes cochées
        if col in colonnes and col not in (d["colonne_cle"],) and not COLONNES_INTERDITES.search(col):
            if col == d["colonne_collaborateur"]:
                continue
            creer_champ(db, code, {"code": slug(col), "libelle": col.replace("_", " ").capitalize(), "groupe": libelle,
                                   "mode": "COLONNE", "colonne": col}, utilisateur_id)
    actualiser_registre(db)
    return {"code": code}


def modifier_source(db: Session, code: str, s: dict) -> dict:
    src = _source(db, code)
    if not src["perso"]:
        raise ErreurDictionnaire("Une source système se règle par ses champs, pas par sa définition")
    if (s.get("libelle") or "").strip():
        db.execute(text("UPDATE edt_source SET libelle = :l WHERE code = :c"), {"c": code, "l": s["libelle"].strip()})
    d = _verifier_source(db, s)
    db.execute(text("""UPDATE edt_source_perso SET description = :description, table_principale = :table_principale,
                           colonne_cle = :colonne_cle, colonne_societe = :colonne_societe,
                           colonne_collaborateur = :colonne_collaborateur, conditions = CAST(:cond AS jsonb), modifie_le = now()
                       WHERE code = :c"""),
               {"c": code, "cond": json.dumps(d["conditions"]),
                **{k: d[k] for k in ("description", "table_principale", "colonne_cle", "colonne_societe", "colonne_collaborateur")}})
    actualiser_registre(db)
    return {"code": code}


def supprimer_source(db: Session, code: str) -> None:
    src = _source(db, code)
    if not src["perso"]:
        raise ErreurDictionnaire("Une source système ne se supprime pas")
    usages = modeles_utilisant(db, source=code)
    if usages:
        raise ErreurDictionnaire(f"Source utilisée par {len(usages)} modèle(s)", usages)
    if db.execute(text("SELECT 1 FROM edt_source_relation WHERE cible_code = :c AND source_code <> :c"), {"c": code}).first():
        raise ErreurDictionnaire("Des relations mènent à cette source : supprimez-les d'abord")
    db.execute(text("DELETE FROM edt_source WHERE code = :c"), {"c": code})       # cascade : champs, relations, définition
    actualiser_registre(db)


def creer_relation(db: Session, r: dict) -> dict:
    source = _source(db, r.get("source") or "")
    cible = _source(db, r.get("cible") or "")
    if not cible["perso"]:
        raise ErreurDictionnaire("La source cible d'une relation doit être une source personnalisée")
    code = slug(r.get("code") or cible["libelle"])
    if db.execute(text("SELECT 1 FROM edt_source_relation WHERE source_code = :s AND code = :c"),
                  {"s": source["code"], "c": code}).first():
        raise ErreurDictionnaire(f"La relation {code} existe déjà sur {source['libelle']}")
    cle_source = (r.get("cle_source") or "").strip()
    if not CHEMIN.match(cle_source):
        raise ErreurDictionnaire("Clé côté source : à choisir parmi les champs de la source")
    table = db.execute(text("SELECT table_principale FROM edt_source_perso WHERE code = :c"), {"c": cible["code"]}).scalar()
    cle_cible = _col(_colonnes(db, table), r.get("cle_cible"), "Clé côté cible", table)
    card = r.get("cardinalite") if r.get("cardinalite") in ("UN", "PLUSIEURS") else "PLUSIEURS"
    db.execute(text("""INSERT INTO edt_source_relation (source_code, code, cible_code, cardinalite, cle_source, cle_cible,
                                                        perso, libelle)
                       VALUES (:s, :c, :t, :card, :cs, :cc, true, :l)"""),
               {"s": source["code"], "c": code, "t": cible["code"], "card": card, "cs": cle_source, "cc": cle_cible,
                "l": (r.get("libelle") or "").strip() or None})
    return {"source": source["code"], "code": code}


def supprimer_relation(db: Session, source: str, code: str) -> None:
    r = db.execute(text("SELECT perso FROM edt_source_relation WHERE source_code = :s AND code = :c"),
                   {"s": source, "c": code}).first()
    if not r:
        raise ErreurDictionnaire("Relation inconnue")
    if not r[0]:
        raise ErreurDictionnaire("Une relation système ne se supprime pas")
    usages = modeles_utilisant(db, source=source, relation_code=code)
    if usages:
        raise ErreurDictionnaire(f"Relation utilisée par {len(usages)} modèle(s)", usages)
    db.execute(text("DELETE FROM edt_source_relation WHERE source_code = :s AND code = :c"), {"s": source, "c": code})


# ---------------------------------------------------------------------------
# Essais dans le configurateur
# ---------------------------------------------------------------------------
def _json(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: _json(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_json(x) for x in v]
    return propre(v)


def apercu_table(db: Session, table: str, colonnes: list[str], sec: ContexteSecurite, limite: int = 10) -> dict:
    cols = _colonnes(db, table)
    choisies = [c for c in (colonnes or list(cols)[:12]) if c in cols][:20]
    where, valeurs = ("", {})
    if "societe_id" in cols:
        where, valeurs = " WHERE (t.societe_id IS NULL OR CAST(t.societe_id AS text) = :soc)", {"soc": sec.societe_id}
    rows = db.execute(text(f"SELECT {', '.join('t.' + _q(c) for c in choisies)} FROM {_q(table)} t{where} LIMIT {int(limite)}"),
                      valeurs).mappings().all()
    return {"colonnes": choisies, "lignes": [_json(dict(r)) for r in rows]}


def tester_champ(db: Session, source_code: str, c: dict, cles: list[str], sec: ContexteSecurite) -> dict:
    """Valeurs trouvées pour quelques clés (saisies, sinon les premières de la table cible)."""
    source = _source(db, source_code)
    d = _verifier_champ(db, source, c)
    if d["mode"] == "COLONNE":
        return {"resultats": []}
    if not cles:
        colonnes = _colonnes(db, d["table_cible"])
        where, v = ("", {})
        if "societe_id" in colonnes:
            where, v = " WHERE (t.societe_id IS NULL OR CAST(t.societe_id AS text) = :soc)", {"soc": sec.societe_id}
        cles = [r[0] for r in db.execute(text(
            f"SELECT DISTINCT CAST(t.{_q(d['colonne_cle'])} AS text) FROM {_q(d['table_cible'])} t{where} LIMIT 8"), v).all()
            if r[0] is not None]
    trouves = _lire_recherche(db, d, set(cles), sec) if cles else {}
    res = []
    for k in cles:
        rangs = _en_vigueur(trouves.get(str(k), []), date.today(), d)
        res.append({"cle": k, "valeur": _json(_valeur_agregee(rangs, d)), "nb_lignes": len(trouves.get(str(k), []))})
    return {"resultats": res}


def apercu_source(db: Session, code: str, sec: ContexteSecurite, limite: int = 15) -> dict:
    actualiser_registre(db)
    f = REGISTRE.get(code)
    if not isinstance(f, FournisseurPerso):
        raise ErreurDictionnaire("Aperçu disponible pour les sources personnalisées (les autres : « Aperçu des données » du designer)")
    lignes = f.lire(db, {}, sec)
    f.masquer(lignes, sec, {r[0] for r in db.execute(text(
        "SELECT code FROM edt_source_champ WHERE source_code = :s AND sensible = true AND actif = true"), {"s": code}).all()})
    return {"total": len(lignes), "lignes": [_json(l) for l in lignes[:limite]]}
