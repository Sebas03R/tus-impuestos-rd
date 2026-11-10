"""Modelos Pydantic de las respuestas de la API DGCP (verificadas el 2026-11-09).

Se toleran campos nuevos (extra="allow") y se registran como desviación de esquema.
Los campos clave son obligatorios: si faltan, el registro se cuenta como inválido.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from tirds.transform import parse as p

Text = Annotated[str | None, BeforeValidator(p.clean_text)]
ReqText = Annotated[str, BeforeValidator(p.clean_text)]
Dec = Annotated[Decimal | None, BeforeValidator(p.to_amount)]
Int = Annotated[int | None, BeforeValidator(p.to_int)]
ReqInt = Annotated[int, BeforeValidator(p.to_int)]
Bool = Annotated[bool | None, BeforeValidator(p.to_bool)]
DT = Annotated[datetime | None, BeforeValidator(p.to_datetime)]
Cur = Annotated[str | None, BeforeValidator(p.currency_code)]


class DgcpModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    def unknown_fields(self) -> set[str]:
        return set(self.model_extra or {})


class PurchasingUnit(DgcpModel):
    codigo_unidad_compra: ReqInt
    unidad_compra: ReqText
    acronimo: Text = None
    fecha_registro: DT = None
    tipo: Text = None
    estado: Text = None
    codigo_capitulo: Text = None
    # Se reciben pero NO se guardan (contactos): direccion, telefono, correo...
    direccion: Any = None
    telefono: Any = None
    correo: Any = None
    correo_notificaciones: Any = None
    implementada: Any = None


class Process(DgcpModel):
    codigo_proceso: ReqText
    codigo_unidad_compra: Int = None
    unidad_compra: Text = None
    modalidad: Text = None
    tipo_excepcion: Text = None
    titulo: Text = None
    descripcion: Text = None
    estado_proceso: Text = None
    divisa: Cur = None
    monto_estimado: Dec = None
    fecha_publicacion: DT = None
    fecha_enmienda: DT = None
    fecha_fin_recepcion_ofertas: DT = None
    fecha_apertura_ofertas: DT = None
    fecha_estimada_adjudicacion: DT = None
    fecha_suscripcion: DT = None
    fecha_habilitacion_oferente: DT = None
    dirigido_mipymes: Bool = None
    dirigido_mipymes_mujeres: Bool = None
    proceso_lotificado: Bool = None
    es_snip: Bool = None
    codigo_snip: Text = None
    numero_proveedores_notificados: Int = None
    area_requiriente: Text = None
    url: Text = None
    adquisicion_planeada: Bool = None
    justificacion_no_pacc: Text = None
    objeto_proceso: Text = None
    subobjeto_proceso: Text = None
    decreto_presidencial: Any = None
    resolucion_maxima_autoridad: Any = None
    organismo_financiero_externo: Any = None
    marco_decreto_3122: Any = None
    compra_verde: Any = None
    compra_conjunta: Any = None
    duracion_contrato: Text = None


class Contract(DgcpModel):
    codigo_contrato: ReqText
    codigo_proceso: Text = None
    estado_contrato: Text = None
    estado_adjudicacion: Text = None
    fecha_adjudicacion: DT = None
    divisa: Cur = None
    valor_contratado: Dec = None
    metodo_pago: Text = None
    plazo_pago_factura: Text = None
    descripcion: Text = None
    fecha_creacion_contrato: DT = None
    url_contrato: Text = None
    unidad_compra: Text = None
    codigo_unidad_compra: Int = None
    rpe: Int = None
    razon_social: Text = None


class ContractItem(DgcpModel):
    codigo_contrato: ReqText
    codigo_proceso: Text = None
    familia: Text = None
    clase: Text = None
    subclase: Text = None
    cuenta_presupuestaria: Text = None
    descripcion_articulo: Text = None
    descripcion_usuario: Text = None
    unidad_medida: Text = None
    cantidad: Dec = None
    precio_unitario: Dec = None
    itbis: Dec = None
    otros_impuestos: Dec = None
    descuentos: Dec = None
    costo_total: Dec = None
    fecha_creacion_contrato: DT = None


class ProcessItem(DgcpModel):
    codigo_proceso: ReqText
    fecha_publicacion: DT = None
    familia_unspsc: Text = None
    clase_unspsc: Text = None
    subclase_unspsc: Text = None
    descripcion_articulo: Text = None
    cuenta_presupuestaria: Text = None
    descripcion_usuario: Text = None
    cantidad: Dec = None
    unidad_medida: Text = None
    precio_unitario_estimado: Dec = None
    precio_total_estimado: Dec = None


class Bid(DgcpModel):
    id_oferta: ReqText
    codigo_proceso: ReqText
    codigo_unidad_compra: Int = None
    unidad_compra: Text = None
    rpe: Int = None
    razon_social: Text = None
    nombre_oferta: Text = None
    valor_oferta: Dec = None
    estado_oferta: Text = None
    estado_evaluacion: Text = None
    tipo_oferta: Text = None
    fecha_creacion: DT = None
    fecha_entrega_oferta: DT = None
    fecha_evaluacion: DT = None


class SupplierRecord(DgcpModel):
    rpe: ReqInt
    razon_social: ReqText
    tipo_documento: Text = None
    numero_documento: Text = None
    estado: Text = None
    tipo_persona: Text = None
    forma_juridica: Text = None
    fecha_registro_rpe: DT = None
    es_mipyme: Bool = None
    provee: Text = None
    provincia: Text = None
    municipio: Text = None


class CatalogRecord(DgcpModel):
    segmento: Text = None
    descripcion_segmento: Text = None
    familia: Text = None
    descripcion_familia: Text = None
    clase: Text = None
    descripcion_clase: Text = None
    subclase: Text = None
    descripcion_subclase: Text = None


class Document(DgcpModel):
    codigo_proceso: ReqText
    nombre_documento: ReqText
    tipo_documento: Text = None
    fecha_carga_archivo: DT = None
    url_documento: ReqText = Field(...)
