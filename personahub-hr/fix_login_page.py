"""
fix_login_page.py
Script pour corriger LoginPage.tsx : remplacer Supabase par FastAPI AuthContext
Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os

FILE = os.path.join("src", "pages", "LoginPage.tsx")

if not os.path.exists(FILE):
    print(f"ERREUR : fichier introuvable -> {FILE}")
    print("Assurez-vous de lancer ce script depuis D:\\SOLGEIS\\personahub-hr\\")
    exit(1)

# Lire le fichier
with open(FILE, "r", encoding="utf-8") as f:
    content = f.read()

# --- Modification 1 : Remplacer l'import supabase ---
old1 = 'import { supabase } from "@/integrations/supabase/client";'
new1 = 'import { useAuth } from "@/contexts/AuthContext";'

if old1 in content:
    content = content.replace(old1, new1)
    print("OK : import supabase remplace par useAuth")
else:
    print("ATTENTION : import supabase non trouve (peut-etre deja corrige)")

# --- Modification 2 : Ajouter useAuth dans le composant ---
old2 = "  const navigate = useNavigate();"
new2 = "  const navigate = useNavigate();\n  const { signIn } = useAuth();"

if old2 in content and "const { signIn } = useAuth();" not in content:
    content = content.replace(old2, new2, 1)
    print("OK : signIn ajoute depuis useAuth")
else:
    print("ATTENTION : useNavigate non trouve ou signIn deja present")

# --- Modification 3 : Remplacer l'appel supabase.auth.signInWithPassword ---
old3 = """        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/dashboard");"""
new3 = """        await signIn(email, password);
        navigate("/dashboard");"""

if old3 in content:
    content = content.replace(old3, new3)
    print("OK : supabase.auth.signInWithPassword remplace par signIn()")
else:
    print("ATTENTION : supabase.auth.signInWithPassword non trouve (peut-etre deja corrige)")

# --- Sauvegarder ---
with open(FILE, "w", encoding="utf-8") as f:
    f.write(content)

print("")
print("Fichier sauvegarde avec succes !")
print("Actualisez le navigateur (F5) et reconnectez-vous.")
