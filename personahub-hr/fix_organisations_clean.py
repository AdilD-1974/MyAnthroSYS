"""
fix_organisations_clean.py
Restaure OrganisationsPage.tsx depuis le zip original et applique 
les corrections minimales proprement (encodage UTF-8 garanti).
Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os
import re
import zipfile
import shutil

# ─── Chemins ──────────────────────────────────────────────────────────────────
ZIP_PATH   = r"D:\SOLGEIS\personahub-hr-Version_GA_PAIE__1_.zip"
FILE_IN_ZIP = "personahub-hr-Version_GA_PAIE/src/pages/OrganisationsPage.tsx"
TARGET     = os.path.join("src", "pages", "OrganisationsPage.tsx")

# ─── 1. Extraire le fichier original depuis le zip ───────────────────────────
print("Etape 1 : Restauration depuis le zip original...")

if not os.path.exists(ZIP_PATH):
    # Chercher le zip dans les emplacements courants
    candidates = [
        r"D:\personahub-hr-Version_GA_PAIE__1_.zip",
        r"C:\Users\solge\Downloads\personahub-hr-Version_GA_PAIE__1_.zip",
        r"D:\SOLGEIS\personahub-hr-Version_GA_PAIE__1_.zip",
    ]
    for c in candidates:
        if os.path.exists(c):
            ZIP_PATH = c
            break
    else:
        print("ZIP non trouve ! Cherchez manuellement le fichier zip original.")
        print("Entrez le chemin complet du zip :")
        ZIP_PATH = input("> ").strip()

try:
    with zipfile.ZipFile(ZIP_PATH, 'r') as z:
        # Lister les fichiers pour trouver le bon chemin
        names = z.namelist()
        org_files = [n for n in names if "OrganisationsPage.tsx" in n]
        if not org_files:
            print("ERREUR : OrganisationsPage.tsx non trouve dans le zip")
            exit(1)
        
        src_name = org_files[0]
        print(f"  Trouve dans le zip : {src_name}")
        
        # Lire le contenu original
        with z.open(src_name) as f:
            content = f.read().decode('utf-8')
        
        print(f"  OK : {len(content)} caracteres lus")
except Exception as e:
    print(f"ERREUR lecture zip : {e}")
    exit(1)

# ─── 2. Appliquer les corrections minimales ──────────────────────────────────
print("\nEtape 2 : Application des corrections...")

# Correction 1 : Import ManagerReadOnlyContext depuis @/App -> @/contexts/ManagerContext
old1 = 'import { ManagerReadOnlyContext } from "@/App";'
new1 = 'import { ManagerReadOnlyContext } from "@/contexts/ManagerContext";'
if old1 in content:
    content = content.replace(old1, new1)
    print("  OK : import ManagerReadOnlyContext corrige")

# Correction 2 : S'assurer que l'import supabase est present (utilise le mock)
if 'from "@/integrations/supabase/client"' not in content:
    content = content.replace(
        'import React,',
        'import { supabase } from "@/integrations/supabase/client";\nimport React,'
    )
    print("  OK : import supabase ajoute")
else:
    print("  OK : import supabase deja present")

# ─── 3. Sauvegarder avec encodage UTF-8 correct ──────────────────────────────
print(f"\nEtape 3 : Sauvegarde dans {TARGET}...")

os.makedirs(os.path.dirname(TARGET), exist_ok=True)
with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(content)

print("  OK : Fichier sauvegarde en UTF-8 pur")

# ─── 4. Verification ─────────────────────────────────────────────────────────
print("\nEtape 4 : Verification...")
with open(TARGET, 'r', encoding='utf-8') as f:
    check = f.read()

# Verifier que les accents sont corrects
if 'SociÃ' in check or 'Ã©' in check:
    print("  ATTENTION : Des caracteres mal encodes ont ete detectes !")
else:
    print("  OK : Encodage UTF-8 correct")

if 'ManagerReadOnlyContext' in check and '@/contexts/ManagerContext' in check:
    print("  OK : Import ManagerContext correct")

print(f"\nFichier restaure et corrige avec succes !")
print("Actualisez le navigateur (F5).")
print("\nNote : Les creations/modifications ne fonctionneront pas encore")
print("car les appels supabase.from().insert() doivent etre migres vers FastAPI.")
