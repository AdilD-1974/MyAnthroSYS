from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles  # ✅ AJOUT
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import os  # ✅ AJOUT

from app.core.config import settings
from app.core.database import engine, Base
from app.middleware.logging import log_requests

from app.models import auth, collaborateur, paie, absences, organisation, mouvement  # noqa

from app.routers import (
    auth as auth_router,
    collaborateurs as collabs_router,
    absences as absences_router,
    paie as paie_router,
    organisations as orgs_router,
    mouvements as mouvements_router,
    dashboard as dashboard_router,
    collaborateur_adresses as collab_adresses_router,   # ✅ AJOUT
    referentiels_adresse as ref_adresse_router,         # ✅ AJOUT
    conges_droits as conges_droits_router,              # ✅ AJOUT
    workflow as workflow_router,                         # ✅ AJOUT moteur workflow
    contrats_admin as contrats_admin_router,             # ✅ AJOUT auto-clôture contrats
    conges_admin as conges_admin_router,                 # ✅ AJOUT RPC congés (generate_droits / recalculate_cong_solde)
)

# ✅ Créer les dossiers ICI — avant tout le reste
os.makedirs("storage/logos_societes", exist_ok=True)
os.makedirs("storage/documents", exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ✅ Créer les dossiers de stockage au démarrage
    os.makedirs("storage/logos_societes", exist_ok=True)
    os.makedirs("storage/documents", exist_ok=True)

    if settings.APP_ENV == "development":
        Base.metadata.create_all(bind=engine)

    # ✅ AJOUT — Démarrer le scheduler d'auto-clôture des contrats échus (01:00 quotidien)
    contrats_admin_router.start_scheduler()

    yield

    # ✅ AJOUT — Arrêt propre du scheduler
    contrats_admin_router.stop_scheduler()


app = FastAPI(
    title=settings.APP_NAME,
    description="PersonaHub HR — API REST Python/FastAPI + PostgreSQL",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(BaseHTTPMiddleware, dispatch=log_requests)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

PREFIX = "/api/v1"

app.include_router(auth_router.router,            prefix=PREFIX)
app.include_router(collabs_router.router,         prefix=PREFIX)
app.include_router(collab_adresses_router.router, prefix=PREFIX)  # ✅ AJOUT
app.include_router(absences_router.router,        prefix=PREFIX)
app.include_router(paie_router.router,            prefix=PREFIX)
app.include_router(orgs_router.router,            prefix=PREFIX)
app.include_router(mouvements_router.router,      prefix=PREFIX)
app.include_router(dashboard_router.router,       prefix=PREFIX)
app.include_router(ref_adresse_router.router,     prefix=PREFIX)  # ✅ AJOUT
app.include_router(conges_droits_router.router,    prefix=PREFIX)  # ✅ AJOUT
app.include_router(workflow_router.router,         prefix=PREFIX)  # ✅ AJOUT moteur workflow
app.include_router(contrats_admin_router.router,   prefix=PREFIX)  # ✅ AJOUT auto-clôture contrats
app.include_router(conges_admin_router.router,     prefix=PREFIX)  # ✅ AJOUT RPC congés

from app.routers import generic as generic_router
app.include_router(generic_router.router, prefix=PREFIX)

# ✅ Servir les fichiers statiques APRÈS les routers
# http://localhost:8000/api/v1/storage/logos_societes/fichier.png
app.mount(
    "/api/v1/storage",
    StaticFiles(directory="storage"),
    name="storage"
)


@app.get("/", tags=["Santé"])
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "1.0.0"}
