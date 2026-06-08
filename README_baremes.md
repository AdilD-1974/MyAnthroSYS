# Refonte des barèmes — guide d'intégration

## 📦 Ce qui est livré

### Backend (`personahub-api`)
- `alembic/versions/2026_refonte_baremes.py` — migration : drop ancien schéma + création nouveau
- `app/models/bareme.py` — 4 modèles SQLAlchemy (Bareme, BaremeCle, BaremeSortie, BaremeLigne)
- `app/schemas/bareme.py` — schémas Pydantic avec validation métier
- `app/routers/baremes.py` — router CRUD + PUT atomique
- `app/routers/paie.py` — **REMPLACE** ton fichier existant (retire les anciens endpoints barème, monte le sous-router)

### Frontend (`personahub-hr`)
- `src/types/bareme.ts` — types TypeScript + helpers
- `src/hooks/useBaremes.ts` — hooks React Query
- `src/components/paie/baremes/BaremeForm.tsx` — formulaire complet (l'écran cible)
- `src/pages/paie/parametrage/BaremesPages.tsx` — pages liste + new + edit

## 🚀 Intégration backend (5 min)

### 1. Vérifier que `app/models/paie.py` ne contient plus `Bareme` ni `BaremeLigne`

⚠️ **Important** : ton ancien fichier `app/models/paie.py` contient encore les classes `Bareme` et `BaremeLigne`. Il faut les **retirer** sinon SQLAlchemy va lever une erreur au démarrage (mappers en doublon avec `app/models/bareme.py`).

Édite `app/models/paie.py` et supprime les blocs `class Bareme(Base)` et `class BaremeLigne(Base)`. Garde tout le reste (`Rubrique`, `Cotisation`, `SalaireFixe`).

### 2. Déclarer le nouveau modèle dans `app/models/__init__.py`

```python
from app.models import bareme  # noqa
```

### 3. Lancer la migration

```powershell
cd D:\SOLGEIS\personahub-api
.\venv312\Scripts\activate

# Charger les variables d'env (si pas déjà fait)
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/solgeis_hr"
$env:SECRET_KEY   = "personahub-solgeis-secret-key-2025"
# ... + autres

# Migrer
alembic upgrade head
```

### 4. Vérifier les nouvelles tables

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema='public' AND table_name LIKE 'bareme%' 
ORDER BY table_name;
-- Doit retourner : bareme, bareme_cle, bareme_ligne, bareme_sortie
```

### 5. Tester l'API

Démarre `uvicorn`, va sur **http://localhost:8000/docs**, cherche la section **"Paie · Barèmes"** : 6 endpoints.

## 🎨 Intégration frontend (5 min)

### 1. Ajouter les routes dans ton routeur React

```tsx
import {
  BaremesListPage,
  BaremeNewPage,
  BaremeEditPage,
} from "@/pages/paie/parametrage/BaremesPages";

// ...
<Route path="/paie/parametrage/baremes"        element={<BaremesListPage />} />
<Route path="/paie/parametrage/baremes/new"    element={<BaremeNewPage />} />
<Route path="/paie/parametrage/baremes/:id"    element={<BaremeEditPage />} />
```

### 2. Adapter le client API si besoin

Le hook `useBaremes.ts` utilise `import { api } from "@/lib/api"`. Si ton client se trouve ailleurs, ajuste l'import.

### 3. Lien depuis l'écran existant

Sur ta page **Paramétrage paie → Règles de calcul → Barèmes**, le bouton qui ouvre le form de barème doit pointer vers `/paie/parametrage/baremes/new` (ou `/.../{id}` pour l'édition).

## 🧪 Premier test

1. Va sur la liste des barèmes — vide.
2. Clique "Nouveau barème".
3. Saisis :
   - Code : `PANC`
   - Libellé : `Barème des Anciennetés`
   - Date début : `01/01/2020`
4. Clé d'entrée par défaut : modifie en `ancien` / `Ancienneté (Année)` / `NUMERIQUE` / `PLAGE`.
5. Sortie par défaut : modifie en `taux` / `Taux d'ancienneté` / `TAUX`.
6. Ajoute 3 lignes :
   - 2 → 4.99 → 5
   - 5 → 11.99 → 10
   - 12 → 19.99 → 15
7. Enregistre. ✅

## 🧠 Pour la suite (moteur de paie)

Les lignes sont stockées en JSONB. Pour récupérer la valeur d'un barème depuis SQL :

```sql
-- Trouver la ligne pour ancienneté = 7 ans dans le barème PANC
SELECT bl.valeurs_sorties->>'taux' AS taux
FROM bareme_ligne bl
JOIN bareme b ON b.id = bl.bareme_id
WHERE b.code = 'PANC'
  AND b.actif = true
  AND b.archive = false
  AND CURRENT_DATE BETWEEN b.date_debut_validite 
                       AND COALESCE(b.date_fin_validite, '9999-12-31')
  AND (bl.valeurs_cles->'ancien'->>'min')::numeric <= 7
  AND (bl.valeurs_cles->'ancien'->>'max')::numeric >= 7
ORDER BY bl.ordre
LIMIT 1;
```

Les index GIN sur `valeurs_cles` et `valeurs_sorties` accélèrent les recherches sur des barèmes volumineux.
