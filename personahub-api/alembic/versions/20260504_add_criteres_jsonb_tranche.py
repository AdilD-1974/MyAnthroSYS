"""add_criteres_jsonb_to_bareme_tranche

Ajoute une colonne criteres JSONB sur bareme_droit_conge_tranche pour
supporter tous les attributs collaborateur (général, affectation, contrat).

Revision ID : add_criteres_jsonb_tranche_001
Revises     : add_bareme_droits_conge_001
Create Date : 2026-05-04
"""

from alembic import op
from sqlalchemy import text

revision = "add_criteres_jsonb_tranche_001"
down_revision = "add_bareme_droits_conge_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Colonne JSONB souple pour stocker N critères hétérogènes
    op.execute(text("""
        ALTER TABLE bareme_droit_conge_tranche
        ADD COLUMN IF NOT EXISTS criteres JSONB DEFAULT '{}'
    """))
    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_bareme_tranche_criteres_gin
        ON bareme_droit_conge_tranche USING GIN (criteres)
    """))
    # Libellé optionnel sur la tranche
    op.execute(text("""
        ALTER TABLE bareme_droit_conge_tranche
        ADD COLUMN IF NOT EXISTS libelle TEXT
    """))


def downgrade() -> None:
    op.execute(text("DROP INDEX IF EXISTS ix_bareme_tranche_criteres_gin"))
    op.execute(text("ALTER TABLE bareme_droit_conge_tranche DROP COLUMN IF EXISTS criteres"))
    op.execute(text("ALTER TABLE bareme_droit_conge_tranche DROP COLUMN IF EXISTS libelle"))
