"""
Modeles SQLAlchemy 2.0 — Referentiels d'adresse (lecture seule).

Ces tables existent deja en base et sont gerees ailleurs (Supabase direct
ou autre). On les expose ici uniquement pour le besoin du formulaire d'adresse :
    - liste pays
    - liste regions par pays
    - liste villes par region (avec code_postal pre-rempli)
"""
from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RefPays(Base):
    __tablename__ = "ref_pays"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    libelle: Mapped[str] = mapped_column(String, nullable=False)
    actif: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=True)
    code_pays_alpha2: Mapped[str | None] = mapped_column(String, nullable=True)
    code_pays_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    continent: Mapped[str | None] = mapped_column(String, nullable=True)
    devise: Mapped[str | None] = mapped_column(String, nullable=True)
    langue_principale: Mapped[str | None] = mapped_column(String, nullable=True)


class RefRegion(Base):
    __tablename__ = "ref_region"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    libelle: Mapped[str] = mapped_column(String, nullable=False)
    code_pays: Mapped[str | None] = mapped_column(
        String, ForeignKey("ref_pays.code"), nullable=True, index=True,
    )
    actif: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=True)


class RefVille(Base):
    __tablename__ = "ref_ville"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    libelle: Mapped[str] = mapped_column(String, nullable=False)
    code_region: Mapped[str] = mapped_column(
        String, ForeignKey("ref_region.code"), nullable=False, index=True,
    )
    code_postal: Mapped[str | None] = mapped_column(String, nullable=True)
    actif: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=True)
