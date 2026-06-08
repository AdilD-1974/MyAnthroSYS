import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Date, Integer, Numeric, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class TypeConge(Base):
    __tablename__ = "types_conge"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    duree_max_annuelle: Mapped[int | None] = mapped_column(Integer)
    deductible_paie: Mapped[bool] = mapped_column(Boolean, default=False)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    demandes: Mapped[list["DemandeConge"]] = relationship("DemandeConge", back_populates="type_conge")


class DemandeConge(Base):
    __tablename__ = "demandes_conge"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collaborateur_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"))
    type_conge_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("types_conge.id"))
    date_debut: Mapped[datetime] = mapped_column(Date, nullable=False)
    date_fin: Mapped[datetime] = mapped_column(Date, nullable=False)
    nombre_jours: Mapped[float] = mapped_column(Numeric(5, 1), nullable=False)
    statut: Mapped[str] = mapped_column(String(30), default="en_attente")
    # en_attente | approuvee | refusee | annulee
    motif: Mapped[str | None] = mapped_column(Text)
    commentaire_valideur: Mapped[str | None] = mapped_column(Text)
    valideur_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    date_validation: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    type_conge: Mapped["TypeConge"] = relationship("TypeConge", back_populates="demandes")


class CompteurConge(Base):
    __tablename__ = "compteurs_conge"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collaborateur_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"))
    type_conge_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("types_conge.id"))
    annee: Mapped[int] = mapped_column(Integer, nullable=False)
    solde_initial: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    solde_acquis: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    solde_pris: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    solde_restant: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class JourFerie(Base):
    __tablename__ = "jours_feries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date: Mapped[datetime] = mapped_column(Date, nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    annee: Mapped[int] = mapped_column(Integer, nullable=False)
    recurrent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
