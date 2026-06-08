"""
Modele SQLAlchemy 2.0 — Adresses des collaborateurs.

Une fiche collaborateur peut avoir plusieurs adresses (personnelle, residence,
correspondance, professionnelle). Au moins une adresse principale (active)
doit exister par collaborateur — cette regle est appliquee cote service/router.
"""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class CollaborateurAdresse(Base):
    __tablename__ = "collaborateur_adresses"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    collaborateur_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("collaborateurs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Adresse postale
    adresse: Mapped[str] = mapped_column(Text, nullable=False)
    complement_adresse: Mapped[str | None] = mapped_column(Text, nullable=True)
    code_postal: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Codes referentiels (FK ajoutees par la migration)
    code_pays: Mapped[str | None] = mapped_column(
        String, ForeignKey("ref_pays.code", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    code_region: Mapped[str | None] = mapped_column(
        String, ForeignKey("ref_region.code", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    code_ville: Mapped[str | None] = mapped_column(
        String, ForeignKey("ref_ville.code", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )

    # Coordonnees
    telephone: Mapped[str | None] = mapped_column(Text, nullable=True)
    telephone_bis: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Roles de l'adresse (cumulables, sauf "principale" qui est unique par collab)
    is_adresse_principale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_adresse_correspondance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_adresse_residence: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_adresse_professionnelle: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    archive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now(),
    )
