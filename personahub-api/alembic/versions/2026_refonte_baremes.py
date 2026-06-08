"""refonte baremes - schema multi-cles multi-sorties

Revision ID: a1b2c3d4e5f1
Revises: d4e5f6a7b8c9
Create Date: 2026-04-26

REFONTE COMPLETE DES BAREMES :
  - Drop des anciennes tables (1 cle / 1 valeur) : bareme(s), bareme_ligne(s)
  - Creation du nouveau schema (N cles / N sorties / lignes JSONB) :
      * bareme           : en-tete (code, libelle, dates, etc.)
      * bareme_cle       : N cles d'entree (nom, libelle, type, mode EXACT/PLAGE)
      * bareme_sortie    : N sorties (nom, libelle, type, par_defaut)
      * bareme_ligne     : valeurs (JSONB) par ligne du barème
  - Index GIN sur les JSONB pour les futurs lookups du moteur de paie

ATTENTION : tabula rasa - les baremes existants en base seront perdus.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f1"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =========================================================================
    # 1. NETTOYAGE — drop des anciennes tables (singulier ET pluriel par sécurité)
    # =========================================================================
    op.execute("DROP TABLE IF EXISTS bareme_lignes CASCADE")
    op.execute("DROP TABLE IF EXISTS bareme_ligne  CASCADE")
    op.execute("DROP TABLE IF EXISTS baremes        CASCADE")
    op.execute("DROP TABLE IF EXISTS bareme         CASCADE")

    # =========================================================================
    # 2. TABLE PRINCIPALE — bareme
    # =========================================================================
    op.create_table(
        "bareme",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("date_debut_validite", sa.Date(), nullable=False),
        sa.Column("date_fin_validite", sa.Date(), nullable=True),
        sa.Column("reference_decision", sa.String(200), nullable=True),
        sa.Column(
            "actif",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "archive",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            onupdate=sa.text("now()"),
        ),
        sa.UniqueConstraint("code", name="uq_bareme_code"),
    )
    op.create_index("ix_bareme_actif",   "bareme", ["actif"])
    op.create_index("ix_bareme_archive", "bareme", ["archive"])
    op.create_index("ix_bareme_dates",   "bareme", ["date_debut_validite", "date_fin_validite"])

    # =========================================================================
    # 3. CLES D'ENTREE — bareme_cle
    # =========================================================================
    op.create_table(
        "bareme_cle",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "bareme_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("bareme.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("nom_technique", sa.String(50), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        # NUMERIQUE | TEXTE | DATE | BOOLEEN
        sa.Column("type", sa.String(20), nullable=False),
        # EXACT | PLAGE
        sa.Column("mode", sa.String(10), nullable=False, server_default=sa.text("'EXACT'")),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("bareme_id", "nom_technique", name="uq_bareme_cle_bareme_nom"),
        sa.CheckConstraint(
            "type IN ('NUMERIQUE','TEXTE','DATE','BOOLEEN')",
            name="ck_bareme_cle_type",
        ),
        sa.CheckConstraint(
            "mode IN ('EXACT','PLAGE')",
            name="ck_bareme_cle_mode",
        ),
        # Le mode PLAGE n'a de sens que pour des types ordonnés
        sa.CheckConstraint(
            "mode = 'EXACT' OR type IN ('NUMERIQUE','DATE')",
            name="ck_bareme_cle_plage_compatible",
        ),
    )
    op.create_index("ix_bareme_cle_bareme", "bareme_cle", ["bareme_id"])

    # =========================================================================
    # 4. SORTIES — bareme_sortie
    # =========================================================================
    op.create_table(
        "bareme_sortie",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "bareme_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("bareme.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("nom_technique", sa.String(50), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        # TAUX | MONTANT | NUMERIQUE | TEXTE | BOOLEEN
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column(
            "par_defaut",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("bareme_id", "nom_technique", name="uq_bareme_sortie_bareme_nom"),
        sa.CheckConstraint(
            "type IN ('TAUX','MONTANT','NUMERIQUE','TEXTE','BOOLEEN')",
            name="ck_bareme_sortie_type",
        ),
    )
    op.create_index("ix_bareme_sortie_bareme", "bareme_sortie", ["bareme_id"])

    # Index partiel : exactement UNE sortie par_defaut=true par bareme
    op.execute("""
        CREATE UNIQUE INDEX uq_bareme_sortie_par_defaut
        ON bareme_sortie (bareme_id)
        WHERE par_defaut = true;
    """)

    # =========================================================================
    # 5. LIGNES — bareme_ligne (valeurs en JSONB)
    # =========================================================================
    op.create_table(
        "bareme_ligne",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "bareme_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("bareme.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default=sa.text("0")),
        # Format : { "<nom_cle>": <valeur_ou_{min,max}>, ... }
        sa.Column(
            "valeurs_cles",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # Format : { "<nom_sortie>": <valeur>, ... }
        sa.Column(
            "valeurs_sorties",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("commentaire", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            onupdate=sa.text("now()"),
        ),
    )
    op.create_index("ix_bareme_ligne_bareme",        "bareme_ligne", ["bareme_id"])
    op.create_index("ix_bareme_ligne_bareme_ordre", "bareme_ligne", ["bareme_id", "ordre"])

    # Index GIN pour lookups rapides du moteur de paie
    op.execute("CREATE INDEX ix_bareme_ligne_valeurs_cles_gin    ON bareme_ligne USING gin (valeurs_cles);")
    op.execute("CREATE INDEX ix_bareme_ligne_valeurs_sorties_gin ON bareme_ligne USING gin (valeurs_sorties);")


def downgrade() -> None:
    """
    Revient au schéma précédent (1 clé / 1 valeur).
    Les barèmes saisis dans le nouveau schéma seront perdus à ce moment.
    """
    # 1. Drop des nouvelles tables
    op.execute("DROP INDEX IF EXISTS ix_bareme_ligne_valeurs_cles_gin;")
    op.execute("DROP INDEX IF EXISTS ix_bareme_ligne_valeurs_sorties_gin;")
    op.execute("DROP INDEX IF EXISTS uq_bareme_sortie_par_defaut;")
    op.drop_table("bareme_ligne")
    op.drop_table("bareme_sortie")
    op.drop_table("bareme_cle")
    op.drop_table("bareme")

    # 2. Recréation de l'ancien schéma simple
    op.create_table(
        "bareme",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("type_cle", sa.String(50)),
        sa.Column("type_valeur", sa.String(50)),
        sa.Column("actif", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("archive", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("date_debut_validite", sa.Date()),
        sa.Column("date_fin_validite", sa.Date()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("code", name="uq_bareme_code"),
    )
    op.create_table(
        "bareme_ligne",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("bareme_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bareme.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ordre", sa.Integer(), server_default=sa.text("0")),
        sa.Column("cle", sa.String(200), nullable=False),
        sa.Column("valeur", sa.Numeric(18, 6)),
        sa.Column("valeur_texte", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("bareme_id", "cle", name="bareme_ligne_bareme_id_cle_key"),
    )
