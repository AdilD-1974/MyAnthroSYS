"""habilitation : conditions composees (ET) + valeurs multiples (OU)

⚠️ AVANT D'EXÉCUTER :
   Remplace `down_revision` ci-dessous par ton head actuel.
   Pour le connaître :  alembic heads
   (ou génère un squelette vide via `alembic revision -m "habilitation conditions"`
    puis colle les corps upgrade()/downgrade() ci-dessous dedans.)

Modèle :
   habilitation_perimetre        en-tête (user_id, role, actif) + est_global
     └─ habilitation_condition           1 axe (type_critere) — combinées en ET
          └─ habilitation_condition_valeur  1 valeur            — combinées en OU

Non destructif : les anciennes colonnes type_critere/valeur/inclure_sous_uo
sont CONSERVÉES (à supprimer dans une migration ultérieure, une fois le
résolveur migré vers la nouvelle structure).
"""
from alembic import op

# ─── Identifiants de révision ────────────────────────────────────────────────
revision = "habil_conditions_001"
down_revision = "add_criteres_jsonb_tranche_001" # ⚠️ REMPLACER par le head actuel (alembic heads)
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Flag "périmètre global" sur l'en-tête
    op.execute("""
        ALTER TABLE habilitation_perimetre
        ADD COLUMN IF NOT EXISTS est_global boolean NOT NULL DEFAULT false
    """)

    # 2) Table des conditions (un axe par condition) — combinées en ET
    op.execute("""
        CREATE TABLE IF NOT EXISTS habilitation_condition (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            perimetre_id    uuid NOT NULL
                            REFERENCES habilitation_perimetre(id) ON DELETE CASCADE,
            type_critere    text NOT NULL,
            inclure_sous_uo boolean NOT NULL DEFAULT false,
            created_at      timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_habil_condition_perimetre
        ON habilitation_condition(perimetre_id)
    """)

    # 3) Table des valeurs (plusieurs valeurs par condition) — combinées en OU
    op.execute("""
        CREATE TABLE IF NOT EXISTS habilitation_condition_valeur (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            condition_id uuid NOT NULL
                         REFERENCES habilitation_condition(id) ON DELETE CASCADE,
            valeur       text NOT NULL
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_habil_valeur_condition
        ON habilitation_condition_valeur(condition_id)
    """)

    # 4) Reprise des données existantes
    #    a) Règles GLOBAL → est_global = true
    op.execute("""
        UPDATE habilitation_perimetre
        SET est_global = true
        WHERE type_critere = 'GLOBAL'
    """)
    #    b) Règles mono-critère → 1 condition + 1 valeur
    op.execute("""
        WITH ins AS (
            INSERT INTO habilitation_condition (perimetre_id, type_critere, inclure_sous_uo)
            SELECT id, type_critere, COALESCE(inclure_sous_uo, false)
            FROM habilitation_perimetre
            WHERE type_critere IS NOT NULL
              AND type_critere <> 'GLOBAL'
              AND valeur IS NOT NULL
            RETURNING id AS condition_id, perimetre_id
        )
        INSERT INTO habilitation_condition_valeur (condition_id, valeur)
        SELECT ins.condition_id, hp.valeur
        FROM ins
        JOIN habilitation_perimetre hp ON hp.id = ins.perimetre_id
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS habilitation_condition_valeur")
    op.execute("DROP TABLE IF EXISTS habilitation_condition")
    op.execute("ALTER TABLE habilitation_perimetre DROP COLUMN IF EXISTS est_global")
