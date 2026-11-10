"""Construye los tres conceptos (símbolo + lockup horizontal) en negro."""
import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

from pathlib import Path
F = TTFont(Path(__file__).resolve().parents[3] / "apps/web/assets/BigShoulders-Black.ttf")
GS = F.getGlyphSet(); CM = F.getBestCmap(); HM = F["hmtx"]; CAP = F["OS/2"].sCapHeight

def text_path(text, x, baseline, cap_px, tracking=0.0):
    s = cap_px / CAP
    pen = SVGPathPen(GS); cx = x
    for ch in text:
        g = CM[ord(ch)]
        if ch != " ":
            GS[g].draw(TransformPen(pen, (s, 0, 0, -s, cx, baseline)))
        cx += HM[g][0] * s + tracking * cap_px
    return pen.getCommands(), cx - x - tracking * cap_px

def glyph_path(ch, cx, top, height):
    g = CM[ord(ch)]
    from fontTools.pens.boundsPen import BoundsPen
    bp = BoundsPen(GS); GS[g].draw(bp); x0, y0, x1, y1 = bp.bounds
    s = height / (y1 - y0)
    pen = SVGPathPen(GS)
    GS[g].draw(TransformPen(pen, (s, 0, 0, -s, cx - (x0 + x1) / 2 * s, top + y1 * s)))
    return pen.getCommands()

def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy - r * math.sin(a)

def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")

def annulus(cx, cy, r_out, r_in, a0, a1):
    """Segmento de anillo de a0 a a1 grados (a0 > a1, sentido horario en pantalla)."""
    x0, y0 = pt(cx, cy, r_out, a0); x1, y1 = pt(cx, cy, r_out, a1)
    x2, y2 = pt(cx, cy, r_in, a1); x3, y3 = pt(cx, cy, r_in, a0)
    large = 1 if (a0 - a1) > 180 else 0
    return (f"M{f(x0)} {f(y0)}A{r_out} {r_out} 0 {large} 1 {f(x1)} {f(y1)}"
            f"L{f(x2)} {f(y2)}A{r_in} {r_in} 0 {large} 0 {f(x3)} {f(y3)}Z")

def circle(cx, cy, r, ccw=False):
    s = 0 if ccw else 1
    return f"M{f(cx - r)} {f(cy)}A{r} {r} 0 1 {s} {f(cx + r)} {f(cy)}A{r} {r} 0 1 {s} {f(cx - r)} {f(cy)}Z"

def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
            f'<title>{title}</title>{body}</svg>\n')

# ── A · Sobreprecímetro ─────────────────────────────────────────────
# Medidor de media luna con pivote en (128,170). Tramo "normal" delgado (180°→60°, banda 22 px);
# tramo inflado grueso (60°→0°, banda 50 px): el exceso engorda. Aguja fija a 30°, en el tramo grueso.
# El pivote es un ojal de etiqueta de precio (disco con hueco).
CX, CY, RO = 128, 170, 110
a_thin = annulus(CX, CY, RO, RO - 22, 180, 64)
a_fat = annulus(CX, CY, RO, RO - 50, 56, 0)
ang = 30; tip = pt(CX, CY, 76, ang)
# Base de la aguja: dos puntos a ±90° de su dirección, a 12 px del pivote (fuera del ojal de r=10).
b1 = pt(CX, CY, 12, ang + 90); b2 = pt(CX, CY, 12, ang - 90)
needle = f"M{f(b1[0])} {f(b1[1])}L{f(tip[0])} {f(tip[1])}L{f(b2[0])} {f(b2[1])}Z"
hub = circle(CX, CY, 26) + circle(CX, CY, 10, ccw=True)
# Dos trazados: arcos y pivote con ojal (evenodd) y la aguja aparte (sin restar del pivote).
A_sym = (f'<path fill="#111" fill-rule="evenodd" d="{a_thin}{a_fat}{hub}"/>'
         f'<path fill="#111" d="{needle}"/>')

# ── B · Pancarta ─────────────────────────────────────────────────────
# Etiqueta de precio vertical (esquinas superiores achaflanadas, ojal) clavada en un palo,
# inclinada -15° como una pancarta en alto.
tag_b = "M94 26H162L198 62V164H58V62Z"
eye_b = circle(128, 62, 14, ccw=True)
stick_b = "M118 164H138V240H118Z"
B_sym = (f'<g transform="rotate(-15 128 133)"><path fill="#111" fill-rule="evenodd" d="{tag_b}{eye_b}"/>'
         f'<path fill="#111" d="{stick_b}"/></g>')

# ── C · La etiqueta que pregunta ─────────────────────────────────────
# Etiqueta vertical con el signo «¿» calado; el punto del signo hace de ojal.
tag_c = "M100 14H156L200 58V242H56V58Z"
q = glyph_path("¿", 128, 46, 166)
C_sym = f'<path fill="#111" fill-rule="evenodd" d="{tag_c}{q}"/>'

def lockup(sym, name, sym_w=256):
    wd, ww = text_path("TUS IMPUESTOS RD", 0, 0, 92, tracking=0.02)
    gap = 40
    x = sym_w + gap
    wd, ww = text_path("TUS IMPUESTOS RD", x, 128 + 46, 92, tracking=0.02)
    W = int(math.ceil(x + ww + 8))
    return svg(W, 256, sym + f'<path fill="#111" d="{wd}"/>', name)

for key, sym, title in [("a", A_sym, "Sobreprecímetro"), ("b", B_sym, "Pancarta"), ("c", C_sym, "La etiqueta que pregunta")]:
    open(f"{key}-symbol-v2.svg", "w").write(svg(256, 256, sym, title))
    open(f"{key}-lockup-v2.svg", "w").write(lockup(sym, title))
print("ok")
