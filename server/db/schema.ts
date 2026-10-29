import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Config } from "@/lib/params";
import type { CheckKyc, Representante, ResultadoKyc } from "@/lib/kyc";
import type { Evaluacion } from "@/lib/scoring";
import type { ComercioDisglobal } from "../disglobal";

/** Usuarios del backoffice. */
export const usuarios = pgTable("usuarios", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  hash: text("hash").notNull(),
  roles: jsonb("roles").$type<("admin" | "riesgo" | "operaciones")[]>().notNull(),
  activo: boolean("activo").notNull().default(true),
  creado: timestamp("creado", { withTimezone: true }).notNull().defaultNow(),
});

/** Sesiones del backoffice (`admin`, usuarioId = usuario) y de los POS (`pos`, usuarioId = comercio). Solo se guarda el hash del token. */
export const sesiones = pgTable("sesiones", {
  tokenHash: text("token_hash").primaryKey(),
  tipo: text("tipo", { enum: ["admin", "pos"] }).notNull(),
  usuarioId: text("usuario_id").notNull(),
  serial: text("serial"), // terminal desde la que se abrió (POS)
  expira: timestamp("expira", { withTimezone: true }).notNull(),
});

/** Comercio: ficha traída de Disglobal por RIF y confirmada por el cliente en el POS. */
export const comercios = pgTable("comercios", {
  id: text("id").primaryKey(),
  rif: text("rif").notNull().unique(),
  razonSocial: text("razon_social").notNull(),
  nombreComercial: text("nombre_comercial").notNull(),
  telefono: text("telefono").notNull(),
  email: text("email").notNull(),
  disglobal: jsonb("disglobal").$type<ComercioDisglobal>().notNull(), // ficha tal como llegó (auditoría)
  correcciones: jsonb("correcciones").$type<Record<string, string>>(), // lo que el cliente cambió al confirmar
  confirmadoEn: timestamp("confirmado_en", { withTimezone: true }),
  estado: text("estado", { enum: ["activo", "bloqueado"] }).notNull().default("activo"),
  creado: timestamp("creado", { withTimezone: true }).notNull().defaultNow(),
});

/** Todo RIF consultado desde un POS (aunque no termine el registro): la primera etapa del embudo. */
export const prospectos = pgTable("prospectos", {
  rif: text("rif").primaryKey(),
  nombre: text("nombre").notNull(),
  actividad: text("actividad").notNull(),
  ciudad: text("ciudad").notNull(),
  estado: text("estado").notNull(), // estado de Venezuela (geografía)
  serial: text("serial"),
  consultas: integer("consultas").notNull().default(1),
  primera: timestamp("primera", { withTimezone: true }).notNull().defaultNow(),
  ultima: timestamp("ultima", { withTimezone: true }).notNull().defaultNow(),
  comercioId: text("comercio_id"), // cuando confirma los datos
});

/** Uso de la app del POS por comercio y día (cada llamada con sesión cuenta como una interacción). */
export const usos = pgTable("usos", {
  comercioId: text("comercio_id").notNull(),
  fecha: date("fecha").notNull(),
  interacciones: integer("interacciones").notNull().default(1),
}, (t) => ({ pk: uniqueIndex("uso_dia").on(t.comercioId, t.fecha) }));

/** Terminales Disglobal vinculadas a un comercio de Investa. */
export const terminales = pgTable("terminales", {
  serial: text("serial").primaryKey(),
  comercioId: text("comercio_id").notNull(),
  modelo: text("modelo").notNull(),
  verificada: boolean("verificada").notNull(), // el serial figura en Disglobal para ese RIF
  ultimoUso: timestamp("ultimo_uso", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Verificación de identidad del representante legal (KYC), una fila por intento.
 * La cédula esperada es la del representante en Disglobal al momento del intento: si Disglobal la cambia, se pide un KYC nuevo.
 */
export const kyc = pgTable("kyc", {
  id: text("id").primaryKey(),
  comercioId: text("comercio_id").notNull(),
  proveedor: text("proveedor", { enum: ["didit", "simulado"] }).notNull(),
  sesionProveedor: text("sesion_proveedor"), // session_id de Didit
  urlProveedor: text("url_proveedor"), // donde la persona hace la verificación
  estado: text("estado", { enum: ["pendiente", "aprobado", "en_revision", "rechazado"] }).notNull(),
  representante: jsonb("representante").$type<Representante>().notNull(),
  resultado: jsonb("resultado").$type<ResultadoKyc>(),
  checks: jsonb("checks").$type<CheckKyc[]>(),
  motivo: text("motivo"),
  decididoPor: text("decidido_por"), // "Motor" o el usuario del backoffice que revisó
  cuentaIntento: boolean("cuenta_intento").notNull().default(true), // false cuando el backoffice habilita otro intento
  creado: timestamp("creado", { withTimezone: true }).notNull().defaultNow(),
  decidido: timestamp("decidido", { withTimezone: true }),
}, (t) => ({ porComercio: index("kyc_comercio").on(t.comercioId), porSesion: uniqueIndex("kyc_sesion").on(t.sesionProveedor) }));

/** Cada scoring que se corrió, con la versión de parámetros usada. */
export const evaluaciones = pgTable("evaluaciones", {
  id: serial("id").primaryKey(),
  comercioId: text("comercio_id").notNull(),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  paramsVersion: integer("params_version").notNull(),
  score: integer("score").notNull(),
  montoMaxUsd: doublePrecision("monto_max_usd").notNull(),
  detalle: jsonb("detalle").$type<Evaluacion>().notNull(),
  vence: date("vence").notNull(),
}, (t) => ({ porComercio: index("eval_comercio").on(t.comercioId) }));

export const adelantos = pgTable("adelantos", {
  id: text("id").primaryKey(),
  comercioId: text("comercio_id").notNull(),
  evaluacionId: integer("evaluacion_id").notNull(),
  paramsVersion: integer("params_version").notNull(),
  estado: text("estado", { enum: ["en_revision", "aprobado", "rechazado", "desembolsado", "pagado", "vencido", "cancelado"] }).notNull(),
  montoUsd: doublePrecision("monto_usd").notNull(),
  plazoDias: integer("plazo_dias").notNull(),
  cargoUsd: doublePrecision("cargo_usd").notNull(),
  comisionUsd: doublePrecision("comision_usd").notNull(),
  totalUsd: doublePrecision("total_usd").notNull(),
  retencionPct: doublePrecision("retencion_pct").notNull(),
  saldoUsd: doublePrecision("saldo_usd").notNull(),
  // Desembolso en Bs a la tasa BCV del día
  tasaDesembolso: doublePrecision("tasa_desembolso"),
  montoBs: doublePrecision("monto_bs"),
  referenciaDesembolso: text("referencia_desembolso"),
  desembolsadoEn: date("desembolsado_en"),
  venceEn: date("vence_en"),
  ultimoCierre: date("ultimo_cierre"), // último día cuyas ventas ya se procesaron
  aprobadoPor: text("aprobado_por"),
  motivo: text("motivo"),
  aceptadoEn: timestamp("aceptado_en", { withTimezone: true }).notNull().defaultNow(), // el comercio aceptó las condiciones en el POS
  serial: text("serial"),
  creado: timestamp("creado", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ porComercio: index("adel_comercio").on(t.comercioId) }));

/** Abonos diarios: retención sobre las ventas del POS en Bs, convertida a la tasa BCV de ese día. */
export const pagos = pgTable("pagos", {
  id: serial("id").primaryKey(),
  adelantoId: text("adelanto_id").notNull(),
  fecha: date("fecha").notNull(),
  ventasBs: doublePrecision("ventas_bs").notNull(),
  montoBs: doublePrecision("monto_bs").notNull(),
  tasaBcv: doublePrecision("tasa_bcv").notNull(),
  montoUsd: doublePrecision("monto_usd").notNull(),
  saldoUsd: doublePrecision("saldo_usd").notNull(),
  origen: text("origen", { enum: ["retencion", "manual"] }).notNull(),
  registradoPor: text("registrado_por"),
}, (t) => ({ unico: uniqueIndex("pago_dia").on(t.adelantoId, t.fecha, t.origen), porAdelanto: index("pago_adelanto").on(t.adelantoId) }));

export const tasasBcv = pgTable("tasas_bcv", {
  fecha: date("fecha").primaryKey(),
  tasa: doublePrecision("tasa").notNull(),
  fuente: text("fuente", { enum: ["api", "manual", "importada", "simulada"] }).notNull(),
  registradoPor: text("registrado_por"),
});

/** Versiones de parámetros: inmutables una vez aprobadas; quien propone no aprueba. */
export const parametros = pgTable("parametros", {
  id: serial("id").primaryKey(),
  valores: jsonb("valores").$type<Config>().notNull(),
  estado: text("estado", { enum: ["pendiente", "aprobada", "rechazada"] }).notNull(),
  nota: text("nota").notNull(),
  propuestoPor: text("propuesto_por").notNull(),
  propuestoPorId: text("propuesto_por_id").notNull(),
  propuestoEn: timestamp("propuesto_en", { withTimezone: true }).notNull().defaultNow(),
  aprobadoPor: text("aprobado_por"),
  aprobadoEn: timestamp("aprobado_en", { withTimezone: true }),
  vigenteDesde: date("vigente_desde").notNull(),
  motivoRechazo: text("motivo_rechazo"),
});

export const bitacora = pgTable("bitacora", {
  id: serial("id").primaryKey(),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  accion: text("accion").notNull(),
  detalle: text("detalle").notNull(),
  comercioId: text("comercio_id"),
});

/** Lo que propone cada agente de IA (Claude, Jev) sobre una solicitud o un KYC; la decisión final queda en el backoffice salvo que se active la aplicación automática. */
export const recomendaciones = pgTable("recomendaciones", {
  id: serial("id").primaryKey(),
  tipo: text("tipo", { enum: ["solicitud", "kyc"] }).notNull(),
  objetivoId: text("objetivo_id").notNull(), // id del adelanto o del KYC
  comercioId: text("comercio_id").notNull(),
  decision: text("decision", { enum: ["aprobar", "rechazar", "revisar"] }).notNull(),
  confianza: doublePrecision("confianza").notNull(), // 0–1
  resumen: text("resumen").notNull(),
  detalle: jsonb("detalle").$type<{ claude?: unknown; jev?: unknown; riesgos?: string[]; mitigantes?: string[] }>().notNull(),
  motores: jsonb("motores").$type<{ claude: "api" | "simulado" | "error"; jev: "api" | "simulado" | "error" }>().notNull(),
  aplicada: boolean("aplicada").notNull().default(false),
  creado: timestamp("creado", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ porObjetivo: index("rec_objetivo").on(t.tipo, t.objetivoId) }));

/** Avisos al comercio en la app del POS: cobro voluntario (día sin ventas) y seguimiento del registro. */
export const notificaciones = pgTable("notificaciones", {
  id: text("id").primaryKey(),
  comercioId: text("comercio_id").notNull(),
  adelantoId: text("adelanto_id"),
  tipo: text("tipo", { enum: ["cobro_voluntario", "seguimiento"] }).notNull(),
  clave: text("clave").notNull(), // evita duplicados: p. ej. cobro:<adelanto>:<fecha>
  titulo: text("titulo").notNull(),
  mensaje: text("mensaje").notNull(),
  montoUsd: doublePrecision("monto_usd"),
  montoBs: doublePrecision("monto_bs"),
  estado: text("estado", { enum: ["pendiente", "leida", "reportada", "conciliada", "descartada"] }).notNull().default("pendiente"),
  reporte: jsonb("reporte").$type<{ referencia: string; montoBs: number; fecha: string }>(),
  redactadoPor: text("redactado_por").notNull(), // "Claude" o "Plantilla"
  creado: timestamp("creado", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ unica: uniqueIndex("notif_clave").on(t.clave), porComercio: index("notif_comercio").on(t.comercioId) }));

/** Resumen diario de cartera escrito por el agente. */
export const informes = pgTable("informes", {
  id: serial("id").primaryKey(),
  fecha: date("fecha").notNull().unique(),
  texto: text("texto").notNull(),
  datos: jsonb("datos").$type<Record<string, unknown>>().notNull(),
  motor: text("motor").notNull(), // "Claude" o "Plantilla"
  hex: text("hex"), // resultado de disparar el proyecto de Hex
  creado: timestamp("creado", { withTimezone: true }).notNull().defaultNow(),
});
