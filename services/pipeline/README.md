# tirds — pipeline de datos y Motor de Análisis de Contrataciones

Paquete Python de **Tus Impuestos RD**. Descarga datos oficiales, los normaliza en PostgreSQL,
ejecuta las reglas del Radar de Contrataciones y publica alertas con evidencia.

```bash
uv sync
uv run tirds db upgrade                 # migraciones + fuentes + reglas + umbrales legales
uv run tirds sync dgcp --mode incremental
uv run tirds sync mapainversiones | bcrd | hacienda | transparencia-fiscal
uv run tirds analyze                    # motor de análisis + publicación de alertas
uv run tirds status && uv run tirds db size
uv run pytest                           # requiere `docker compose up -d db`
```

Ver `docs/` en la raíz del repositorio para arquitectura, fuentes y metodología.
