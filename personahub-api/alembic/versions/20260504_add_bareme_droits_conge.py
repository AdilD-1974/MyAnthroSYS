"""add_bareme_droits_conge

Ajout du moteur de droits paramétrables (barèmes, formules, prorata).
- Nouvelles colonnes sur ref_type_conge (mode calcul, barème, acquisition)
- Nouvelle table bareme_droit_conge (en-tête barème)
- Nouvelle table bareme_droit_conge_tranche (tranches par critères)
- Nouvelle table histo_recalcul_droits (audit des recalculs)
- Nouvelles colonnes sur solde_conge (prévisionnel, mode appliqué)

Revision ID : add_bareme_droits_conge_001
Revises     : b2c3d4e5f1a2
Create Date : 2026-05-04
"""

from alembic import op
from sqlalchemy import text

revision = "add_bareme_droits_conge_001"
down_revision = "b2c3d4e5f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:

    # 1. Table bareme_droit_conge
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS bareme_droit_conge (
            id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
            code            TEXT        NOT NULL UNIQUE,
            libelle         TEXT        NOT NULL,
            description     TEXT,
            critere_principal   TEXT    NOT NULL
                CHECK (critere_principal IN
                    ('ANCIENNETE','CATEGORIE_PRO','TYPE_CONTRAT','TEMPS_TRAVAIL')),
            critere_secondaire  TEXT,
            actif           BOOLEAN     NOT NULL DEFAULT TRUE,
            ordre           INTEGER     DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    # 2. Table bareme_droit_conge_tranche
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS bareme_droit_conge_tranche (
            id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
            code_bareme             TEXT        NOT NULL
                REFERENCES bareme_droit_conge(code) ON DELETE CASCADE,
            anciennete_min_mois     INTEGER,
            anciennete_max_mois     INTEGER,
            categorie_pro           TEXT,
            type_contrat            TEXT,
            temps_travail_min_pct   NUMERIC(5,2),
            temps_travail_max_pct   NUMERIC(5,2),
            valeur_jours            NUMERIC(6,2) NOT NULL,
            valeur_heures           NUMERIC(6,2),
            ordre                   INTEGER      NOT NULL DEFAULT 0,
            created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """))

    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_bareme_tranche_code_bareme
        ON bareme_droit_conge_tranche (code_bareme, ordre)
    """))

    # 3. Table histo_recalcul_droits
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS histo_recalcul_droits (
            id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
            id_collaborateur    UUID        NOT NULL,
            code_type_conge     TEXT        NOT NULL,
            type_evenement      TEXT        NOT NULL,
            date_evenement      DATE        NOT NULL,
            ancienne_valeur     NUMERIC(6,2),
            nouvelle_valeur     NUMERIC(6,2),
            motif               TEXT,
            mode_calcul         TEXT,
            code_bareme         TEXT,
            created_by          UUID,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_histo_recalcul_collab_conge
        ON histo_recalcul_droits (id_collaborateur, code_type_conge, date_evenement)
    """))

    # 4. Nouvelles colonnes sur ref_type_conge
    for niveau in ('legal', 'convention', 'particulier'):
        op.execute(text(f"ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS mode_calcul_droit_{niveau} TEXT DEFAULT 'FIXE'"))
        op.execute(text(f"ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS code_bareme_{niveau} TEXT REFERENCES bareme_droit_conge(code)"))
        op.execute(text(f"ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS formule_droit_{niveau} TEXT"))

    op.execute(text("ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS periodicite_acquisition TEXT DEFAULT 'ANNUEL'"))
    op.execute(text("ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS prorata_entree BOOLEAN DEFAULT TRUE"))
    op.execute(text("ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS prorata_sortie BOOLEAN DEFAULT TRUE"))
    op.execute(text("ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS prorata_temps_partiel BOOLEAN DEFAULT TRUE"))
    op.execute(text("ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS arrondi_acquisition TEXT DEFAULT 'SUPERIEUR'"))
    op.execute(text("ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS evenements_recalcul TEXT[] DEFAULT '{}'"))
    op.execute(text("ALTER TABLE ref_type_conge ADD COLUMN IF NOT EXISTS absence_deductible BOOLEAN DEFAULT FALSE"))

    # 5. Nouvelles colonnes sur solde_conge (uniquement si la table existe)
    op.execute(text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema = 'public' AND table_name = 'solde_conge') THEN
                ALTER TABLE solde_conge ADD COLUMN IF NOT EXISTS droits_previsionnel_fin_periode NUMERIC(6,2);
                ALTER TABLE solde_conge ADD COLUMN IF NOT EXISTS date_prochain_recalcul DATE;
                ALTER TABLE solde_conge ADD COLUMN IF NOT EXISTS mode_calcul_applique TEXT;
                ALTER TABLE solde_conge ADD COLUMN IF NOT EXISTS code_bareme_applique TEXT;
            END IF;
        END
        $$
    """))


def downgrade() -> None:

    for col in ('code_bareme_applique', 'mode_calcul_applique',
                'date_prochain_recalcul', 'droits_previsionnel_fin_periode'):
        op.execute(text(f"ALTER TABLE solde_conge DROP COLUMN IF EXISTS {col}"))

    cols = [
        'absence_deductible', 'evenements_recalcul', 'arrondi_acquisition',
        'prorata_temps_partiel', 'prorata_sortie', 'prorata_entree',
        'periodicite_acquisition',
    ]
    for niveau in ('legal', 'convention', 'particulier'):
        cols += [f'formule_droit_{niveau}', f'code_bareme_{niveau}', f'mode_calcul_droit_{niveau}']
    for col in cols:
        op.execute(text(f"ALTER TABLE ref_type_conge DROP COLUMN IF EXISTS {col}"))

    op.execute(text("DROP INDEX IF EXISTS ix_histo_recalcul_collab_conge"))
    op.execute(text("DROP INDEX IF EXISTS ix_bareme_tranche_code_bareme"))
    op.execute(text("DROP TABLE IF EXISTS histo_recalcul_droits"))
    op.execute(text("DROP TABLE IF EXISTS bareme_droit_conge_tranche"))
    op.execute(text("DROP TABLE IF EXISTS bareme_droit_conge"))
