"""create paie tables (rubriques + cotisations + baremes)

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-25

Crée les 14 tables nécessaires au module Paie complet :
  - Rubriques : refs (type/famille/flux/frequence) + table principale + imputations + assiettes + alimentations
  - Imputations comptables (référentiel)
  - Cotisations : règles + tranches + rubriques associées
  - Barèmes : table principale + lignes
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =========================================================================
    # 1. RÉFÉRENTIELS RUBRIQUES (type / famille / flux / fréquence)
    # =========================================================================
    op.create_table(
        'ref_type_rubrique_paie',
        sa.Column('code', sa.Text, primary_key=True),
        sa.Column('libelle', sa.Text, nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('actif', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
    )

    op.create_table(
        'ref_famille_rubrique_paie',
        sa.Column('code', sa.Text, primary_key=True),
        sa.Column('libelle', sa.Text, nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('actif', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
    )

    op.create_table(
        'ref_flux_rubrique_paie',
        sa.Column('code', sa.Text, primary_key=True),
        sa.Column('libelle', sa.Text, nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('actif', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
    )

    op.create_table(
        'ref_frequence_rubrique_paie',
        sa.Column('code', sa.Text, primary_key=True),
        sa.Column('libelle', sa.Text, nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('actif', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
    )

    # =========================================================================
    # 2. RÉFÉRENTIEL IMPUTATIONS COMPTABLES
    # =========================================================================
    op.create_table(
        'ref_imputation_comptable',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('code_compte', sa.Text, nullable=False, unique=True),
        sa.Column('intitule_compte', sa.Text),
        sa.Column('actif', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
    )

    # =========================================================================
    # 3. RUBRIQUE PAIE (table principale)
    # =========================================================================
    op.create_table(
        'rubrique_paie',
        sa.Column('code', sa.Text, primary_key=True),
        sa.Column('libelle', sa.Text, nullable=False),
        sa.Column('libelle_edition', sa.Text),
        sa.Column('description', sa.Text),
        sa.Column('code_famille', sa.Text, sa.ForeignKey('ref_famille_rubrique_paie.code')),
        sa.Column('code_flux', sa.Text, sa.ForeignKey('ref_flux_rubrique_paie.code')),
        sa.Column('code_type', sa.Text, sa.ForeignKey('ref_type_rubrique_paie.code')),
        sa.Column('code_frequence', sa.Text, sa.ForeignKey('ref_frequence_rubrique_paie.code')),
        sa.Column('date_debut', sa.Date),
        sa.Column('date_fin', sa.Date),
        sa.Column('traiter', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('simulation', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('v_batch', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('v_externe', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('v_ajout', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('v_forcage', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('v_regularisation', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('v_glissant', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('v_historique', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('pr_cumulee', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('archive', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
    )
    op.create_index('idx_rubrique_paie_famille', 'rubrique_paie', ['code_famille'])
    op.create_index('idx_rubrique_paie_type', 'rubrique_paie', ['code_type'])
    op.create_index('idx_rubrique_paie_flux', 'rubrique_paie', ['code_flux'])
    op.create_index('idx_rubrique_paie_archive', 'rubrique_paie', ['archive'])

    # =========================================================================
    # 4. RUBRIQUE_PAIE_IMPUTATION (lien rubrique <-> compte comptable)
    # =========================================================================
    op.create_table(
        'rubrique_paie_imputation',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('code_rubrique', sa.Text, sa.ForeignKey('rubrique_paie.code', ondelete='CASCADE'), nullable=False),
        sa.Column('numero_imputation', sa.Integer, nullable=False),
        sa.Column('code_compte', sa.Text),
        sa.Column('intitule_compte', sa.Text),
        sa.Column('ref_imputation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('ref_imputation_comptable.id')),
        sa.Column('sens', sa.CHAR(length=1), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.UniqueConstraint('code_rubrique', 'ref_imputation_id', name='rubrique_paie_imputation_code_rubrique_ref_id_key'),
        sa.CheckConstraint("sens IN ('D','C')", name='ck_rubrique_paie_imputation_sens'),
    )
    op.create_index('idx_rubrique_paie_imputation_rubrique', 'rubrique_paie_imputation', ['code_rubrique'])

    # =========================================================================
    # 5. RUBRIQUE_PAIE_ASSIETTE (composantes d'une rubrique de type ASS)
    # =========================================================================
    op.create_table(
        'rubrique_paie_assiette',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('code_rubrique', sa.Text, sa.ForeignKey('rubrique_paie.code', ondelete='CASCADE'), nullable=False),
        sa.Column('code_assiette', sa.Text, sa.ForeignKey('rubrique_paie.code', ondelete='CASCADE'), nullable=False),
        sa.Column('sens_assiette', sa.Text, nullable=False, server_default=sa.text("'PLUS'")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.UniqueConstraint('code_rubrique', 'code_assiette', name='rubrique_paie_assiette_code_rubrique_code_assiette_key'),
        sa.CheckConstraint("sens_assiette IN ('PLUS','MOINS')", name='ck_rubrique_paie_assiette_sens'),
    )

    # =========================================================================
    # 6. RUBRIQUE_PAIE_ALIMENTATION (sources de données pour une rubrique)
    # =========================================================================
    op.create_table(
        'rubrique_paie_alimentation',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('code_rubrique', sa.Text, sa.ForeignKey('rubrique_paie.code', ondelete='CASCADE'), nullable=False),
        sa.Column('code_attribut', sa.Text, nullable=False),
        sa.Column('source_type', sa.Text, nullable=False, server_default=sa.text("'TABLE'")),
        sa.Column('table_source', sa.Text),
        sa.Column('donnee_source', sa.Text),
        sa.Column('rubrique_source', sa.Text),
        sa.Column('attribut_source', sa.Text),
        sa.Column('valeur_constante', sa.Text),
        sa.Column('type_constante', sa.Text),
        sa.Column('nbr_paies_recuperer', sa.Integer),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.UniqueConstraint('code_rubrique', 'code_attribut', name='rubrique_paie_alimentation_code_rubrique_code_attribut_key'),
    )

    # =========================================================================
    # 7. REGLES_COTISATION (CNSS, AMO, etc.)
    # =========================================================================
    op.create_table(
        'regles_cotisation',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('code', sa.Text, nullable=False, unique=True),
        sa.Column('regime', sa.Text),
        sa.Column('intitule', sa.Text, nullable=False),
        sa.Column('intitule_complet', sa.Text),
        sa.Column('a_traiter', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('date_debut', sa.Date),
        sa.Column('date_fin', sa.Date),
        sa.Column('est_bareme', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('cumuler_plafonds_planchers', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('date_application', sa.Date),
        sa.Column('taxe', sa.Numeric(12, 4)),
        sa.Column('code_assiette', sa.Text),
        sa.Column('type_assiette', sa.Text),
        sa.Column('nb_paie', sa.Text),
        sa.Column('nb_jours', sa.Text),
        sa.Column('trentieme', sa.Text),
        sa.Column('rapport', sa.Text),
        sa.Column('mode_calcul', sa.Text),
        sa.Column('code_bareme', sa.Text),
        sa.Column('cle_bareme', sa.Text),
        sa.Column('type_bareme', sa.Text),
        sa.Column('assiette_negative_acceptee', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('assiette_negative_zero', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('prorata_temporis', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('min_salariale', sa.Numeric(12, 4)),
        sa.Column('max_salariale', sa.Numeric(12, 4)),
        sa.Column('min_patronale', sa.Numeric(12, 4)),
        sa.Column('max_patronale', sa.Numeric(12, 4)),
        sa.Column('archive', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
    )

    op.create_table(
        'regles_cotisation_tranches',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('regle_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('regles_cotisation.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code_tranche', sa.Text, nullable=False),
        sa.Column('plancher', sa.Numeric(12, 4)),
        sa.Column('plafond', sa.Numeric(12, 4)),
        sa.Column('taux_salariale', sa.Numeric(8, 4)),
        sa.Column('taux_patronale', sa.Numeric(8, 4)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.UniqueConstraint('regle_id', 'code_tranche', name='regles_cotisation_tranches_regle_id_code_tranche_key'),
    )

    op.create_table(
        'regles_cotisation_rubriques',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('regle_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('regles_cotisation.id', ondelete='CASCADE'), nullable=False),
        sa.Column('ligne', sa.Text, nullable=False),
        sa.Column('rubrique_salariale', sa.Text),
        sa.Column('rubrique_patronale', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.UniqueConstraint('regle_id', 'ligne', name='regles_cotisation_rubriques_regle_id_ligne_key'),
    )

    # =========================================================================
    # 8. BAREME (table principale)
    # =========================================================================
    op.create_table(
        'bareme',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('code', sa.String(50), nullable=False, unique=True),
        sa.Column('libelle', sa.String(200), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('type_cle', sa.String(20), nullable=False),
        sa.Column('type_valeur', sa.String(20), nullable=False),
        sa.Column('date_debut_validite', sa.Date),
        sa.Column('date_fin_validite', sa.Date),
        sa.Column('decision_reference', sa.String(200)),
        sa.Column('actif', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('archive', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.Column('created_by', postgresql.UUID(as_uuid=True)),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True)),
        sa.CheckConstraint("type_cle IN ('TEXTE','NUMERIQUE','DATE')", name='ck_bareme_type_cle'),
        sa.CheckConstraint("type_valeur IN ('MONTANT','TAUX','NOMBRE','TEXTE')", name='ck_bareme_type_valeur'),
    )
    op.create_index('idx_bareme_actif', 'bareme', ['actif'], postgresql_where=sa.text('archive = false'))

    op.create_table(
        'bareme_ligne',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('bareme_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('bareme.id', ondelete='CASCADE'), nullable=False),
        sa.Column('ordre', sa.Integer, nullable=False, server_default=sa.text('0')),
        sa.Column('cle', sa.String(200), nullable=False),
        sa.Column('valeur', sa.Numeric(18, 6)),
        sa.Column('valeur_texte', sa.Text),
        sa.Column('commentaire', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.UniqueConstraint('bareme_id', 'cle', name='bareme_ligne_bareme_id_cle_key'),
    )
    op.create_index('idx_bareme_ligne_bareme', 'bareme_ligne', ['bareme_id'])

    # =========================================================================
    # 9. SEED DATA - quelques valeurs par défaut pour les référentiels
    # =========================================================================
    op.execute("""
        INSERT INTO ref_type_rubrique_paie (code, libelle, description, actif) VALUES
        ('STD', 'Standard', 'Rubrique de calcul standard', true),
        ('ASS', 'Assiette', 'Rubrique calculée à partir d''autres rubriques', true),
        ('CST', 'Constante', 'Rubrique avec valeur constante', true),
        ('BAREME', 'Barème', 'Rubrique basée sur un barème de calcul', true)
        ON CONFLICT (code) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO ref_famille_rubrique_paie (code, libelle, description, actif) VALUES
        ('SAL', 'Salaires', 'Rubriques de salaire', true),
        ('PRIME', 'Primes', 'Primes diverses', true),
        ('AVT', 'Avantages', 'Avantages en nature ou monétaires', true),
        ('IND', 'Indemnités', 'Indemnités diverses', true),
        ('COT', 'Cotisations', 'Cotisations sociales', true),
        ('IMP', 'Impôts', 'Retenues fiscales', true),
        ('REG', 'Régularisations', 'Rubriques de régularisation', true)
        ON CONFLICT (code) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO ref_flux_rubrique_paie (code, libelle, description, actif) VALUES
        ('GAIN', 'Gain', 'Rubrique en faveur du salarié', true),
        ('RETENUE', 'Retenue', 'Rubrique en débit du salarié', true)
        ON CONFLICT (code) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO ref_frequence_rubrique_paie (code, libelle, description, actif) VALUES
        ('MEN', 'Mensuelle', 'Rubrique payée tous les mois', true),
        ('TRI', 'Trimestrielle', 'Rubrique payée tous les 3 mois', true),
        ('SEM', 'Semestrielle', 'Rubrique payée tous les 6 mois', true),
        ('ANN', 'Annuelle', 'Rubrique payée une fois par an', true),
        ('PON', 'Ponctuelle', 'Rubrique sur évenement', true)
        ON CONFLICT (code) DO NOTHING;
    """)


def downgrade() -> None:
    # Ordre inverse pour respecter les FK
    op.drop_table('bareme_ligne')
    op.drop_table('bareme')
    op.drop_table('regles_cotisation_rubriques')
    op.drop_table('regles_cotisation_tranches')
    op.drop_table('regles_cotisation')
    op.drop_table('rubrique_paie_alimentation')
    op.drop_table('rubrique_paie_assiette')
    op.drop_table('rubrique_paie_imputation')
    op.drop_table('rubrique_paie')
    op.drop_table('ref_imputation_comptable')
    op.drop_table('ref_frequence_rubrique_paie')
    op.drop_table('ref_flux_rubrique_paie')
    op.drop_table('ref_famille_rubrique_paie')
    op.drop_table('ref_type_rubrique_paie')
