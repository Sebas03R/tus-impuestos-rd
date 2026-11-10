-- Solo entorno local: crea el rol con el que se conecta la web.
-- En Supabase este paso lo hace scripts/bootstrap-supabase.sh con una contraseña real.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_app') THEN
    CREATE ROLE web_app LOGIN PASSWORD 'web_app_local_only';
  END IF;
END $$;
