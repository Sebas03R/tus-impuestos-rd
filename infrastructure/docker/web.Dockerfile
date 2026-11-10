# Sitio web (Next.js) para self-hosting. En Netlify no se usa este archivo.
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY tests/e2e/package.json tests/e2e/
RUN pnpm install --frozen-lockfile --filter @tirds/web...

FROM deps AS build
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm -C apps/web build

FROM node:22-alpine AS run
RUN corepack enable && addgroup -S web && adduser -S web -G web
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=web:web /repo /repo
USER web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["pnpm", "-C", "apps/web", "exec", "next", "start", "-p", "3000"]
