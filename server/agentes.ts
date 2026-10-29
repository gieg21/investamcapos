import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { CUENTA_COBRO } from "@/lib/config";
import { addDays, isoDay } from "@/lib/format";
import { r2 } from "@/lib/mca";
import type { Admin } from "./auth";
import { nuevoId } from "./auth";
import { schema, type DB } from "./db";
import { DEMO, enSerie } from "./http";
import { pedirClaude, claudeConfigurado } from "./ia/claude";
import { correrProyectoHex, hexConfigurado } from "./ia/hex";
import { jevConfigurado, preguntarJev, type Pregunta, type Respuesta } from "./ia/jev";
import { revisarKyc } from "./kyc";
import { aprobar } from "./mca";
import { params, paramsVigente, registrar, tasaDelDia } from "./repo";
import { estadoSeguimiento } from "./seguimiento";

/**
 * Agentes de IA del backend.
 *
 * - Jev (TypeSafe) toma la decisión rápida y calibrada con probabilidades sobre datos estructurados.
 * - Claude analiza el caso, explica la recomendación con sus riesgos y redacta los mensajes al comercio.
 * - Hex refresca el tablero de cartera con el resumen diario.
 *
 * Por defecto los agentes solo recomiendan. Con `ia.aplicarAutomatico` aprueban solos cuando Claude y Jev
 * coinciden en aprobar con la confianza mínima y dentro del tope de monto. Un rechazo nunca se aplica solo:
 * lo decide una persona. Sin credenciales, cada motor se simula en demo con reglas sobre los mismos datos.
 */

/** Usuario con el que los agentes actúan en el backoffice (rol Riesgo: puede aprobar, no mueve dinero). */
const AGENTE: Admin = { id: "agente-ia", email: "agentes@grupoinvesta.com", nombre: "Agente IA", roles: ["riesgo"] };

type Decision = "aprobar" | "rechazar" | "revisar";
type Motor = "api" | "simulado" | "error";
const zMemo = z.object({
  recomendacion: z.enum(["aprobar", "rechazar", "revisar"]),
  confianza: z.number().describe("Entre 0 y 1"),
  resumen: z.string().describe("Dos o tres frases para el analista"),
  riesgos: z.array(z.string()),
  mitigantes: z.array(z.string()),
});
type Memo = z.infer<typeof zMemo>;
const zMensaje = z.object({ titulo: z.string().describe("Máximo 60 caracteres"), mensaje: z.string().describe("Máximo 320 caracteres") });

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Corre un motor y registra si respondió la API, se simuló o falló (un fallo no frena al otro motor). */
async function motor<T>(real: () => Promise<T | null>, simulado: () => T, configurado: boolean): Promise<{ r: T | null; m: Motor }> {
  try {
    const r = await real();
    if (r) return { r, m: "api" };
    if (!configurado && DEMO) return { r: simulado(), m: "simulado" };
    return { r: null, m: configurado ? "error" : "simulado" };
  } catch (e) {
    console.error("[agentes]", e);
    return { r: DEMO ? simulado() : null, m: "error" };
  }
}

/** Une las dos opiniones: si coinciden, esa decisión con la menor confianza; si no, a revisión humana. */
function combinar(jev: { decision: Decision; confianza: number } | null, claude: Memo | null): { decision: Decision; confianza: number } {
  if (jev && claude) {
    if (jev.decision === claude.recomendacion) return { decision: jev.decision, confianza: Math.min(jev.confianza, clamp01(claude.confianza)) };
    return { decision: "revisar", confianza: 0.5 };
  }
  const uno = jev ?? (claude && { decision: claude.recomendacion, confianza: clamp01(claude.confianza) });
  return uno ? { decision: uno.decision, confianza: uno.confianza * 0.8 } : { decision: "revisar", confianza: 0 };
}

function deChoice(r: Respuesta | undefined): { decision: Decision; confianza: number } | null {
  if (!r || r.type !== "choice" || !["aprobar", "rechazar", "revisar"].includes(r.choice)) return null;
  return { decision: r.choice as Decision, confianza: r.probabilities[r.choice] ?? r.confidence };
}

async function guardar(db: DB, x: { tipo: "solicitud" | "kyc"; objetivoId: string; comercioId: string; decision: Decision; confianza: number; resumen: string; detalle: Record<string, unknown>; motores: { claude: Motor; jev: Motor } }) {
  const [r] = await db.insert(schema.recomendaciones).values({ ...x, confianza: r2(x.confianza) }).returning();
  return r;
}

/* ---------- 1. Análisis de solicitudes ---------- */

const PREGUNTAS_SOLICITUD: Record<string, Pregunta> = {
  recomendacion: {
    type: "choice",
    instructions: "Dada la solicitud de adelanto, el flujo de ventas del POS de los últimos meses y cómo pagó el último adelanto, ¿qué debe hacer el analista?",
    criteria: {
      aprobar: "Las ventas y el historial de pagos sostienen con holgura el monto y la retención pedidos",
      rechazar: "Las ventas o el historial de pagos no sostienen el monto; alto riesgo de que no pague en el plazo",
      revisar: "Señales mixtas o datos insuficientes; necesita revisión humana",
    },
  },
  paga_en_plazo: { type: "noul", instructions: "¿El comercio pagará el total dentro del plazo con la retención diaria pactada?" },
  riesgo: {
    type: "score",
    instructions: "Riesgo de impago de este adelanto",
    criteria: ["Ventas estables y altas, buen historial: casi sin riesgo", "Algún punto débil menor", "Varias señales débiles", "Ventas caídas o irregulares, o pagos lentos", "Ventas insuficientes o mal historial: impago probable"],
  },
};

export async function analizarSolicitud(db: DB, adelantoId: string) {
  const [a] = await db.select().from(schema.adelantos).where(eq(schema.adelantos.id, adelantoId));
  if (!a || a.estado !== "en_revision") return null;
  const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, a.comercioId));
  const [ev] = await db.select().from(schema.evaluaciones).where(eq(schema.evaluaciones.id, a.evaluacionId));
  const cfg = await params(db, a.paramsVersion);
  const previos = await db.select({ estado: schema.adelantos.estado, montoUsd: schema.adelantos.montoUsd, totalUsd: schema.adelantos.totalUsd, saldoUsd: schema.adelantos.saldoUsd })
    .from(schema.adelantos).where(and(eq(schema.adelantos.comercioId, c.id), inArray(schema.adelantos.estado, ["pagado", "desembolsado", "vencido"])));
  const d = ev.detalle;
  const estado = {
    solicitud: { montoUsd: a.montoUsd, plazoDias: a.plazoDias, totalUsd: a.totalUsd, retencionPct: a.retencionPct, retencionMaxPct: cfg.precio.retencionMaxPct, ofertaMaxUsd: ev.montoMaxUsd },
    comercio: { actividad: c.disglobal.actividad, ciudad: c.disglobal.ciudad, estatusDisglobal: c.disglobal.estatus, correccionesPedidas: c.correcciones ?? null },
    scoring: { score: ev.score, subscores: d.subscores, ventasMensualesUsd: r2(d.metricas.ventasMensualesUsd), mesesAnalizados: d.metricas.meses.map((m) => r2(m.ventasUsd)), variacionMensual: r2(d.metricas.cv), tendencia: r2(d.metricas.tendencia), diasConVentasPct: r2(d.metricas.diasActivosPct), rechazoPct: r2(d.metricas.rechazoPct), antiguedadMeses: d.metricas.antiguedadMeses, cortes: d.cortes },
    ultimoAdelanto: d.comportamiento ? { clase: d.comportamiento.clase, frecuenciaPago: r2(d.comportamiento.frecuencia), ritmo: r2(d.comportamiento.ritmo), diasAtraso: d.comportamiento.diasAtraso } : "primer adelanto",
    adelantosPrevios: previos,
  };

  // Simulaciones (demo sin credenciales): mismas señales que verían los modelos.
  const simJev = (): Record<string, Respuesta> => {
    const malo = ev.score < 60 || d.cortes.length > 0 || ["lento", "moroso"].includes(d.comportamiento?.clase ?? "");
    const holgura = a.retencionPct <= cfg.precio.retencionMaxPct * 0.8 && d.metricas.cv < 0.25;
    const choice: Decision = malo ? "rechazar" : ev.score >= 75 && holgura ? "aprobar" : "revisar";
    const p = clamp01(0.55 + Math.abs(ev.score - 65) / 70);
    return {
      recomendacion: { type: "choice", choice, probabilities: { aprobar: choice === "aprobar" ? p : (1 - p) / 2, rechazar: choice === "rechazar" ? p : (1 - p) / 2, revisar: choice === "revisar" ? p : (1 - p) / 2 }, confidence: p },
      paga_en_plazo: { type: "noul", noul: clamp01(ev.score / 100) },
      riesgo: { type: "score", score: r2(4 - ev.score / 25), probabilities: {}, confidence: p },
    };
  };
  const simClaude = (): Memo => {
    const j = simJev().recomendacion as Extract<Respuesta, { type: "choice" }>;
    const riesgos = [...d.cortes, ...(d.metricas.cv > 0.25 ? [`Ventas irregulares (variación ${Math.round(d.metricas.cv * 100)}%)`] : []), ...(d.metricas.tendencia < 0.9 ? ["Ventas en baja frente a los meses anteriores"] : []), ...(a.retencionPct > cfg.precio.retencionMaxPct * 0.8 ? [`Retención alta (${(a.retencionPct * 100).toFixed(1)}%)`] : [])];
    return {
      recomendacion: j.choice as Decision, confianza: j.confidence,
      resumen: `Score ${ev.score}, ventas de ~USD ${Math.round(d.metricas.ventasMensualesUsd)} al mes; pide USD ${a.montoUsd} a ${a.plazoDias} días con ${(a.retencionPct * 100).toFixed(1)}% de retención. ${d.comportamiento ? `Su último adelanto lo pagó de forma ${d.comportamiento.clase}.` : "Es su primer adelanto."}`,
      riesgos: riesgos.length ? riesgos : ["Sin riesgos relevantes en los datos"],
      mitigantes: ["La retención se cobra antes de que Disglobal liquide las ventas", ...(d.metricas.antiguedadMeses >= 12 ? [`${d.metricas.antiguedadMeses} meses con Disglobal`] : [])],
    };
  };

  const [jev, claude] = await Promise.all([
    motor(() => preguntarJev(estado, PREGUNTAS_SOLICITUD), simJev, jevConfigurado()),
    motor(() => pedirClaude("Analiza esta solicitud de adelanto y recomienda aprobar, rechazar o revisar. Usa solo los datos dados.", estado, zMemo), simClaude, claudeConfigurado()),
  ]);
  const fin = combinar(deChoice(jev.r?.recomendacion), claude.r);
  const rec = await guardar(db, {
    tipo: "solicitud", objetivoId: a.id, comercioId: c.id, ...fin,
    resumen: claude.r?.resumen ?? "Sin análisis de Claude.",
    detalle: { jev: jev.r, claude: claude.r, riesgos: claude.r?.riesgos, mitigantes: claude.r?.mitigantes },
    motores: { claude: claude.m, jev: jev.m },
  });
  await registrar(db, "Agente IA", "Recomendación de solicitud", `${c.nombreComercial}: ${fin.decision} (${Math.round(fin.confianza * 100)}%) · Jev ${jev.m}, Claude ${claude.m}`, c.id);

  const { valores: vig } = await paramsVigente(db);
  const motoresOk = (jev.m === "api" && claude.m === "api") || (DEMO && jev.m !== "error" && claude.m !== "error");
  if (vig.ia.aplicarAutomatico && motoresOk && fin.decision === "aprobar" && fin.confianza >= vig.ia.confianzaMin && a.montoUsd <= vig.ia.montoAutoMaxUsd) {
    await aprobar(db, AGENTE, a.id);
    await db.update(schema.recomendaciones).set({ aplicada: true }).where(eq(schema.recomendaciones.id, rec.id));
  }
  return rec;
}

/* ---------- 2. KYC dudosos ---------- */

const PREGUNTAS_KYC: Record<string, Pregunta> = {
  misma_persona: { type: "noul", instructions: "¿La persona verificada (documento y selfie) es el representante legal registrado en Disglobal? Considera cédula, nombre y coincidencia de rostro." },
  recomendacion: {
    type: "choice",
    instructions: "¿Qué hacer con esta verificación de identidad que quedó en revisión?",
    criteria: {
      aprobar: "Cédula idéntica a la del representante y las diferencias son de forma (orden del nombre, acentos, segundo nombre, selfie aceptable)",
      rechazar: "Hay indicios de que es otra persona o el documento no es válido",
      revisar: "No alcanza para decidir; un analista debe mirar las fotos en Didit",
    },
  },
};

export async function analizarKyc(db: DB, kycId: string) {
  const [k] = await db.select().from(schema.kyc).where(eq(schema.kyc.id, kycId));
  if (!k || k.estado !== "en_revision" || !k.resultado) return null;
  const { valores: cfg } = await paramsVigente(db);
  const estado = { representante: k.representante, documento: { nombre: k.resultado.nombre, cedula: k.resultado.documento, vence: k.resultado.vencimiento }, pruebaDeVida: k.resultado.vivo, coincidenciaRostroPct: k.resultado.coincidenciaRostro, minimoRostroPct: cfg.kyc.coincidenciaRostroMin, chequeos: k.checks };
  const cedulaOk = k.checks?.find((x) => x.id === "cedula")?.estado === "ok";
  const nombreOk = k.checks?.find((x) => x.id === "nombre")?.estado !== "fail";
  const rostro = k.resultado.coincidenciaRostro ?? 0;

  const simJev = (): Record<string, Respuesta> => {
    const choice: Decision = !cedulaOk ? "rechazar" : rostro >= cfg.kyc.coincidenciaRostroMin - 15 && nombreOk ? "aprobar" : "revisar";
    const p = choice === "revisar" ? 0.6 : 0.88;
    return {
      misma_persona: { type: "noul", noul: cedulaOk ? clamp01(rostro / 100 + 0.2) : 0.05 },
      recomendacion: { type: "choice", choice, probabilities: { aprobar: choice === "aprobar" ? p : (1 - p) / 2, rechazar: choice === "rechazar" ? p : (1 - p) / 2, revisar: choice === "revisar" ? p : (1 - p) / 2 }, confidence: p },
    };
  };
  const simClaude = (): Memo => {
    const j = (simJev().recomendacion as Extract<Respuesta, { type: "choice" }>);
    return {
      recomendacion: j.choice as Decision, confianza: j.confidence,
      resumen: cedulaOk
        ? `La cédula coincide con la del representante (${k.representante.cedula}). Selfie al ${Math.round(rostro)}% frente al mínimo de ${cfg.kyc.coincidenciaRostroMin}%${rostro >= cfg.kyc.coincidenciaRostroMin - 15 ? ": diferencia compatible con mala luz o foto vieja del documento." : ": conviene mirar las fotos en Didit."}`
        : "La cédula verificada no es la del representante legal: es otra persona.",
      riesgos: k.checks?.filter((x) => x.estado !== "ok").map((x) => `${x.label}: ${x.detalle}`) ?? [],
      mitigantes: cedulaOk ? ["Prueba de vida superada", "Cédula idéntica a la registrada en Disglobal"] : [],
    };
  };

  const [jev, claude] = await Promise.all([
    motor(() => preguntarJev(estado, PREGUNTAS_KYC), simJev, jevConfigurado()),
    motor(() => pedirClaude("Esta verificación de identidad quedó en revisión. Recomienda aprobar, rechazar o revisar, y explica por qué. Una cédula distinta a la del representante siempre es rechazo.", estado, zMemo), simClaude, claudeConfigurado()),
  ]);
  const fin = combinar(deChoice(jev.r?.recomendacion), claude.r);
  const rec = await guardar(db, { tipo: "kyc", objetivoId: k.id, comercioId: k.comercioId, ...fin, resumen: claude.r?.resumen ?? "Sin análisis de Claude.", detalle: { jev: jev.r, claude: claude.r, riesgos: claude.r?.riesgos, mitigantes: claude.r?.mitigantes }, motores: { claude: claude.m, jev: jev.m } });
  await registrar(db, "Agente IA", "Recomendación de KYC", `${k.representante.nombre}: ${fin.decision} (${Math.round(fin.confianza * 100)}%) · Jev ${jev.m}, Claude ${claude.m}`, k.comercioId);

  const motoresOk = (jev.m === "api" && claude.m === "api") || (DEMO && jev.m !== "error" && claude.m !== "error");
  if (cfg.ia.aplicarAutomatico && motoresOk && cedulaOk && fin.decision === "aprobar" && fin.confianza >= cfg.ia.confianzaMin) {
    await revisarKyc(db, AGENTE, { id: k.id, aprobar: true, motivo: `Aprobado por el agente IA (${Math.round(fin.confianza * 100)}%): ${(claude.r?.resumen ?? "").slice(0, 300)}` });
    await db.update(schema.recomendaciones).set({ aplicada: true }).where(eq(schema.recomendaciones.id, rec.id));
  }
  return rec;
}

/* ---------- 3. Cobranza: cobro voluntario en días sin ventas ---------- */

/**
 * El cobro normal lo hace Disglobal: retiene el % pactado de las ventas del día antes de liquidarle al comercio.
 * Si el comercio no vendió por el POS (cerró, no operó o cobró por otra vía), no hay nada que retener:
 * el agente le deja un aviso en la app del POS para que abone la cuota del día por su voluntad.
 */
export async function agenteCobranza(db: DB) {
  const { valores: cfg } = await paramsVigente(db);
  if (!cfg.cobranza.avisarSinVentas) return 0;
  const ayer = isoDay(addDays(new Date(), -1));
  const n = cfg.cobranza.diasSinVentasAviso;
  const tasa = (await tasaDelDia(db))?.tasa ?? null;
  const activos = await db.select().from(schema.adelantos).where(inArray(schema.adelantos.estado, ["desembolsado", "vencido"]));
  let creados = 0;
  for (const a of activos) {
    if (!a.desembolsadoEn || a.saldoUsd <= 0) continue;
    // Solo se sabe si hubo ventas en días ya cerrados.
    if ((a.ultimoCierre ?? "") < ayer) continue;
    // Último día de la semana pasada que cierra una racha de n días sin retención (alcanza los días en que el agente no corrió).
    const desdeVentana = isoDay(addDays(new Date(), -7 - n));
    const fechas = new Set((await db.select({ f: schema.pagos.fecha }).from(schema.pagos)
      .where(and(eq(schema.pagos.adelantoId, a.id), eq(schema.pagos.origen, "retencion"), gte(schema.pagos.fecha, desdeVentana)))).map((p) => p.f));
    let dia: string | null = null;
    for (let i = 1; i <= 7 && !dia; i++) {
      const fin = addDays(new Date(), -i);
      const racha = Array.from({ length: n }, (_, j) => isoDay(addDays(fin, -j)));
      if (racha.every((f) => f > a.desembolsadoEn! && !fechas.has(f))) dia = isoDay(fin);
    }
    if (!dia) continue;
    const clave = `cobro:${a.id}:${dia}`;
    const [ya] = await db.select({ id: schema.notificaciones.id }).from(schema.notificaciones).where(eq(schema.notificaciones.clave, clave));
    if (ya) continue;

    const [ev] = await db.select().from(schema.evaluaciones).where(eq(schema.evaluaciones.id, a.evaluacionId));
    const cuota = r2(Math.min(a.saldoUsd, (ev?.detalle.metricas.ventasDiariasUsd ?? 0) * a.retencionPct * n));
    if (cuota <= 0) continue;
    const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, a.comercioId));
    const datos = { comercio: c.nombreComercial, representante: c.disglobal.representante.nombre.split(" ")[0], diaSinVentas: dia, diasSinVentas: n, cuotaUsd: cuota, cuotaBs: tasa ? r2(cuota * tasa) : null, saldoUsd: a.saldoUsd, vence: a.venceEn, pagoMovil: CUENTA_COBRO };
    const plantilla = {
      titulo: n === 1 ? (dia === ayer ? "Ayer no registramos ventas en tu punto" : `El ${dia.slice(8)}/${dia.slice(5, 7)} no registramos ventas`) : `${n} días sin ventas en tu punto`,
      mensaje: `Hola ${datos.representante}: como no hubo ventas por el POS, no se retuvo la cuota de tu adelanto. Si puedes, abona USD ${cuota.toFixed(2)}${datos.cuotaBs ? ` (Bs ${datos.cuotaBs.toLocaleString("es-VE")})` : ""} por Pago Móvil y repórtalo aquí. Te queda por pagar USD ${a.saldoUsd.toFixed(2)}.`,
    };
    let texto = plantilla, redactadoPor = "Plantilla";
    try {
      const r = await pedirClaude("Redacta un aviso corto y cordial para la app del punto de venta: el comercio no tuvo ventas por el POS, así que no se retuvo la cuota de su adelanto. Invítalo a abonar la cuota sugerida por Pago Móvil y a reportarlo en la app. Sin amenazas ni presión; menciona el monto en USD y Bs.", datos, zMensaje, "low");
      if (r) { texto = r; redactadoPor = "Claude"; }
    } catch (e) { console.error("[agentes] mensaje de cobro", e); }
    await db.insert(schema.notificaciones).values({ id: nuevoId("n_"), comercioId: c.id, adelantoId: a.id, tipo: "cobro_voluntario", clave, titulo: texto.titulo.slice(0, 80), mensaje: texto.mensaje.slice(0, 500), montoUsd: cuota, montoBs: datos.cuotaBs, redactadoPor }).onConflictDoNothing();
    await registrar(db, "Agente IA", "Aviso de cobro voluntario", `${c.nombreComercial}: sin ventas por el POS el ${dia} · cuota sugerida USD ${cuota}`, c.id);
    creados++;
  }
  return creados;
}

/* ---------- 4. Seguimiento del registro ---------- */

const SEGUIMIENTO: Partial<Record<string, string>> = {
  kyc: "Tiene una oferta lista pero el representante legal no ha verificado su identidad.",
  listo: "Ya verificó su identidad y tiene oferta vigente, pero no ha pedido el adelanto.",
  recurrente: "Terminó de pagar su adelanto; puede pedir uno nuevo, quizás con más cupo.",
};

export async function agenteSeguimiento(db: DB) {
  const { valores: cfg } = await paramsVigente(db);
  const s = await estadoSeguimiento(db);
  const semana = isoDay(addDays(new Date(), -new Date().getDay()));
  let creados = 0;
  for (const f of s.filas) {
    const motivo = SEGUIMIENTO[f.etapa];
    if (!motivo || !f.comercioId || f.bloqueado || !f.ofertaUsd) continue;
    const dias = Math.round((Date.now() - new Date(f.desde + "T12:00:00").getTime()) / 86_400_000);
    if (dias < cfg.cobranza.seguimientoDiasEstancado) continue;
    const clave = `seg:${f.comercioId}:${f.etapa}:${semana}`;
    const [ya] = await db.select({ id: schema.notificaciones.id }).from(schema.notificaciones).where(eq(schema.notificaciones.clave, clave));
    if (ya) continue;
    const datos = { comercio: f.nombre, actividad: f.actividad, situacion: motivo, ofertaUsd: f.ofertaUsd, diasEnEstaEtapa: dias };
    const plantilla = {
      kyc: { titulo: `Tienes hasta USD ${f.ofertaUsd} esperándote`, mensaje: "Solo falta que el representante legal verifique su identidad. Toma 2 minutos con la cédula y el teléfono." },
      listo: { titulo: "Tu adelanto está listo", mensaje: `Tienes hasta USD ${f.ofertaUsd} disponibles. Elige el monto y el plazo, y lo pagas con un % de tus ventas diarias.` },
      recurrente: { titulo: "¡Gracias por pagar tu adelanto!", mensaje: `Ya puedes pedir uno nuevo: tienes hasta USD ${f.ofertaUsd} disponibles.` },
    }[f.etapa as "kyc" | "listo" | "recurrente"];
    let texto = plantilla, redactadoPor = "Plantilla";
    try {
      const r = await pedirClaude("Redacta un aviso corto, cálido y concreto para la app del punto de venta que invite al comercio a dar el siguiente paso. No inventes montos ni condiciones distintas a los datos.", datos, zMensaje, "low");
      if (r) { texto = r; redactadoPor = "Claude"; }
    } catch (e) { console.error("[agentes] mensaje de seguimiento", e); }
    await db.insert(schema.notificaciones).values({ id: nuevoId("n_"), comercioId: f.comercioId, tipo: "seguimiento", clave, titulo: texto.titulo.slice(0, 80), mensaje: texto.mensaje.slice(0, 500), redactadoPor }).onConflictDoNothing();
    creados++;
  }
  if (creados) await registrar(db, "Agente IA", "Avisos de seguimiento", `${creados} comercio(s) estancados en el registro recibieron un aviso`);
  return creados;
}

/* ---------- 5. Resumen diario de cartera ---------- */

export async function agenteResumen(db: DB) {
  const hoy = isoDay(new Date());
  const [ya] = await db.select({ id: schema.informes.id }).from(schema.informes).where(eq(schema.informes.fecha, hoy));
  if (ya) return null;
  const ads = await db.select().from(schema.adelantos);
  const vivos = ads.filter((a) => ["desembolsado", "vencido"].includes(a.estado));
  const s = await estadoSeguimiento(db);
  const recs = await db.select().from(schema.recomendaciones).orderBy(desc(schema.recomendaciones.id)).limit(50);
  const avisos = await db.select().from(schema.notificaciones).where(gte(schema.notificaciones.creado, addDays(new Date(), -1)));
  const datos = {
    fecha: hoy,
    tasaBcv: (await tasaDelDia(db))?.tasa ?? null,
    cartera: { adelantosActivos: vivos.length, saldoUsd: r2(vivos.reduce((x, a) => x + a.saldoUsd, 0)), vencidos: vivos.filter((a) => a.estado === "vencido").map((a) => ({ id: a.id, saldoUsd: a.saldoUsd, venceEn: a.venceEn })) },
    pendientes: { porAprobar: ads.filter((a) => a.estado === "en_revision").length, porDesembolsar: ads.filter((a) => a.estado === "aprobado").length },
    embudo: s.embudo.map((e) => ({ etapa: e.t, comercios: e.n })),
    frecuenciaUso: s.frecuencias,
    recomendacionesRecientes: recs.slice(0, 10).map((r) => ({ tipo: r.tipo, decision: r.decision, confianza: r.confianza, aplicada: r.aplicada })),
    avisosUltimoDia: { cobroVoluntario: avisos.filter((a) => a.tipo === "cobro_voluntario").length, seguimiento: avisos.filter((a) => a.tipo === "seguimiento").length, reportados: avisos.filter((a) => a.estado === "reportada").length },
  };
  const plantilla = [
    `Cartera vigente: USD ${datos.cartera.saldoUsd.toLocaleString("es-VE")} en ${datos.cartera.adelantosActivos} adelanto(s)${datos.cartera.vencidos.length ? `, ${datos.cartera.vencidos.length} vencido(s)` : ", sin vencidos"}.`,
    `Pendientes: ${datos.pendientes.porAprobar} solicitud(es) por decidir y ${datos.pendientes.porDesembolsar} por desembolsar.`,
    `Embudo: ${datos.embudo.filter((e) => e.comercios).map((e) => `${e.etapa} ${e.comercios}`).join(" · ")}.`,
    `Avisos del último día: ${datos.avisosUltimoDia.cobroVoluntario} de cobro voluntario y ${datos.avisosUltimoDia.seguimiento} de seguimiento.`,
  ].join("\n");
  let texto = plantilla, motorTxt = "Plantilla";
  try {
    const r = await pedirClaude("Escribe el resumen diario de la cartera de adelantos para el equipo de Investa: 4 a 6 viñetas con lo importante (cartera, mora, pendientes, embudo, uso) y al final 1 a 3 acciones concretas para hoy. Texto plano con viñetas '•'.", datos, z.object({ texto: z.string() }), "medium");
    if (r) { texto = r.texto; motorTxt = "Claude"; }
  } catch (e) { console.error("[agentes] resumen", e); }
  const hex = hexConfigurado() ? await correrProyectoHex().catch((e) => `Hex falló: ${(e as Error).message}`) : null;
  await db.insert(schema.informes).values({ fecha: hoy, texto, datos, motor: motorTxt, hex }).onConflictDoNothing();
  return texto;
}

/* ---------- Orquestación ---------- */

/** Corre todos los agentes: lo pendiente sin recomendación, cobranza, seguimiento y el resumen del día. */
export async function correrAgentes(db: DB) {
  const conRec = new Set((await db.select({ o: schema.recomendaciones.objetivoId }).from(schema.recomendaciones)).map((r) => r.o));
  let analizadas = 0;
  for (const a of await db.select({ id: schema.adelantos.id }).from(schema.adelantos).where(eq(schema.adelantos.estado, "en_revision")))
    if (!conRec.has(a.id) && await analizarSolicitud(db, a.id)) analizadas++;
  for (const k of await db.select({ id: schema.kyc.id }).from(schema.kyc).where(eq(schema.kyc.estado, "en_revision")))
    if (!conRec.has(k.id) && await analizarKyc(db, k.id)) analizadas++;
  const cobros = await agenteCobranza(db);
  const seguimientos = await agenteSeguimiento(db);
  const resumen = await agenteResumen(db);
  return { analizadas, cobros, seguimientos, resumen: !!resumen };
}

/** Dispara un agente sin hacer esperar al comercio; los errores quedan en el log. */
export function enSegundoPlano(db: DB, fn: (db: DB) => Promise<unknown>) {
  void enSerie(() => fn(db)).catch((e) => console.error("[agentes]", e));
}

export const estadoMotores = () => ({ claude: claudeConfigurado(), jev: jevConfigurado(), hex: hexConfigurado(), simulados: DEMO });
