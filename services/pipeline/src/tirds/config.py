"""Configuración central del pipeline (variables de entorno)."""

from __future__ import annotations

from datetime import date
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore", env_ignore_empty=True)

    app_env: str = Field(default="development", alias="APP_ENV")
    database_url: str = Field(
        default="postgresql+psycopg://tirds:tirds_local_only@localhost:54330/tirds",
        alias="DATABASE_URL",
    )
    sync_since: date = Field(default=date(2025, 1, 1), alias="SYNC_SINCE")
    # Ventana móvil opcional (meses). Si se define, el barrido semanal borra lo más antiguo.
    retention_months: int | None = Field(default=None, alias="RETENTION_MONTHS")

    dgcp_base_url: str = Field(default="https://datosabiertos.dgcp.gob.do/api-dgcp/v1", alias="DGCP_BASE_URL")
    mapainversiones_base_url: str = Field(
        default="https://mapainversiones.gob.do/opendata", alias="MAPAINVERSIONES_BASE_URL"
    )
    ckan_base_url: str = Field(default="https://datos.gob.do/api/3/action", alias="CKAN_BASE_URL")
    bcrd_rates_url: str = Field(
        default=(
            "https://cdn.bancentral.gov.do/documents/estadisticas/mercado-cambiario/documents/TASA_DOLAR_REFERENCIA_MC.xlsx"
        ),
        alias="BCRD_RATES_URL",
    )

    # Cortesía con las fuentes: la DGCP permite 60/min; usamos menos.
    requests_per_minute: int = Field(default=50, alias="REQUESTS_PER_MINUTE")
    http_timeout_s: float = Field(default=90.0, alias="HTTP_TIMEOUT_S")
    max_download_bytes: int = Field(default=150 * 1024 * 1024, alias="MAX_DOWNLOAD_BYTES")
    user_agent: str = Field(
        default="TusImpuestosRD-bot/0.1 (+https://tus-impuestos-rd.netlify.app/acerca)",
        alias="HTTP_USER_AGENT",
    )

    # Snapshots crudos: Supabase Storage si hay credenciales; si no, disco local.
    supabase_url: str | None = Field(default=None, alias="SUPABASE_URL")
    supabase_service_key: str | None = Field(default=None, alias="SUPABASE_SERVICE_KEY")
    snapshot_bucket: str = Field(default="raw-snapshots", alias="SNAPSHOT_BUCKET")
    snapshot_dir: Path = Field(default=Path("data/snapshots"), alias="SNAPSHOT_DIR")

    # Alertas operativas (issue en GitHub tras fallos repetidos)
    github_token: str | None = Field(default=None, alias="GITHUB_TOKEN")
    github_repository: str | None = Field(default=None, alias="GITHUB_REPOSITORY")
    failure_issue_threshold: int = Field(default=3, alias="FAILURE_ISSUE_THRESHOLD")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


# Hosts oficiales permitidos para descargas (protección SSRF).
ALLOWED_HOSTS = frozenset(
    {
        "datosabiertos.dgcp.gob.do",
        "mapainversiones.gob.do",
        "datos.gob.do",
        "cdn.bancentral.gov.do",
        "www.hacienda.gob.do",
        "hacienda.gob.do",
        "digepres.gob.do",
        "www.digepres.gob.do",
        "api-sigef.hacienda.gob.do",
    }
)


@lru_cache
def get_settings() -> Settings:
    return Settings()
