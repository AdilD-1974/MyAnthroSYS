"""add validation workflow to regle_calcul_specifique

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-25

Ajoute le workflow de validation simple aux règles de calcul spécifiques :
  - statut : BROUILLON / VALIDEE / ARCHIVEE
  - date_validation, valide_par, commentaire_validation : traçabilité de la validation

Le moteur de paie ne lira que les règles avec statut = 'VALIDEE'.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ajouter les 4 colonnes de validation
    op.add_column(
        'regle_calcul_specifique',
        sa.Column('statut', sa.String(20), nullable=False, server_default=sa.text("'BROUILLON'")),
    )
    op.add_column(
        'regle_calcul_specifique',
        sa.Column('date_validation', sa.DateTime(timezone=True)),
    )
    op.add_column(
        'regle_calcul_specifique',
        sa.Column('valide_par', postgresql.UUID(as_uuid=True)),
    )
    op.add_column(
        'regle_calcul_specifique',
        sa.Column('commentaire_validation', sa.Text),
    )

    # Contrainte CHECK pour limiter les valeurs valides
    op.create_check_constraint(
        'ck_regle_calcul_specifique_statut',
        'regle_calcul_specifique',
        "statut IN ('BROUILLON', 'VALIDEE', 'ARCHIVEE')",
    )

    # Index pour les recherches par statut (très utile pour le moteur de paie)
    op.create_index(
        'idx_regle_calcul_specifique_statut',
        'regle_calcul_specifique',
        ['statut'],
        postgresql_where=sa.text("archive = false"),
    )

    # Migration des données : règles existantes
    # Si actif=true → on les met en VALIDEE (rétrocompatibilité)
    # Si actif=false → on les laisse en BROUILLON
    op.execute("""
        UPDATE regle_calcul_specifique
        SET statut = 'VALIDEE',
            date_validation = COALESCE(updated_at, created_at)
        WHERE actif = true AND archive = false;
    """)


def downgrade() -> None:
    op.drop_index('idx_regle_calcul_specifique_statut', table_name='regle_calcul_specifique')
    op.drop_constraint('ck_regle_calcul_specifique_statut', 'regle_calcul_specifique', type_='check')
    op.drop_column('regle_calcul_specifique', 'commentaire_validation')
    op.drop_column('regle_calcul_specifique', 'valide_par')
    op.drop_column('regle_calcul_specifique', 'date_validation')
    op.drop_column('regle_calcul_specifique', 'statut')
