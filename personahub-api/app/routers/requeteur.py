"""
Module Requêteur — Router FastAPI (v4, relations + libellés intelligents)
Constructeur de requêtes visuel no-code, générique sur TOUTES les tables
du schéma public, sans liste blanche à maintenir à la main.

NOUVEAU EN v4 :
- Détection automatique des relations (clés étrangères réelles du catalogue
  Postgres) : chaque table expose ses relations sortantes (colonnes qui
  pointent vers une autre table) et entrantes (tables qui pointent vers elle).
- Libellés de colonnes/tables humanisés automatiquement à partir du nom
  technique (ex: "structure_id" -> "Structure", "date_entree" -> "Date
  entree"). requeteur_libelles reste disponible pour affiner (accents,
  formulations précises) sans jamais être obligatoire.
- Quand une colonne sélectionnée est une clé étrangère, /executer fait
  automatiquement un LEFT JOIN vers la table référencée et renvoie en plus
  la valeur "humaine" (ex: le libellé de la structure plutôt que son UUID
  brut), sous la clé "<colonne>__libelle".

SÉCURITÉ (renforcée le 16/10/2026, RG-REQ-SECU-01 à 05) :
- Accès au module piloté par la matrice des menus (require_menu_access
  "requeteur") : l'administrateur coche les rôles autorisés, sans code.
- Tables visibles : l'administrateur voit tout sauf les tables interdites ;
  les autres rôles ne voient QUE les tables cochées pour eux dans
  requeteur_droits_tables (liste blanche : rien n'est visible par défaut).
- Tables et colonnes secrètes (mots de passe, jetons, configuration SMTP/SMS,
  comptes) interdites à TOUS, administrateur compris, quel que soit le
  paramétrage en base.
- Toute table portant une colonne societe_id est filtrée sur la société
  active (lignes génériques societe_id NULL comprises).
- Les libellés joints automatiquement ne sont lus que dans des tables
  elles-mêmes visibles par l'utilisateur.

SÉCURITÉ (historique, toujours valable) :
- Table et colonnes sont validées EN DIRECT contre information_schema
  avant toute construction de requête.
- Double validation des identifiants : existence en catalogue ET
  conformité à une regex stricte avant d'être insérés dans le texte SQL.
- Les valeurs sont TOUJOURS passées en paramètres liés SQLAlchemy (:nom).
- Seul le schéma "public" est exposé.
- Les JOIN automatiques ne sont générés que vers des tables/colonnes déjà
  validées de la même façon (catalogue + regex) — jamais vers une table
  explicitement exclue.
"""

import json
import re
from dataclasses import dataclass
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import require_menu_access, roles_from_payload

router = APIRouter(prefix="/requeteur", tags=["Requêteur"])

IDENTIFIANT_VALIDE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

OPERATEURS_AUTORISES = {
    "text": ["=", "!=", "contient", "commence_par", "est_vide", "n_est_pas_vide"],
    "number": ["=", "!=", ">", ">=", "<", "<=", "entre"],
    "date": ["=", "!=", ">", ">=", "<", "<=", "entre"],
    "boolean": ["=", "!="],
    "uuid": ["=", "!=", "est_vide", "n_est_pas_vide"],
}

SQL_OPERATOR_MAP = {"=": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<="}

# Colonnes candidates pour servir de "libellé affiché" d'une table référencée,
# par ordre de préférence.
COLONNES_AFFICHAGE_PRIORITAIRES = [
    "libelle", "libelle_affiche", "nom", "intitule", "intitule_poste",
    "label", "titre", "code", "email",
]

PREFIXES_TABLE_A_IGNORER = ("ref_", "tbl_", "t_")

# RG-REQ-SECU-03 (Adil DAIA) : interdites à tous, administrateur compris.
# Secrets techniques, comptes et paramétrage du requêteur lui-même. Ajouter
# ici toute nouvelle table de secrets ; requeteur_tables_exclues reste la
# liste administrable pour le reste.
TABLES_INTERDITES = frozenset({
    "users", "user_roles", "param_smtp", "param_sms", "configuration_ia",
    "licence", "alembic_version", "acc_audit_role",
    "requeteur_droits_tables", "requeteur_tables_exclues", "requeteur_colonnes_exclues",
})

# RG-REQ-SECU-04 (Adil DAIA) : toute colonne dont le nom évoque un secret est
# masquée partout, y compris dans une table créée après ce correctif.
COLONNES_SECRETES = re.compile(
    r"(password|passwd|mot_de_passe|secret|token|api_?key|cle_api|hash|private_key|cle_privee)",
    re.IGNORECASE,
)

COLONNE_SOCIETE = "societe_id"


def _map_type_donnee(data_type: str) -> str:
    if data_type in ("character varying", "character", "text", "citext"):
        return "text"
    if data_type in ("integer", "bigint", "smallint", "numeric", "real", "double precision", "decimal"):
        return "number"
    if data_type in ("date", "timestamp without time zone", "timestamp with time zone"):
        return "date"
    if data_type == "boolean":
        return "boolean"
    if data_type == "uuid":
        return "uuid"
    return "text"


def _quote_ident(nom: str) -> str:
    if not IDENTIFIANT_VALIDE.match(nom):
        raise HTTPException(status_code=400, detail=f"Identifiant invalide : '{nom}'")
    return f'"{nom}"'


def _humaniser_colonne(nom_colonne: str) -> str:
    """Transforme un nom technique en libellé lisible, sans garantie sur les accents
    (à affiner via requeteur_libelles si besoin)."""
    base = nom_colonne
    if base.endswith("_id") and base != "id":
        base = base[:-3]
    libelle = base.replace("_", " ").strip()
    return libelle[0].upper() + libelle[1:] if libelle else nom_colonne


def _humaniser_table(nom_table: str) -> str:
    base = nom_table
    for prefixe in PREFIXES_TABLE_A_IGNORER:
        if base.startswith(prefixe):
            base = base[len(prefixe):]
            break
    libelle = base.replace("_", " ").strip()
    return libelle[0].upper() + libelle[1:] if libelle else nom_table


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ColonneInfo(BaseModel):
    nom_colonne: str
    libelle_affiche: str
    type_donnee: str
    filtrable: bool
    triable: bool
    est_cle_etrangere: bool = False
    table_referencee: Optional[str] = None
    libelle_table_referencee: Optional[str] = None


class TableInfo(BaseModel):
    nom_table: str
    libelle_affiche: str


class RelationSortante(BaseModel):
    colonne: str
    table_referencee: str
    libelle_table_referencee: str
    colonne_referencee: str


class RelationEntrante(BaseModel):
    table_source: str
    libelle_table_source: str
    colonne_source: str


class RelationsTable(BaseModel):
    sortantes: list[RelationSortante]
    entrantes: list[RelationEntrante]


class Filtre(BaseModel):
    colonne: str
    operateur: str
    valeur: Optional[Any] = None
    valeur_fin: Optional[Any] = None


class Tri(BaseModel):
    colonne: str
    direction: Literal["asc", "desc"] = "asc"


class RequeteExecution(BaseModel):
    table: str
    colonnes: list[str] = Field(min_length=1)
    filtres: list[Filtre] = []
    tri: Optional[Tri] = None
    limite: int = Field(default=100, le=1000)


class RequeteSauvegarde(BaseModel):
    nom: str
    description: Optional[str] = None
    table_principale: str
    configuration: dict
    is_public: bool = False


class LibelleUpsert(BaseModel):
    nom_table: str
    nom_colonne: Optional[str] = None  # None = libellé de la table elle-même
    libelle_affiche: str = Field(min_length=1, max_length=255)


# ---------------------------------------------------------------------------
# Découverte dynamique + validation
# ---------------------------------------------------------------------------

def _table_est_exclue(db: Session, nom_table: str) -> bool:
    row = db.execute(
        text("SELECT 1 FROM requeteur_tables_exclues WHERE nom_table = :t"),
        {"t": nom_table},
    ).first()
    return row is not None


def _colonnes_exclues(db: Session, nom_table: str) -> set[str]:
    rows = db.execute(
        text("SELECT nom_colonne FROM requeteur_colonnes_exclues WHERE nom_table = :t"),
        {"t": nom_table},
    ).all()
    return {r[0] for r in rows}


def _get_libelle(db: Session, nom_table: str, nom_colonne: Optional[str], defaut: str) -> str:
    row = db.execute(
        text(
            "SELECT libelle_affiche FROM requeteur_libelles "
            "WHERE nom_table = :t AND nom_colonne = :c"
        ),
        {"t": nom_table, "c": nom_colonne or ""},
    ).first()
    return row[0] if row else defaut


def _est_administrateur(payload: dict) -> bool:
    roles = payload.get("all_roles") or ([payload["role"]] if payload.get("role") else [])
    return "administrateur" in roles


def _verifier_admin(payload: dict) -> None:
    if not _est_administrateur(payload):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")


@dataclass(frozen=True)
class Acces:
    """Droits effectifs de l'utilisateur sur le requêteur, calculés une fois par requête."""
    admin: bool
    tables_autorisees: Optional[frozenset[str]]  # None = toutes (administrateur)
    societe_id: Optional[str]

    def peut_voir(self, db: Session, nom_table: str) -> bool:
        if nom_table in TABLES_INTERDITES or _table_est_exclue(db, nom_table):
            return False
        return self.tables_autorisees is None or nom_table in self.tables_autorisees


_acces_menu = require_menu_access("requeteur")


def contexte_acces(payload: dict = Depends(_acces_menu), db: Session = Depends(get_db)) -> Acces:
    """RG-REQ-SECU-01/02 (Adil DAIA) : accès au module par la matrice des menus,
    puis liste blanche des tables par rôle (requeteur_droits_tables)."""
    roles = roles_from_payload(payload)
    societe_id = payload.get("societe_active_id")
    if "administrateur" in roles:
        return Acces(admin=True, tables_autorisees=None, societe_id=societe_id)
    rows = db.execute(
        text(
            "SELECT DISTINCT rtrim(nom_table) FROM requeteur_droits_tables "
            "WHERE peut_voir = true AND rtrim(role) = ANY(:roles)"
        ),
        {"roles": list(roles)},
    ).all()
    return Acces(admin=False, tables_autorisees=frozenset(r[0] for r in rows), societe_id=societe_id)


def _a_colonne_societe(db: Session, nom_table: str) -> bool:
    return any(c == COLONNE_SOCIETE for c, _ in _colonnes_brutes(db, nom_table))


def _valider_table_existe(db: Session, nom_table: str, acces: Optional[Acces] = None) -> None:
    row = db.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = :t "
            "AND table_type IN ('BASE TABLE', 'VIEW')"
        ),
        {"t": nom_table},
    ).first()
    if not row:
        raise HTTPException(status_code=400, detail=f"Table '{nom_table}' introuvable")
    if nom_table in TABLES_INTERDITES or _table_est_exclue(db, nom_table):
        raise HTTPException(status_code=403, detail=f"Table '{nom_table}' non accessible via le requêteur")
    if acces is not None and not acces.peut_voir(db, nom_table):
        raise HTTPException(status_code=403, detail=f"Table '{nom_table}' non autorisée pour votre rôle")


def _colonnes_brutes(db: Session, nom_table: str) -> list[tuple[str, str]]:
    return db.execute(
        text(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :t ORDER BY ordinal_position"
        ),
        {"t": nom_table},
    ).all()


def _get_foreign_keys_sortantes(db: Session, nom_table: str) -> list[dict]:
    """Colonnes de nom_table qui référencent une autre table (clé étrangère sortante)."""
    rows = db.execute(
        text(
            """
            SELECT kcu.column_name, ccu.table_name, ccu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = :t
            """
        ),
        {"t": nom_table},
    ).all()
    return [
        {"colonne": r[0], "table_referencee": r[1], "colonne_referencee": r[2]}
        for r in rows
    ]


def _get_foreign_keys_entrantes(db: Session, nom_table: str) -> list[dict]:
    """Tables qui référencent nom_table (clé étrangère entrante)."""
    rows = db.execute(
        text(
            """
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND ccu.table_name = :t
            """
        ),
        {"t": nom_table},
    ).all()
    return [{"table_source": r[0], "colonne_source": r[1]} for r in rows]


def _colonne_affichage_referencee(db: Session, table_ref: str, acces: Acces) -> Optional[str]:
    """Choisit la meilleure colonne 'humaine' pour représenter une ligne de table_ref
    (ex: 'libelle' plutôt que l'UUID). RG-REQ-SECU-05 : uniquement si table_ref est
    elle-même visible par l'utilisateur."""
    if not acces.peut_voir(db, table_ref):
        return None
    colonnes_dispo = {
        c for c, _ in _colonnes_brutes(db, table_ref) if not COLONNES_SECRETES.search(c)
    } - _colonnes_exclues(db, table_ref)
    for candidate in COLONNES_AFFICHAGE_PRIORITAIRES:
        if candidate in colonnes_dispo:
            return candidate
    return None


def _get_colonnes_valides(db: Session, nom_table: str, acces: Acces) -> dict[str, dict]:
    exclues = _colonnes_exclues(db, nom_table)
    result: dict[str, dict] = {}
    for column_name, data_type in _colonnes_brutes(db, nom_table):
        if column_name in exclues or COLONNES_SECRETES.search(column_name):
            continue
        type_donnee = _map_type_donnee(data_type)
        result[column_name] = {
            "type_donnee": type_donnee,
            "filtrable": type_donnee in OPERATEURS_AUTORISES,
            "est_cle_etrangere": False,
            "table_referencee": None,
            "colonne_referencee": None,
        }

    # Enrichissement avec les relations sortantes détectées
    for fk in _get_foreign_keys_sortantes(db, nom_table):
        col = fk["colonne"]
        table_ref = fk["table_referencee"]
        if col not in result or not acces.peut_voir(db, table_ref):
            continue
        colonne_affichage = _colonne_affichage_referencee(db, table_ref, acces)
        result[col]["est_cle_etrangere"] = True
        result[col]["table_referencee"] = table_ref
        result[col]["colonne_referencee"] = fk["colonne_referencee"]
        result[col]["colonne_affichage_referencee"] = colonne_affichage

    return result


def _build_where_clause(filtres: list[Filtre], colonnes_valides: dict, alias_table: str) -> tuple[str, dict]:
    if not filtres:
        return "", {}

    clauses = []
    params: dict = {}

    for i, f in enumerate(filtres):
        col_info = colonnes_valides.get(f.colonne)
        if not col_info or not col_info["filtrable"]:
            raise HTTPException(status_code=400, detail=f"Colonne '{f.colonne}' non filtrable")

        type_donnee = col_info["type_donnee"]
        if f.operateur not in OPERATEURS_AUTORISES.get(type_donnee, []):
            raise HTTPException(
                status_code=400,
                detail=f"Opérateur '{f.operateur}' non autorisé pour le type '{type_donnee}'",
            )

        col_ident = f"{_quote_ident(alias_table)}.{_quote_ident(f.colonne)}"
        p_val = f"p{i}"
        p_val_fin = f"p{i}_fin"

        if f.operateur == "contient":
            clauses.append(f"{col_ident} ILIKE :{p_val}")
            params[p_val] = f"%{f.valeur}%"
        elif f.operateur == "commence_par":
            clauses.append(f"{col_ident} ILIKE :{p_val}")
            params[p_val] = f"{f.valeur}%"
        elif f.operateur == "est_vide":
            clauses.append(f"{col_ident} IS NULL")
        elif f.operateur == "n_est_pas_vide":
            clauses.append(f"{col_ident} IS NOT NULL")
        elif f.operateur == "entre":
            clauses.append(f"{col_ident} BETWEEN :{p_val} AND :{p_val_fin}")
            params[p_val] = f.valeur
            params[p_val_fin] = f.valeur_fin
        else:
            sql_op = SQL_OPERATOR_MAP[f.operateur]
            clauses.append(f"{col_ident} {sql_op} :{p_val}")
            params[p_val] = f.valeur

    where_sql = " WHERE " + " AND ".join(clauses)
    return where_sql, params


def _serialize_value(val: Any) -> Any:
    if isinstance(val, UUID):
        return str(val)
    return val


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/tables", response_model=list[TableInfo])
def lister_tables(acces: Acces = Depends(contexte_acces), db: Session = Depends(get_db)):
    toutes = db.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type IN ('BASE TABLE', 'VIEW') "
            "ORDER BY table_name"
        )
    ).all()
    exclues = {r[0] for r in db.execute(text("SELECT nom_table FROM requeteur_tables_exclues")).all()}

    result = []
    for (nom_table,) in toutes:
        if nom_table in exclues or nom_table in TABLES_INTERDITES:
            continue
        if acces.tables_autorisees is not None and nom_table not in acces.tables_autorisees:
            continue
        libelle = _get_libelle(db, nom_table, None, _humaniser_table(nom_table))
        result.append(TableInfo(nom_table=nom_table, libelle_affiche=libelle))
    return result


@router.get("/tables/{nom_table}/colonnes", response_model=list[ColonneInfo])
def lister_colonnes(
    nom_table: str,
    acces: Acces = Depends(contexte_acces),
    db: Session = Depends(get_db),
):
    _valider_table_existe(db, nom_table, acces)
    colonnes_valides = _get_colonnes_valides(db, nom_table, acces)
    result = []
    for nom_colonne, info in colonnes_valides.items():
        libelle = _get_libelle(db, nom_table, nom_colonne, _humaniser_colonne(nom_colonne))
        libelle_table_ref = None
        if info["table_referencee"]:
            libelle_table_ref = _get_libelle(
                db, info["table_referencee"], None, _humaniser_table(info["table_referencee"])
            )
        result.append(
            ColonneInfo(
                nom_colonne=nom_colonne,
                libelle_affiche=libelle,
                type_donnee=info["type_donnee"],
                filtrable=info["filtrable"],
                triable=True,
                est_cle_etrangere=info["est_cle_etrangere"],
                table_referencee=info["table_referencee"],
                libelle_table_referencee=libelle_table_ref,
            )
        )
    return result


@router.get("/tables/{nom_table}/relations", response_model=RelationsTable)
def obtenir_relations(
    nom_table: str,
    acces: Acces = Depends(contexte_acces),
    db: Session = Depends(get_db),
):
    """Relations détectées automatiquement via les clés étrangères réelles du catalogue."""
    _valider_table_existe(db, nom_table, acces)

    sortantes = []
    for fk in _get_foreign_keys_sortantes(db, nom_table):
        if not acces.peut_voir(db, fk["table_referencee"]):
            continue
        sortantes.append(
            RelationSortante(
                colonne=fk["colonne"],
                table_referencee=fk["table_referencee"],
                libelle_table_referencee=_get_libelle(
                    db, fk["table_referencee"], None, _humaniser_table(fk["table_referencee"])
                ),
                colonne_referencee=fk["colonne_referencee"],
            )
        )

    entrantes = []
    for fk in _get_foreign_keys_entrantes(db, nom_table):
        if not acces.peut_voir(db, fk["table_source"]):
            continue
        entrantes.append(
            RelationEntrante(
                table_source=fk["table_source"],
                libelle_table_source=_get_libelle(
                    db, fk["table_source"], None, _humaniser_table(fk["table_source"])
                ),
                colonne_source=fk["colonne_source"],
            )
        )

    return RelationsTable(sortantes=sortantes, entrantes=entrantes)


@router.post("/executer")
def executer_requete(
    req: RequeteExecution,
    acces: Acces = Depends(contexte_acces),
    db: Session = Depends(get_db),
):
    _valider_table_existe(db, req.table, acces)
    colonnes_valides = _get_colonnes_valides(db, req.table, acces)

    for col in req.colonnes:
        if col not in colonnes_valides:
            raise HTTPException(status_code=400, detail=f"Colonne '{col}' non accessible")

    alias_principal = "t"
    table_sql = _quote_ident(req.table)
    alias_sql = _quote_ident(alias_principal)

    select_parts = []
    join_parts = []
    colonnes_resultat = list(req.colonnes)  # colonnes réellement présentes dans le résultat (avec __libelle)

    for i, col in enumerate(req.colonnes):
        info = colonnes_valides[col]
        select_parts.append(f"{alias_sql}.{_quote_ident(col)} AS {_quote_ident(col)}")

        if info["est_cle_etrangere"] and info.get("colonne_affichage_referencee"):
            alias_fk = f"fk_{i}"
            table_ref_sql = _quote_ident(info["table_referencee"])
            alias_fk_sql = _quote_ident(alias_fk)
            join_parts.append(
                f"LEFT JOIN {table_ref_sql} AS {alias_fk_sql} "
                f"ON {alias_sql}.{_quote_ident(col)} = "
                f"{alias_fk_sql}.{_quote_ident(info['colonne_referencee'])}"
            )
            libelle_col = f"{col}__libelle"
            select_parts.append(
                f"{alias_fk_sql}.{_quote_ident(info['colonne_affichage_referencee'])} "
                f"AS {_quote_ident(libelle_col)}"
            )
            colonnes_resultat.append(libelle_col)

    order_sql = ""
    if req.tri:
        if req.tri.colonne not in colonnes_valides:
            raise HTTPException(status_code=400, detail=f"Colonne '{req.tri.colonne}' non accessible")
        direction = "ASC" if req.tri.direction == "asc" else "DESC"
        order_sql = f" ORDER BY {alias_sql}.{_quote_ident(req.tri.colonne)} {direction}"

    where_sql, where_params = _build_where_clause(req.filtres, colonnes_valides, alias_principal)

    # RG-REQ-SECU-02 (Adil DAIA) : isolation multi-société. Une table qui porte
    # societe_id ne renvoie que les lignes de la société active et les lignes
    # génériques (NULL = partagé, convention du projet).
    if _a_colonne_societe(db, req.table):
        if not acces.societe_id:
            raise HTTPException(status_code=403, detail="Aucune société active sur ce token — reconnexion requise")
        clause_soc = (
            f"(CAST({alias_sql}.{_quote_ident(COLONNE_SOCIETE)} AS text) = :societe_active "
            f"OR {alias_sql}.{_quote_ident(COLONNE_SOCIETE)} IS NULL)"
        )
        where_sql = f"{where_sql} AND {clause_soc}" if where_sql else f" WHERE {clause_soc}"
        where_params["societe_active"] = acces.societe_id

    query = text(
        f"SELECT {', '.join(select_parts)} FROM {table_sql} AS {alias_sql} "
        f"{' '.join(join_parts)}{where_sql}{order_sql} LIMIT :limite"
    )
    params = {**where_params, "limite": req.limite}

    rows = db.execute(query, params).mappings().all()

    return {
        "table": req.table,
        "colonnes": req.colonnes,
        "colonnes_resultat": colonnes_resultat,
        "resultats": [{k: _serialize_value(v) for k, v in row.items()} for row in rows],
        "total_retourne": len(rows),
    }


@router.put("/libelles")
def definir_libelle(
    payload_libelle: LibelleUpsert,
    acces: Acces = Depends(contexte_acces),
    db: Session = Depends(get_db),
):
    """Définit ou met à jour un libellé personnalisé pour une table ou une colonne.
    Réservé aux administrateurs — c'est une donnée partagée par tous les utilisateurs du requêteur."""
    if not acces.admin:
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    _valider_table_existe(db, payload_libelle.nom_table, acces)
    if payload_libelle.nom_colonne and not IDENTIFIANT_VALIDE.match(payload_libelle.nom_colonne):
        raise HTTPException(status_code=400, detail="Nom de colonne invalide")

    db.execute(
        text(
            """
            INSERT INTO requeteur_libelles (nom_table, nom_colonne, libelle_affiche)
            VALUES (:t, :c, :l)
            ON CONFLICT (nom_table, nom_colonne)
            DO UPDATE SET libelle_affiche = EXCLUDED.libelle_affiche
            """
        ),
        {
            "t": payload_libelle.nom_table,
            "c": payload_libelle.nom_colonne or "",
            "l": payload_libelle.libelle_affiche,
        },
    )
    db.commit()
    return {"success": True}


@router.delete("/libelles")
def supprimer_libelle(
    nom_table: str,
    nom_colonne: Optional[str] = None,
    acces: Acces = Depends(contexte_acces),
    db: Session = Depends(get_db),
):
    """Retire un libellé personnalisé — le libellé retombe alors sur l'humanisation automatique."""
    if not acces.admin:
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    db.execute(
        text("DELETE FROM requeteur_libelles WHERE nom_table = :t AND nom_colonne = :c"),
        {"t": nom_table, "c": nom_colonne or ""},
    )
    db.commit()
    return {"success": True}


@router.post("/sauvegardees")
def sauvegarder_requete(
    req: RequeteSauvegarde,
    payload: dict = Depends(_acces_menu),
    db: Session = Depends(get_db),
):
    user_id = payload.get("user_id") or payload.get("sub")
    row = db.execute(
        text(
            """
            INSERT INTO requetes_sauvegardees
                (nom, description, table_principale, configuration, created_by, is_public)
            VALUES (:nom, :description, :table_principale, :configuration, :created_by, :is_public)
            RETURNING id
            """
        ),
        {
            "nom": req.nom,
            "description": req.description,
            "table_principale": req.table_principale,
            "configuration": json.dumps(req.configuration),
            "created_by": user_id,
            "is_public": req.is_public,
        },
    ).first()
    db.commit()
    return {"id": str(row[0])}


@router.get("/sauvegardees")
def lister_requetes_sauvegardees(
    payload: dict = Depends(_acces_menu),
    db: Session = Depends(get_db),
):
    user_id = payload.get("user_id") or payload.get("sub")
    rows = db.execute(
        text(
            """
            SELECT id, nom, description, table_principale, configuration,
                   created_by, is_public, created_at
            FROM requetes_sauvegardees
            WHERE created_by = :uid OR is_public = true
            ORDER BY created_at DESC
            """
        ),
        {"uid": user_id},
    ).all()
    return [
        {
            "id": str(r[0]),
            "nom": r[1],
            "description": r[2],
            "table_principale": r[3],
            "configuration": r[4],
            "created_by": str(r[5]),
            "is_public": r[6],
            "created_at": r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]


@router.delete("/sauvegardees/{requete_id}")
def supprimer_requete_sauvegardee(
    requete_id: UUID,
    payload: dict = Depends(_acces_menu),
    db: Session = Depends(get_db),
):
    user_id = payload.get("user_id") or payload.get("sub")
    row = db.execute(
        text("DELETE FROM requetes_sauvegardees WHERE id = :id AND created_by = :uid RETURNING id"),
        {"id": str(requete_id), "uid": user_id},
    ).first()
    db.commit()
    if not row:
        raise HTTPException(status_code=404, detail="Requête non trouvée ou non autorisée")
    return {"success": True}
