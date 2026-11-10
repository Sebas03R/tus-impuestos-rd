# Mantenimiento y operación

## Qué corre solo

| Workflow | Horario (UTC) | Qué hace |
|---|---|---|
| `sync-dgcp.yml` | 01:45, 04:45, 11:45, 18:45 | Sincronización incremental DGCP + motor de análisis |
| `sync-dgcp.yml` | domingo 07:00 | Barrido completo de la ventana (+ ventana móvil si `RETENTION_MONTHS`) |
| `sync-secundarias.yml` | diario 05:30 / L-V 14:00 / lunes 06:00 | MapaInversiones / BCRD / Hacienda + verificación de Transparencia Fiscal |
| `backup.yml` | diario 08:00 | Volcado cifrado |

Si una fuente falla 3 veces seguidas se abre un issue con la etiqueta `operaciones`.

MapaInversiones y Hacienda bloquean IPs de centros de datos: se actualizan con `scripts/sync-local.sh`
desde un equipo con conexión residencial o con un runner autoalojado (ver `docs/fuentes.md`).

## Comprobar que funciona

- Público: `/fuentes` y `GET /api/system/data-status` (última sincronización, registros, errores).
- Panel: `/admin` → Integraciones (sync_runs), errores, alertas, reglas, solicitudes de corrección.
- CLI: `uv run tirds status`, `uv run tirds db size`.

## Tareas frecuentes

```bash
cd services/pipeline
uv run tirds sync dgcp --mode incremental      # o: gh workflow run sync-dgcp.yml -f mode=incremental
uv run tirds analyze --details 150             # reanálisis + documentos/OCDS de 150 procesos
uv run tirds admin create correo@dominio --role admin
uv run tirds db prune --keep-months 14         # libera espacio (conserva lo que sustenta alertas)
uv run tirds db rehash                         # tras cambiar reglas de mapeo, evita versiones falsas
uv run tirds search-refresh                    # reconstruye el índice de búsqueda
```

## Cambiar un umbral o parámetro

Desde `/admin` → Reglas (crea una versión nueva) o insertando una fila nueva en `detection_rules` con
`version = max + 1`. Nunca editar una versión existente: las alertas guardan la versión con la que se calcularon.
Los umbrales legales se agregan en `src/tirds/analytics/thresholds.py` **con fuente citada** y
`tirds db upgrade`.

## Espacio en Supabase (500 MB)

`tirds db size` lista las tablas más grandes. Si supera ~420 MB: definir `RETENTION_MONTHS` (variable
del repositorio) o adelantar `SYNC_SINCE`, ejecutar el barrido y luego `VACUUM FULL` desde el editor SQL.

## Correcciones

Las solicitudes llegan a `correction_requests` (formulario `/correcciones`). Si se acepta una corrección
que invalida una alerta, marcarla como "Aclarada" desde el panel: el motor no la vuelve a publicar.
