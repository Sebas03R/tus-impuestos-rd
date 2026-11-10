# Fuentes oficiales: estado verificado

Verificación realizada el 9 de noviembre de 2026 con solicitudes reales. El estado vigente de
cada fuente se guarda en la tabla `data_sources` y se publica en `/fuentes`.

| Fuente | Estado | Mecanismo | Frecuencia |
|---|---|---|---|
| DGCP — API de Datos Abiertos | Activa | REST JSON, sin autenticación, `x-ratelimit-limit: 60` por minuto | 4 veces al día |
| MapaInversiones | Activa | Archivos CSV públicos en `/opendata/` | Diaria |
| datos.gob.do (CKAN) — Hacienda | Activa | API CKAN `package_show` → CSV | Semanal (series anuales) |
| Banco Central (BCRD) | Activa | XLSX público, hoja `Diaria` (solo USD) | Días hábiles |
| Transparencia Fiscal | **Bloqueada** | API `api-sigef.hacienda.gob.do` responde 401 sin token reCAPTCHA | — |

## DGCP

- Documentación: <https://datosabiertos.dgcp.gob.do/api-dgcp/docs/index.html> (Swagger 2.0 en `/api-dgcp/docs/doc.json`).
- Base: `https://datosabiertos.dgcp.gob.do/api-dgcp/v1`.
- Respuesta: `{code, hasError, payload: {content: [...]}, page, limit, totalResults, pages}`. `limit=1000` funciona.
- Endpoints usados: `/unidades_compra`, `/procesos` (filtros `startdate`, `enddate`), `/contratos`,
  `/contratos/articulos`, `/ofertas`, `/proveedores`, `/catalogo`, `/procesos/articulos`,
  `/procesos/documentos?proceso=`, `/ocds/releases?ocid=ocds-6550wx-<código>`.
- Hallazgos que condicionan el diseño:
  - `/contratos`, `/contratos/articulos` y `/ofertas` **no tienen filtro de fecha** y su orden no es
    estrictamente cronológico. Se recorren páginas hasta superar la fecha de corte; un barrido semanal
    (`--mode sweep`) recorre toda la ventana para captar modificaciones antiguas.
  - Una página puede traer 999 registros sin ser la última: el fin se determina con `pages`.
  - `precio_unitario` es **antes** de impuestos y descuentos; se verificó en 1,000 de 1,000 artículos que
    `costo_total = cantidad × precio_unitario + itbis + otros_impuestos − descuentos`.
  - El endpoint responde ocasionalmente con HTTP 500; el cliente reintenta con espera exponencial y,
    si una página sigue fallando, la omite y lo registra (hasta 5 páginas por paso).
- Datos personales: no se guardan teléfonos, correos ni direcciones de contacto; el número de documento
  solo se conserva para personas jurídicas (RNC).

## MapaInversiones

Archivos en <https://mapainversiones.gob.do/DatosAbiertos>: proyectos, territorio (región, provincia,
municipio; **sin coordenadas**), fuentes de financiamiento, contratos y procesos por proyecto (vínculo
por SNIP) y `DatosabiertosPresupuestoHacienda.csv` (presupuesto de **inversión** 2023–2026).
Los avances físicos y financieros fuera de 0–100 se guardan como desconocidos.

## Ministerio de Hacienda vía datos.gob.do

Conjunto "Estadísticas de Ejecución de los Gastos y Aplicaciones Financieras, 2017–2025"
(slug `estadisticas-de-solicitudes-de-exequatur`). Archivos CSV mensuales por institución (≈246 mil
filas) y por función. Se agregan a totales anuales. Unos pocos montos vienen en notación científica
(6 cifras significativas): se conservan y se marcan como aproximados.

## Banco Central

`TASA_DOLAR_REFERENCIA_MC.xlsx`, hoja `Diaria` (año, mes, día, compra, venta). Para convertir contratos
en dólares se usa la tasa de venta del día o del último día hábil anterior (máximo 7 días). Contratos en
otras monedas sin tasa publicada no se comparan.

## Transparencia Fiscal

El portal <https://www.transparenciafiscal.gob.do/datos-abiertos/> consume una API que responde 401 sin el
token que genera su propio frontend con reCAPTCHA. No se intenta eludir ese control. El adaptador
`tirds sync transparencia-fiscal` solo comprueba semanalmente si el acceso cambió. El presupuesto general
se cubre con la ejecución publicada por Hacienda en datos.gob.do y el presupuesto de inversión de
MapaInversiones, cada uno como universo separado.

## Restricción de acceso desde la nube

`mapainversiones.gob.do` y `www.hacienda.gob.do` responden **HTTP 403** a solicitudes desde servidores en
centros de datos (verificado el 9-nov-2026 desde GitHub Actions), mientras que funcionan desde una conexión
residencial. No se intenta eludir ese bloqueo. Opciones:

1. `scripts/sync-local.sh` desde un equipo autorizado (cron o temporizador de systemd), que lee las
   credenciales del llavero del sistema.
2. Un runner autoalojado de GitHub Actions en ese equipo y la variable del repositorio
   `SELF_HOSTED_SECONDARY=true`: el workflow `sync-secundarias.yml` lo usará automáticamente.

Si ninguna se configura, `/fuentes` mostrará la antigüedad de esos datos y el resto del sistema sigue
funcionando (DGCP y BCRD sí son accesibles desde GitHub).

## Pendientes

- Pagos: no existe una fuente oficial abierta y verificable de pagos por contrato. La tabla `payments`
  existe vacía; la interfaz muestra "Sin dato".
- Comparador de Precios de la DGCP: no se encontró una API pública documentada.
