"""Porcentajes de diferencia pueden superar 99,999 % en registros erróneos de la fuente.

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE price_comparisons ALTER COLUMN diff_pct TYPE numeric(16,4)")
    op.execute("ALTER TABLE price_comparisons ALTER COLUMN dispersion TYPE numeric(16,4)")


def downgrade() -> None:
    pass
