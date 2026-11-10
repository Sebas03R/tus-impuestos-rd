"""Ahorro de espacio para el plan gratuito de Supabase (500 MB).

- search_index: sin índice trigram ni índice de ref_code (código se busca en sus tablas);
  tsv más compacto; contratos fuera del índice (se buscan por código o vía su proceso).
- search_terms: diccionario de palabras (con índice trigram) para corregir errores de tipeo.
- Índices redundantes de contracts/bids eliminados.

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_search_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_search_ref_code")
    op.execute("DROP INDEX IF EXISTS ix_search_tsv")
    op.execute("DELETE FROM search_index WHERE entity_type = 'contrato'")
    op.execute("ALTER TABLE search_index DROP COLUMN IF EXISTS tsv")
    op.execute(
        """
        ALTER TABLE search_index ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('spanish', public.f_unaccent(coalesce(title, '') || ' ' || coalesce(ref_code, ''))), 'A') ||
          setweight(to_tsvector('spanish', public.f_unaccent(coalesce(institution_name, '') || ' ' || coalesce(supplier_name, ''))), 'B') ||
          setweight(to_tsvector('spanish', public.f_unaccent(coalesce(body, ''))), 'C')
        ) STORED
        """
    )
    op.execute("CREATE INDEX ix_search_tsv ON search_index USING gin (tsv)")
    op.execute("CREATE TABLE IF NOT EXISTS search_terms (term text PRIMARY KEY, freq integer NOT NULL DEFAULT 1)")
    op.execute(
        """
        DO $$
        DECLARE ext_schema text := (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                                     WHERE e.extname = 'pg_trgm');
        BEGIN
          EXECUTE format('CREATE INDEX IF NOT EXISTS ix_search_terms_trgm ON search_terms USING gin (term %I.gin_trgm_ops)', ext_schema);
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_app') THEN
            GRANT SELECT ON search_terms TO web_app;
          END IF;
        END $$;
        """
    )
    for idx in ("ix_bids_process_code", "ix_bids_supplier_id", "ix_contracts_supplier_id", "ix_contracts_institution_id"):
        op.execute(f"DROP INDEX IF EXISTS {idx}")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS search_terms")
