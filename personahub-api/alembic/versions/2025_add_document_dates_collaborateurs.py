"""add_document_dates_to_collaborateurs

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-24 16:30:00

Ajoute les colonnes de dates de début/fin pour les documents administratifs
(fiscal, CNSS, CIMR, AMO) dans la table collaborateurs, pour s'aligner
sur le formulaire "Nouveau collaborateur" qui propose déjà ces champs.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Ajoute 8 colonnes de dates pour les documents administratifs."""
    with op.batch_alter_table("collaborateurs") as batch_op:
        batch_op.add_column(sa.Column("fiscal_date_debut", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("fiscal_date_fin", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("cnss_date_debut", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("cnss_date_fin", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("cimr_date_debut", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("cimr_date_fin", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("amo_date_debut", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("amo_date_fin", sa.Date(), nullable=True))


def downgrade() -> None:
    """Retire les 8 colonnes ajoutées."""
    with op.batch_alter_table("collaborateurs") as batch_op:
        batch_op.drop_column("amo_date_fin")
        batch_op.drop_column("amo_date_debut")
        batch_op.drop_column("cimr_date_fin")
        batch_op.drop_column("cimr_date_debut")
        batch_op.drop_column("cnss_date_fin")
        batch_op.drop_column("cnss_date_debut")
        batch_op.drop_column("fiscal_date_fin")
        batch_op.drop_column("fiscal_date_debut")
