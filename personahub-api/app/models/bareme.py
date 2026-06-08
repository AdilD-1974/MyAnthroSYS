"""
Modèles SQLAlchemy 2.0 — Barèmes (refonte multi-clés / multi-sorties).

Architecture :
    bareme (en-tete)
      ├── bareme_cle    (1..N clés d'entree, EXACT ou PLAGE)
      ├── bareme_sortie (1..N sorties, exactement 1 par_defaut=true)
      └── bareme_ligne  (lignes du tableau, valeurs en JSONB)
"""
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Bareme(Base):
    __tablename__ = "bareme"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    date_debut_validite: Mapped[date] = mapped_column(Date, nullable=False)
    date_fin_validite: Mapped[date | None] = mapped_column(Date, nullable=True)
    reference_decision: Mapped[str | None] = mapped_column(String(200), nullable=True)

    actif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    archive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relations
    cles: Mapped[list["BaremeCle"]] = relationship(
        "BaremeCle",
        back_populates="bareme",
        cascade="all, delete-orphan",
        order_by="BaremeCle.ordre",
    )
    sorties: Mapped[list["BaremeSortie"]] = relationship(
        "BaremeSortie",
        back_populates="bareme",
        cascade="all, delete-orphan",
        order_by="BaremeSortie.ordre",
    )
    lignes: Mapped[list["BaremeLigne"]] = relationship(
        "BaremeLigne",
        back_populates="bareme",
        cascade="all, delete-orphan",
        order_by="BaremeLigne.ordre",
    )

    __table_args__ = (UniqueConstraint("code", name="uq_bareme_code"),)


class BaremeCle(Base):
    __tablename__ = "bareme_cle"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    bareme_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("bareme.id", ondelete="CASCADE"),
        nullable=False,
    )
    nom_technique: Mapped[str] = mapped_column(String(50), nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # NUMERIQUE | TEXTE | DATE | BOOLEEN
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="EXACT")  # EXACT | PLAGE
    ordre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    bareme: Mapped["Bareme"] = relationship("Bareme", back_populates="cles")

    __table_args__ = (
        UniqueConstraint("bareme_id", "nom_technique", name="uq_bareme_cle_bareme_nom"),
        CheckConstraint(
            "type IN ('NUMERIQUE','TEXTE','DATE','BOOLEEN')",
            name="ck_bareme_cle_type",
        ),
        CheckConstraint("mode IN ('EXACT','PLAGE')", name="ck_bareme_cle_mode"),
        CheckConstraint(
            "mode = 'EXACT' OR type IN ('NUMERIQUE','DATE')",
            name="ck_bareme_cle_plage_compatible",
        ),
    )


class BaremeSortie(Base):
    __tablename__ = "bareme_sortie"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    bareme_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("bareme.id", ondelete="CASCADE"),
        nullable=False,
    )
    nom_technique: Mapped[str] = mapped_column(String(50), nullable=False)
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # TAUX | MONTANT | NUMERIQUE | TEXTE | BOOLEEN
    par_defaut: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ordre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    bareme: Mapped["Bareme"] = relationship("Bareme", back_populates="sorties")

    __table_args__ = (
        UniqueConstraint("bareme_id", "nom_technique", name="uq_bareme_sortie_bareme_nom"),
        CheckConstraint(
            "type IN ('TAUX','MONTANT','NUMERIQUE','TEXTE','BOOLEEN')",
            name="ck_bareme_sortie_type",
        ),
    )


class BaremeLigne(Base):
    __tablename__ = "bareme_ligne"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    bareme_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("bareme.id", ondelete="CASCADE"),
        nullable=False,
    )
    ordre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Format : { "<nom_cle>": <valeur_ou_{min,max}>, ... }
    valeurs_cles: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Format : { "<nom_sortie>": <valeur>, ... }
    valeurs_sorties: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    commentaire: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    bareme: Mapped["Bareme"] = relationship("Bareme", back_populates="lignes")
