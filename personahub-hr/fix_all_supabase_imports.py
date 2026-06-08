"""
fix_all_supabase_imports.py

Script global qui parcourt TOUS les fichiers .tsx/.ts du projet et s'assure
que chaque fichier qui utilise `supabase` dispose bien de l'import.

Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os
import re

SRC = "src"
SUPABASE_IMPORT = 'import { supabase } from "@/integrations/supabase/client";\n'

corriges = 0
deja_ok = 0
ignores = 0

for root, dirs, files in os.walk(SRC):
    # Ignorer node_modules et le dossier integrations/supabase lui-meme
    dirs[:] = [d for d in dirs if d not in ["node_modules", "__pycache__"]]

    for fname in files:
        if not (fname.endswith(".tsx") or fname.endswith(".ts")):
            continue

        path = os.path.join(root, fname)

        # Ignorer le client supabase lui-meme et le fichier types
        if "integrations" + os.sep + "supabase" in path:
            ignores += 1
            continue

        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            print(f"  ERREUR lecture {path}: {e}")
            continue

        # Ce fichier utilise-t-il supabase ?
        if "supabase" not in content:
            continue

        # L'import est-il deja present ?
        if 'from "@/integrations/supabase/client"' in content:
            deja_ok += 1
            continue

        # Ajouter l'import apres le premier import existant
        # Trouver la premiere ligne import
        lines = content.split("\n")
        insert_at = 0
        for i, line in enumerate(lines):
            if line.startswith("import "):
                insert_at = i + 1  # Inserer apres ce premier import
                break

        lines.insert(insert_at, 'import { supabase } from "@/integrations/supabase/client";')
        new_content = "\n".join(lines)

        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"  CORRIGE : {path}")
            corriges += 1
        except Exception as e:
            print(f"  ERREUR ecriture {path}: {e}")

print(f"\n{'='*60}")
print(f"Fichiers corriges (import ajoute) : {corriges}")
print(f"Fichiers deja corrects            : {deja_ok}")
print(f"Fichiers ignores (supabase lib)   : {ignores}")
print(f"\nActualisez le navigateur (F5) !")
print("Si des erreurs persistent, elles seront de type 'fonction not found'")
print("ce qui signifie que le client mock ne supporte pas cette methode.")
print("Dans ce cas, envoyez le nom du fichier et je corrige specifiquement.")
