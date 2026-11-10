# Tus Impuestos RD

**El dinero es público. La información también.**

Observatorio ciudadano independiente que reúne datos oficiales del gasto público dominicano
(compras y contratos de la DGCP, presupuesto, obras), los actualiza automáticamente y los explica
en lenguaje sencillo. Incluye el **Radar de Contrataciones**, un motor determinista que señala
compras que merecen revisión, siempre con evidencia, cálculos y limitaciones.

> Tus Impuestos RD es una iniciativa independiente. No es un portal oficial del Gobierno dominicano.
> Una alerta indica una situación que merece revisión; no demuestra por sí sola una irregularidad.

## Componentes

| Carpeta | Qué es |
|---|---|
| `apps/web` | Sitio público, API REST (`/api/*`, OpenAPI) y panel `/admin` — Next.js, TypeScript, Tailwind |
| `services/pipeline` | Ingesta, normalización, Motor de Análisis y publicación de alertas — Python, SQLAlchemy, Alembic |
| `tests/e2e` | Pruebas de interfaz con Playwright + axe (móvil y escritorio) |
| `infrastructure/docker` | Dockerfiles, ejemplo de Caddy (HTTPS) y cron para servidor propio |
| `.github/workflows` | CI, sincronizaciones programadas y copias de seguridad |
| `docs/` | Arquitectura, fuentes, marco legal, metodología técnica, despliegue, backups, mantenimiento |

## Ejecutar localmente

Requisitos: Docker, Python 3.13 con [uv](https://docs.astral.sh/uv/), Node 22+ y pnpm.

```bash
cp .env.example .env
docker compose up -d db                       # PostgreSQL 17 en el puerto 54330
cd services/pipeline && uv sync
uv run tirds db upgrade                       # esquema, fuentes, reglas y umbrales legales
uv run tirds sync dgcp --mode incremental     # datos reales de los últimos 15 días (≈2 min)
uv run tirds sync mapainversiones && uv run tirds sync bcrd && uv run tirds sync hacienda
uv run tirds analyze                          # Radar de Contrataciones
cd ../.. && pnpm install && pnpm dev          # http://localhost:3000
```

Datos **ficticios** para desarrollo y pruebas (base separada `tirds_demo`): `./scripts/seed-demo.sh`.
Para la historia completa de la ventana: `uv run tirds sync dgcp --mode backfill` (≈1–2 h, respeta el
límite de 60 solicitudes por minuto de la DGCP).

## Pruebas

```bash
cd services/pipeline && uv run pytest            # unidad, 12 casos del motor, integración con BD
pnpm -C apps/web test                            # vitest
pnpm -C apps/web build
./scripts/seed-demo.sh && pnpm e2e               # Playwright (360 px y 1280 px) + axe
```

## Producción

Gratuita: **Netlify** (web) + **Supabase** (PostgreSQL y Storage) + **GitHub Actions** (sincronización
4 veces al día después de cada actualización de la DGCP, fuentes secundarias, análisis y copias de
seguridad). Ver [docs/despliegue.md](docs/despliegue.md) y [docs/mantenimiento.md](docs/mantenimiento.md).

## Fuentes

DGCP (API de datos abiertos), MapaInversiones, Ministerio de Hacienda (datos.gob.do), Banco Central.
El Portal de Transparencia Fiscal está **bloqueado** para uso automatizado (401). Detalle y estado en
[docs/fuentes.md](docs/fuentes.md) y en `/fuentes`.

## Licencia

Código: MIT. Los datos pertenecen a sus fuentes oficiales y conservan sus condiciones de uso.
