# Arquitectura

```
                 cron (GitHub Actions)                         visitantes
                         │                                         │
          ┌──────────────▼──────────────┐              ┌───────────▼───────────┐
          │ services/pipeline (Python)  │              │ apps/web (Next.js)    │
          │ ingesta → normalización →   │              │ páginas ISR + /api/*  │
          │ entidades → análisis →      │              │ + /admin (Netlify)    │
          │ alertas → índice búsqueda   │              └───────────┬───────────┘
          └──────┬───────────────┬──────┘                          │ rol web_app
                 │ rol postgres  │ snapshots .ndjson.gz             │ (lectura + escrituras mínimas)
          ┌──────▼───────────────▼──────────────────────────────────▼─────┐
          │ Supabase: PostgreSQL 17 (500 MB) + Storage privado (1 GB)       │
          └────────────────────────────────────────────────────────────────┘
```

## Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| Hosting | Netlify (web) + Supabase (BD) + GitHub Actions (procesos) | Gratuito; acordado con el responsable del proyecto |
| API pública | Route Handlers de Next.js | FastAPI requeriría un servidor siempre encendido (no gratuito); una sola API |
| Tareas programadas | GitHub Actions cron + `sync_runs` + `pg_advisory_lock` | Reemplaza Celery/Redis; repositorio público = minutos ilimitados |
| Esquema | SQLAlchemy 2 + Alembic (fuente única) | La web consulta con SQL parametrizado (`postgres`) |
| Dinero | `NUMERIC` + `Decimal`; JSON parseado con `parse_float=Decimal` | Nunca float |
| Procedencia | `content_hash`, `first_seen_at`, `last_seen_at`, `last_changed_at`, `record_versions`, snapshots | Trazabilidad y detección de cambios |
| Búsqueda | `search_entries` + vista `search_index` (tsvector por expresión, español, sin tildes) + `search_terms` (trigram) | Tolerante a tildes y errores; compacto |
| Espacio | Ventana desde `SYNC_SINCE`; ventana móvil opcional `RETENTION_MONTHS` | Límite de 500 MB del plan gratuito |
| Admin | Usuarios propios (argon2id) + JWT en cookie HttpOnly | Portable entre Postgres local y Supabase |

## Módulos del pipeline (`services/pipeline/src/tirds`)

- `http.py`: cliente cortés (token bucket 50/min, cabeceras de límite, reintentos con backoff, lista blanca de hosts, límite de tamaño).
- `sources/dgcp`: modelos Pydantic, sincronización por páginas y por ventanas de fecha, detalle bajo demanda (documentos, OCDS).
- `sources/mapainversiones.py`, `ckan_hacienda.py`, `bcrd.py`, `transparencia_fiscal.py`.
- `transform/`: conversión segura de valores y upsert idempotente con versionado.
- `analytics/`: normalización, comparación de precios, reglas SQL, textos, orquestación (`engine.py`).
- `publish/`: ciclo de vida de alertas e índice de búsqueda.
- `runs.py`, `snapshots.py`: observabilidad, estado de fuentes, alertas operativas (issue en GitHub tras 3 fallos).

## Separación de datos ficticios

`tirds seed-demo` solo corre fuera de producción y en la base `tirds_demo`; todas sus filas llevan
`is_demo = true` y `system_settings.data_mode = demo`. La web muestra una franja "DATOS FICTICIOS" en ese modo.
