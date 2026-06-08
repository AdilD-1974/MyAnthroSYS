"""add fk references to ref_pays/ref_region/ref_ville on collaborateur_adresses

Revision ID: b2c3d4e5f1a2
Revises: a1b2c3d4e5f1
Create Date: 2026-04-26

La table collaborateur_adresses existe deja en base mais ne possede pas
les FK vers les referentiels d'adresse. On les ajoute ici, avec un index
metier sur (collaborateur_id, archive) pour les listes par fiche.

Idempotent : utilise IF NOT EXISTS pour les index, et verifie l'existence
des contraintes avant creation (au cas ou la migration serait rejouee).
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "b2c3d4e5f1a2"
down_revision = "a1b2c3d4e5f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ----------------------------------------------------------------------
    # 1. FK vers ref_pays / ref_region / ref_ville
    #    (creees seulement si absentes — tolere les bases ou la table a deja
    #     ete patchee manuellement)
    # ----------------------------------------------------------------------
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'collaborateur_adresses_code_pays_fkey'
            ) THEN
                ALTER TABLE collaborateur_adresses
                ADD CONSTRAINT collaborateur_adresses_code_pays_fkey
                FOREIGN KEY (code_pays) REFERENCES ref_pays(code)
                ON UPDATE CASCADE ON DELETE SET NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'collaborateur_adresses_code_region_fkey'
            ) THEN
                ALTER TABLE collaborateur_adresses
                ADD CONSTRAINT collaborateur_adresses_code_region_fkey
                FOREIGN KEY (code_region) REFERENCES ref_region(code)
                ON UPDATE CASCADE ON DELETE SET NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'collaborateur_adresses_code_ville_fkey'
            ) THEN
                ALTER TABLE collaborateur_adresses
                ADD CONSTRAINT collaborateur_adresses_code_ville_fkey
                FOREIGN KEY (code_ville) REFERENCES ref_ville(code)
                ON UPDATE CASCADE ON DELETE SET NULL;
            END IF;
        END $$;
    """)

    # ----------------------------------------------------------------------
    # 2. Index sur les FK (recommande pour eviter les locks lors d'updates
    #    sur les referentiels, et pour les jointures)
    # ----------------------------------------------------------------------
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_collab_adresses_code_pays
            ON collaborateur_adresses(code_pays);
        CREATE INDEX IF NOT EXISTS ix_collab_adresses_code_region
            ON collaborateur_adresses(code_region);
        CREATE INDEX IF NOT EXISTS ix_collab_adresses_code_ville
            ON collaborateur_adresses(code_ville);
    """)

    # ----------------------------------------------------------------------
    # 3. Index metier : recuperation rapide des adresses actives d'un collab
    # ----------------------------------------------------------------------
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_collab_adresses_collab_archive
            ON collaborateur_adresses(collaborateur_id, archive);
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_collab_adresses_collab_archive;")
    op.execute("DROP INDEX IF EXISTS ix_collab_adresses_code_ville;")
    op.execute("DROP INDEX IF EXISTS ix_collab_adresses_code_region;")
    op.execute("DROP INDEX IF EXISTS ix_collab_adresses_code_pays;")
    op.execute("ALTER TABLE collaborateur_adresses DROP CONSTRAINT IF EXISTS collaborateur_adresses_code_ville_fkey;")
    op.execute("ALTER TABLE collaborateur_adresses DROP CONSTRAINT IF EXISTS collaborateur_adresses_code_region_fkey;")
    op.execute("ALTER TABLE collaborateur_adresses DROP CONSTRAINT IF EXISTS collaborateur_adresses_code_pays_fkey;")
