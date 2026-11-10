#!/usr/bin/env bash
# Re-aplica los permisos del rol web_app (lectura general + escrituras mínimas).
# Uso: DATABASE_URL=postgresql://... scripts/grant-web-role.sh
set -euo pipefail
URL="${DATABASE_URL/postgresql+psycopg:/postgresql:}"
psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO web_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO web_app;
REVOKE SELECT ON admin_users FROM web_app;
GRANT SELECT (id, email, display_name, password_hash, role, active, failed_attempts, locked_until, last_login_at) ON admin_users TO web_app;
GRANT UPDATE (failed_attempts, locked_until, last_login_at) ON admin_users TO web_app;
GRANT INSERT ON correction_requests, audit_logs, alert_status_history, detection_rules TO web_app;
GRANT UPDATE (status, resolution, handled_by, handled_at) ON correction_requests TO web_app;
GRANT UPDATE (status, public_label) ON alerts TO web_app;
GRANT UPDATE (active) ON detection_rules TO web_app;
GRANT INSERT, UPDATE ON system_settings TO web_app;
GRANT INSERT, UPDATE, DELETE ON rate_limit_buckets TO web_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO web_app;
GRANT EXECUTE ON FUNCTION public.f_unaccent(text) TO web_app;
GRANT EXECUTE ON FUNCTION public.si_tsv(text, text, text, text, text) TO web_app;
SQL
echo "Permisos de web_app aplicados."
