"""
app/models/cotisation.py — Modèles cotisations & régimes
Auteur : Adil DAIA

Architecture :
    RefRegimeCotisation               (CNSS, AMO, CIMR, IR…)
        ├─ pointe vers une règle de calcul (1 régime → 1 règle)
        └─ référencé par CollaborateurRegime (N collabs → 1 régime)

    RegleCalculCotisation             (entête)
        ├─ N composantes (PF, LCT, CT, etc.)
        └─ modalités complètes (mode, base, options, min/max, barème)

    RegleCalculCotisationComposante   (ligne avec taux et plafond)
        └─ liaison optionnelle aux rubriques de paie (parts sal et pat)

    CollaborateurRegime               (table de jointure)
"""
from sqlalchemy import (
    Column, String, Boolean, Integer, Numeric, Date, DateTime,
    ForeignKey, Index, UniqueConstraint, CheckConstraint, text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


# ─────────────────────────────────────────────────────────────────────────────
# 1. ref_regime_cotisation
# ─────────────────────────────────────────────────────────────────────────────
class RefRegimeCotisation(Base):
    __tablename__ = "ref_regime_cotisation"

    code = Column(String, primary_key=True)
    libelle = Column(String, nullable=False)
    description = Column(String)
    organisme = Column(String)
    code_organisme = Column(String, ForeignKey("ref_organisme_social.code", ondelete="SET NULL"))
    code_regle_cotisation = Column(
        String,
        # RG-MULTISOCIETE-03 (correctif 24/08, migration 060) : ForeignKey()
        # retirée -- fk_regime_regle_cotisation a été supprimée en base
        # (remplacée par id_regle_cotisation ci-dessous, seule vraie FK
        # désormais). Colonne conservée telle quelle (dénormalisée, plus
        # contrainte) pour compat avec le code existant qui la lit encore.
    )
    # RG-MULTISOCIETE-03 (migration 060) : nouvelle FK réelle, sur id --
    # nécessaire car une contrainte FOREIGN KEY ne peut viser qu'une
    # contrainte UNIQUE complète, jamais un index partiel (regle_calcul_
    # cotisation.code n'est plus unique globalement depuis migration 059).
    id_regle_cotisation = Column(
        UUID(as_uuid=True),
        ForeignKey("regle_calcul_cotisation.id"),
        nullable=True,
    )
    actif = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    ordre = Column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─────────────────────────────────────────────────────────────────────────────
# 2. regle_calcul_cotisation (entête + modalités complètes)
# ─────────────────────────────────────────────────────────────────────────────
class RegleCalculCotisation(Base):
    __tablename__ = "regle_calcul_cotisation"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    # RG-MULTISOCIETE-03 (correctif 24/08, migrations 059/060) : unique=True
    # retiré -- remplacé en base par 2 index partiels
    # (uq_regle_calcul_cotisation_code_generique / _societe_code) pour
    # permettre une surcharge société avec le même code qu'une règle
    # générique. Laisser unique=True ici recréerait l'ancienne contrainte
    # bloquante si le schéma est un jour régénéré depuis ces modèles
    # (Base.metadata.create_all(), autogenerate Alembic...).
    code = Column(String, nullable=False)
    libelle = Column(String, nullable=False)
    description = Column(String)
    code_regime = Column(String, ForeignKey("ref_regime_cotisation.code"))

    # Champs hérités de la v1 (gardés pour rétrocompat — usage déprécié)
    code_rubrique_assiette = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))
    taux_salarial = Column(Numeric(8, 4))
    taux_patronal = Column(Numeric(8, 4))
    plafond_mensuel = Column(Numeric(14, 2))

    # RG-MULTISOCIETE-03 (migration 059) : None = règle générique (visible
    # de toutes les sociétés), une valeur = surcharge propre à cette société.
    societe_id = Column(UUID(as_uuid=True), ForeignKey("societes.id"), nullable=True)

    # Validité
    date_debut_validite = Column(Date)
    date_fin_validite = Column(Date)
    decision_reference = Column(String)

    # Statut
    actif = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    archive = Column(Boolean, nullable=False, default=False, server_default=text("false"))

    # ── Modalités de calcul (RG-COTIS-MOD-01 — ajout 06/05/2026) ──────────
    mode_calcul = Column(
        String, nullable=False, default="PERIODIQUE", server_default=text("'PERIODIQUE'"),
    )
    code_rubrique_nb_paie = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))
    code_rubrique_nb_jours = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))
    code_rubrique_trentieme = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))
    code_rubrique_rapport = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))
    valeur_defaut_nb_paie = Column(Numeric(8, 2))
    valeur_defaut_nb_jours = Column(Numeric(8, 2))
    valeur_defaut_trentieme = Column(Numeric(8, 2))
    valeur_defaut_rapport = Column(Numeric(8, 4))
    assiette_negative_acceptee = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    assiette_negative_ramenee_zero = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    prorata_temporis = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    minimum_salarial = Column(Numeric(14, 2))
    minimum_patronal = Column(Numeric(14, 2))
    maximum_salarial = Column(Numeric(14, 2))
    maximum_patronal = Column(Numeric(14, 2))
    code_bareme_taux = Column(
        String,
        # RG-MULTISOCIETE-03 (correctif 24/08, migration 061) : ForeignKey()
        # retirée -- fk_cotis_bareme_taux a été supprimée en base (remplacée
        # par id_bareme_taux ci-dessous). Colonne conservée dénormalisée.
    )
    # RG-MULTISOCIETE-03 (migration 061) : nouvelle FK réelle, sur id --
    # même raison que id_regle_cotisation ci-dessus (bareme.code n'est plus
    # unique globalement depuis la migration 061).
    id_bareme_taux = Column(UUID(as_uuid=True), ForeignKey("bareme.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    composantes = relationship(
        "RegleCalculCotisationComposante",
        back_populates="regle",
        cascade="all, delete-orphan",
        order_by="RegleCalculCotisationComposante.ordre",
    )

    __table_args__ = (
        CheckConstraint(
            "mode_calcul IN ('PERIODIQUE','CUMUL','GLISSANT')",
            name="ck_regle_cotis_mode_calcul",
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. regle_calcul_cotisation_composante
# ─────────────────────────────────────────────────────────────────────────────
class RegleCalculCotisationComposante(Base):
    __tablename__ = "regle_calcul_cotisation_composante"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    id_regle = Column(
        UUID(as_uuid=True),
        ForeignKey("regle_calcul_cotisation.id", ondelete="CASCADE"),
        nullable=False,
    )
    code = Column(String, nullable=False)
    libelle = Column(String, nullable=False)
    ordre = Column(Integer, nullable=False, default=0, server_default=text("0"))

    code_rubrique_assiette = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))
    taux_salarial = Column(Numeric(8, 4))
    taux_patronal = Column(Numeric(8, 4))
    plafond_mensuel = Column(Numeric(14, 2))

    code_rubrique_part_salariale = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))
    code_rubrique_part_patronale = Column(String, ForeignKey("rubrique_paie.code", ondelete="SET NULL"))

    actif = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    regle = relationship("RegleCalculCotisation", back_populates="composantes")

    __table_args__ = (
        UniqueConstraint("id_regle", "code", name="uq_cotis_compo_regle_code"),
        Index("ix_cotis_composante_regle", "id_regle", "ordre"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 4. collaborateur_regime — affectation collaborateur ↔ régime
# ─────────────────────────────────────────────────────────────────────────────
class CollaborateurRegime(Base):
    __tablename__ = "collaborateur_regime"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    collaborateur_id = Column(
        UUID(as_uuid=True),
        ForeignKey("collaborateurs.id", ondelete="CASCADE"),
        nullable=False,
    )
    code_regime = Column(
        String,
        ForeignKey("ref_regime_cotisation.code"),
        nullable=False,
    )
    matricule_organisme = Column(String)
    date_affiliation = Column(Date)
    date_radiation = Column(Date)
    actif = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("collaborateur_id", "code_regime", name="uq_collab_regime"),
    )
