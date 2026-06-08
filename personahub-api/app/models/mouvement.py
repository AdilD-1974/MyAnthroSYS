import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Date, Numeric, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Mouvement(Base):
    """
    Mouvement interne : mutation, promotion, changement de poste.
    Conserve l'historique des affectations d'un collaborateur.
    """
    __tablename__ = "mouvements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collaborateur_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"))

    # Type : mutation | promotion | changement_poste | detachement | mise_disposition
    type_mouvement: Mapped[str] = mapped_column(String(50), nullable=False)
    date_mouvement: Mapped[datetime] = mapped_column(Date, nullable=False)

    organisation_origine_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id"))
    organisation_destination_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id"))
    poste_origine_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("postes.id"))
    poste_destination_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("postes.id"))
    motif: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))


class Depart(Base):
    """
    Départ définitif d'un collaborateur (démission, licenciement, retraite...).
    Déclenche l'archivage du collaborateur.
    """
    __tablename__ = "departs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collaborateur_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"))

    # Type : demission | licenciement | retraite | fin_cdd | deces | rupture_conventionnelle
    type_depart: Mapped[str] = mapped_column(String(50), nullable=False)
    date_depart: Mapped[datetime] = mapped_column(Date, nullable=False)
    motif: Mapped[str | None] = mapped_column(Text)

    # Éléments de solde de tout compte
    solde_conge_restant: Mapped[float | None] = mapped_column(Numeric(6, 2))
    indemnite_calculee: Mapped[float | None] = mapped_column(Numeric(14, 2))

    # Statut : en_cours | valide | annule
    statut: Mapped[str] = mapped_column(String(30), default="en_cours")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
