"""create trigger etablissement default

Revision ID: a1b2c3d4e5f6
Revises: <mettre_ici_la_revision_precedente>
Create Date: 2025-04-23 00:00:00.000000

Ce trigger crée automatiquement un établissement "Siège" à chaque
insertion d'une nouvelle société dans la table societes.
"""

from alembic import op

# ── Identifiants de révision ──────────────────────────────────────────────────
revision = "a1b2c3d4e5f6"
down_revision = "001_initial"   # ← Remplacer par l'ID de ta dernière migration
branch_labels = None
depends_on = None


# ── Upgrade : création de la fonction + du trigger ────────────────────────────
def upgrade() -> None:

    # 1. Fonction PL/pgSQL
    op.execute("""
        CREATE OR REPLACE FUNCTION create_default_etablissement()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO etablissements (
                id,
                societe_id,
                libelle,
                code,
                actif,
                created_at,
                updated_at
            ) VALUES (
                gen_random_uuid(),
                NEW.id,
                NEW.raison_sociale || ' - Siège',
                'SIEGE',
                TRUE,
                NOW(),
                NOW()
            );
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # 2. Trigger attaché à la table societes
    op.execute("""
        CREATE TRIGGER trigger_create_default_etablissement
            AFTER INSERT ON societes
            FOR EACH ROW
            EXECUTE FUNCTION create_default_etablissement();
    """)


# ── Downgrade : suppression propre ───────────────────────────────────────────
def downgrade() -> None:

    op.execute("""
        DROP TRIGGER IF EXISTS trigger_create_default_etablissement
        ON societes;
    """)

    op.execute("""
        DROP FUNCTION IF EXISTS create_default_etablissement();
    """)
