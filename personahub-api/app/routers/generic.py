"""
generic.py — Endpoint CRUD générique compatible avec l'API REST de Supabase.
Supporte les relations embarquées style Supabase :

  GET    /api/v1/db/{table}?select=*,related!inner(col1,col2)&related.col=eq.val
  POST   /api/v1/db/{table}
  PATCH  /api/v1/db/{table}
  DELETE /api/v1/db/{table}
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional
import re
import json

from app.core.database import get_db
from app.core.security import get_current_user_payload

router = APIRouter(prefix="/db", tags=["Base de données générique"])

# ── Configuration ──────────────────────────────────────────────────────────────
FORBIDDEN_TABLES = {"users", "user_roles", "alembic_version"}
RESERVED_PARAMS = {"select", "order", "limit", "offset", "count"}

VALID_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
EMBED_PATTERN = re.compile(r"^(\w+)(!inner|!left)?\((.*)\)$")


# ── Sérialisation JSON ────────────────────────────────────────────────────────────────

def serialize_value(v):
    """
    - dict            → JSON string (colonne JSONB)
    - list de dicts   → JSON string (colonne JSONB, ex: criteres)
    - list de scalaires → laissée telle quelle (TEXT[], psycopg2 gère nativement)
    """
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list) and any(isinstance(i, dict) for i in v):
        return json.dumps(v, ensure_ascii=False)
    return v


def serialize_row(row: dict) -> dict:
    """Sérialise toutes les valeurs d'un dict avant envoi à psycopg2."""
    return {k: serialize_value(v) for k, v in row.items()}


# ── Helpers de validation ─────────────────────────────────────────────────────

def safe_ident(name: str) -> str:
    """Empêche toute injection SQL dans les noms de tables/colonnes."""
    if not VALID_IDENT.match(name):
        raise HTTPException(400, detail=f"Identifiant invalide: {name}")
    return name


def table_exists(db: Session, table_name: str) -> bool:
    return db.execute(text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = :t)"
    ), {"t": table_name}).scalar()


def get_table_columns(db: Session, table_name: str) -> list[str]:
    result = db.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :t
        ORDER BY ordinal_position
    """), {"t": table_name})
    return [r.column_name for r in result]


def get_table_pk(db: Session, table_name: str) -> str:
    result = db.execute(text("""
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = :t
        LIMIT 1
    """), {"t": table_name}).fetchone()
    return result.column_name if result else "id"


def get_foreign_key(db: Session, main_table: str, referenced_table: str):
    """
    Cherche la FK dans main_table qui référence referenced_table.
    Retourne (fk_col, referenced_col) ou (None, None).
    """
    result = db.execute(text("""
        SELECT
          kcu.column_name AS fk_column,
          ccu.column_name AS referenced_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = :main
          AND ccu.table_name = :ref
        LIMIT 1
    """), {"main": main_table, "ref": referenced_table}).fetchone()
    return (result.fk_column, result.referenced_column) if result else (None, None)


# ── Parseur du paramètre select ──────────────────────────────────────────────

def split_respecting_parens(s: str) -> list[str]:
    """Split par virgules en respectant la profondeur des parenthèses."""
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch == "(":
            depth += 1
            cur.append(ch)
        elif ch == ")":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if cur:
        parts.append("".join(cur).strip())
    return [p for p in parts if p]


def parse_select(select_str: str) -> tuple[list[str], list[dict]]:
    """
    Sépare les colonnes de la table principale et les embeds.
    Retourne: (main_cols, embeds)
      embeds = [{table, type: 'inner'|'left', cols: [...]}, ...]
    """
    if not select_str or select_str == "*":
        return ["*"], []

    main_cols, embeds = [], []
    for part in split_respecting_parens(select_str):
        m = EMBED_PATTERN.match(part)
        if m:
            embeds.append({
                "table": m.group(1),
                "type": "inner" if m.group(2) == "!inner" else "left",
                "cols": [c.strip() for c in split_respecting_parens(m.group(3))],
            })
        else:
            main_cols.append(part)

    if not main_cols:
        main_cols = ["*"]
    return main_cols, embeds


# ── Parseur de filtres ───────────────────────────────────────────────────────

def parse_filters(
    params: dict,
    main_alias: Optional[str] = None,
    embed_aliases: Optional[dict] = None,
):
    """
    Transforme les query params en clauses WHERE.
    - main_alias: alias SQL de la table principale (None si pas de JOIN)
    - embed_aliases: {nom_table: alias_sql} pour les filtres sur tables liées
    """
    if embed_aliases is None:
        embed_aliases = {}

    conditions, bind_params = [], {}
    i = 0

    def coerce(v: str):
        low = v.lower()
        if low == "true":
            return True
        if low == "false":
            return False
        if low == "null":
            return None
        return v

    for key, value in params.items():
        if key in RESERVED_PARAMS:
            continue

        # Résolution de la référence colonne
        if "." in key:
            table_part, col = key.split(".", 1)
            if table_part in embed_aliases:
                safe_ident(col)
                col_ref = f'{embed_aliases[table_part]}."{col}"'
            else:
                # Préfixe inconnu → on garde le nom brut (rétrocompatible)
                col_ref = f'"{key}"'
        else:
            safe_ident(key)
            col_ref = f'{main_alias}."{key}"' if main_alias else f'"{key}"'

        # Opérateur
        val_str = str(value)
        if "." in val_str:
            op, val = val_str.split(".", 1)
        else:
            op, val = "eq", val_str

        p = f"p_{i}"
        i += 1

        if op == "eq":
            c = coerce(val)
            if c is None:
                conditions.append(f"{col_ref} IS NULL")
            else:
                conditions.append(f"{col_ref} = :{p}")
                bind_params[p] = c
        elif op == "neq":
            c = coerce(val)
            if c is None:
                conditions.append(f"{col_ref} IS NOT NULL")
            else:
                conditions.append(f"{col_ref} != :{p}")
                bind_params[p] = c
        elif op in ("gt", "gte", "lt", "lte"):
            sql_op = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            conditions.append(f"{col_ref} {sql_op} :{p}")
            bind_params[p] = val
        elif op == "like":
            conditions.append(f"{col_ref} LIKE :{p}")
            bind_params[p] = val
        elif op == "ilike":
            conditions.append(f"{col_ref} ILIKE :{p}")
            bind_params[p] = val
        elif op == "is":
            if val.lower() == "null":
                conditions.append(f"{col_ref} IS NULL")
            else:
                conditions.append(f"{col_ref} IS NOT NULL")
        elif op == "in":
            vals = val.strip("()").split(",")
            placeholders = []
            for j, v in enumerate(vals):
                pj = f"p_{i}_{j}"
                placeholders.append(f":{pj}")
                bind_params[pj] = v.strip()
            conditions.append(f'{col_ref} IN ({", ".join(placeholders)})')

    return conditions, bind_params


# ── Helpers SQL ───────────────────────────────────────────────────────────────

def build_embed_json_expr(alias: str, cols: list[str], db: Session, embed_table: str) -> str:
    """Construit un json_build_object pour l'embed."""
    if cols == ["*"]:
        cols = get_table_columns(db, embed_table)
    pairs = []
    for col in cols:
        safe_ident(col)
        pairs.append(f"'{col}', {alias}.\"{col}\"")
    return f"json_build_object({', '.join(pairs)})"


def build_order_clause(order_raw: str, main_alias: Optional[str], embed_aliases: dict) -> str:
    """Supporte: col, col.desc, table.col.desc"""
    if not order_raw:
        return ""
    parts = order_raw.split(".")
    if len(parts) == 3 and parts[0] in embed_aliases:
        safe_ident(parts[1])
        col_ref = f'{embed_aliases[parts[0]]}."{parts[1]}"'
        direction = "DESC" if parts[2].lower() == "desc" else "ASC"
    elif len(parts) == 2:
        safe_ident(parts[0])
        col_ref = f'{main_alias}."{parts[0]}"' if main_alias else f'"{parts[0]}"'
        direction = "DESC" if parts[1].lower() == "desc" else "ASC"
    elif len(parts) == 1:
        safe_ident(parts[0])
        col_ref = f'{main_alias}."{parts[0]}"' if main_alias else f'"{parts[0]}"'
        direction = "ASC"
    else:
        return ""
    return f"ORDER BY {col_ref} {direction}"


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/{table}")
async def select_table(
    table: str,
    request: Request,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """SELECT avec filtres, tri, pagination et relations Supabase-style."""
    if table in FORBIDDEN_TABLES:
        raise HTTPException(403, detail="Accès refusé")
    safe_ident(table)
    if not table_exists(db, table):
        return []

    params = dict(request.query_params)
    select_str = params.get("select", "*")
    main_cols, embeds = parse_select(select_str)

    # ─── Cas simple : pas d'embed, requête directe (rétrocompatible) ────────
    if not embeds:
        if main_cols == ["*"]:
            cols_clause = "*"
        else:
            cols_clause = ", ".join(f'"{safe_ident(c)}"' for c in main_cols)
        conditions, bind_params = parse_filters(params)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        order_clause = build_order_clause(params.get("order", ""), None, {})
        limit = int(params.get("limit", "1000"))
        offset = int(params.get("offset", "0"))
        sql = (
            f'SELECT {cols_clause} FROM "{table}" '
            f"{where_clause} {order_clause} LIMIT {limit} OFFSET {offset}"
        )
        try:
            result = db.execute(text(sql), bind_params)
            return [dict(row._mapping) for row in result]
        except Exception as e:
            raise HTTPException(400, detail=str(e))

    # ─── Cas avec embeds : JOINs + JSON ─────────────────────────────────────
    main_alias = "t"
    embed_aliases = {emb["table"]: f"e{i}" for i, emb in enumerate(embeds)}

    # SELECT clauses
    select_parts = []
    if "*" in main_cols:
        select_parts.append(f"{main_alias}.*")
    else:
        for c in main_cols:
            safe_ident(c)
            select_parts.append(f'{main_alias}."{c}"')

    for emb in embeds:
        safe_ident(emb["table"])
        if not table_exists(db, emb["table"]):
            raise HTTPException(400, detail=f"Table liée inconnue: {emb['table']}")
        alias = embed_aliases[emb["table"]]
        json_expr = build_embed_json_expr(alias, emb["cols"], db, emb["table"])
        if emb["type"] == "left":
            ref_pk = get_table_pk(db, emb["table"])
            safe_ident(ref_pk)
            expr = (
                f'CASE WHEN {alias}."{ref_pk}" IS NULL '
                f"THEN NULL ELSE {json_expr} END"
            )
        else:
            expr = json_expr
        select_parts.append(f'{expr} AS "{emb["table"]}"')

    # FROM + JOINs
    from_parts = [f'"{table}" {main_alias}']
    for emb in embeds:
        alias = embed_aliases[emb["table"]]
        fk_col, ref_col = get_foreign_key(db, table, emb["table"])
        if not fk_col:
            raise HTTPException(
                400,
                detail=(
                    f"Impossible de trouver une clé étrangère entre "
                    f"'{table}' et '{emb['table']}'. "
                    f"Vérifiez que la relation existe en base."
                ),
            )
        join_type = "INNER JOIN" if emb["type"] == "inner" else "LEFT JOIN"
        from_parts.append(
            f'{join_type} "{emb["table"]}" {alias} '
            f'ON {alias}."{ref_col}" = {main_alias}."{fk_col}"'
        )

    # WHERE
    conditions, bind_params = parse_filters(params, main_alias, embed_aliases)
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    # ORDER / LIMIT / OFFSET
    order_clause = build_order_clause(params.get("order", ""), main_alias, embed_aliases)
    limit = int(params.get("limit", "1000"))
    offset = int(params.get("offset", "0"))

    sql = (
        f'SELECT {", ".join(select_parts)} '
        f'FROM {" ".join(from_parts)} '
        f"{where_clause} {order_clause} "
        f"LIMIT {limit} OFFSET {offset}"
    )

    try:
        result = db.execute(text(sql), bind_params)
        return [dict(row._mapping) for row in result]
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/{table}", status_code=201)
async def insert_table(
    table: str,
    request: Request,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """INSERT générique."""
    if table in FORBIDDEN_TABLES:
        raise HTTPException(403, detail="Accès refusé")
    safe_ident(table)
    if not table_exists(db, table):
        raise HTTPException(404, detail=f"Table '{table}' introuvable")

    body = await request.json()
    rows = body if isinstance(body, list) else [body]

    inserted = []
    for row in rows:
        if not row:
            continue
        for k in row.keys():
            safe_ident(k)
        cols = [f'"{k}"' for k in row.keys()]
        placeholders = [f":{k}" for k in row.keys()]
        sql = (
            f'INSERT INTO "{table}" ({", ".join(cols)}) '
            f'VALUES ({", ".join(placeholders)}) RETURNING *'
        )
        try:
            result = db.execute(text(sql), serialize_row(row))
            inserted.append(dict(result.fetchone()._mapping))
        except Exception as e:
            db.rollback()
            raise HTTPException(400, detail=str(e))
    db.commit()
    return inserted if len(inserted) > 1 else (inserted[0] if inserted else None)


@router.patch("/{table}")
async def update_table(
    table: str,
    request: Request,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """UPDATE générique avec filtres."""
    if table in FORBIDDEN_TABLES:
        raise HTTPException(403, detail="Accès refusé")
    safe_ident(table)
    if not table_exists(db, table):
        raise HTTPException(404, detail=f"Table '{table}' introuvable")

    params = dict(request.query_params)
    body = await request.json()
    if not body:
        raise HTTPException(400, detail="Corps de la requête vide")

    for k in body.keys():
        safe_ident(k)
    set_parts = [f'"{k}" = :set_{k}' for k in body.keys()]
    set_params = {f"set_{k}": serialize_value(v) for k, v in body.items()}

    conditions, where_params = parse_filters(params)
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    all_params = {**set_params, **where_params}
    sql = f'UPDATE "{table}" SET {", ".join(set_parts)} {where_clause} RETURNING *'

    try:
        result = db.execute(text(sql), all_params)
        updated = [dict(row._mapping) for row in result]
        db.commit()
        return updated
    except Exception as e:
        db.rollback()
        raise HTTPException(400, detail=str(e))


@router.delete("/{table}")
async def delete_table(
    table: str,
    request: Request,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """DELETE générique avec filtres."""
    if table in FORBIDDEN_TABLES:
        raise HTTPException(403, detail="Accès refusé")
    safe_ident(table)
    if not table_exists(db, table):
        raise HTTPException(404, detail=f"Table '{table}' introuvable")

    params = dict(request.query_params)
    conditions, bind_params = parse_filters(params)
    if not conditions:
        raise HTTPException(400, detail="DELETE sans filtre refusé par sécurité")

    where_clause = f"WHERE {' AND '.join(conditions)}"
    sql = f'DELETE FROM "{table}" {where_clause} RETURNING *'

    try:
        result = db.execute(text(sql), bind_params)
        deleted = [dict(row._mapping) for row in result]
        db.commit()
        return deleted
    except Exception as e:
        db.rollback()
        raise HTTPException(400, detail=str(e))


@router.post("/{table}/rpc")
async def rpc_call(
    table: str,
    request: Request,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
):
    """Appel de fonction PostgreSQL (RPC)."""
    safe_ident(table)
    body = await request.json()
    params_str = ", ".join([f":{k}" for k in body.keys()])
    sql = f"SELECT * FROM {table}({params_str})"
    try:
        result = db.execute(text(sql), body)
        rows = [dict(row._mapping) for row in result]
        db.commit()
        return rows
    except Exception as e:
        db.rollback()
        raise HTTPException(400, detail=str(e))
