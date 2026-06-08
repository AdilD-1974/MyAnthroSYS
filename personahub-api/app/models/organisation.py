import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Organisation(Base):
    __tablename__ = "organisations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    type_organisation: Mapped[str | None] = mapped_column(String(50))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id"))
    responsable_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id"))
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    enfants: Mapped[list["Organisation"]] = relationship("Organisation", back_populates="parent")
    parent: Mapped["Organisation | None"] = relationship("Organisation", back_populates="enfants", remote_side=[id])
    postes: Mapped[list["Poste"]] = relationship("Poste", back_populates="organisation")


class Poste(Base):
    __tablename__ = "postes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    organisation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id"))
    niveau_hierarchique: Mapped[int | None] = mapped_column(Integer)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    organisation: Mapped["Organisation | None"] = relationship("Organisation", back_populates="postes")
