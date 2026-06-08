"""
Modèles SQLAlchemy pour la gestion des collaborateurs.
Mappés depuis le schéma Supabase existant (supabase/migrations/).
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    String, Boolean, DateTime, Date, Text, ForeignKey, Enum
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Collaborateur(Base):
    __tablename__ = "collaborateurs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matricule: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    ancien_matricule: Mapped[str | None] = mapped_column(String(50))
    civilite: Mapped[str | None] = mapped_column(String(10))
    nom: Mapped[str] = mapped_column(String(100), nullable=False)
    prenom: Mapped[str] = mapped_column(String(100), nullable=False)
    nom_jeune_fille: Mapped[str | None] = mapped_column(String(100))
    date_naissance: Mapped[datetime] = mapped_column(Date, nullable=False)
    lieu_naissance: Mapped[str | None] = mapped_column(String(200))
    code_nationalite: Mapped[str | None] = mapped_column(String(5))
    code_nationalite2: Mapped[str | None] = mapped_column(String(5))
    code_genre: Mapped[str] = mapped_column(String(1), nullable=False)

    # Pièces d'identité
    cin: Mapped[str | None] = mapped_column(String(50))
    cin_date_debut: Mapped[datetime | None] = mapped_column(Date)
    cin_date_fin: Mapped[datetime | None] = mapped_column(Date)
    passeport: Mapped[str | None] = mapped_column(String(50))
    passeport_date_debut: Mapped[datetime | None] = mapped_column(Date)
    passeport_date_fin: Mapped[datetime | None] = mapped_column(Date)

    # Immatriculations sociales
    num_cnss: Mapped[str | None] = mapped_column(String(50))
    num_cimr: Mapped[str | None] = mapped_column(String(50))
    num_amo: Mapped[str | None] = mapped_column(String(50))
    num_fiscal: Mapped[str | None] = mapped_column(String(50))

    # Contact
    telephone: Mapped[str | None] = mapped_column(String(20))
    gsm: Mapped[str | None] = mapped_column(String(20))
    email_personnel: Mapped[str | None] = mapped_column(String(200))
    email_professionnel: Mapped[str | None] = mapped_column(String(200))

    # Statut
    statut_collaborateur: Mapped[str] = mapped_column(String(50), nullable=False, default="actif")
    photo_path: Mapped[str | None] = mapped_column(Text)
    archive: Mapped[bool] = mapped_column(Boolean, default=False)

    # Audit
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relations
    contrats: Mapped[list["Contrat"]] = relationship("Contrat", back_populates="collaborateur", cascade="all, delete-orphan")
    affectations: Mapped[list["Affectation"]] = relationship("Affectation", back_populates="collaborateur", cascade="all, delete-orphan")


class Contrat(Base):
    __tablename__ = "contrats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collaborateur_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"))
    type_contrat: Mapped[str] = mapped_column(String(50), nullable=False)
    date_debut: Mapped[datetime] = mapped_column(Date, nullable=False)
    date_fin: Mapped[datetime | None] = mapped_column(Date)
    motif_fin: Mapped[str | None] = mapped_column(String(200))
    est_actif: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    collaborateur: Mapped["Collaborateur"] = relationship("Collaborateur", back_populates="contrats")


class Affectation(Base):
    __tablename__ = "affectations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collaborateur_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"))
    organisation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id"))
    poste_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("postes.id"))
    date_debut: Mapped[datetime] = mapped_column(Date, nullable=False)
    date_fin: Mapped[datetime | None] = mapped_column(Date)
    est_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    collaborateur: Mapped["Collaborateur"] = relationship("Collaborateur", back_populates="affectations")
