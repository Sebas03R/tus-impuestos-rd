# Marco legal aplicado por el Radar

Investigación con fuentes oficiales (PDF descargados y leídos el 9 de noviembre de 2026).

## Régimen según la fecha de convocatoria

| Procesos convocados | Ley aplicable | Fuente |
|---|---|---|
| Antes del 29-ene-2026 | Ley 340-06 y modificaciones; Reglamento 416-23 | Ley 47-25 art. 245; Resolución DGCP PNP-01-2026 art. 16 |
| Desde el 29-ene-2026 | Ley 47-25 (vigente desde el 28-ene-2026) y Decreto 52-26 (reglamento) | Ley 47-25 art. 248; Decreto 52-26 art. 252 |

La Ley 47-25 derogó la Ley 340-06, la Ley 449-06, la Ley 6-21 y el Decreto 416-23 (art. 247).
Promulgada el 28-jul-2025; publicada en G. O. 11204 del 29-jul-2025 (según transcripción oficial).
Decreto 52-26: dictado el 28-ene-2026, G. O. 11231 del 31-ene-2026.

## Umbrales (tabla `legal_thresholds`)

| Vigencia | Resolución | Bienes y servicios | Obras |
|---|---|---|---|
| 2-ene-2025 → 31-mar-2026 | [PNP-01-2025](https://dgcp.gob.do/wp-content/uploads/page/PNP-01-2025%20Umbrales.pdf) | Compra menor RD$248,085.67–1,860,642.55; Comparación de precios RD$1,860,642.56–5,644,812.73; Licitación restringida RD$5,644,812.74–6,272,014.15; Licitación pública desde RD$6,272,014.16 | Comparación de precios RD$49,617,134.88–186,064,255.80; Sorteo RD$186,064,255.81–310,107,093.00; Restringida hasta RD$411,347,975.99; Pública desde RD$411,347,976.00 |
| desde 1-abr-2026 | [PNP-03-2026](https://www.dgcp.gob.do/wp-content/uploads/page/PNP-03-2026_UMBRALES.pdf) | Directa sujeta al umbral hasta RD$268,111.37; Contratación menor RD$268,111.38–2,010,835.37; Simplificada RD$2,010,835.38–6,436,757.50; Licitación pública desde RD$6,436,757.51 | Contratación menor hasta RD$53,622,276.92; Simplificada RD$53,622,276.93–201,083,538.47; Sorteo RD$201,083,538.48–406,713,345.69; Pública desde RD$406,713,345.70 |

Notas:

- Entre el 29-ene y el 31-mar-2026 siguieron vigentes los montos de 2025 bajo la Ley 47-25
  (PNP-01-2026 art. 2); la licitación restringida quedó abolida (art. 6).
- El tramo "debajo del umbral" de 2025 no tiene fila propia en la resolución; se infiere como inferior al
  mínimo de compras menores.
- Ley 47-25 art. 59 párrafo IV: instituciones con presupuesto pequeño multiplican los factores por 0.5. El
  Radar usa los umbrales publicados (mayores), por lo que su análisis de fraccionamiento es conservador.

## Fraccionamiento

- Ley 340-06, art. 10: prohíbe fraccionar compras para eludir procedimientos.
- Ley 47-25, art. 5 num. 20 y art. 81: define fraccionamiento como otra convocatoria del mismo
  rubro-clase en el mismo año presupuestario a menos de 3 meses; art. 82 enumera excepciones
  (etapas o lotes, fondos insuficientes, excepciones, desiertos) con autorización motivada.
- El Radar usa una ventana de 30 días (Ley 340-06, parámetro editable) y de 90 días para procesos regidos
  por la Ley 47-25. Una alerta de fraccionamiento **no** afirma que se violó la ley: indica que la suma de
  compras parecidas superó el límite de la modalidad usada y que conviene revisar la justificación.
