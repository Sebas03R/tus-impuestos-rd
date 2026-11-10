"""Datos de referencia: fuentes oficiales y su estado verificado."""

from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tirds.db.models import DataSource

SOURCES = [
    {
        "code": "dgcp",
        "name": "API de Datos Abiertos de Contrataciones Públicas",
        "publisher": "Dirección General de Contrataciones Públicas (DGCP)",
        "url": "https://datosabiertos.dgcp.gob.do/api-dgcp/v1",
        "docs_url": "https://datosabiertos.dgcp.gob.do/api-dgcp/docs/index.html",
        "license": "Datos abiertos del Estado dominicano (ver términos del portal)",
        "status": "activa",
        "status_detail": "Verificada: sin autenticación, límite de 60 solicitudes por minuto.",
        "update_frequency": "Cuatro veces al día (00:00, 07:00, 14:00 y 21:00, hora dominicana)",
    },
    {
        "code": "mapainversiones",
        "name": "MapaInversiones — Datos abiertos",
        "publisher": "Ministerio de Economía, Planificación y Desarrollo / Ministerio de Hacienda",
        "url": "https://mapainversiones.gob.do/DatosAbiertos",
        "docs_url": "https://mapainversiones.gob.do/DatosAbiertos",
        "license": "Datos abiertos del Estado dominicano (ver términos del portal)",
        "status": "activa",
        "status_detail": (
            "Verificada: archivos CSV públicos actualizados diariamente. Responde 403 a servidores en centros de "
            "datos (GitHub Actions); se sincroniza desde un equipo con conexión residencial."
        ),
        "update_frequency": "Diaria",
    },
    {
        "code": "hacienda_ckan",
        "name": "Portal de Datos Abiertos (datos.gob.do) — Ministerio de Hacienda",
        "publisher": "Ministerio de Hacienda y Economía / OPTIC",
        "url": "https://datos.gob.do/organization/ministerio-de-hacienda",
        "docs_url": "https://datos.gob.do/api/3/action/help_show?name=package_search",
        "license": "Según cada conjunto de datos en datos.gob.do",
        "status": "activa",
        "status_detail": (
            "Verificada: API CKAN pública; series anuales de ejecución del gasto. Los archivos en hacienda.gob.do "
            "responden 403 a servidores en centros de datos; se sincroniza desde un equipo con conexión residencial."
        ),
        "update_frequency": "Semanal (las series se publican de forma anual)",
    },
    {
        "code": "bcrd",
        "name": "Tasa de cambio de referencia del dólar",
        "publisher": "Banco Central de la República Dominicana",
        "url": "https://cdn.bancentral.gov.do/documents/estadisticas/mercado-cambiario/documents/TASA_DOLAR_REFERENCIA_MC.xlsx",
        "docs_url": "https://www.bancentral.gov.do/a/d/2538-mercado-cambiario",
        "license": "Publicación estadística del BCRD",
        "status": "activa",
        "status_detail": "Verificada: archivo XLSX público.",
        "update_frequency": "Diaria (días hábiles)",
    },
    {
        "code": "transparencia_fiscal",
        "name": "Portal de Transparencia Fiscal — API de datos abiertos",
        "publisher": "Ministerio de Hacienda y Economía",
        "url": "https://www.transparenciafiscal.gob.do/datos-abiertos/",
        "docs_url": None,
        "license": None,
        "status": "bloqueada",
        "status_detail": (
            "La API que usa el portal (api-sigef.hacienda.gob.do) responde 401 sin el token que genera "
            "el propio sitio con reCAPTCHA. No se usa hasta contar con acceso autorizado."
        ),
        "update_frequency": "No aplica mientras esté bloqueada",
    },
]


def seed_reference(session: Session) -> None:
    stmt = insert(DataSource).values(SOURCES)
    stmt = stmt.on_conflict_do_update(
        index_elements=["code"],
        set_={k: getattr(stmt.excluded, k) for k in ("name", "publisher", "url", "docs_url", "license", "update_frequency")},
    )
    session.execute(stmt)
    # El estado inicial solo se fija si la fuente aún no tiene historial.
    for src in SOURCES:
        session.query(DataSource).filter(DataSource.code == src["code"], DataSource.last_attempt_at.is_(None)).update(
            {"status": src["status"], "status_detail": src["status_detail"]}
        )
    from tirds.analytics.rules import seed_rules
    from tirds.analytics.thresholds import seed_thresholds

    seed_rules(session)
    seed_thresholds(session)
