import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Date, Numeric, Integer, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Rubrique(Base):
    __tablename__ = "rubriques"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    type_rubrique: Mapped[str] = mapped_column(String(50))  # gain, retenue, cotisation
    nature: Mapped[str | None] = mapped_column(String(50))
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    archive: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class Cotisation(Base):
    __tablename__ = "cotisations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    taux_salarial: Mapped[float | None] = mapped_column(Numeric(8, 4))
    taux_patronal: Mapped[float | None] = mapped_column(Numeric(8, 4))
    plafond: Mapped[float | None] = mapped_column(Numeric(14, 2))
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class SalaireFixe(Base):
    __tablename__ = "salaires_fixes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collaborateur_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"))
    rubrique_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("rubriques.id"))
    montant: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    date_debut: Mapped[datetime] = mapped_column(Date, nullable=False)
    date_fin: Mapped[datetime | None] = mapped_column(Date)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
