from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import os
import logging

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
    collaborateur_adresses as collab_adresses_router,
    referentiels_adresse as ref_adresse_router,
    conges_droits as conges_droits_router,
    workflow as workflow_router,
    contrats_admin as contrats_admin_router,
    conges_admin as conges_admin_router,
    provisioning as provisioning_router,
    workflow_trigger as workflow_trigger_router,
    taches as taches_router,                          # ✅ TACHES
    ai_tache as ai_tache_router,                      # ✅ TACHES-IA
)

logger = logging.getLogger(__name__)

# Créer les dossiers ICI — avant tout le reste
os.makedirs("storage/logos_societes", exist_ok=True)
os.makedirs("storage/documents", exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("storage/logos_societes", exist_ok=True)
    os.makedirs("storage/documents", exist_ok=True)

    if settings.APP_ENV == "development":
        Base.metadata.create_all(bind=engine)

    # Scheduler auto-clôture des contrats échus (01:00 quotidien)
    contrats_admin_router.start_scheduler()

    # ✅ TACHES — Démarrer le scheduler des rappels de tâches (toutes les 5 min)
    try:
        from app.services.tache_rappel_scheduler import scheduler as tache_scheduler
        tache_scheduler.start()
        logger.info("✅ Scheduler rappels tâches démarré")
    except Exception as e:
        logger.warning(f"Scheduler tâches non démarré : {e}")

    yield

    # Arrêt propre du scheduler contrats
    contrats_admin_router.stop_scheduler()

    # ✅ TACHES — Arrêt propre du scheduler tâches
    try:
        tache_scheduler.shutdown(wait=False)
        logger.info("Scheduler rappels tâches arrêté")
    except Exception:
        pass


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
app.include_router(collab_adresses_router.router, prefix=PREFIX)
app.include_router(absences_router.router,        prefix=PREFIX)
app.include_router(paie_router.router,            prefix=PREFIX)
app.include_router(orgs_router.router,            prefix=PREFIX)
app.include_router(mouvements_router.router,      prefix=PREFIX)
app.include_router(dashboard_router.router,       prefix=PREFIX)
app.include_router(ref_adresse_router.router,     prefix=PREFIX)
app.include_router(conges_droits_router.router,   prefix=PREFIX)
app.include_router(workflow_router.router,        prefix=PREFIX)
app.include_router(contrats_admin_router.router,  prefix=PREFIX)
app.include_router(conges_admin_router.router,    prefix=PREFIX)
app.include_router(provisioning_router.router,    prefix=PREFIX)
app.include_router(workflow_trigger_router.router,prefix=PREFIX)
app.include_router(taches_router.router,          prefix=PREFIX)  # ✅ TACHES
app.include_router(ai_tache_router.router,        prefix=PREFIX)  # ✅ TACHES-IA

from app.routers import habilitations as habilitations_router
app.include_router(habilitations_router.router, prefix=PREFIX)

from app.routers import demandes as demandes_router
app.include_router(demandes_router.router, prefix=PREFIX)

from app.routers import generic as generic_router
app.include_router(generic_router.router, prefix=PREFIX)

from app.routers import chat as chat_router
app.include_router(chat_router.router, prefix=PREFIX)

from app.routers import roles as roles_router
app.include_router(roles_router.router, prefix=PREFIX)

from app.routers import prets as prets_router          # ✅ PRÊTS
app.include_router(prets_router.router, prefix=PREFIX)

from app.routers import pret_documents as pret_documents_router   # ✅ DOCUMENTS DE PRÊT (upload + lecture sécurisée)
app.include_router(pret_documents_router.router, prefix=PREFIX)

from app.routers import nav as nav_router              # ✅ NAVIGATION
app.include_router(nav_router.router, prefix=PREFIX)

from app.routers import smtp_config as smtp_config_router   # ✅ SMTP
app.include_router(smtp_config_router.router, prefix=PREFIX)

from app.routers import sms_config as sms_config_router     # ✅ SMS
app.include_router(sms_config_router.router, prefix=PREFIX)

from app.routers import licence as licence_router         # ✅ LICENCES
app.include_router(licence_router.router, prefix=PREFIX)

from app.routers import cong_operations as cong_operations_router   # ✅ OPÉRATIONS CONGÉS (annulation / report / reprise)
app.include_router(cong_operations_router.router, prefix=PREFIX)

from app.routers import conges as conges_router   # ✅ LISTE DES CONGÉS (scopée par rôle)
app.include_router(conges_router.router, prefix=PREFIX)

from app.routers import departs as departs_router   # ✅ DÉPARTS scopés (manager / RH / Paie / admin)
app.include_router(departs_router.router, prefix=PREFIX)

from app.routers import departs_storage as departs_storage_router   # ✅ DOCUMENTS DE DÉPART (upload + lecture sécurisée)
app.include_router(departs_storage_router.router, prefix=PREFIX)

from app.routers import depart_processus as depart_processus_router   # ✅ PROCESSUS DE DÉPART (config + association + suivi)
app.include_router(depart_processus_router.router, prefix=PREFIX)

from app.routers import requeteur as requeteur_router   # ✅ REQUÊTEUR (constructeur de requêtes visuel)
app.include_router(requeteur_router.router, prefix=PREFIX)

from app.routers import virements as virements_router   # ✅ VIREMENTS (salaires & retenues à la source)
app.include_router(virements_router.router, prefix=PREFIX)

from app.routers import declarations_ir as declarations_ir_router   # ✅ DÉCLARATION IR - ÉTAT 9421 (DTS)
app.include_router(declarations_ir_router.router, prefix=PREFIX)

from app.routers import etats as etats_router   # ✅ GÉNÉRATEUR D'ÉTATS PERSONNALISÉS (MODULE_ETATS_PAIE.md)
app.include_router(etats_router.router, prefix=PREFIX)
app.include_router(etats_router.ecrans_router, prefix=PREFIX)

# Servir les fichiers statiques APRÈS les routers
app.mount(
    "/api/v1/storage",
    StaticFiles(directory="storage"),
    name="storage"
)


@app.get("/", tags=["Santé"])
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "1.0.0"}
