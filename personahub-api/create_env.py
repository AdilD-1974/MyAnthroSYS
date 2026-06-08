content = 'DATABASE_URL=postgresql://postgres:postgres123@localhost:5432/SOLGEIS_HR\nSECRET_KEY=personahub-solgeis-secret-key-2025\nALGORITHM=HS256\nACCESS_TOKEN_EXPIRE_MINUTES=480\nAPP_NAME=PersonaHub HR\nAPP_ENV=development\nALLOWED_ORIGINS=["http://localhost:5173"]\n'
with open(".env", "w", encoding="utf-8") as f:
    for line in content.split("\\n"):
        if line:
            f.write(line + "\n")
print("Fichier .env cree avec succes !")
