"""
fix_organisations_page.py
Corrige l'import de ManagerReadOnlyContext dans OrganisationsPage.tsx
Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os

FILE = os.path.join("src", "pages", "OrganisationsPage.tsx")

if not os.path.exists(FILE):
    print(f"ERREUR : fichier introuvable -> {FILE}")
    exit(1)

with open(FILE, "r", encoding="utf-8") as f:
    content = f.read()

# Corriger l'import de ManagerReadOnlyContext
old = 'import { ManagerReadOnlyContext } from "@/App";'
new = 'import { ManagerReadOnlyContext } from "@/contexts/ManagerContext";'

if old in content:
    content = content.replace(old, new)
    print("OK : import ManagerReadOnlyContext corrige")
else:
    print("ATTENTION : import non trouve (peut-etre deja corrige)")

with open(FILE, "w", encoding="utf-8") as f:
    f.write(content)

print("Fichier sauvegarde !")
print("Actualisez le navigateur (F5).")
