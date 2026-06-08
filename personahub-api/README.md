# PersonaHub HR — Backend FastAPI + PostgreSQL

Backend Python remplaçant Supabase pour l'application PersonaHub HR.

## Stack technique
- **Python 3.12** + **FastAPI 0.115**
- **PostgreSQL 16** via **SQLAlchemy 2.0**
- **Alembic** pour les migrations
- **JWT** (python-jose) pour l'authentification
- **Docker Compose** pour le déploiement

---

## Démarrage rapide (développement)

### 1. Prérequis
```bash
python 3.12+
postgresql 14+  (ou Docker)
```

### 2. Installation
```bash
git clone <votre-repo>
cd personahub-api

python -m venv venv
source venv/bin/activate        # Linux/macOS
# venv\Scripts\activate.bat     # Windows

pip install -r requirements.txt
```

### 3. Configuration
```bash
cp .env.example .env
# Éditer .env avec votre DATABASE_URL et SECRET_KEY
openssl rand -hex 32            # pour générer SECRET_KEY
```

### 4. Base de données
```bash
# Créer la base
createdb personahub_hr

# Appliquer les migrations
alembic upgrade head

# (optionnel) Injecter les données initiales
psql personahub_hr < scripts/init.sql
```

### 5. Lancer le serveur
```bash
uvicorn app.main:app --reload
# → http://localhost:8000
# → http://localhost:8000/docs  (Swagger UI)
```

---

## Démarrage avec Docker

```bash
cp .env.example .env
# Renseigner DB_PASSWORD et SECRET_KEY dans .env

docker compose up -d
# → API  : http://localhost:8000/docs
# → DB   : localhost:5432

# Avec pgAdmin (interface graphique BDD) :
docker compose --profile tools up -d
# → pgAdmin : http://localhost:5050
```

---

## Endpoints principaux

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/api/v1/auth/login` | Authentification → JWT |
| GET  | `/api/v1/auth/me` | Utilisateur connecté |
| GET  | `/api/v1/collaborateurs` | Liste paginée |
| POST | `/api/v1/collaborateurs` | Créer un collaborateur |
| GET  | `/api/v1/collaborateurs/{id}` | Fiche collaborateur |
| GET  | `/api/v1/absences/demandes` | Demandes de congé |
| POST | `/api/v1/absences/demandes` | Soumettre une demande |
| POST | `/api/v1/absences/demandes/{id}/valider` | Approuver/Refuser |
| GET  | `/api/v1/paie/rubriques` | Rubriques de paie |
| GET  | `/api/v1/paie/cotisations` | Cotisations CNSS/AMO/CIMR |
| GET  | `/api/v1/paie/baremes` | Barèmes (IGR...) |
| GET  | `/api/v1/organisations` | Structure organisationnelle |

---

## Migrations Alembic

```bash
# Créer une nouvelle migration après modification des modèles
alembic revision --autogenerate -m "description"

# Appliquer toutes les migrations
alembic upgrade head

# Revenir en arrière
alembic downgrade -1
```

---

## Tests

```bash
pytest tests/ -v
pytest tests/ -v --cov=app     # avec couverture
```

---

## Adaptation du frontend React

Copiez les fichiers du dossier `frontend-adapter/` :

1. **`api.ts`** → `src/lib/api.ts` — remplace le client Supabase
2. **`AuthContext.tsx`** → `src/contexts/AuthContext.tsx` — remplace l'auth Supabase

Puis mettez à jour `.env` du frontend React :
```bash
# .env (projet React)
VITE_API_URL=http://localhost:8000/api/v1
# Supprimer VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
```

---

## Structure du projet

```
personahub-api/
├── app/
│   ├── main.py              ← FastAPI app + middleware + routers
│   ├── core/
│   │   ├── config.py        ← Pydantic Settings
│   │   ├── database.py      ← SQLAlchemy + pool PostgreSQL
│   │   └── security.py      ← JWT + bcrypt + require_roles()
│   ├── middleware/
│   │   └── logging.py       ← Log des requêtes
│   ├── models/              ← SQLAlchemy ORM
│   │   ├── auth.py          ← User, Profile, UserRole
│   │   ├── collaborateur.py ← Collaborateur, Contrat, Affectation
│   │   ├── paie.py          ← Rubrique, Cotisation, Bareme, SalaireFixe
│   │   ├── absences.py      ← TypeConge, DemandeConge, Compteur, JourFerie
│   │   └── organisation.py  ← Organisation, Poste
│   ├── schemas/             ← Pydantic (validation I/O)
│   └── routers/             ← Endpoints API
│       ├── auth.py
│       ├── collaborateurs.py
│       ├── absences.py
│       ├── paie.py
│       └── organisations.py
├── alembic/                 ← Migrations SQL
├── scripts/
│   └── init.sql             ← Données initiales (jours fériés, cotisations Maroc)
├── frontend-adapter/        ← Fichiers à copier dans le projet React
│   ├── api.ts
│   └── AuthContext.tsx
├── tests/
│   └── test_auth.py
├── Dockerfile
├── docker-compose.yml
├── alembic.ini
├── requirements.txt
└── .env.example
```
