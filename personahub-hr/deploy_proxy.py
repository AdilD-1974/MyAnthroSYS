"""
deploy_proxy.py
Déploie le client Supabase proxy dans le frontend React.
Ce proxy redirige TOUS les appels Supabase vers FastAPI.
Résultat : les créations/modifications/suppressions fonctionnent !

Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os
import shutil

# Chemin source (dans personahub-api)
SRC = r"D:\SOLGEIS\personahub-api\frontend-adapter\supabase-proxy.ts"

# Chemin cible (remplace le client mock)
DST = os.path.join("src", "integrations", "supabase", "client.ts")

if not os.path.exists(SRC):
    print(f"ERREUR : fichier source introuvable : {SRC}")
    print("Vérifiez que personahub-api est bien dans D:\\SOLGEIS\\")
    exit(1)

# Sauvegarder l'ancien client
backup = DST + ".mock.bak"
if os.path.exists(DST):
    shutil.copy2(DST, backup)
    print(f"Ancien client sauvegardé : {backup}")

# Copier le nouveau proxy
shutil.copy2(SRC, DST)
print(f"OK : Client Supabase proxy déployé dans {DST}")

# Vérifier
with open(DST, 'r', encoding='utf-8') as f:
    content = f.read()

if 'SupabaseProxyClient' in content:
    print("OK : Le proxy est bien en place")
else:
    print("ATTENTION : Le fichier ne semble pas correct")

print("\nMainteant redémarrez le backend FastAPI :")
print("  cd D:\\SOLGEIS\\personahub-api")
print("  .\\venv312\\Scripts\\Activate.ps1")
print("  uvicorn app.main:app --reload")
print("\nPuis F5 dans le navigateur.")
print("Les créations et modifications vont maintenant fonctionner !")
