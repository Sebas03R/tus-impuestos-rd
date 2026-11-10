# @tirds/web — sitio público, API y panel de Tus Impuestos RD

Next.js 16 (App Router, Cache Components), TypeScript, Tailwind CSS 4.

```bash
pnpm -C apps/web dev          # http://localhost:3010 (lee DATABASE_URL_WEB de .env.local)
pnpm -C apps/web lint && pnpm -C apps/web typecheck && pnpm -C apps/web test && pnpm -C apps/web build
```

Variables: `DATABASE_URL_WEB` (rol `web_app`), `SESSION_SECRET` (≥ 32 caracteres), `SITE_URL`;
opcionales `GEMINI_API_KEY`, `GEMINI_MODEL`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPOSITORY`.
La API pública está documentada en `/api/docs` (OpenAPI en `/api/openapi.json`).
