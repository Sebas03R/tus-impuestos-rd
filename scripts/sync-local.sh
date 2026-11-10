#!/usr/bin/env bash
# Sincroniza las fuentes que bloquean IPs de centros de datos (MapaInversiones, Hacienda) desde un
# equipo con conexión residencial, escribiendo en la base de producción.
# Requiere las credenciales en el llavero del sistema (secret-tool), nunca en archivos:
#   secret-tool store --label="tirds pipeline" service tirds key pipeline_db_password
# Uso:  scripts/sync-local.sh            (o desde cron / un temporizador de systemd)
set -euo pipefail
cd "$(dirname "$0")/../services/pipeline"
REF="${SUPABASE_REF:-vysnidveukmzmpwfbzei}"
export APP_ENV=production
export DATABASE_URL="postgresql+psycopg://tirds_pipeline.${REF}:$(secret-tool lookup service tirds key pipeline_db_password)@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
export SUPABASE_URL="https://${REF}.supabase.co"
SUPABASE_SERVICE_KEY="$(secret-tool lookup service tirds key supabase_service_key || true)"
export SUPABASE_SERVICE_KEY
uv run tirds sync mapainversiones --trigger local
if [[ "$(date +%u)" == "1" || "${1:-}" == "--todo" ]]; then
  uv run tirds sync hacienda --trigger local
fi
