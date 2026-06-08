"""Schéma initial PersonaHub HR

Revision ID: 001_initial
Revises: 
Create Date: 2025-04-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Users & Auth ──────────────────────────────────────────────────────────
    op.create_table("users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table("profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("nom", sa.String(100)),
        sa.Column("prenom", sa.String(100)),
        sa.Column("telephone", sa.String(20)),
        sa.Column("avatar_url", sa.Text()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )

    op.create_table("user_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── Organisations & Postes ────────────────────────────────────────────────
    op.create_table("organisations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("type_organisation", sa.String(50)),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True)),
        sa.Column("responsable_id", postgresql.UUID(as_uuid=True)),
        sa.Column("actif", sa.Boolean(), server_default="true"),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["parent_id"], ["organisations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )

    op.create_table("postes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("organisation_id", postgresql.UUID(as_uuid=True)),
        sa.Column("niveau_hierarchique", sa.Integer()),
        sa.Column("actif", sa.Boolean(), server_default="true"),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["organisation_id"], ["organisations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )

    # ── Collaborateurs ────────────────────────────────────────────────────────
    op.create_table("collaborateurs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("matricule", sa.String(50), nullable=False),
        sa.Column("ancien_matricule", sa.String(50)),
        sa.Column("civilite", sa.String(10)),
        sa.Column("nom", sa.String(100), nullable=False),
        sa.Column("prenom", sa.String(100), nullable=False),
        sa.Column("nom_jeune_fille", sa.String(100)),
        sa.Column("date_naissance", sa.Date(), nullable=False),
        sa.Column("lieu_naissance", sa.String(200)),
        sa.Column("code_nationalite", sa.String(5)),
        sa.Column("code_nationalite2", sa.String(5)),
        sa.Column("code_genre", sa.String(1), nullable=False),
        sa.Column("cin", sa.String(50)),
        sa.Column("cin_date_debut", sa.Date()),
        sa.Column("cin_date_fin", sa.Date()),
        sa.Column("passeport", sa.String(50)),
        sa.Column("passeport_date_debut", sa.Date()),
        sa.Column("passeport_date_fin", sa.Date()),
        sa.Column("num_cnss", sa.String(50)),
        sa.Column("num_cimr", sa.String(50)),
        sa.Column("num_amo", sa.String(50)),
        sa.Column("num_fiscal", sa.String(50)),
        sa.Column("telephone", sa.String(20)),
        sa.Column("gsm", sa.String(20)),
        sa.Column("email_personnel", sa.String(200)),
        sa.Column("email_professionnel", sa.String(200)),
        sa.Column("statut_collaborateur", sa.String(50), server_default="actif"),
        sa.Column("photo_path", sa.Text()),
        sa.Column("archive", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("matricule"),
    )
    op.create_index("ix_collaborateurs_nom", "collaborateurs", ["nom"])
    op.create_index("ix_collaborateurs_matricule", "collaborateurs", ["matricule"])

    op.create_table("contrats",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("collaborateur_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type_contrat", sa.String(50), nullable=False),
        sa.Column("date_debut", sa.Date(), nullable=False),
        sa.Column("date_fin", sa.Date()),
        sa.Column("motif_fin", sa.String(200)),
        sa.Column("est_actif", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["collaborateur_id"], ["collaborateurs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table("affectations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("collaborateur_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organisation_id", postgresql.UUID(as_uuid=True)),
        sa.Column("poste_id", postgresql.UUID(as_uuid=True)),
        sa.Column("date_debut", sa.Date(), nullable=False),
        sa.Column("date_fin", sa.Date()),
        sa.Column("est_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["collaborateur_id"], ["collaborateurs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organisation_id"], ["organisations.id"]),
        sa.ForeignKeyConstraint(["poste_id"], ["postes.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # FK différée : organisations.responsable_id → collaborateurs.id
    op.create_foreign_key("fk_org_responsable", "organisations", "collaborateurs",
                          ["responsable_id"], ["id"])

    # ── Paie ──────────────────────────────────────────────────────────────────
    op.create_table("rubriques",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("type_rubrique", sa.String(50)),
        sa.Column("nature", sa.String(50)),
        sa.Column("actif", sa.Boolean(), server_default="true"),
        sa.Column("archive", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("code"),
    )

    op.create_table("cotisations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("taux_salarial", sa.Numeric(8, 4)),
        sa.Column("taux_patronal", sa.Numeric(8, 4)),
        sa.Column("plafond", sa.Numeric(14, 2)),
        sa.Column("actif", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("code"),
    )

    op.create_table("baremes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("type_cle", sa.String(50), nullable=False),
        sa.Column("type_valeur", sa.String(50), nullable=False),
        sa.Column("actif", sa.Boolean(), server_default="true"),
        sa.Column("archive", sa.Boolean(), server_default="false"),
        sa.Column("date_debut_validite", sa.Date()),
        sa.Column("date_fin_validite", sa.Date()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("code"),
    )

    op.create_table("bareme_lignes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("bareme_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cle", sa.String(100), nullable=False),
        sa.Column("valeur", sa.Numeric(14, 4)),
        sa.Column("valeur_texte", sa.String(200)),
        sa.Column("ordre", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["bareme_id"], ["baremes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table("salaires_fixes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("collaborateur_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rubrique_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("montant", sa.Numeric(14, 2), nullable=False),
        sa.Column("date_debut", sa.Date(), nullable=False),
        sa.Column("date_fin", sa.Date()),
        sa.Column("actif", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["collaborateur_id"], ["collaborateurs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rubrique_id"], ["rubriques.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── Absences ──────────────────────────────────────────────────────────────
    op.create_table("types_conge",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("duree_max_annuelle", sa.Integer()),
        sa.Column("deductible_paie", sa.Boolean(), server_default="false"),
        sa.Column("actif", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("code"),
    )

    op.create_table("demandes_conge",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("collaborateur_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type_conge_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("date_debut", sa.Date(), nullable=False),
        sa.Column("date_fin", sa.Date(), nullable=False),
        sa.Column("nombre_jours", sa.Numeric(5, 1), nullable=False),
        sa.Column("statut", sa.String(30), server_default="en_attente"),
        sa.Column("motif", sa.Text()),
        sa.Column("commentaire_valideur", sa.Text()),
        sa.Column("valideur_id", postgresql.UUID(as_uuid=True)),
        sa.Column("date_validation", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["collaborateur_id"], ["collaborateurs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["type_conge_id"], ["types_conge.id"]),
        sa.ForeignKeyConstraint(["valideur_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table("compteurs_conge",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("collaborateur_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type_conge_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("annee", sa.Integer(), nullable=False),
        sa.Column("solde_initial", sa.Numeric(6, 2), server_default="0"),
        sa.Column("solde_acquis", sa.Numeric(6, 2), server_default="0"),
        sa.Column("solde_pris", sa.Numeric(6, 2), server_default="0"),
        sa.Column("solde_restant", sa.Numeric(6, 2), server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["collaborateur_id"], ["collaborateurs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["type_conge_id"], ["types_conge.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table("jours_feries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("libelle", sa.String(200), nullable=False),
        sa.Column("annee", sa.Integer(), nullable=False),
        sa.Column("recurrent", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── Mouvements & Départs ──────────────────────────────────────────────────
    op.create_table("mouvements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("collaborateur_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type_mouvement", sa.String(50), nullable=False),
        sa.Column("date_mouvement", sa.Date(), nullable=False),
        sa.Column("organisation_origine_id", postgresql.UUID(as_uuid=True)),
        sa.Column("organisation_destination_id", postgresql.UUID(as_uuid=True)),
        sa.Column("poste_origine_id", postgresql.UUID(as_uuid=True)),
        sa.Column("poste_destination_id", postgresql.UUID(as_uuid=True)),
        sa.Column("motif", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True)),
        sa.ForeignKeyConstraint(["collaborateur_id"], ["collaborateurs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table("departs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("collaborateur_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type_depart", sa.String(50), nullable=False),
        sa.Column("date_depart", sa.Date(), nullable=False),
        sa.Column("motif", sa.Text()),
        sa.Column("solde_conge_restant", sa.Numeric(6, 2)),
        sa.Column("indemnite_calculee", sa.Numeric(14, 2)),
        sa.Column("statut", sa.String(30), server_default="en_cours"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True)),
        sa.ForeignKeyConstraint(["collaborateur_id"], ["collaborateurs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("departs")
    op.drop_table("mouvements")
    op.drop_table("jours_feries")
    op.drop_table("compteurs_conge")
    op.drop_table("demandes_conge")
    op.drop_table("types_conge")
    op.drop_table("salaires_fixes")
    op.drop_table("bareme_lignes")
    op.drop_table("baremes")
    op.drop_table("cotisations")
    op.drop_table("rubriques")
    op.drop_foreign_key("fk_org_responsable", "organisations")
    op.drop_table("affectations")
    op.drop_table("contrats")
    op.drop_index("ix_collaborateurs_matricule", "collaborateurs")
    op.drop_index("ix_collaborateurs_nom", "collaborateurs")
    op.drop_table("collaborateurs")
    op.drop_table("postes")
    op.drop_table("organisations")
    op.drop_table("user_roles")
    op.drop_table("profiles")
    op.drop_index("ix_users_email", "users")
    op.drop_table("users")
