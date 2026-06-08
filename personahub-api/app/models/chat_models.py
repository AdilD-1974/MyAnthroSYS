"""
Modèles SQLAlchemy du module Chat.

Cible : app/models/chat_models.py

⚠️  POINT D'INTÉGRATION 1/4
    L'import `Base` ci-dessous doit pointer vers le même `Base` déclaratif
    que le reste de ton projet (souvent `app.database` ou `app.db`).
    Adapte la ligne si besoin.
"""

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base  # ⚠️ adapte le chemin si ton Base est ailleurs


class ChatConversation(Base):
    __tablename__ = "chat_conversation"

    id = Column(BigInteger, primary_key=True)
    type = Column(Text, nullable=False)          # 'direct' | 'groupe'
    titre = Column(Text, nullable=True)          # NULL pour un direct
    cle_directe = Column(Text, nullable=True)    # "min-max" des 2 collaborateur_id
    cree_par = Column(BigInteger, nullable=False)
    cree_le = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    participants = relationship(
        "ChatParticipant", back_populates="conversation", cascade="all, delete-orphan"
    )
    messages = relationship(
        "ChatMessage", back_populates="conversation", cascade="all, delete-orphan"
    )


class ChatParticipant(Base):
    __tablename__ = "chat_participant"
    __table_args__ = (
        UniqueConstraint("conversation_id", "collaborateur_id", name="uq_chat_part"),
        Index("ix_chat_participant_collab", "collaborateur_id"),
    )

    id = Column(BigInteger, primary_key=True)
    conversation_id = Column(
        BigInteger, ForeignKey("chat_conversation.id", ondelete="CASCADE"), nullable=False
    )
    collaborateur_id = Column(BigInteger, nullable=False)
    role_conv = Column(Text, nullable=False, default="membre")   # 'admin' | 'membre'
    dernier_message_lu_id = Column(BigInteger, nullable=True)
    rejoint_le = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    conversation = relationship("ChatConversation", back_populates="participants")


class ChatMessage(Base):
    __tablename__ = "chat_message"
    __table_args__ = (
        Index("ix_chat_message_conv_date", "conversation_id", "cree_le"),
    )

    id = Column(BigInteger, primary_key=True)
    conversation_id = Column(
        BigInteger, ForeignKey("chat_conversation.id", ondelete="CASCADE"), nullable=False
    )
    expediteur_id = Column(BigInteger, nullable=False)
    contenu = Column(Text, nullable=False)
    cree_le = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    modifie_le = Column(DateTime(timezone=True), nullable=True)
    supprime_le = Column(DateTime(timezone=True), nullable=True)

    conversation = relationship("ChatConversation", back_populates="messages")


class ChatRoleAutorisation(Base):
    __tablename__ = "chat_role_autorisation"

    role_source = Column(Text, primary_key=True)
    role_cible = Column(Text, primary_key=True)
    autorise = Column(Boolean, nullable=False, default=True)
