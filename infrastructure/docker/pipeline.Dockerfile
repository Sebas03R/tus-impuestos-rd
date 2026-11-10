# Pipeline de datos y Motor de Análisis (Python 3.13 + uv)
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
WORKDIR /app
COPY services/pipeline/pyproject.toml services/pipeline/uv.lock services/pipeline/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/pipeline/ ./
RUN uv sync --frozen --no-dev && useradd --system --uid 10001 tirds && chown -R tirds /app
USER tirds
ENV PATH="/app/.venv/bin:$PATH"
HEALTHCHECK --interval=5m --timeout=30s CMD tirds status >/dev/null || exit 1
CMD ["tirds", "run-scheduled"]
