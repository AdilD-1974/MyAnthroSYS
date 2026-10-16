"""
Routeur — Déclaration IR / État 9421.

Notes d'intégration confirmées le 19/08 :
  - `get_db` → app.core.database
  - `require_roles(*roles)` → app.core.security, sert lui-même de
    dépendance FastAPI et renvoie le payload JWT décodé (dict avec
    "sub"/"email"/"role"/"all_roles"), pas un objet — voir usage de
    `current_user.get("sub")` dans `alimenter()`.

RG-MULTISOCIETE-07 (migration 058) : ir_declarations.societe_id (NOT NULL)
ajouté -- tous les endpoints ci-dessous sont désormais bornés à la société
active (recherche par (annee, societe_id) au lieu de (annee) seul).
"""

from __future__ import annotations

from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db      # ✅ confirmé via main.py
from app.core.security import require_roles, get_societe_active_id      # ✅ confirmé via rapports_paie.py
from app.services.rapport_ir_9421_engine import (
    alimenter_declaration_ir,
    archiver_declarations_ir_echues,
    calculer_kpis_ir,
    delete_mapping_exoneration,
    delete_rubrique_ligne_ir,
    generer_xml_declaration_ir,
    get_parametrage_ir,
    upsert_mapping_exoneration,
    upsert_rubrique_ligne_ir,
)

router = APIRouter(prefix="/paie/declarations/ir", tags=["Déclaration IR - État 9421"])

ROLES_AUTORISES = ["administrateur", "gestionnaire_rh", "gestionnaire_paie"]


class RubriqueLigneUpsert(BaseModel):
    code_constante: str
    code_rubrique_paie: str
    attribut: str  # "montant" | "nombre" | "taux"
    signe: str      # "+" | "-"


class ExonerationUpsert(BaseModel):
    code_rubrique_paie: str
    code_dgi: str
    signe: str = "+"  # "+" | "-"


# ── Paramétrage ────────────────────────────────────────────────
# ⚠️ Placés avant la route générique "/{annee}" pour éviter tout
# conflit de routing (comme "/historique" ci-dessous).

@router.get("/parametrage")
def parametrage(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
):
    """Tout ce qu'il faut pour afficher et éditer l'écran Paramétrage :
    composition (rubrique+attribut+signe) de chaque agrégat
    IR_RUBRIQUE_*, rubriques de paie disponibles, mapping types de
    contrat, mapping éléments exonérés."""
    return get_parametrage_ir(db)


@router.post("/parametrage/rubrique-ligne")
def parametrage_ajouter_rubrique_ligne(
    payload: RubriqueLigneUpsert,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
):
    try:
        upsert_rubrique_ligne_ir(
            db, payload.code_constante, payload.code_rubrique_paie, payload.attribut, payload.signe
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.delete("/parametrage/rubrique-ligne/{code_constante}/{code_rubrique_paie}")
def parametrage_supprimer_rubrique_ligne(
    code_constante: str,
    code_rubrique_paie: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
):
    delete_rubrique_ligne_ir(db, code_constante, code_rubrique_paie)
    return {"ok": True}


@router.post("/parametrage/exoneration")
def parametrage_maj_exoneration(
    payload: ExonerationUpsert,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
):
    upsert_mapping_exoneration(db, payload.code_rubrique_paie, payload.code_dgi, payload.signe)
    return {"ok": True}


@router.delete("/parametrage/exoneration/{code_rubrique_paie}")
def parametrage_suppr_exoneration(
    code_rubrique_paie: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
):
    delete_mapping_exoneration(db, code_rubrique_paie)
    return {"ok": True}


@router.post("/{annee}/alimenter")
def alimenter(
    annee: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """Recalcule les lignes de la déclaration IR de l'année donnée à
    partir des bulletins réels (table-rase)."""
    # ✅ confirmé par la trace d'erreur du 19/08 : require_roles(...)
    # renvoie un dict (payload JWT décodé : sub/email/role/all_roles),
    # pas un objet — "sub" est le claim JWT standard pour l'ID utilisateur.
    user_id = current_user.get("sub") if isinstance(current_user, dict) else current_user.id
    try:
        result = alimenter_declaration_ir(db, annee, created_by=user_id, societe_id=societe_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.get("/{annee}/kpis")
def kpis(
    annee: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
    societe_id: str = Depends(get_societe_active_id),
):
    from sqlalchemy import text

    declaration = db.execute(
        text("SELECT id, statut FROM ir_declarations WHERE annee = :annee AND societe_id = :sid"),
        {"annee": annee, "sid": societe_id},
    ).fetchone()
    if not declaration:
        raise HTTPException(status_code=404, detail=f"Aucune déclaration IR pour {annee}.")

    return {
        "declaration_id": str(declaration.id),
        "statut": declaration.statut,
        **calculer_kpis_ir(db, declaration.id),
    }


@router.get("/{annee}/lignes")
def lignes(
    annee: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
    societe_id: str = Depends(get_societe_active_id),
):
    from sqlalchemy import text

    declaration = db.execute(
        text("SELECT id FROM ir_declarations WHERE annee = :annee AND societe_id = :sid"),
        {"annee": annee, "sid": societe_id},
    ).fetchone()
    if not declaration:
        raise HTTPException(status_code=404, detail=f"Aucune déclaration IR pour {annee}.")

    rows = db.execute(
        text(
            "SELECT * FROM ir_declaration_lignes WHERE declaration_id = :id ORDER BY nom, prenom"
        ),
        {"id": declaration.id},
    ).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/{annee}/generer-xml")
def generer_xml(
    annee: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """Génère et retourne le fichier XML DTS/État 9421 en téléchargement
    (consommé côté frontend via postForBlob, comme le bordereau CNSS).

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` corrige l'en-tête
    (raison sociale/IF) du XML généré -- CORRECTIF PARTIEL, voir avertissement
    dans get_societe_info(). `ir_declarations` elle-même n'a pas encore de
    societe_id (table non migrée) : ce endpoint reste utilisable en
    mono-société réelle uniquement tant que la migration correspondante
    n'est pas écrite (nécessite le schéma exact de ir_declarations/
    ir_declaration_lignes, non fourni à ce stade)."""
    try:
        xml_bytes = generer_xml_declaration_ir(db, annee, societe_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    filename = f"{annee}_DTS_9421.xml"
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/historique")
def historique(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """Liste des déclarations IR toutes années confondues, avec
    archivage automatique des déclarations échues (délai légal Art. 79
    CGI) déclenché au chargement, sur le même principe que l'historique
    CNSS.

    RG-MULTISOCIETE-07 : archiver_declarations_ir_echues() balaie TOUTES
    les sociétés (opération de maintenance sans risque de fuite -- elle ne
    fait que changer un statut) ; la liste renvoyée ensuite, elle, est
    bornée à la société active."""
    from sqlalchemy import text

    archiver_declarations_ir_echues(db)

    rows = db.execute(
        text(
            "SELECT id, annee, statut, nombre_total_salaries, montant_total_ir, "
            "fichier_xml_path, created_at, updated_at "
            "FROM ir_declarations WHERE societe_id = :sid ORDER BY annee DESC"
        ),
        {"sid": societe_id},
    ).fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/{annee}")
def get_declaration(
    annee: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*ROLES_AUTORISES)),
    societe_id: str = Depends(get_societe_active_id),
):
    from sqlalchemy import text

    declaration = db.execute(
        text("SELECT * FROM ir_declarations WHERE annee = :annee AND societe_id = :sid"),
        {"annee": annee, "sid": societe_id},
    ).fetchone()
    if not declaration:
        raise HTTPException(status_code=404, detail=f"Aucune déclaration IR pour {annee}.")
    return dict(declaration._mapping)
