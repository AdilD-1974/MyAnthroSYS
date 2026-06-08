# Adresses collaborateur — Livraison 1 (backend)

## 📦 Contenu

- **Migration Alembic** `2026_add_fk_collaborateur_adresses.py`
  - Ajoute les FK manquantes vers `ref_pays`, `ref_region`, `ref_ville`
  - Ajoute des index sur les FK et un index `(collaborateur_id, archive)`
  - Idempotente (peut etre rejouee sans erreur)
- **Modeles SQLAlchemy** :
  - `app/models/collaborateur_adresse.py` — table `collaborateur_adresses`
  - `app/models/referentiels_adresse.py` — `RefPays`, `RefRegion`, `RefVille` (lecture seule)
- **Schemas Pydantic** :
  - `app/schemas/collaborateur_adresse.py` — Create / Update / Read avec validation
  - `app/schemas/referentiels_adresse.py` — schemas read-only pour les referentiels
- **Routers** :
  - `app/routers/collaborateur_adresses.py` — CRUD scope par collaborateur (5 endpoints)
  - `app/routers/referentiels_adresse.py` — pays / regions / villes en lecture seule (3 endpoints)

## 🚀 Integration backend (5 etapes)

### 1. Extraire les fichiers

```powershell
$zip = "D:\adresses-livraison1.zip"
Expand-Archive -Path $zip -DestinationPath "D:\SOLGEIS" -Force
```

### 2. Declarer les nouveaux modeles dans `app/models/__init__.py`

Ouvre `D:\SOLGEIS\personahub-api\app\models\__init__.py` et ajoute apres
les imports existants :

```python
from app.models import collaborateur_adresse  # noqa
from app.models import referentiels_adresse   # noqa
```

### 3. Inclure les routers dans `main.py`

Ouvre `D:\SOLGEIS\personahub-api\main.py` (ou `app/main.py` selon ton arbo)
et ajoute :

```python
from app.routers import collaborateur_adresses, referentiels_adresse
# ...
app.include_router(collaborateur_adresses.router, prefix=PREFIX)
app.include_router(referentiels_adresse.router,   prefix=PREFIX)
```

### 4. Lancer la migration

```powershell
cd D:\SOLGEIS\personahub-api
.\venv312\Scripts\activate

# Sur la base actuellement pointee par DATABASE_URL
alembic upgrade head
```

Tu dois voir :
```
Running upgrade a1b2c3d4e5f1 -> b2c3d4e5f1a2, add fk references...
```

### 5. Verifier dans Swagger

Demarre uvicorn, va sur http://localhost:8000/docs.
Tu dois voir 2 nouvelles sections :

**Collaborateurs · Adresses** (5 endpoints)
- GET /api/v1/collaborateurs/{collaborateur_id}/adresses
- GET /api/v1/collaborateurs/{collaborateur_id}/adresses/{adresse_id}
- POST /api/v1/collaborateurs/{collaborateur_id}/adresses
- PATCH /api/v1/collaborateurs/{collaborateur_id}/adresses/{adresse_id}
- DELETE /api/v1/collaborateurs/{collaborateur_id}/adresses/{adresse_id}

**Referentiels · Adresse** (3 endpoints)
- GET /api/v1/referentiels/pays
- GET /api/v1/referentiels/regions
- GET /api/v1/referentiels/villes

## 🧪 Test rapide via curl ou httpie

```bash
# Lister les pays
curl http://localhost:8000/api/v1/referentiels/pays \
  -H "Authorization: Bearer $TOKEN"

# Lister les regions du Maroc (par exemple)
curl "http://localhost:8000/api/v1/referentiels/regions?code_pays=MA" \
  -H "Authorization: Bearer $TOKEN"

# Rechercher une ville
curl "http://localhost:8000/api/v1/referentiels/villes?search=casa" \
  -H "Authorization: Bearer $TOKEN"
```

## ⏭️ Apres validation : Livraison 2 (frontend)

Une fois ces endpoints valides, je livre :
- Hooks React Query (`useCollaborateurAdresses.ts`, `useReferentielsAdresse.ts`)
- Modale `AdresseFormDialog.tsx` avec cascading intelligent
- Onglet `TabAdresses.tsx`
- Patch `FicheCollaborateur.tsx` (ajout de l'onglet "Adresses")
