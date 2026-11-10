#!/usr/bin/env bash
# Crea la base `tirds_demo` (separada de la real) y carga datos FICTICIOS para desarrollo y pruebas E2E.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_HOST="${DB_HOST:-localhost}"; DB_PORT="${DB_PORT:-54330}"
ADMIN_URL="${ADMIN_URL:-postgresql://tirds:tirds_local_only@${DB_HOST}:${DB_PORT}/postgres}"
DEMO_DB="${DEMO_DB:-tirds_demo}"
if [[ "${APP_ENV:-development}" == "production" ]]; then echo "Rechazado en producción" >&2; exit 2; fi
psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '${DEMO_DB}'" | grep -q 1 \
  || psql "$ADMIN_URL" -c "CREATE DATABASE \"${DEMO_DB}\""
psql "${ADMIN_URL%/*}/${DEMO_DB}" -qc "CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm; GRANT CONNECT ON DATABASE \"${DEMO_DB}\" TO web_app;" 2>/dev/null || true
export DATABASE_URL="postgresql+psycopg://${ADMIN_URL#postgresql://}"; DATABASE_URL="${DATABASE_URL%/*}/${DEMO_DB}"
cd services/pipeline
uv run tirds db upgrade
uv run tirds seed-demo
