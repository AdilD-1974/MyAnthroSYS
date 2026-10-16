import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

APP_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie", "manager", "collaborateur")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # RG-05 (migration 057, multi-société façon Odoo) : société actuellement
    # sélectionnée par l'utilisateur. Pas de relationship() vers un modèle
    # Societe ici (non fourni dans les fichiers disponibles) -- la liste des
    # sociétés accessibles (table user_societes) est lue en SQL brut dans le
    # routeur auth, même pattern que Profile.collaborateur_id ci-dessous qui
    # n'a pas non plus de relationship() vers un modèle Collaborateur.
    # RG-05 (migration 057, multi-société façon Odoo) : société actuellement
    # sélectionnée par l'utilisateur.
    #
    # ⚠️ CORRECTIF (24/08) : ForeignKey("societes.id", ...) retirée. Elle
    # provoquait `sqlalchemy.exc.NoReferencedTableError` à chaque flush/commit
    # touchant cette colonne (ex. POST /auth/societe-active) : SQLAlchemy doit
    # pouvoir résoudre "societes" comme une Table connue de SON metadata au
    # moment du tri des tables par dépendances de FK -- or aucun modèle ORM
    # Societe n'est déclaré nulle part dans ce projet (toutes les requêtes sur
    # `societes` passent en SQL brut, cf. _societes_utilisateur() dans le
    # routeur auth). Ne PAS remettre cette ForeignKey() tant qu'aucun modèle
    # ORM Societe n'existe. La contrainte réelle en base (posée par la
    # migration 057, `REFERENCES societes(id)`) continue de protéger
    # l'intégrité des données indépendamment de cette absence côté ORM --
    # seule la description SQLAlchemy est retirée, pas la protection SQL.
    #
    # Pas de relationship() non plus, même raison que Profile.collaborateur_id
    # ci-dessous (qui a le même risque latent, non déclenché à ce jour car
    # rien ne met à jour ce champ via l'ORM dans le code actuel -- à traiter
    # pareillement si un jour un flush dessus est ajouté).
    societe_active_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    profile: Mapped["Profile"] = relationship("Profile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    roles: Mapped[list["UserRole"]] = relationship("UserRole", back_populates="user", cascade="all, delete-orphan")


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    nom: Mapped[str | None] = mapped_column(String(100))
    prenom: Mapped[str | None] = mapped_column(String(100))
    telephone: Mapped[str | None] = mapped_column(String(20))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    # Liaison optionnelle au collaborateur (pour useManagerPopulation)
    collaborateur_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("collaborateurs.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="profile")


class UserRole(Base):
    __tablename__ = "user_roles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(50), nullable=False)  # APP_ROLES
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="roles")
