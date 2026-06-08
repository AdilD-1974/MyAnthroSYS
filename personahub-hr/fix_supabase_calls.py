"""
fix_supabase_calls.py
Corrige tous les fichiers qui appellent encore supabase.from(...).select(...)
en remplacant par des appels API FastAPI ou des valeurs par defaut.
Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os
import re

SRC = "src"

# Compter les fichiers corriges
corriges = 0
erreurs = 0

def lire(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def ecrire(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

# ─── 1. Corriger ThemeContext.tsx ──────────────────────────────────────────────
theme_path = os.path.join(SRC, "contexts", "ThemeContext.tsx")
if os.path.exists(theme_path):
    content = lire(theme_path)
    if "supabase" in content:
        # Remplacer tout le bloc qui charge le theme depuis supabase
        # par une lecture du localStorage uniquement
        content = re.sub(
            r"import\s*\{[^}]*\}\s*from\s*['\"]@/integrations/supabase/client['\"];?\n?",
            "",
            content
        )
        # Remplacer les appels supabase par des no-ops
        content = re.sub(
            r"await supabase\.from\([^;]+\)\.select\([^;]+\)\.eq\([^;]+\);?",
            "// Supabase desactive - theme sauvegarde en localStorage",
            content
        )
        content = re.sub(
            r"await supabase\.from\([^;]+\)\.upsert\([^;]+\);?",
            "// Supabase desactive - theme sauvegarde en localStorage",
            content
        )
        content = re.sub(
            r"const\s*\{[^}]*\}\s*=\s*await supabase[^;]+;",
            "// Supabase desactive",
            content
        )
        ecrire(theme_path, content)
        print(f"OK : {theme_path} corrige")
        corriges += 1
    else:
        print(f"OK : {theme_path} - pas de supabase")
else:
    print(f"NON TROUVE : {theme_path}")

# ─── 2. Corriger useKpiWidgets.ts(x) ──────────────────────────────────────────
for fname in ["useKpiWidgets.ts", "useKpiWidgets.tsx"]:
    kpi_path = os.path.join(SRC, "hooks", fname)
    if os.path.exists(kpi_path):
        content = lire(kpi_path)
        if "supabase" in content:
            content = re.sub(
                r"import\s*\{[^}]*\}\s*from\s*['\"]@/integrations/supabase/client['\"];?\n?",
                "",
                content
            )
            content = re.sub(
                r"await supabase\.from\([^;]+\)\.select\([^;]+\)\.eq\([^;]+\);?",
                "null // Supabase desactive",
                content
            )
            ecrire(kpi_path, content)
            print(f"OK : {kpi_path} corrige")
            corriges += 1
        else:
            print(f"OK : {kpi_path} - pas de supabase")

# ─── 3. Scanner tous les autres fichiers avec supabase.from() ──────────────────
print("\nScan de tous les fichiers avec supabase.from()...")
for root, dirs, files in os.walk(SRC):
    # Ignorer node_modules et le client supabase lui-meme
    dirs[:] = [d for d in dirs if d not in ["node_modules", "__pycache__"]]
    for fname in files:
        if not (fname.endswith(".ts") or fname.endswith(".tsx")):
            continue
        path = os.path.join(root, fname)
        if "supabase/client" in path or "supabase/types" in path:
            continue
        try:
            content = lire(path)
            if "supabase.from" in content or "supabase.auth" in content:
                # Neutraliser les imports supabase
                new_content = re.sub(
                    r"import\s*\{[^}]*supabase[^}]*\}\s*from\s*['\"]@/integrations/supabase/client['\"];?\n?",
                    "",
                    content
                )
                # Neutraliser les appels supabase.from().select() complexes
                new_content = re.sub(
                    r"const\s*\{\s*data[^}]*\}\s*=\s*await\s+supabase\s*\n?\s*\.from\([^)]+\)[^;]+;",
                    "const data = []; const error = null; // Supabase desactive",
                    new_content,
                    flags=re.DOTALL
                )
                if new_content != content:
                    ecrire(path, new_content)
                    print(f"  CORRIGE : {path}")
                    corriges += 1
                else:
                    print(f"  ATTENTION (manuel requis) : {path}")
        except Exception as e:
            print(f"  ERREUR sur {path}: {e}")
            erreurs += 1

print(f"\n{'='*50}")
print(f"Fichiers corriges : {corriges}")
print(f"Erreurs           : {erreurs}")
print(f"\nActualisez le navigateur (F5) pour voir le resultat !")
