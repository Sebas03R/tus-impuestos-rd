# Marca de Tus Impuestos RD

## El logo: «La etiqueta que pregunta»

Una etiqueta de precio con el signo «¿» calado; el punto del signo hace de ojal. Une la pregunta de la
portada («¿Por qué pagaron tanto?») con la etiqueta de precio de una compra. Se eligió entre tres
conceptos (ver `conceptos-logo/`).

## Archivos (`logo/`)

| Archivo | Uso |
|---|---|
| `simbolo.svg` | Símbolo en tinta, sobre fondos claros |
| `simbolo-rojo.svg` | Símbolo en rojo pancarta |
| `simbolo-blanco.svg` | Símbolo en blanco, sobre tinta o fotos oscuras |
| `ficha.svg` / `ficha-borde.svg` | Ficha amarilla cuadrada: favicon, ícono de la app, avatar de redes |
| `horizontal.svg` / `horizontal-color.svg` / `horizontal-blanco.svg` | Logo con el nombre en una línea |
| `apilado.svg` | Logo con el nombre debajo, para espacios cuadrados |

Todos son trazados (sin texto vivo). Las letras salen de Big Shoulders Black (SIL Open Font License,
permite usarla en logotipos). El sitio usa el mismo trazo desde `apps/web/src/lib/brand.ts`; el
favicon, el ícono SVG y el de Apple están en `apps/web/src/app/`, y los PNG de la app en `apps/web/public/`.

## Colores

| Nombre | HEX | RGB | CMYK aprox. | Pantone aprox. |
|---|---|---|---|---|
| Tinta | `#111111` | 17 17 17 | 0 0 0 93 | Black 6 C |
| Amarillo etiqueta | `#FFD400` | 255 212 0 | 0 17 100 0 | 108 C |
| Rojo pancarta | `#D21F1F` | 210 31 31 | 0 85 85 18 | 485 C |

Las equivalencias CMYK y Pantone son aproximadas: pedir prueba de color antes de imprimir.
Contraste: tinta sobre amarillo 14:1; blanco sobre rojo 4,9:1.

## Reglas

- **Espacio libre**: alrededor del logo, como mínimo el ancho del punto del «¿».
- **Tamaño mínimo**: símbolo 16 px (en pantalla) o 6 mm (impreso); logo horizontal 120 px de ancho.
- **Fondos**: tinta sobre blanco o amarillo; blanco sobre tinta o rojo. En fotos, usar la ficha amarilla.
- **No**: girar ni inclinar el símbolo, cambiar la tipografía del nombre, poner el «¿» en otro color que
  el fondo, añadir sombras o degradados, ni usar el símbolo junto a escudos o símbolos patrios (el
  proyecto no es oficial).
