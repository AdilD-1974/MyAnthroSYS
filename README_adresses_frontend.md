# Adresses collaborateur — Livraison 2 (frontend)

## 📦 Contenu

- **`src/hooks/useReferentielsAdresse.ts`** — hooks `usePays`, `useRegions`, `useVilles`, `useVilleByCode` (cache 30 min)
- **`src/hooks/useCollaborateurAdresses.ts`** — hook combiné `useCollaborateurAdresses(collabId)` avec list + create + update + archive
- **`src/components/collaborateur/AdresseFormDialog.tsx`** — modale création/édition avec **cascading intelligent**
- **`src/components/collaborateur/TabAdresses.tsx`** — l'onglet à insérer dans la fiche collaborateur

## 🚀 Intégration (3 étapes)

### 1. Extraire le zip dans `D:\SOLGEIS`

```powershell
$zip = "D:\adresses-livraison2.zip"
Expand-Archive -Path $zip -DestinationPath "D:\SOLGEIS" -Force
```

### 2. Patcher `FicheCollaborateur.tsx`

⚠️ Ce fichier ne peut pas être livré complet (1300+ lignes de ton code), donc tu dois faire **3 modifications manuelles** dedans.

Ouvre `D:\SOLGEIS\personahub-hr\src\pages\FicheCollaborateur.tsx` dans VS Code.

#### Modif A — Ajouter l'import en haut

Cherche la zone des imports (autour de la ligne 26, après `CollaborateurPlanPaieForm`) et ajoute :

```tsx
import TabAdresses from "@/components/collaborateur/TabAdresses";
```

#### Modif B — Ajouter l'onglet dans `TABS`

Cherche la définition `const TABS = [...]` (autour de la ligne 54). Ajoute une ligne **entre `affectation` et `famille`** (ou n'importe où, mais en bonne logique métier) :

```tsx
const TABS = [
  { id: "identite",       label: "Identité",      icon: <User size={15} /> },
  { id: "contrats",       label: "Contrats",       icon: <Briefcase size={15} /> },
  { id: "affectation",    label: "Affectation & Classification",    icon: <Building2 size={15} /> },
  { id: "adresses",       label: "Adresses",       icon: <MapPin size={15} /> },  // ✅ AJOUT
  { id: "famille",        label: "Famille",        icon: <Heart size={15} /> },
  { id: "remuneration",   label: "Rémunération",   icon: <CreditCard size={15} /> },
  { id: "formation",      label: "Formation & Compétences", icon: <GraduationCap size={15} /> },
  { id: "immatriculation",label: "Immatriculat°",  icon: <Shield size={15} /> },
  { id: "syndical",       label: "Syndical",       icon: <Users size={15} /> },
  { id: "divers",         label: "Divers",         icon: <Settings size={15} /> },
];
```

⚠️ Vérifie que `MapPin` est bien dans tes imports `lucide-react` en haut du fichier — c'est le cas, tu l'avais déjà.

#### Modif C — Ajouter le rendu de l'onglet

Cherche le bloc autour de la **ligne 1287** où les onglets sont rendus :

```tsx
{activeTab === "identite" && <TabIdentite collab={collab} onSave={loadCollab} />}
{activeTab === "contrats" && <TabContrats collaborateurId={collab.id} ... />}
{activeTab === "affectation" && <TabAffectation collaborateurId={collab.id} ... />}
{!isManager && activeTab === "famille" && <TabFamille collaborateurId={collab.id} />}
... etc
```

Ajoute une ligne **entre `affectation` et `famille`** :

```tsx
{activeTab === "affectation" && <TabAffectation collaborateurId={collab.id} ancienMatricule={...} />}
{!isManager && activeTab === "adresses" && <TabAdresses collaborateurId={collab.id} />}  // ✅ AJOUT
{!isManager && activeTab === "famille" && <TabFamille collaborateurId={collab.id} />}
```

> **Note sur le `!isManager`** : l'adresse est considérée comme une donnée privée → restreint aux admin/RH. Si tu préfères que les managers la voient, retire le `!isManager &&`.

### 3. Tester

Vite va recharger automatiquement. Va sur la fiche d'un collaborateur :

```
http://localhost:8080/collaborateurs/{id}
```

Clique sur l'onglet **Adresses** → tu dois voir un état vide avec "Ajouter la première".

Clique sur **Ajouter** → la modale s'ouvre :
- Choisis un pays → les régions se filtrent
- Choisis une région → le pays s'auto-remplit, les villes se filtrent
- **Choisis une ville** → région, pays et code postal s'auto-remplissent ✨

Coche au moins un rôle (par exemple "Principale") et clique **Créer**. ✅

## 🧪 Tests rapides

| Action | Comportement attendu |
|---|---|
| Sauvegarder sans rôle coché | Erreur "Au moins un rôle d'adresse doit être coché" |
| Email mal formé | Erreur "Format d'email invalide" |
| Ouvrir une 2e fois la modale | Pré-remplit avec l'adresse en cours d'édition |
| Archiver la dernière principale | Erreur 400 du backend (garde-fou) |
| Saisir une ville inconnue | Possible, mais sans auto-remplissage (fallback) |

## 💡 Notes de design

- **Cache long sur les référentiels** : pays/régions/villes ne changent quasi jamais → 30 minutes de cache.
- **Recherche dans les villes** : si une base contient des milliers de villes, le champ de recherche dans le `<Select>` permet de filtrer côté serveur (le backend gère `?search=...`).
- **Carte adresse** : la principale est mise en évidence par un border accent.
- **Cascading bidirectionnel** : choisir une ville pré-remplit tout vers le haut. Choisir un pays vide tout vers le bas. Le code postal n'est écrasé QUE s'il était vide.

## ❓ Si quelque chose plante

1. **"Cannot find module @/hooks/useReferentielsAdresse"** → Vite a besoin d'être redémarré
2. **403 Forbidden sur les endpoints** → vérifie que ton user a bien un des rôles autorisés (`require_roles(...)`)
3. **Pays vide** → vérifie que `ref_pays` contient bien des lignes avec `actif = true`
