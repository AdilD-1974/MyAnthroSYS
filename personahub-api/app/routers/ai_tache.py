# app/routers/ai_tache.py
# ------------------------------------------------------------
# Agent IA pour la rédaction de descriptions de tâches
# POST /api/v1/ai/tache/rediger
# POST /api/v1/ai/tache/ameliorer
# POST /api/v1/ai/tache/decomposer
# ------------------------------------------------------------
from __future__ import annotations
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import anthropic

from app.core.security import get_current_user_payload

router = APIRouter(prefix="/ai/tache", tags=["ai-tache"])

def _client() -> anthropic.Anthropic:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY non configurée")
    return anthropic.Anthropic(api_key=key)


# ─── Schémas ─────────────────────────────────────────────────

class RedigerRequest(BaseModel):
    titre:       str
    type_tache:  Optional[str] = "personnelle"
    priorite:    Optional[str] = "normale"
    contexte:    Optional[str] = None   # infos sup fournies par l'utilisateur

class AmeliorerRequest(BaseModel):
    titre:       str
    description: str           # texte existant à améliorer
    type_tache:  Optional[str] = "personnelle"

class DecomposerRequest(BaseModel):
    titre:       str
    description: Optional[str] = None


# ─── Endpoints ───────────────────────────────────────────────

@router.post("/rediger")
def rediger_description(
    body: RedigerRequest,
    payload: dict = Depends(get_current_user_payload),
):
    """Génère une description complète à partir du titre de la tâche."""
    client = _client()

    prompt = f"""Tu es un assistant RH expert en gestion de tâches pour PersonaHub HR.

Génère une description professionnelle et structurée pour la tâche suivante :

**Titre** : {body.titre}
**Type** : {body.type_tache}
**Priorité** : {body.priorite}
{f"**Contexte fourni** : {body.contexte}" if body.contexte else ""}

La description doit :
- Être en français
- Commencer par un paragraphe d'objectif clair (1-2 phrases)
- Inclure une liste des actions concrètes à réaliser (3-5 points)
- Mentionner les critères de complétion si pertinent
- Être concise et actionnable (max 150 mots)

Réponds UNIQUEMENT avec le texte de la description en HTML simple (utilise <p>, <ul>, <li>, <strong> uniquement). Pas de markdown, pas d'explication."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    return {"description": message.content[0].text}


@router.post("/ameliorer")
def ameliorer_description(
    body: AmeliorerRequest,
    payload: dict = Depends(get_current_user_payload),
):
    """Améliore une description existante."""
    client = _client()

    prompt = f"""Tu es un assistant RH expert en gestion de tâches pour PersonaHub HR.

Améliore cette description de tâche pour la rendre plus claire, professionnelle et actionnable :

**Titre** : {body.titre}
**Type** : {body.type_tache}
**Description actuelle** :
{body.description}

Critères d'amélioration :
- Clarifier l'objectif
- Structurer avec des listes si pertinent
- Ajouter des critères de complétion si absents
- Rester concis (max 150 mots)
- Garder le même sens, améliorer la forme

Réponds UNIQUEMENT avec le texte amélioré en HTML simple (<p>, <ul>, <li>, <strong> uniquement). Pas d'explication."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    return {"description": message.content[0].text}


@router.post("/decomposer")
def decomposer_en_sous_taches(
    body: DecomposerRequest,
    payload: dict = Depends(get_current_user_payload),
):
    """Décompose une tâche en sous-tâches suggérées."""
    client = _client()

    prompt = f"""Tu es un assistant RH expert en gestion de tâches pour PersonaHub HR.

Décompose cette tâche en sous-tâches concrètes et réalisables :

**Titre** : {body.titre}
{f"**Description** : {body.description}" if body.description else ""}

Génère 3 à 6 sous-tâches. Pour chacune donne :
- Un titre court et actionnable
- Une priorité parmi : basse, normale, haute, urgente

Réponds UNIQUEMENT en JSON valide avec ce format exact, sans markdown :
{{"sous_taches": [{{"titre": "...", "priorite": "normale"}}, ...]}}"""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}]
    )

    import json
    try:
        text = message.content[0].text.strip()
        # Nettoyer si markdown
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        data = json.loads(text)
        return data
    except Exception:
        return {"sous_taches": [], "erreur": "Parsing échoué"}
