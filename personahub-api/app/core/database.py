from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings


# ── Moteur SQLAlchemy ─────────────────────────────────────────────────────────
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,       # vérifie la connexion avant chaque requête
    pool_size=10,             # connexions maintenues en pool
    max_overflow=20,          # connexions supplémentaires possibles en pic
    echo=(settings.APP_ENV == "development"),  # log SQL en dev uniquement
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ── Classe de base pour tous les modèles ─────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── Dépendance FastAPI — injection de session dans les routes ─────────────────
def get_db():
    """
    Générateur de session de base de données.
    Usage dans une route :
        def ma_route(db: Session = Depends(get_db)): ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
