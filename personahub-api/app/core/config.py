from pydantic_settings import BaseSettings
from pydantic import AnyHttpUrl
from typing import List


class Settings(BaseSettings):
    APP_NAME: str = "PersonaHub HR"
    APP_ENV: str = "development"

    # Base de données
    DATABASE_URL: str

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # CORS — origines autorisées, configurées via .env
    # Exemple .env : ALLOWED_ORIGINS=https://app.mondomaine.ma,https://admin.mondomaine.ma
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173"]

    # Email
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@personahub.ma"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
