# Metodología técnica del Radar de Contrataciones

La versión para ciudadanos está en `/metodologia` (generada desde `detection_rules` y
`legal_thresholds`). Este documento describe la implementación (`services/pipeline/src/tirds/analytics`).

## Principios

1. Cálculos deterministas y reproducibles en Python con `Decimal`; ningún número sale de un modelo de lenguaje.
2. Ante la duda, no comparar. Una alerta indica que algo merece revisión; nunca afirma irregularidad.
3. Cada alerta guarda: regla y versión, parámetros, registros usados, cálculos, fecha y limitaciones.
4. Los parámetros son experimentales y editables: cambiar uno crea una versión nueva de la regla.

## Diferencia de precio (`precio`)

**Normalización** (`normalize.py`):
- Solo artículos con subclase UNSPSC de 8 dígitos; se excluyen servicios y obras (segmentos 70–95).
- Unidades: unidad, docena, kg/libra/quintal/gramo, litro/galón/ml, metro/yarda/pie, m², m³, resma, par,
  hora, día, mes. Empaques (caja, paquete, saco…) solo si la descripción declara el contenido ("caja de 12").
  "Servicio", "global" y "lote" no son comparables.
- Precio comparable = (cantidad × precio_unitario − descuentos) / cantidad normalizada, en DOP.
- Se excluyen artículos de valor nominal (tickets —también mal escritos—, vales, bonos, recargas), kits y
  reactivos de laboratorio, arreglos y prendas personalizadas (contenido heterogéneo), descripciones de menos de
  dos palabras informativas, medicamentos sin concentración, tóner/cartuchos sin código de modelo, bienes
  durables sin ninguna especificación numérica y artículos por "unidad" de pinturas, químicos, limpieza,
  alimentos o combustibles sin tamaño declarado.
- Unidades contradictorias se excluyen: "huacal"/"saco" registrado por kg, "5 lb" registrado por kg,
  "lb"/"pies" sueltos registrados por unidad, "juego"/"caja" por unidad sin cantidad de piezas.
- Diferencias superiores a 400 % se tratan como probable error de registro: quedan internas.
- Alimentos (segmento 50) usan una ventana de ±90 días por la volatilidad de precios.
- Registros contradictorios (el total publicado no cuadra con cantidad, precio, impuestos y descuentos
  con tolerancia de 1 % o RD$1) se excluyen.
- Huella: banderas de servicios incluidos (instalación, transporte, garantía extendida, licencia,
  mantenimiento, capacitación, configuración, montaje), calificativos (blindado, 4x4, inyectable,
  tableta, laptop, usado, genérico…) y dimensiones numéricas (GB, mg, ml, pulgadas, W, BTU, cilindros,
  procesador, año del modelo).

**Pares comparables**: misma subclase, unidad, banderas y calificativos; dimensiones compatibles
(iguales cuando ambos las declaran; a lo sumo una dimensión presente en solo uno; el tamaño de empaque
—"4/1", "caja de 12"— y, en medicamentos, la concentración y el volumen deben estar en ambos); similitud de texto
`token_set_ratio ≥ 70` y `token_sort_ratio ≥ 70`; ventana ±365 días; cantidad dentro de ×20 / ÷20; distinto contrato y proceso.

**Referencia**: mediana de las medianas por proceso (una observación por proceso evita que un proceso con
muchas líneas domine). Dispersión = MAD / mediana.

**Impuestos**: si el contrato no declara ITBIS ni otros impuestos, se asume el caso más favorable (que
su precio ya incluye 18 % de ITBIS) y se descuenta antes de comparar.

**Fórmulas**:
```
diferencia_unitaria  = precio_contratado − precio_referencia
variacion_porcentual = (precio_contratado / precio_referencia − 1) × 100
diferencia_total     = diferencia_unitaria × cantidad
```

**Niveles** (editables): < 15 % sin alerta; 15–30 % interno; 30–60 % candidata; > 60 % prioritaria.
**Evidencia B** (publicable) exige ≥ 5 procesos comparables de ≥ 3 instituciones y dispersión ≤ 0.3.
Además, la diferencia total debe ser ≥ RD$50,000. Sin evidencia suficiente la alerta queda **interna**
("Información insuficiente"). La evidencia A queda reservada para precios oficiales de referencia
equivalentes (no disponibles todavía).

## Otras reglas

| Regla | Criterio | Excepciones / contexto |
|---|---|---|
| Competencia limitada | 1 oferente registrado en modalidad competitiva con contrato ≥ RD$1 M | Excluye excepciones por urgencia/emergencia; sin ofertas registradas = desconocido |
| Diferencia entre etapas | Contratado sin ITBIS > estimado × 1.25 y diferencia ≥ RD$1 M (misma moneda, ≤ 10 contratos) | Excluye procesos lotificados; > 400 % queda interno (probable error de registro) |
| Posible fraccionamiento | ≥ 3 procesos bajo umbral/contratación menor, misma institución y clase UNSPSC, ventana 30 días, suma > máximo de la modalidad vigente y ≥ 3 compras entre 70 % y 100 % de ese máximo | Sin umbral verificado para la fecha no se publica; la Ley 47-25 usa 3 meses, el Radar prioriza los casos más claros |
| Adjudicaciones recurrentes | Un proveedor ≥ 80 % de lo contratado por una institución en una familia y año, ≥ 5 contratos, grupo ≥ RD$5 M, mercado con ≥ 5 proveedores | Patrón estadístico, no prueba vínculos |
| Incremento contractual | Monto actual ≥ inicial × 1.25 y ≥ RD$500 mil (enmiendas OCDS o cambios observados por el sistema) | Solo cambios observados desde el primer registro |
| Documentación insuficiente | Proceso competitivo con contrato, revisado ≥ 30 días después de adjudicar, sin acto de adjudicación o pliego | Se revisan nombres y tipos de documentos, no su contenido |
| Patrón temporal | Monto de diciembre en modalidades no competitivas ≥ 4 × promedio mensual y ≥ RD$10 M | Solo años cerrados |

## Prioridad

`puntaje = (35·precio + 30·magnitud + 20·competencia + 15·documentación) / 100`, cada componente de 0 a
100; magnitud = escala log10 del monto involucrado entre RD$10 mil y RD$1,000 millones. La etiqueta
"Revisión prioritaria" se asigna con puntaje ≥ 60 o diferencia de precio > 60 %. El orden público es:
prioritarias primero, luego puntaje. **No es una probabilidad de corrupción**; no se calculan puntajes
de instituciones, personas ni empresas.

## Ciclo de vida

- Identidad estable: `(regla, sujeto)`; `public_id` permanente (`A-AAAA-NNNNNN`).
- Cambia el dato o el cálculo → nueva `alert_version` con su evidencia.
- Deja de cumplirse el criterio → `retirada` / "Sin alerta vigente", con historial.
- Estados editoriales (`en_revision`, `aclarada`) no se revierten automáticamente.

## Pruebas

`services/pipeline/tests/engine/test_price_cases.py` cubre los 12 casos exigidos; los que necesitan
base de datos (modificación contractual, duplicados, retiro tras corrección) están en
`tests/integration/test_alert_lifecycle.py`.
