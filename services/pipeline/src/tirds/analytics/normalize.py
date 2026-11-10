"""Normalización de artículos contratados para comparar precios de forma justa.

Principio: ante la duda, NO comparar. Dos artículos solo son comparables si coinciden
categoría UNSPSC (subclase), unidad normalizada, servicios incluidos, calificativos
técnicos (blindado, 4x4, inyectable…) y especificaciones numéricas (8 GB, 500 mg…).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from tirds.transform.parse import strip_accents

# ------------------------------------------------------------------ unidades

# unidad canónica, factor (cuántas unidades canónicas hay en 1 unidad de origen)
UNIT_MAP: dict[str, tuple[str, Decimal]] = {}


def _units(canonical: str, factor: str, *names: str) -> None:
    for n in names:
        UNIT_MAP[n] = (canonical, Decimal(factor))


_units("unidad", "1", "unidad", "unidades", "und", "ud", "u", "pieza", "piezas", "pza", "ea", "each")
_units("unidad", "12", "docena", "docenas")
_units("kg", "1", "kilogramo", "kilogramos", "kg", "kilo", "kilos")
_units("kg", "0.45359237", "libra", "libras", "lb", "lbs")
_units("kg", "45.359237", "quintal", "quintales")
_units("kg", "0.001", "gramo", "gramos", "g", "gr")
_units("litro", "1", "litro", "litros", "l", "lt", "lts")
_units("litro", "3.785411784", "galon", "galones", "gal")
_units("litro", "0.001", "mililitro", "mililitros", "ml")
_units("metro", "1", "metro", "metros", "m", "mt", "mts", "metro lineal")
_units("metro", "0.9144", "yarda", "yardas")
_units("metro", "0.3048", "pie", "pies")
_units("m2", "1", "metro cuadrado", "metros cuadrados", "m2")
_units("m3", "1", "metro cubico", "metros cubicos", "m3")
_units("resma", "1", "resma", "resmas")
_units("par", "1", "par", "pares")
_units("hora", "1", "hora", "horas")
_units("dia", "1", "dia", "dias")
_units("mes", "1", "mes", "meses")

# Unidades contenedoras: solo comparables si el tamaño del empaque es explícito e igual.
CONTAINER_UNITS = {
    "caja",
    "cajas",
    "paquete",
    "paquetes",
    "saco",
    "sacos",
    "bolsa",
    "bolsas",
    "fardo",
    "fardos",
    "kit",
    "kits",
    "juego",
    "juegos",
    "rollo",
    "rollos",
    "frasco",
    "frascos",
    "botella",
    "botellas",
    "lata",
    "latas",
    "cubeta",
    "cubetas",
    "tanque",
    "tanques",
    "tubo",
    "tubos",
    "estuche",
    "blister",
    "set",
    "bulto",
    "bultos",
    "envase",
    "envases",
    "pote",
    "potes",
    "sobre",
    "sobres",
    "galonera",
}
# Unidades no comparables por precio unitario.
NON_UNIT = {"servicio", "servicios", "global", "lote", "lotes", "evento", "eventos", "proyecto", "obra", "partida"}

# ------------------------------------------------------------------ texto

STOPWORDS = {
    "de",
    "la",
    "el",
    "los",
    "las",
    "y",
    "o",
    "para",
    "con",
    "sin",
    "en",
    "por",
    "del",
    "al",
    "a",
    "un",
    "una",
    "unos",
    "unas",
    "su",
    "sus",
    "que",
    "segun",
    "tipo",
    "marca",
    "modelo",
    "color",
    "adquisicion",
    "compra",
    "suministro",
    "adquirir",
    "otros",
    "otro",
    "incluye",
    "incluir",
    "debe",
    "deben",
    "ser",
    "como",
    "minimo",
    "maximo",
    "aprox",
    "aproximadamente",
    "etc",
    "uso",
    "institucional",
    "ministerio",
    "direccion",
}

SERVICE_FLAGS = {
    "instalacion": re.compile(r"\binstal(a|ac|aci)"),
    "transporte": re.compile(r"\b(transporte|flete|traslado|entrega a domicilio|acarreo)"),
    "garantia_extendida": re.compile(r"garantia\s+(extendida|de\s+\d+\s*(anos?|meses))"),
    "licencia": re.compile(r"\blicenci"),
    "mantenimiento": re.compile(r"\bmantenimiento"),
    "capacitacion": re.compile(r"\b(capacitaci|entrenamiento)"),
    "configuracion": re.compile(r"\bconfiguraci"),
    "montaje": re.compile(r"\b(montaje|ensamblaje)"),
    "accesorios": re.compile(r"(\+|\bcon (base|soporte|accesorios|estuche|cable|bulto|mochila|bateria|cargador)\b)"),
}

QUALIFIERS = {
    "blindado": re.compile(r"\bblindad"),
    "4x4": re.compile(r"\b4\s*x\s*4\b"),
    "4x2": re.compile(r"\b4\s*x\s*2\b"),
    "doble_cabina": re.compile(r"doble\s+cabina"),
    "electrico": re.compile(r"\belectric[oa]s?\b(?!\s+(de|para)\s)"),
    "hibrido": re.compile(r"\bhibrid"),
    "diesel": re.compile(r"\bdiesel"),
    "gasolina": re.compile(r"\bgasolina"),
    "inyectable": re.compile(r"(\b(inyectable|ampolla|vial|ampula|inyec|iny|inj|amp)\b|p/iny)"),
    "inverter": re.compile(r"\binverte"),
    "tableta": re.compile(r"\b(tableta|comprimido|tab)\b"),
    "capsula": re.compile(r"\bcapsula"),
    "jarabe": re.compile(r"\b(jarabe|suspension|solucion oral)"),
    "crema": re.compile(r"\b(crema|unguento|gel topico)"),
    "servidor": re.compile(r"\bservidor"),
    "workstation": re.compile(r"\b(workstation|estacion de trabajo)"),
    "laptop": re.compile(r"\b(laptop|portatil|notebook)"),
    "todo_en_uno": re.compile(r"\b(todo en uno|all in one|aio)\b"),
    "usado": re.compile(r"\b(usad[oa]|reacondicionad|remanufacturad)"),
    "generico": re.compile(r"\bgeneric"),
    "original": re.compile(r"\boriginal(es)?\b"),
}

# Especificaciones numéricas: valor + unidad → dimensión canónica
_SPEC = re.compile(
    r"(?<![\w.])(\d{1,6}(?:[.,]\d{1,3})?)\s*"
    r"(tb|gb|mb|ghz|mhz|mg|mcg|g|gr|kg|ml|cc|l|lt|lts|litros?|oz|lb|libras?|pulgadas?|plg|\"|w|watts?|vatios|v|voltios|"
    r"kva|kw|hp|btu|mm|cm|mts?|metros?|hojas|unidades|und|tabletas|capsulas|pies|ton|toneladas|cilindros?|puertas?|"
    r"pasajeros|asientos|%)(?![\w])"
)
_PACK = re.compile(
    r"\b(?:caja|paquete|bolsa|saco|fardo|frasco|estuche|set|kit|juego)\s*(?:de|x|con)?\s*(\d{1,5})\b|\bx\s*(\d{1,5})\s*(?:unidades|und|u|tabletas|capsulas|hojas)?\b"
)
_CPU = re.compile(r"\b(core\s*i[3579]|ryzen\s*[3579]|celeron|pentium|xeon|core\s*ultra\s*[579]|m[1-4]\b)")
_YEAR = re.compile(r"\b(20[12]\d)\b")

DIMENSION = {
    "tb": ("almacenamiento_gb", Decimal(1000)),
    "gb": ("almacenamiento_gb", Decimal(1)),
    "mb": ("almacenamiento_gb", Decimal("0.001")),
    "ghz": ("frecuencia_ghz", Decimal(1)),
    "mhz": ("frecuencia_ghz", Decimal("0.001")),
    "mg": ("masa_mg", Decimal(1)),
    "mcg": ("masa_mg", Decimal("0.001")),
    "g": ("masa_mg", Decimal(1000)),
    "gr": ("masa_mg", Decimal(1000)),
    "kg": ("masa_mg", Decimal(1000000)),
    "lb": ("masa_mg", Decimal("453592.37")),
    "libra": ("masa_mg", Decimal("453592.37")),
    "libras": ("masa_mg", Decimal("453592.37")),
    "oz": ("masa_mg", Decimal("28349.5")),
    "ml": ("volumen_ml", Decimal(1)),
    "cc": ("volumen_ml", Decimal(1)),
    "l": ("volumen_ml", Decimal(1000)),
    "lt": ("volumen_ml", Decimal(1000)),
    "lts": ("volumen_ml", Decimal(1000)),
    "litro": ("volumen_ml", Decimal(1000)),
    "litros": ("volumen_ml", Decimal(1000)),
    "pulgada": ("pulgadas", Decimal(1)),
    "pulgadas": ("pulgadas", Decimal(1)),
    "plg": ("pulgadas", Decimal(1)),
    '"': ("pulgadas", Decimal(1)),
    "w": ("potencia_w", Decimal(1)),
    "watt": ("potencia_w", Decimal(1)),
    "watts": ("potencia_w", Decimal(1)),
    "vatios": ("potencia_w", Decimal(1)),
    "kw": ("potencia_w", Decimal(1000)),
    "hp": ("potencia_hp", Decimal(1)),
    "v": ("voltaje_v", Decimal(1)),
    "voltios": ("voltaje_v", Decimal(1)),
    "kva": ("potencia_kva", Decimal(1)),
    "btu": ("capacidad_btu", Decimal(1)),
    "mm": ("longitud_mm", Decimal(1)),
    "cm": ("longitud_mm", Decimal(10)),
    "mt": ("longitud_mm", Decimal(1000)),
    "mts": ("longitud_mm", Decimal(1000)),
    "metro": ("longitud_mm", Decimal(1000)),
    "metros": ("longitud_mm", Decimal(1000)),
    "pies": ("longitud_mm", Decimal("304.8")),
    "hojas": ("conteo", Decimal(1)),
    "unidades": ("conteo", Decimal(1)),
    "und": ("conteo", Decimal(1)),
    "tabletas": ("conteo", Decimal(1)),
    "capsulas": ("conteo", Decimal(1)),
    "ton": ("toneladas", Decimal(1)),
    "toneladas": ("toneladas", Decimal(1)),
    "cilindro": ("cilindros", Decimal(1)),
    "cilindros": ("cilindros", Decimal(1)),
    "puerta": ("puertas", Decimal(1)),
    "puertas": ("puertas", Decimal(1)),
    "pasajeros": ("pasajeros", Decimal(1)),
    "asientos": ("pasajeros", Decimal(1)),
    "%": ("porcentaje", Decimal(1)),
}

# Códigos de modelo o norma (N95, B196, R410A, HP305): mezcla de letras y números.
_CODE = re.compile(r"\b(?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{3,10}\b")
# Palabras de envase que contradicen una unidad de peso/volumen/longitud.
_CONTAINER_WORDS = re.compile(
    r"\b(huacal|huacales|saco|sacos|caja|cajas|fardo|fardos|paquete|paquetes|bulto|bultos|"
    r"funda|fundas|cubeta|cubetas|galonera|racimo|racimos|mano|manos|docena)\b"
)
# Unidad de medida suelta en la descripción ("leche entera lb") sin número que la acompañe.
_BARE_MEASURE = re.compile(
    r"\b(lb|lbs|libra|libras|kg|kilo|kilos|kilogramo|litro|litros|lt|lts|galon|galones|onza|onzas|oz|pie|pies|yarda|yardas)\b"
)
# Palabras de conjunto que contradicen una unidad suelta ("juego de neumáticos" registrado por unidad).
_SET_WORDS = re.compile(
    r"\b(juego|juegos|set|kit|par de|pares|docena|caja|cajas|paquete|paquetes|fardo|fardos|bulto|bultos)\b"
)
# Categorías donde una "unidad" sin tamaño declarado no dice nada (pinturas, químicos, limpieza, alimentos, combustibles).
SIZE_REQUIRED_SEGMENTS = {"12", "15", "31", "47", "50"}
# Bienes durables: sin al menos una especificación numérica no se comparan.
DURABLE_SEGMENTS = {
    "20",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
    "27",
    "39",
    "40",
    "41",
    "42",
    "43",
    "45",
    "46",
    "48",
    "49",
    "52",
    "56",
    "60",
}

# Notación de empaque "4/1", "12x1", "pack de 6"
_PACK_NOTATION = re.compile(r"\b(\d{1,4})\s*/\s*1\b|\b(?:pack|paq|fardo|bulto)\s*(?:de|x)?\s*(\d{1,4})\b")

# Artículos cuyo precio unitario depende de un valor nominal o de un contenido heterogéneo.
NOMINAL_VALUE = re.compile(
    r"\b(ti(c)?kets?|tickes?|vale|vales|bono|bonos|cupon|cupones|certificado de regalo|tarjeta de (combustible|regalo)|"
    r"recarga|gift card|denominacion)\b"
)
HETEROGENEOUS = re.compile(
    r"\b(kit|kits|reactivo|reactivos|reagent|control|calibrador|panel|surtido|variado|varios|arreglo|arreglos|"
    r"lote de|conjunto de|combo|sublimad[ao]s?|bordad[ao]s?|serigrafiad[ao]s?|personalizad[ao]s?|con logo)\b"
)
# Consumibles cuyo precio depende del modelo exacto (tóner HP 105A vs 414X): sin código no se comparan.
MODEL_REQUIRED = re.compile(r"\b(toner|toners|cartucho|cartuchos|tinta|tintas|drum|fusor)\b")
# Familias de laboratorio/diagnóstico: alta heterogeneidad técnica.
HETEROGENEOUS_FAMILIES = {"4111", "4112", "4113", "4211", "4218"}

# Segmentos UNSPSC de servicios y obras: el precio unitario casi nunca es comparable.
SERVICE_SEGMENTS = {str(s) for s in range(70, 96)}


def normalize_text(*parts: str | None) -> str:
    text = " ".join(p for p in parts if p)
    text = strip_accents(text.lower())
    text = re.sub(r"[^a-z0-9%\".,x+ ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def comparison_text(text: str) -> str:
    tokens = [t for t in re.split(r"[ .,]+", text) if t and t not in STOPWORDS and len(t) > 1]
    return " ".join(tokens)


@dataclass
class UnitInfo:
    canonical: str | None
    factor: Decimal | None
    reason: str | None = None


def normalize_unit(unit: str | None, text: str) -> UnitInfo:
    raw = strip_accents((unit or "").lower()).strip()
    raw = re.sub(r"\s+", " ", raw)
    if not raw:
        return UnitInfo(None, None, "unidad_no_registrada")
    if raw in NON_UNIT:
        return UnitInfo(None, None, "unidad_no_comparable")
    if raw in UNIT_MAP:
        canon, factor = UNIT_MAP[raw]
        return UnitInfo(canon, factor)
    if raw in CONTAINER_UNITS:
        size = pack_size(text)
        if size is None:
            return UnitInfo(None, None, "empaque_sin_contenido_declarado")
        base = raw.rstrip("s") if raw.endswith("s") and raw[:-1] in CONTAINER_UNITS else raw
        return UnitInfo(f"{base}_{size}", Decimal(1))
    return UnitInfo(raw, Decimal(1))


def pack_size(text: str) -> int | None:
    m = _PACK.search(text)
    if not m:
        return None
    value = m.group(1) or m.group(2)
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if 1 < n <= 100000 else None


def spec_dimensions(text: str) -> dict[str, frozenset[str]]:
    dims: dict[str, set[str]] = {}
    for num, unit in _SPEC.findall(text):
        unit = unit.lower()
        if unit not in DIMENSION:
            unit = unit.rstrip("s") if unit.rstrip("s") in DIMENSION else unit
        if unit not in DIMENSION:
            continue
        dim, factor = DIMENSION[unit]
        try:
            value = Decimal(num.replace(",", ".")) * factor
        except ArithmeticError:
            continue
        dims.setdefault(dim, set()).add(_fmt(value))
    for cpu in _CPU.findall(text):
        dims.setdefault("procesador", set()).add(re.sub(r"\s+", "", cpu))
    codes = {c for c in _CODE.findall(text) if not _SPEC.fullmatch(c)}
    if codes:
        dims["codigo"] = codes
    pack = _PACK_NOTATION.search(text)
    size = int(pack.group(1) or pack.group(2)) if pack else pack_size(text)
    if size and size > 1:
        dims["empaque"] = {str(size)}
    years = {y for y in _YEAR.findall(text) if 2015 <= int(y) <= 2030}
    if years:
        dims["ano_modelo"] = years
    return {k: frozenset(v) for k, v in dims.items()}


def _fmt(value: Decimal) -> str:
    q = value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP).normalize()
    return format(q, "f")


def flags(text: str, patterns: dict[str, re.Pattern[str]]) -> frozenset[str]:
    return frozenset(name for name, rx in patterns.items() if rx.search(text))


# Dimensiones que deben coincidir SIEMPRE (si uno la declara y el otro no, no son comparables).
STRICT_DIMS = frozenset({"empaque", "codigo"})
# En medicamentos también la concentración y el volumen.
MEDICINE_STRICT_DIMS = frozenset({"empaque", "codigo", "masa_mg", "volumen_ml"})


def specs_compatible(
    a: dict[str, frozenset[str]],
    b: dict[str, frozenset[str]],
    max_unmatched: int = 1,
    strict: frozenset[str] = STRICT_DIMS,
) -> bool:
    """Compatibles si coinciden todas las dimensiones presentes en ambos, las dimensiones estrictas
    (empaque, concentración, volumen) están en ambos o en ninguno, y como mucho `max_unmatched`
    dimensiones no estrictas aparecen en solo uno de los dos."""
    shared = a.keys() & b.keys()
    if any(a[d] != b[d] for d in shared):
        return False
    only_one = a.keys() ^ b.keys()
    if only_one & strict:
        return False
    return len(only_one) <= max_unmatched


@dataclass
class NormalizedItem:
    comparable: bool
    exclusion_reason: str | None
    unit_norm: str | None
    quantity_norm: Decimal | None
    unit_price_pretax: Decimal | None  # en moneda original, por unidad normalizada
    tax_treatment: str
    service_flags: frozenset[str] = field(default_factory=frozenset)
    qualifiers: frozenset[str] = field(default_factory=frozenset)
    dims: dict[str, frozenset[str]] = field(default_factory=dict)
    text: str = ""

    @property
    def spec_tokens(self) -> list[str]:
        toks = [f"{k}={'|'.join(sorted(v))}" for k, v in sorted(self.dims.items())]
        return toks + [f"q:{q}" for q in sorted(self.qualifiers)]


def normalize_item(
    *,
    subclass: str | None,
    item_name: str | None,
    user_description: str | None,
    unit: str | None,
    quantity: Decimal | None,
    unit_price: Decimal | None,
    itbis: Decimal | None,
    other_taxes: Decimal | None,
    discounts: Decimal | None,
    total: Decimal | None = None,
) -> NormalizedItem:
    text = normalize_text(item_name, user_description)
    taxes = (itbis or Decimal(0)) + (other_taxes or Decimal(0))
    treatment = "separado" if taxes > 0 else "sin_impuesto_declarado"
    base = NormalizedItem(False, None, None, None, None, treatment, text=text)

    def reject(reason: str) -> NormalizedItem:
        base.exclusion_reason = reason
        return base

    if not subclass or len(subclass) < 8:
        return reject("sin_subclase_unspsc")
    if subclass[:2] in SERVICE_SEGMENTS:
        return reject("servicio_u_obra")
    if NOMINAL_VALUE.search(text):
        return reject("valor_nominal_ticket_o_bono")
    if subclass[:4] in HETEROGENEOUS_FAMILIES or HETEROGENEOUS.search(text):
        return reject("contenido_heterogeneo_kit_o_reactivo")
    if len(comparison_text(normalize_text(user_description)).split()) < 2:
        return reject("descripcion_insuficiente")
    if subclass[:2] == "51" and "masa_mg" not in spec_dimensions(text):
        # Medicamentos: sin concentración declarada no hay forma de saber si son equivalentes.
        return reject("medicamento_sin_concentracion")
    if quantity is None or quantity <= 0:
        return reject("cantidad_invalida")
    if unit_price is None or unit_price <= 0:
        return reject("precio_invalido")
    if discounts is not None and discounts < 0:
        return reject("descuento_invalido")
    gross = quantity * unit_price
    net_total = gross - (discounts or Decimal(0))
    if total is not None:
        # Registro contradictorio: el total publicado no cuadra con cantidad, precio, impuestos y descuentos.
        expected = net_total + taxes
        if abs(total - expected) > max(Decimal(1), expected * Decimal("0.01")):
            return reject("registro_inconsistente")
    if net_total <= 0:
        return reject("total_neto_invalido")
    uinfo = normalize_unit(unit, text)
    if uinfo.canonical is None or uinfo.factor is None:
        return reject(uinfo.reason or "unidad_desconocida")
    if uinfo.canonical in {"kg", "litro", "metro", "m2", "m3"} and _CONTAINER_WORDS.search(text):
        # p. ej. "huacal de tomates" registrado por kilogramo: la unidad no es confiable
        return reject("unidad_contradictoria")
    if uinfo.canonical == "unidad" and _BARE_MEASURE.search(text) and not _SPEC.search(text):
        # p. ej. "Leche entera lb" registrada por unidad: no se sabe cuánto contiene cada unidad
        return reject("unidad_contradictoria")
    if (
        uinfo.canonical == "unidad"
        and _SET_WORDS.search(text)
        and pack_size(text) is None
        and not _PACK_NOTATION.search(text)
    ):
        # p. ej. "juego de neumáticos" registrado por unidad, sin decir cuántas piezas trae
        return reject("unidad_contradictoria")
    dims_now = spec_dimensions(text)
    if subclass[:2] in DURABLE_SEGMENTS and not dims_now:
        return reject("especificacion_insuficiente")
    if MODEL_REQUIRED.search(text) and "codigo" not in dims_now:
        return reject("especificacion_insuficiente")
    if uinfo.canonical == "unidad" and subclass[:2] in SIZE_REQUIRED_SEGMENTS and not dims_now:
        # p. ej. "pinturas de esmalte" por unidad: ¿galón o cubeta?
        return reject("especificacion_insuficiente")
    if uinfo.canonical in {"kg", "litro"} and ("masa_mg" in dims_now or "volumen_ml" in dims_now):
        one = {"kg": ("masa_mg", "1000000"), "litro": ("volumen_ml", "1000")}[uinfo.canonical]
        if dims_now.get(one[0]) != frozenset({one[1]}):
            # p. ej. "azúcar crema 5 lb" registrada por kilogramo: ¿precio por kg o por funda?
            return reject("unidad_contradictoria")
    qty_norm = quantity * uinfo.factor
    price = net_total / qty_norm
    return NormalizedItem(
        comparable=True,
        exclusion_reason=None,
        unit_norm=uinfo.canonical,
        quantity_norm=qty_norm,
        unit_price_pretax=price,
        tax_treatment=treatment,
        service_flags=flags(text, SERVICE_FLAGS),
        qualifiers=flags(text, QUALIFIERS),
        dims=dims_now,
        # La similitud se mide SOLO con la descripción del usuario: el nombre de catálogo es igual para
        # toda la subclase (p. ej. "Verduras frescas") e inflaría la similitud entre ajo y papas.
        text=comparison_text(normalize_text(user_description or item_name)),
    )
