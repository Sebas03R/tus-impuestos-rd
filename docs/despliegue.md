# Despliegue en producción (gratuito: Netlify + Supabase + GitHub Actions)

## 1. Base de datos (Supabase)

1. Crear proyecto (plan Free) y anotar `project_ref` y la contraseña de `postgres`.
2. Desde la raíz del repo:
   ```bash
   export DATABASE_URL="postgresql+psycopg://postgres:<clave>@db.<ref>.supabase.co:5432/postgres"
   cd services/pipeline && uv run tirds db upgrade
   ```
3. Crear el rol de la web con contraseña aleatoria y volver a aplicar permisos:
   ```bash
   WEB_PASS=$(openssl rand -base64 32 | tr -d '=+/')
   psql "${DATABASE_URL/+psycopg/}" -c "CREATE ROLE web_app LOGIN PASSWORD '$WEB_PASS'; ALTER ROLE web_app SET search_path = public, extensions;"
   scripts/grant-web-role.sh   # re-ejecuta los GRANT de las migraciones
   ```
4. Storage: crear bucket **privado** `raw-snapshots`.
5. Primer llenado (desde su máquina o con `gh workflow run sync-dgcp.yml -f mode=backfill`):
   `uv run tirds sync dgcp --mode backfill && uv run tirds sync mapainversiones && uv run tirds sync hacienda && uv run tirds sync bcrd && uv run tirds analyze`.

## 2. GitHub

```bash
gh secret set DATABASE_URL          # postgresql+psycopg://postgres.<ref>:<clave>@aws-0-<región>.pooler.supabase.com:5432/postgres
gh secret set DATABASE_URL_DIRECT   # conexión directa para pg_dump
gh secret set SUPABASE_URL          # https://<ref>.supabase.co
gh secret set SUPABASE_SERVICE_KEY  # service_role (solo Storage; nunca en la web)
gh secret set BACKUP_AGE_PUBKEY     # ver docs/backups.md
gh variable set SYNC_SINCE --body 2026-01-01
gh variable set RETENTION_MONTHS --body 10   # ventana móvil: cabe en los 500 MB del plan gratuito
```

## 3. Web (Netlify)

- Sitio enlazado al repositorio; directorio base `apps/web` (ver `netlify.toml`, que declara
  `@netlify/plugin-nextjs`).
- Variables: `DATABASE_URL_WEB` (pooler en **modo sesión**, puerto 5432, usuario `web_app.<ref>`;
  el modo transaccional 6543 cuelga consultas con el pipelining del driver `postgres`),
  `SESSION_SECRET` (≥ 32 caracteres aleatorios), `SITE_URL`, opcionales `GEMINI_API_KEY`,
  `GITHUB_DISPATCH_TOKEN`.
- Desactivar el distintivo "Built with Netlify":
  `netlify api updateSite --data '{"site_id":"<id>","body":{"built_with_badge_enabled":false}}'`.
- Crear el primer usuario del panel: `uv run tirds admin create correo@dominio --role admin`.

## 4. Verificación

- `https://<sitio>/api/health` → `ok`; `/api/system/data-status` muestra la última sincronización.
- `gh run list --workflow sync-dgcp.yml` muestra ejecuciones exitosas.
- `uv run tirds db size` < 420 MB. Medido el 9-nov-2026: ~42 mil artículos contratados por mes
  (~15 MB/mes en total); 10 meses ≈ 400 MB. Con Supabase Pro (8 GB) se puede quitar `RETENTION_MONTHS`
  y adelantar `SYNC_SINCE` a 2025-01-01 o antes.

## Alternativa: servidor propio (Docker)

```bash
cp .env.example .env    # completar
docker compose --profile full up -d --build
docker compose --profile full run --rm pipeline tirds db upgrade
# cron del host: infrastructure/docker/crontab.example ; HTTPS: infrastructure/docker/Caddyfile.example
```
