"""price_observations.tax_treatment admite 'sin_impuesto_declarado' (22 caracteres).

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE price_observations ALTER COLUMN tax_treatment TYPE varchar(32)")


def downgrade() -> None:
    op.execute("ALTER TABLE price_observations ALTER COLUMN tax_treatment TYPE varchar(20)")
