"""
app/models/paie_resultat.py — Modèles SQLAlchemy 2.0 des tables de résultat
du moteur de paie et de l'entrée des éléments variables.
Auteur : Adil DAIA

Tables :
    element_variable  (entrée saisie/import consommée par le moteur)
    lot_paie          (run/batch de calcul)
    bulletin          (en-tête bulletin, 1 par collaborateur × période)
    bulletin_ligne    (détail rubrique par rubrique)
    cumul             (accumulateur rubrique × collaborateur × année × type)
"""
from datetime import datetime, date
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text,
    UniqueConstraint, CheckConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


# ─────────────────────────────────────────────────────────────────────────────
# 1. element_variable
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# 0. Référentiels des éléments variables
# ─────────────────────────────────────────────────────────────────────────────
class RefEvSource(Base):
    __tablename__ = "ref_ev_source"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    libelle: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    actif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    ordre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class RefEvType(Base):
    __tablename__ = "ref_ev_type"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    libelle: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    mode_application: Mapped[str] = mapped_column(Text, nullable=False, default="AJOUT")
    actif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    ordre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        CheckConstraint("mode_application IN ('AJOUT','FORCAGE')", name="ck_ev_type_mode"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. element_variable (modèle enrichi)
# ─────────────────────────────────────────────────────────────────────────────
class ElementVariable(Base):
    __tablename__ = "element_variable"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    collaborateur_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"), nullable=False
    )
    periode_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("calendrier_paie.id", ondelete="CASCADE"), nullable=False
    )
    periode_rattachement_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("calendrier_paie.id", ondelete="SET NULL")
    )
    code_rubrique: Mapped[str] = mapped_column(Text, nullable=False)
    attribut: Mapped[str] = mapped_column(Text, nullable=False, default="MONTANT")
    valeur: Mapped[float] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    sens: Mapped[str | None] = mapped_column(Text)

    code_source: Mapped[str] = mapped_column(
        Text, ForeignKey("ref_ev_source.code"), nullable=False, default="SAISIE"
    )
    code_type: Mapped[str] = mapped_column(
        Text, ForeignKey("ref_ev_type.code"), nullable=False, default="AJOUT"
    )

    date_debut: Mapped[date | None] = mapped_column(Date)
    date_fin: Mapped[date | None] = mapped_column(Date)

    statut: Mapped[str] = mapped_column(Text, nullable=False, default="VALIDE")
    motif: Mapped[str | None] = mapped_column(Text)
    piece_reference: Mapped[str | None] = mapped_column(Text)
    commentaire: Mapped[str | None] = mapped_column(Text)

    saisi_par: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    valide_par: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    valide_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("attribut IN ('NOMBRE','TAUX','MONTANT','BASE')", name="ck_ev_attribut"),
        CheckConstraint("sens IS NULL OR sens IN ('PLUS','MOINS')", name="ck_ev_sens"),
        CheckConstraint("statut IN ('SAISI','VALIDE','REJETE')", name="ck_ev_statut"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 2. lot_paie
# ─────────────────────────────────────────────────────────────────────────────
class LotPaie(Base):
    __tablename__ = "lot_paie"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    periode_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("calendrier_paie.id", ondelete="RESTRICT"), nullable=False
    )
    plan_paie_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("plan_paie.id", ondelete="RESTRICT")
    )
    code_plan: Mapped[str | None] = mapped_column(Text)
    libelle: Mapped[str | None] = mapped_column(Text)
    type_lot: Mapped[str] = mapped_column(Text, nullable=False, default="MASSE")
    statut: Mapped[str] = mapped_column(Text, nullable=False, default="EN_COURS")
    nb_bulletins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    nb_erreurs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    date_calcul: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lance_par: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    observations: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    bulletins: Mapped[list["Bulletin"]] = relationship(
        "Bulletin", back_populates="lot", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("type_lot IN ('MASSE','UNITAIRE','SIMULATION')", name="ck_lot_type"),
        CheckConstraint("statut IN ('EN_COURS','CALCULE','ERREUR','VALIDE','ANNULE')", name="ck_lot_statut"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. bulletin
# ─────────────────────────────────────────────────────────────────────────────
class Bulletin(Base):
    __tablename__ = "bulletin"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    lot_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("lot_paie.id", ondelete="CASCADE"), nullable=False
    )
    periode_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("calendrier_paie.id", ondelete="RESTRICT"), nullable=False
    )
    plan_paie_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("plan_paie.id", ondelete="RESTRICT")
    )
    code_plan: Mapped[str | None] = mapped_column(Text)
    collaborateur_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="RESTRICT"), nullable=False
    )
    matricule: Mapped[str | None] = mapped_column(Text)

    total_brut: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total_brut_imposable: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total_gains: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total_retenues: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total_cot_salariale: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total_cot_patronale: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    net_imposable: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    net_a_payer: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    cout_employeur: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)

    statut: Mapped[str] = mapped_column(Text, nullable=False, default="CALCULE")
    a_erreur: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    trace: Mapped[dict | None] = mapped_column(JSONB)
    messages: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    calcule_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    lot: Mapped["LotPaie"] = relationship("LotPaie", back_populates="bulletins")
    lignes: Mapped[list["BulletinLigne"]] = relationship(
        "BulletinLigne", back_populates="bulletin",
        cascade="all, delete-orphan", order_by="BulletinLigne.ordre_affichage",
    )

    __table_args__ = (
        CheckConstraint("statut IN ('CALCULE','ERREUR','VALIDE')", name="ck_bulletin_statut"),
        UniqueConstraint("collaborateur_id", "periode_id", name="uq_bulletin_collab_periode"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 4. bulletin_ligne
# ─────────────────────────────────────────────────────────────────────────────
class BulletinLigne(Base):
    __tablename__ = "bulletin_ligne"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    bulletin_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("bulletin.id", ondelete="CASCADE"), nullable=False
    )
    code_rubrique: Mapped[str] = mapped_column(Text, nullable=False)
    libelle: Mapped[str] = mapped_column(Text, nullable=False)
    code_type: Mapped[str | None] = mapped_column(Text)
    type_regle: Mapped[str | None] = mapped_column(Text)
    ordre_calcul: Mapped[int | None] = mapped_column(Integer)
    ordre_affichage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    base: Mapped[float | None] = mapped_column(Numeric(18, 4))
    nombre: Mapped[float | None] = mapped_column(Numeric(18, 4))
    taux: Mapped[float | None] = mapped_column(Numeric(18, 4))
    montant: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    montant_patronal: Mapped[float | None] = mapped_column(Numeric(18, 2))

    sens: Mapped[str | None] = mapped_column(Text)
    est_cotisation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    type_periodicite: Mapped[str | None] = mapped_column(Text)
    date_valeur: Mapped[date | None] = mapped_column(Date)
    texte: Mapped[str | None] = mapped_column(Text)
    observation: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bulletin: Mapped["Bulletin"] = relationship("Bulletin", back_populates="lignes")

    __table_args__ = (
        UniqueConstraint("bulletin_id", "code_rubrique", name="uq_bulletin_ligne_rub"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 5. cumul
# ─────────────────────────────────────────────────────────────────────────────
class Cumul(Base):
    __tablename__ = "cumul"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    collaborateur_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="CASCADE"), nullable=False
    )
    code_rubrique: Mapped[str] = mapped_column(Text, nullable=False)
    type_cumul: Mapped[str] = mapped_column(Text, nullable=False, default="ANNUEL")
    annee: Mapped[int] = mapped_column(Integer, nullable=False)
    mois: Mapped[int | None] = mapped_column(Integer)
    periode_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("calendrier_paie.id", ondelete="SET NULL")
    )
    code_plan: Mapped[str | None] = mapped_column(Text)
    montant: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    nombre: Mapped[float] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    base: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("type_cumul IN ('ANNUEL','GLISSANT','MENSUEL')", name="ck_cumul_type"),
        UniqueConstraint("collaborateur_id", "code_rubrique", "type_cumul", "annee", "mois", "code_plan",
                         name="uq_cumul_key"),
    )
