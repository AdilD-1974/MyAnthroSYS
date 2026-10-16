"""journal grille : habillage des cases (masque, texte avant/après, valeur si vide, condition)

Emplacement : personahub-api/alembic/versions/c4e8a1f7d92b_grille_case_habillage.py

Revision ID: c4e8a1f7d92b
Revises: habil_conditions_001

Cinq colonnes OPTIONNELLES sur rapport_grille_case. Toutes à NULL = rendu
historique inchangé : les journaux existants sortent exactement comme avant
tant qu'aucune case n'est habillée.

  masque              code d'un masque du registre rapport_grille_engine.MASQUES
  texte_avant/apres   texte imprimé autour de la valeur
  valeur_si_vide      NULL = tiret "-" (historique) ; '' = vide ; autre = ce texte
  condition_affichage {cible, operateur, valeur, sinon} (JSONB sur PostgreSQL)

Vérifier le head avant d'appliquer :  alembic heads
(doit afficher habil_conditions_001 ; sinon corriger down_revision ci-dessous)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c4e8a1f7d92b"
down_revision = "habil_conditions_001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("rapport_grille_case", sa.Column("masque", sa.String(30)))
    op.add_column("rapport_grille_case", sa.Column("texte_avant", sa.String(100)))
    op.add_column("rapport_grille_case", sa.Column("texte_apres", sa.String(100)))
    op.add_column("rapport_grille_case", sa.Column("valeur_si_vide", sa.String(100)))
    op.add_column(
        "rapport_grille_case",
        sa.Column("condition_affichage", sa.JSON().with_variant(postgresql.JSONB(), "postgresql")),
    )


def downgrade():
    for col in ("condition_affichage", "valeur_si_vide", "texte_apres", "texte_avant", "masque"):
        op.drop_column("rapport_grille_case", col)
