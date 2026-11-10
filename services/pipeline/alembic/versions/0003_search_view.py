"""El tsvector deja de almacenarse (43 % del tamaño de cada fila): se indexa una expresión.

La tabla física pasa a llamarse `search_entries`; `search_index` es una vista con la misma
forma (incluida la columna `tsv`), así que las consultas `tsv @@ q` siguen usando el índice GIN
porque la vista se expande en línea.

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

TSV_FN = """
CREATE OR REPLACE FUNCTION public.si_tsv(title text, ref_code text, institution_name text, supplier_name text, body text)
RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('spanish'::regconfig, public.f_unaccent(coalesce(title, '') || ' ' || coalesce(ref_code, ''))), 'A') ||
         setweight(to_tsvector('spanish'::regconfig, public.f_unaccent(coalesce(institution_name, '') || ' ' || coalesce(supplier_name, ''))), 'B') ||
         setweight(to_tsvector('spanish'::regconfig, public.f_unaccent(coalesce(body, ''))), 'C')
$$
"""


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_search_tsv")
    op.execute("ALTER TABLE search_index DROP COLUMN IF EXISTS tsv")
    op.execute("ALTER TABLE search_index RENAME TO search_entries")
    op.execute(TSV_FN)
    op.execute(
        "CREATE INDEX ix_search_entries_tsv ON search_entries USING gin "
        "(public.si_tsv(title, ref_code, institution_name, supplier_name, body))"
    )
    op.execute(
        """
        CREATE VIEW search_index AS
        SELECT e.*, public.si_tsv(e.title, e.ref_code, e.institution_name, e.supplier_name, e.body) AS tsv
        FROM search_entries e
        """
    )
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_app') THEN
            GRANT SELECT ON search_entries, search_index TO web_app;
            GRANT EXECUTE ON FUNCTION public.si_tsv(text, text, text, text, text) TO web_app;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS search_index")
    op.execute("ALTER TABLE search_entries RENAME TO search_index")
