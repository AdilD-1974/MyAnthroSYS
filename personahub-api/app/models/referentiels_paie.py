"""
Modèles SQLAlchemy 2.0 — Référentiels paie.

Tous les référentiels héritent du même mixin `ReferentielMixin`
afin de garantir une structure homogène (CRUD générique côté router/front).
"""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class ReferentielMixin:
    """
    Colonnes communes à tous les référentiels paie.

    Les classes filles doivent uniquement définir :
        __tablename__ = "ref_xxx"
    """

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class FamilleRubrique(ReferentielMixin, Base):
    __tablename__ = "ref_famille_rubrique"
    __table_args__ = (UniqueConstraint("code", name="uq_ref_famille_rubrique_code"),)


class TypeRubrique(ReferentielMixin, Base):
    __tablename__ = "ref_type_rubrique"
    __table_args__ = (UniqueConstraint("code", name="uq_ref_type_rubrique_code"),)


class Flux(ReferentielMixin, Base):
    __tablename__ = "ref_flux"
    __table_args__ = (UniqueConstraint("code", name="uq_ref_flux_code"),)


class Frequence(ReferentielMixin, Base):
    """Fréquence partagée par les 3 dropdowns (générale / calcul / RAZ)."""

    __tablename__ = "ref_frequence"
    __table_args__ = (UniqueConstraint("code", name="uq_ref_frequence_code"),)


class ZoneFixe(ReferentielMixin, Base):
    __tablename__ = "ref_zone_fixe"
    __table_args__ = (UniqueConstraint("code", name="uq_ref_zone_fixe_code"),)


# Mapping centralisé exposé au router pour la factory CRUD
REFERENTIEL_MODELS = {
    "familles":  FamilleRubrique,
    "types":     TypeRubrique,
    "flux":      Flux,
    "frequences": Frequence,
    "zones-fixes": ZoneFixe,
}
