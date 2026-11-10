"""Ejecutar desde docs/marca/logo con fonttools instalado.
Kit final de «La etiqueta que pregunta»: símbolo, lockups, ícono y constantes para la web."""
import json, math
exec(open("../conceptos-logo/construir.py").read().split("# ── A · Sobreprecímetro")[0])  # helpers: text_path, glyph_path, svg, f

INK, RED, YELLOW, WHITE = "#111111", "#D21F1F", "#FFD400", "#FFFFFF"
TAG = "M100 14H156L200 58V242H56V58Z"
Q = glyph_path("¿", 128, 46, 166)
MARK = TAG + Q  # etiqueta con «¿» calado (fill-rule evenodd)
OUT = "."

def mark(color, transform=""):
    t = f' transform="{transform}"' if transform else ""
    return f'<path fill="{color}" fill-rule="evenodd"{t} d="{MARK}"/>'

def write(name, w, h, body, title):
    open(f"{OUT}/{name}", "w").write(svg(w, h, body, title))

# Símbolo (caja ajustada 56..200 × 14..242 → recentrado en 256 con el mismo trazo)
write("simbolo.svg", 256, 256, mark(INK), "Tus Impuestos RD")
write("simbolo-rojo.svg", 256, 256, mark(RED), "Tus Impuestos RD")
write("simbolo-blanco.svg", 256, 256, mark(WHITE), "Tus Impuestos RD")

# Ficha (ícono): amarillo de etiqueta con la etiqueta en tinta, escalada al 78 % y centrada.
s = 0.78; tx = 128 - 128 * s; ty = 128 - 128 * s
tile_inner = mark(INK, f"translate({f(tx)} {f(ty)}) scale({s})")
write("ficha.svg", 256, 256, f'<rect width="256" height="256" fill="{YELLOW}"/>{tile_inner}', "Tus Impuestos RD")
write("ficha-borde.svg", 256, 256,
      f'<rect x="6" y="6" width="244" height="244" fill="{YELLOW}" stroke="{INK}" stroke-width="12"/>{tile_inner}', "Tus Impuestos RD")

# Horizontal: símbolo (ancho útil 144, desde x=56) + 32 px + nombre (mayúscula de 92 px centrada).
def horizontal(color_mark, color_text, fname):
    sym = mark(color_mark, "translate(-56 0)")  # el símbolo empieza en x=0
    x = 144 + 40
    d, w = text_path("TUS IMPUESTOS RD", x, 128 + 46, 92, tracking=0.02)
    W = int(math.ceil(x + w + 4))
    write(fname, W, 256, sym + f'<path fill="{color_text}" d="{d}"/>', "Tus Impuestos RD")
    return W
horizontal(INK, INK, "horizontal.svg")
horizontal(RED, INK, "horizontal-color.svg")
horizontal(WHITE, WHITE, "horizontal-blanco.svg")

# Apilado: símbolo centrado arriba; «TUS IMPUESTOS» y «RD» centrados debajo.
d1, w1 = text_path("TUS IMPUESTOS", 0, 0, 92, tracking=0.02)
W = int(math.ceil(w1 + 8))
x1 = (W - w1) / 2
d1, _ = text_path("TUS IMPUESTOS", x1, 256 + 40 + 92, 92, tracking=0.02)
d2, w2 = text_path("RD", 0, 0, 92, tracking=0.02)
d2, _ = text_path("RD", (W - w2) / 2, 256 + 40 + 92 + 24 + 92, 92, tracking=0.02)
H = 256 + 40 + 92 + 24 + 92 + 4
write("apilado.svg", W, H, mark(INK, f"translate({f(W / 2 - 128)} 0)") + f'<path fill="{INK}" d="{d1}{d2}"/>', "Tus Impuestos RD")

# Constantes para la web (mismos trazos que los masters).
open("/dev/null", "w").write(json.dumps({"mark": MARK}))
print("ok")
