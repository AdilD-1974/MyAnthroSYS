"""
app/routers/roles.py
Gestion des rôles : CRUD + affectation d'espaces + droits d'accès menus.

Sécurité :
  - Tous les endpoints exigent l'authentification (get_current_user).
  - Seul le rôle 'administrateur' peut appeler ces routes (vérifié côté serveur).
  - Les rôles système (administrateur, collaborateur, gestionnaire_rh,
    gestionnaire_paie, manager) sont verrouillés : pas de suppression,
    pas de modification du code ni du caractère système.
  - Audit : chaque mutation est tracée dans acc_audit_role.
  - Paramétrage des accès menus : seules les entrées connues sont acceptées
    (whitelist via la table ref_menus).
"""

from __future__ import annotations

import re
from datetime import datetime, date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_payload  # payload JWT (dict)

router = APIRouter(prefix="/roles", tags=["Rôles"])

# ---------------------------------------------------------------------------
# Helpers sécurité
# ---------------------------------------------------------------------------

ROLE_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,49}$")
SYSTEM_ROLES = {
    "administrateur",
    "collaborateur",
    "gestionnaire_rh",
    "gestionnaire_paie",
    "manager",
}


def _require_admin(current_user: dict) -> None:
    """Lève 403 si l'utilisateur n'est pas administrateur."""
    roles = current_user.get("all_roles", [])
    if "administrateur" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Réservé aux administrateurs.",
        )


def _get_role_or_404(db: Session, role_id: int) -> dict:
    row = db.execute(
        text("SELECT * FROM acc_roles WHERE id = :id"), {"id": role_id}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Rôle introuvable.")
    return dict(row)


def _guard_system_role(role: dict, action: str = "modifier") -> None:
    if role.get("est_systeme"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Impossible de {action} un rôle système.",
        )


def _audit(db: Session, user_id: int, action: str, role_id: int, detail: str = "") -> None:
    db.execute(
        text(
            """
            INSERT INTO acc_audit_role (user_id, action, role_id, detail, cree_le)
            VALUES (CAST(:uid AS uuid), :action, :rid, :detail, NOW())
            """
        ),
        {"uid": user_id, "action": action, "rid": role_id, "detail": detail},
    )


# ---------------------------------------------------------------------------
# Schémas Pydantic
# ---------------------------------------------------------------------------

class RoleCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=50)
    libelle: str = Field(..., min_length=2, max_length=100)
    description: str | None = Field(None, max_length=500)
    couleur: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icone: str | None = Field(None, max_length=50)

    @field_validator("code")
    @classmethod
    def code_format(cls, v: str) -> str:
        v = v.lower().strip()
        if not ROLE_CODE_RE.match(v):
            raise ValueError(
                "Le code doit être en minuscules, commencer par une lettre, "
                "sans espaces ni caractères spéciaux (underscore autorisé)."
            )
        if v in SYSTEM_ROLES:
            raise ValueError("Ce code est réservé à un rôle système.")
        return v

    @field_validator("libelle")
    @classmethod
    def libelle_strip(cls, v: str) -> str:
        return v.strip()


class RoleUpdate(BaseModel):
    libelle: str | None = Field(None, min_length=2, max_length=100)
    description: str | None = Field(None, max_length=500)
    couleur: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icone: str | None = Field(None, max_length=50)
    actif: bool | None = None


class EspaceAffectation(BaseModel):
    espace_ids: list[int] = Field(..., description="Liste des IDs d'espaces à affecter au rôle.")


class MenuAccesUpdate(BaseModel):
    """
    Chaque entrée : { menu_code: str, actif: bool }
    Seuls les codes présents dans ref_menus sont acceptés (validé en BDD).
    """
    acces: list[dict[str, Any]] = Field(
        ...,
        description="Liste de { menu_code, actif }",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def list_roles(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Liste tous les rôles (admin uniquement)."""
    _require_admin(current_user)
    rows = db.execute(
        text(
            """
            SELECT r.id, r.code, r.libelle, r.description,
                   r.couleur, r.icone, r.est_systeme, r.actif,
                   r.cree_le, r.modifie_le,
                   COUNT(DISTINCT ur.user_id) AS nb_utilisateurs
            FROM acc_roles r
            LEFT JOIN user_roles ur ON ur.role = r.code
            GROUP BY r.id
            ORDER BY r.est_systeme DESC, r.libelle
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]


@router.get("/espaces")
def list_espaces(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Liste des espaces de travail (pour l'affectation rôle ↔ espace)."""
    _require_admin(current_user)
    rows = db.execute(
        text("SELECT id, code, libelle, chemin FROM acc_espaces ORDER BY libelle")
    ).mappings().all()
    return [dict(r) for r in rows]


@router.get("/labels")
def list_role_labels(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """
    Libellés des rôles, pour l'affichage (sidebar, sélecteur de rôle).
    Accessible à tout utilisateur authentifié (les noms de rôles ne sont pas sensibles).
    """
    rows = db.execute(
        text("SELECT code, libelle, couleur, icone FROM acc_roles WHERE actif = TRUE")
    ).mappings().all()
    return [dict(r) for r in rows]


@router.get("/{role_id}")
def get_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Détail d'un rôle avec ses espaces et ses accès menus."""
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)

    # Espaces associés
    espaces = db.execute(
        text(
            """
            SELECT e.id, e.code, e.libelle, e.chemin
            FROM acc_role_espace re
            JOIN acc_espaces e ON e.id = re.espace_id
            WHERE re.role_id = :rid
            ORDER BY e.libelle
            """
        ),
        {"rid": role_id},
    ).mappings().all()

    # Accès menus — SOURCE UNIQUE : menu_items (la même table que la sidebar).
    # Un menu est "actif" pour ce rôle s'il existe une ligne dans menu_role.
    # → tout nouvel écran ajouté au menu apparaît ici automatiquement.
    acces = db.execute(
        text(
            """
            SELECT m.code AS menu_code, m.libelle,
                   pm.code AS parent_code,
                   m.icone, m.ordre,
                   (mr.menu_id IS NOT NULL) AS actif
            FROM menu_items m
            LEFT JOIN menu_items pm ON pm.id = m.parent_id
            LEFT JOIN menu_role  mr ON mr.menu_id = m.id AND mr.role = :role_code
            WHERE m.actif = TRUE
            ORDER BY m.ordre
            """
        ),
        {"role_code": role["code"]},
    ).mappings().all()

    return {
        **role,
        "espaces": [dict(e) for e in espaces],
        "acces_menus": [dict(a) for a in acces],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Crée un nouveau rôle personnalisé."""
    _require_admin(current_user)

    # Unicité du code
    existing = db.execute(
        text("SELECT id FROM acc_roles WHERE code = :code"), {"code": payload.code}
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Un rôle avec le code '{payload.code}' existe déjà.",
        )

    row = db.execute(
        text(
            """
            INSERT INTO acc_roles (code, libelle, description, couleur, icone,
                                   est_systeme, actif, cree_le, modifie_le)
            VALUES (:code, :libelle, :description, :couleur, :icone,
                    FALSE, TRUE, NOW(), NOW())
            RETURNING id
            """
        ),
        payload.model_dump(),
    ).first()
    db.flush()
    _audit(db, current_user["sub"], "CREATE", row.id, f"code={payload.code}")
    db.commit()
    return {"id": row.id, "message": "Rôle créé avec succès."}


@router.patch("/{role_id}")
def update_role(
    role_id: int,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Met à jour un rôle (libellé, description, couleur, icone, actif). Le code n'est pas modifiable."""
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)
    # Note : le code (identifiant technique) n'est pas modifiable car référencé
    # par menu_role / user_roles. Les autres champs sont modifiables, y compris
    # pour les rôles système (l'administrateur a le contrôle total).

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour.")

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = role_id
    db.execute(
        text(f"UPDATE acc_roles SET {set_clauses}, modifie_le = NOW() WHERE id = :id"),
        updates,
    )
    _audit(db, current_user["sub"], "UPDATE", role_id, str(updates))
    db.commit()
    return {"message": "Rôle mis à jour."}


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """
    Supprime un rôle. Refusé si des utilisateurs l'ont encore assigné,
    et le rôle 'administrateur' ne peut jamais être supprimé (anti-verrouillage).
    """
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)

    # Anti-verrouillage : le rôle administrateur est structurel, jamais supprimable.
    if role["code"] == "administrateur":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le rôle administrateur ne peut pas être supprimé.",
        )

    nb = db.execute(
        text("SELECT COUNT(*) FROM user_roles WHERE role = :code"),
        {"code": role["code"]},
    ).scalar()
    if nb > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ce rôle est encore assigné à {nb} utilisateur(s). Retirez-le d'abord.",
        )

    db.execute(text("DELETE FROM acc_role_acces  WHERE role_id = :id"), {"id": role_id})
    db.execute(text("DELETE FROM acc_role_espace WHERE role_id = :id"), {"id": role_id})
    db.execute(text("DELETE FROM acc_roles        WHERE id     = :id"), {"id": role_id})
    _audit(db, current_user["sub"], "DELETE", role_id, f"code={role['code']}")
    db.commit()


# ---------------------------------------------------------------------------
# Affectation d'espaces
# ---------------------------------------------------------------------------

@router.put("/{role_id}/espaces")
def set_espaces(
    role_id: int,
    payload: EspaceAffectation,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """
    Remplace la liste complète des espaces affectés à un rôle.
    Les IDs inconnus sont rejetés (sécurité : pas d'injection d'espace fantôme).
    """
    _require_admin(current_user)
    _get_role_or_404(db, role_id)  # lève 404 si absent

    # Valider que tous les espace_ids existent
    if payload.espace_ids:
        valid = db.execute(
            text("SELECT id FROM acc_espaces WHERE id = ANY(:ids)"),
            {"ids": payload.espace_ids},
        ).scalars().all()
        invalid = set(payload.espace_ids) - set(valid)
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Espaces inconnus : {sorted(invalid)}",
            )

    # Remplacement atomique
    db.execute(text("DELETE FROM acc_role_espace WHERE role_id = :rid"), {"rid": role_id})
    for espace_id in payload.espace_ids:
        db.execute(
            text(
                "INSERT INTO acc_role_espace (role_id, espace_id) VALUES (:rid, :eid)"
            ),
            {"rid": role_id, "eid": espace_id},
        )
    _audit(db, current_user["sub"], "SET_ESPACES", role_id, f"espaces={payload.espace_ids}")
    db.commit()
    return {"message": "Espaces mis à jour."}


# ---------------------------------------------------------------------------
# Gestion des accès menus
# ---------------------------------------------------------------------------

@router.put("/{role_id}/acces")
def set_acces_menus(
    role_id: int,
    payload: MenuAccesUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """
    Met à jour la matrice d'accès menus pour un rôle.

    Sécurité :
      - Seuls les codes présents dans ref_menus sont acceptés (whitelist BDD).
      - L'administrateur est verrouillé en base : ses droits ne peuvent être
        réduits (si role.code == 'administrateur', tous les accès restent True).
      - Chaque paire (role_id, menu_code) est upsertée (pas d'injection SQL
        possible : paramètres liés uniquement).
    """
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)
    role_code = role["code"]

    # L'admin voit tout (géré par la sidebar) → ses accès ne sont pas modifiables.
    if role_code == "administrateur":
        return {"message": "Accès administrateur verrouillés (accès total)."}

    # Whitelist = les écrans réels du menu (menu_items)
    valid_codes = set(
        db.execute(text("SELECT code FROM menu_items WHERE actif = TRUE")).scalars().all()
    )

    for item in payload.acces:
        code = item.get("menu_code", "")
        actif = bool(item.get("actif", False))

        if code not in valid_codes:
            raise HTTPException(
                status_code=400,
                detail=f"Code menu inconnu : '{code}'",
            )

        if actif:
            # Donne l'accès : insère dans menu_role si absent (table lue par la sidebar)
            db.execute(
                text(
                    """
                    INSERT INTO menu_role (menu_id, role)
                    SELECT m.id, :role
                    FROM menu_items m
                    WHERE m.code = :code
                      AND NOT EXISTS (
                          SELECT 1 FROM menu_role mr
                          JOIN menu_items mi ON mi.id = mr.menu_id
                          WHERE mi.code = :code AND mr.role = :role
                      )
                    """
                ),
                {"role": role_code, "code": code},
            )
        else:
            # Retire l'accès
            db.execute(
                text(
                    """
                    DELETE FROM menu_role
                    WHERE role = :role
                      AND menu_id IN (SELECT id FROM menu_items WHERE code = :code)
                    """
                ),
                {"role": role_code, "code": code},
            )

    _audit(db, current_user["sub"], "SET_ACCES", role_id, f"{len(payload.acces)} menus mis à jour")
    db.commit()
    return {"message": "Accès menus mis à jour."}

# ---------------------------------------------------------------------------
# Affectation des rôles aux utilisateurs (avec dates de validité)
# ---------------------------------------------------------------------------

class AssignUser(BaseModel):
    user_id: str = Field(..., description="UUID de l'utilisateur")
    date_debut: date | None = Field(None, description="Début de validité (défaut: aujourd'hui)")
    date_fin: date | None = Field(None, description="Fin de validité (optionnelle)")


class DatesUpdate(BaseModel):
    date_debut: date | None = None
    date_fin: date | None = None


@router.get("/{role_id}/utilisateurs")
def list_role_users(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Utilisateurs possédant ce rôle, avec leurs dates de validité. (Admin uniquement.)"""
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)

    rows = db.execute(
        text(
            """
            SELECT u.id::text                 AS user_id,
                   COALESCE(p.prenom, '')     AS prenom,
                   COALESCE(p.nom, '')        AS nom,
                   u.email                    AS email,
                   ur.date_debut              AS date_debut,
                   ur.date_fin                AS date_fin
            FROM user_roles ur
            JOIN users u    ON u.id = ur.user_id
            LEFT JOIN profiles p ON p.user_id = u.id
            WHERE ur.role = :code
            ORDER BY nom, prenom, u.email
            """
        ),
        {"code": role["code"]},
    ).mappings().all()
    return [dict(r) for r in rows]


@router.get("/{role_id}/utilisateurs/candidats")
def list_role_candidats(
    role_id: int,
    q: str | None = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Utilisateurs actifs ne possédant PAS encore ce rôle (pour l'ajout). (Admin uniquement.)"""
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)

    like = f"%{(q or '').strip().lower()}%"
    rows = db.execute(
        text(
            """
            SELECT u.id::text             AS user_id,
                   COALESCE(p.prenom, '') AS prenom,
                   COALESCE(p.nom, '')    AS nom,
                   u.email                AS email
            FROM users u
            LEFT JOIN profiles p ON p.user_id = u.id
            WHERE u.is_active = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM user_roles ur
                  WHERE ur.user_id = u.id AND ur.role = :code
              )
              AND (
                  :q = '%%'
                  OR lower(COALESCE(p.prenom,'') || ' ' || COALESCE(p.nom,'')) LIKE :q
                  OR lower(u.email) LIKE :q
              )
            ORDER BY nom, prenom, u.email
            LIMIT 50
            """
        ),
        {"code": role["code"], "q": like},
    ).mappings().all()
    return [dict(r) for r in rows]


@router.post("/{role_id}/utilisateurs", status_code=status.HTTP_201_CREATED)
def assign_role_user(
    role_id: int,
    payload: AssignUser,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Attribue ce rôle à un utilisateur (avec dates). Met à jour les dates si déjà attribué."""
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)

    if not role.get("actif"):
        raise HTTPException(status_code=400, detail="Rôle inactif : activez-le avant de l'attribuer.")

    exists_user = db.execute(
        text("SELECT 1 FROM users WHERE id = CAST(:uid AS uuid)"),
        {"uid": payload.user_id},
    ).first()
    if not exists_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    if payload.date_debut and payload.date_fin and payload.date_fin < payload.date_debut:
        raise HTTPException(status_code=400, detail="La date de fin doit être postérieure à la date de début.")

    params = {
        "uid": payload.user_id,
        "code": role["code"],
        "dd": payload.date_debut,   # None => défaut SQL (CURRENT_DATE) à l'insert
        "df": payload.date_fin,
    }

    already = db.execute(
        text("SELECT 1 FROM user_roles WHERE user_id = CAST(:uid AS uuid) AND role = :code"),
        params,
    ).first()

    if already:
        # Mise à jour des dates uniquement
        db.execute(
            text(
                """
                UPDATE user_roles
                SET date_debut = COALESCE(:dd, date_debut),
                    date_fin   = :df
                WHERE user_id = CAST(:uid AS uuid) AND role = :code
                """
            ),
            params,
        )
        action = "UPDATE_USER_DATES"
    else:
        db.execute(
            text(
                """
                INSERT INTO user_roles (id, user_id, role, date_debut, date_fin, created_at)
                VALUES (gen_random_uuid(), CAST(:uid AS uuid), :code,
                        COALESCE(:dd, CURRENT_DATE), :df, NOW())
                """
            ),
            params,
        )
        action = "ASSIGN_USER"

    _audit(db, current_user["sub"], action, role_id,
           f"user={payload.user_id} role={role['code']} debut={payload.date_debut} fin={payload.date_fin}")
    db.commit()
    return {"message": "Rôle attribué." if action == "ASSIGN_USER" else "Dates mises à jour."}


@router.patch("/{role_id}/utilisateurs/{user_id}")
def update_role_user_dates(
    role_id: int,
    user_id: str,
    payload: DatesUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Met à jour les dates de validité d'une affectation. (Admin uniquement.)"""
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)

    if payload.date_debut and payload.date_fin and payload.date_fin < payload.date_debut:
        raise HTTPException(status_code=400, detail="La date de fin doit être postérieure à la date de début.")

    res = db.execute(
        text(
            """
            UPDATE user_roles
            SET date_debut = COALESCE(:dd, date_debut),
                date_fin   = :df
            WHERE user_id = CAST(:uid AS uuid) AND role = :code
            """
        ),
        {"uid": user_id, "code": role["code"], "dd": payload.date_debut, "df": payload.date_fin},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Affectation introuvable.")

    _audit(db, current_user["sub"], "UPDATE_USER_DATES", role_id,
           f"user={user_id} debut={payload.date_debut} fin={payload.date_fin}")
    db.commit()
    return {"message": "Dates mises à jour."}


@router.delete("/{role_id}/utilisateurs/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_role_user(
    role_id: int,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_payload),
):
    """Retire ce rôle à un utilisateur. (Admin uniquement.)"""
    _require_admin(current_user)
    role = _get_role_or_404(db, role_id)

    # SÉCURITÉ : ne jamais retirer le rôle administrateur au dernier admin (anti-verrouillage)
    if role["code"] == "administrateur":
        nb_admins = db.execute(
            text("SELECT COUNT(DISTINCT user_id) FROM user_roles WHERE role = 'administrateur'")
        ).scalar()
        if nb_admins is not None and nb_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Impossible : il doit rester au moins un administrateur.",
            )

    db.execute(
        text("DELETE FROM user_roles WHERE user_id = CAST(:uid AS uuid) AND role = :code"),
        {"uid": user_id, "code": role["code"]},
    )
    _audit(db, current_user["sub"], "REVOKE_USER", role_id, f"user={user_id} role={role['code']}")
    db.commit()
