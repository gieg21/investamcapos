import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { addDays, isoDay } from "@/lib/format";
import { abonoDelDia, cotizar, r2 } from "@/lib/mca";
import { parseRif, rifValido } from "@/lib/rif";
import { evaluar, metricas, tasaEn } from "@/lib/scoring";
import { crearSesion, exigir, nuevoId, type Admin } from "./auth";
import { schema, type DB } from "./db";
import { disglobal } from "./disglobal";
import { conflicto, DEMO, invalido, noEncontrado, prohibido } from "./http";
import { params, paramsVigente, registrar, tasaDelDia, tasas } from "./repo";
import { asegurarTasaDeHoy, BCV_REFERENCIA } from "./tasas";

type Comercio = typeof schema.comercios.$inferSelect;
type Adelanto = typeof schema.adelantos.$inferSelect;

const hoy = () => isoDay(new Date());
const enmascarar = (n: string) => `${n.slice(0, 4)} •••• ${n.slice(-4)}`;
const tasaFn = (ts: { fecha: string; tasa: number }[]) => (f: string) => tasaEn(ts, f) ?? BCV_REFERENCIA;

/* ---------- Onboarding desde el POS: solo el RIF ---------- */

export const zConsulta = z.object({ rif: z.string().min(5).max(20), serial: z.string().max(40).optional() });

/** Busca la ficha en Disglobal y comprueba que la terminal desde la que se pide pertenece a ese RIF. */
export async function consultarRif(db: DB, x: z.infer<typeof zConsulta>) {
  const p = parseRif(x.rif);
  if (!p || !rifValido(p.canon)) throw invalido("Ese RIF no es válido. Revisa la letra, los 8 números y el dígito final.");
  const ficha = await disglobal.comercio(p.canon);
  if (!ficha) throw noEncontrado("Ese RIF no aparece afiliado a Disglobal. Verifica que sea el RIF del comercio dueño de este punto de venta.");
  const terminal = ficha.terminales.find((t) => t.serial === x.serial);
  // Sin esta comprobación, cualquiera que conozca un RIF vería la ficha del comercio.
  if (!terminal && !DEMO) throw prohibido("Este punto de venta no está registrado a nombre de ese RIF en Disglobal.");
  const [existente] = await db.select({ id: schema.comercios.id, telefono: schema.comercios.telefono, email: schema.comercios.email }).from(schema.comercios).where(eq(schema.comercios.rif, p.canon));
  return {
    ficha: { ...ficha, cuentaLiquidacion: { ...ficha.cuentaLiquidacion, numero: enmascarar(ficha.cuentaLiquidacion.numero) } },
    terminalVerificada: !!terminal,
    yaRegistrado: !!existente,
    contacto: existente ? { telefono: existente.telefono, email: existente.email } : null,
  };
}

const tel = z.string().regex(/^0?4\d{2}-?\d{7}$|^0?2\d{2}-?\d{7}$/, "teléfono venezolano, p. ej. 0414-1234567");
export const zConfirmar = zConsulta.extend({
  telefono: tel,
  email: z.string().email(),
  nota: z.string().max(500).optional(), // algo de la ficha que el cliente dice que está mal
  acepto: z.literal(true),
});

/** El cliente confirmó los datos: se crea (o actualiza) el comercio, se vincula la terminal, se abre la sesión del POS y se corre el scoring. */
export async function confirmarOnboarding(db: DB, x: z.infer<typeof zConfirmar>) {
  const { ficha, terminalVerificada } = await consultarRif(db, x);
  const real = (await disglobal.comercio(ficha.rif))!; // la ficha sin enmascarar, nunca la que manda el cliente
  const correcciones: Record<string, string> = {};
  if (x.telefono !== real.telefono) correcciones.telefono = `${real.telefono} → ${x.telefono}`;
  if (x.email.toLowerCase() !== real.email.toLowerCase()) correcciones.email = `${real.email} → ${x.email}`;
  if (x.nota?.trim()) correcciones.nota = x.nota.trim();

  const [antes] = await db.select().from(schema.comercios).where(eq(schema.comercios.rif, real.rif));
  const id = antes?.id ?? nuevoId("c_");
  const datos = { razonSocial: real.razonSocial, nombreComercial: real.nombreComercial, telefono: x.telefono, email: x.email.toLowerCase(), disglobal: real, correcciones: Object.keys(correcciones).length ? correcciones : null, confirmadoEn: new Date() };
  if (antes) await db.update(schema.comercios).set(datos).where(eq(schema.comercios.id, id));
  else await db.insert(schema.comercios).values({ id, rif: real.rif, ...datos });

  const serial = x.serial || "SIN-SERIAL";
  const modelo = real.terminales.find((t) => t.serial === serial)?.modelo ?? "desconocido";
  await db.insert(schema.terminales).values({ serial, comercioId: id, modelo, verificada: terminalVerificada })
    .onConflictDoUpdate({ target: schema.terminales.serial, set: { comercioId: id, modelo, verificada: terminalVerificada, ultimoUso: new Date() } });

  await registrar(db, real.nombreComercial, antes ? "Datos reconfirmados" : "Onboarding desde POS",
    `RIF ${real.rif} desde ${modelo} ${serial}${terminalVerificada ? "" : " (terminal NO verificada en Disglobal — solo demo)"}${Object.keys(correcciones).length ? `. Correcciones: ${Object.values(correcciones).join("; ")}` : ""}`, id);
  await crearSesion(db, "pos", id, serial);
  const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, id));
  if (c.estado === "bloqueado") throw prohibido("Tu comercio está bloqueado para adelantos. Comunícate con Investa.");
  await evaluarComercio(db, c, "Sistema");
}

/* ---------- Scoring ---------- */

/** Corre el scoring con la data transaccional de Disglobal y la versión vigente de parámetros. */
export async function evaluarComercio(db: DB, c: Comercio, actor: string) {
  const { id: version, valores: cfg } = await paramsVigente(db);
  const ts = await tasas(db);
  const fin = isoDay(addDays(new Date(), -1));
  const desde = isoDay(addDays(new Date(), -(cfg.scoring.ventanaMeses * 30 + 400)));
  const dias = await disglobal.ventas(c.rif, desde, fin, tasaFn(ts));
  const ficha = (await disglobal.comercio(c.rif)) ?? c.disglobal;
  const m = metricas(dias, ts, hoy(), ficha.afiliadoDesde, cfg);
  const ev = evaluar(m, cfg, ficha.estatus);
  const [row] = await db.insert(schema.evaluaciones).values({
    comercioId: c.id, paramsVersion: version, score: ev.score, montoMaxUsd: ev.montoMaxUsd, detalle: ev,
    vence: isoDay(addDays(new Date(), cfg.aprobacion.vigenciaOfertaDias)),
  }).returning();
  await registrar(db, actor, "Scoring", `Score ${ev.score} · ${ev.montoMaxUsd ? `oferta hasta USD ${ev.montoMaxUsd}` : `sin oferta: ${ev.cortes[0]}`} (parámetros v${version})`, c.id);
  return row;
}

/** La evaluación vigente del comercio; si venció o cambiaron los parámetros, se recalcula. */
export async function evaluacionVigente(db: DB, c: Comercio) {
  const { id: version } = await paramsVigente(db);
  const [e] = await db.select().from(schema.evaluaciones).where(eq(schema.evaluaciones.comercioId, c.id)).orderBy(desc(schema.evaluaciones.id)).limit(1);
  if (e && e.vence >= hoy() && e.paramsVersion === version) return e;
  return evaluarComercio(db, c, "Sistema");
}

const ACTIVOS = ["en_revision", "aprobado", "desembolsado", "vencido"] as const;

/** Todo lo que necesita la app del POS. */
export async function estadoPos(db: DB, c: Comercio) {
  const ev = await evaluacionVigente(db, c);
  const cfg = await params(db, ev.paramsVersion);
  const ads = await db.select().from(schema.adelantos).where(eq(schema.adelantos.comercioId, c.id)).orderBy(desc(schema.adelantos.creado));
  const activo = ads.find((a) => (ACTIVOS as readonly string[]).includes(a.estado)) ?? null;
  const pagos = activo ? await db.select().from(schema.pagos).where(eq(schema.pagos.adelantoId, activo.id)).orderBy(desc(schema.pagos.fecha)) : [];
  const t = await tasaDelDia(db);
  return {
    comercio: { rif: c.rif, nombre: c.nombreComercial, razonSocial: c.razonSocial, telefono: c.telefono, email: c.email, banco: c.disglobal.cuentaLiquidacion.banco, cuenta: enmascarar(c.disglobal.cuentaLiquidacion.numero) },
    tasaHoy: t?.tasa ?? null,
    oferta: {
      montoMaxUsd: ev.montoMaxUsd,
      score: ev.score,
      cortes: ev.detalle.cortes,
      vence: ev.vence,
      ventasDiariasUsd: r2(ev.detalle.metricas.ventasDiariasUsd),
      ventasMensualesUsd: r2(ev.detalle.metricas.ventasMensualesUsd),
      precio: cfg.precio,
      montoMinUsd: cfg.oferta.montoMin,
      redondeo: cfg.oferta.redondeo,
    },
    activo: activo && { ...activo, pagos, pagadoUsd: r2(activo.totalUsd - activo.saldoUsd) },
    historial: ads.filter((a) => a !== activo).map((a) => ({ id: a.id, estado: a.estado, montoUsd: a.montoUsd, totalUsd: a.totalUsd, creado: a.creado, motivo: a.motivo })),
  };
}

/* ---------- Solicitud desde el POS ---------- */

export const zSolicitud = z.object({ montoUsd: z.number().positive(), plazoDias: z.number().int().positive(), acepto: z.literal(true) });

export async function solicitar(db: DB, c: Comercio, serial: string | null, x: z.infer<typeof zSolicitud>) {
  const [abierto] = await db.select({ id: schema.adelantos.id }).from(schema.adelantos).where(and(eq(schema.adelantos.comercioId, c.id), inArray(schema.adelantos.estado, [...ACTIVOS])));
  if (abierto) throw conflicto("Ya tienes un adelanto en curso. Podrás pedir otro cuando lo termines de pagar.");
  const ev = await evaluacionVigente(db, c);
  const cfg = await params(db, ev.paramsVersion);
  if (!ev.montoMaxUsd) throw invalido("Por ahora tu comercio no califica para un adelanto.");
  if (x.montoUsd > ev.montoMaxUsd) throw invalido(`El máximo disponible es USD ${ev.montoMaxUsd}.`);
  if (x.montoUsd % cfg.oferta.redondeo) throw invalido(`El monto va en múltiplos de USD ${cfg.oferta.redondeo}.`);
  const q = cotizar(x.montoUsd, x.plazoDias, ev.detalle.metricas.ventasDiariasUsd, cfg);
  if (!q.disponible) throw invalido(q.motivo!);

  const auto = x.montoUsd <= cfg.aprobacion.automaticaHastaUsd && ev.score >= cfg.aprobacion.scoreAutoMin;
  const id = nuevoId("a_");
  await db.insert(schema.adelantos).values({
    id, comercioId: c.id, evaluacionId: ev.id, paramsVersion: ev.paramsVersion, estado: auto ? "aprobado" : "en_revision",
    montoUsd: q.montoUsd, plazoDias: q.plazoDias, cargoUsd: q.cargoUsd, comisionUsd: q.comisionUsd, totalUsd: q.totalUsd,
    retencionPct: q.retencionPct, saldoUsd: q.totalUsd, aprobadoPor: auto ? "Motor automático" : null, serial,
  });
  await registrar(db, c.nombreComercial, "Solicitud de adelanto", `USD ${q.montoUsd} a ${q.plazoDias} días · total USD ${q.totalUsd} · retención ${(q.retencionPct * 100).toFixed(1)}%${auto ? " · aprobada automáticamente" : " · a revisión de Riesgo"}`, c.id);
}

/* ---------- Backoffice ---------- */

async function adelanto(db: DB, id: string) {
  const [a] = await db.select().from(schema.adelantos).where(eq(schema.adelantos.id, id));
  if (!a) throw noEncontrado("Adelanto no encontrado.");
  return a;
}
const nombreDe = async (db: DB, comercioId: string) => (await db.select({ n: schema.comercios.nombreComercial }).from(schema.comercios).where(eq(schema.comercios.id, comercioId)))[0]?.n ?? comercioId;

export async function aprobar(db: DB, u: Admin, id: string) {
  exigir(u, "decidir");
  const a = await adelanto(db, id);
  if (a.estado !== "en_revision") throw conflicto("Solo se aprueban solicitudes en revisión.");
  await db.update(schema.adelantos).set({ estado: "aprobado", aprobadoPor: u.nombre }).where(eq(schema.adelantos.id, id));
  await registrar(db, u.nombre, "Adelanto aprobado", `${await nombreDe(db, a.comercioId)}: USD ${a.montoUsd} a ${a.plazoDias} días`, a.comercioId);
}

export async function rechazar(db: DB, u: Admin, id: string, motivo: string) {
  exigir(u, "decidir");
  const a = await adelanto(db, id);
  if (!["en_revision", "aprobado"].includes(a.estado)) throw conflicto("Ese adelanto ya no se puede rechazar.");
  if (motivo.trim().length < 5) throw invalido("Escribe el motivo del rechazo.");
  await db.update(schema.adelantos).set({ estado: "rechazado", motivo: motivo.trim(), aprobadoPor: u.nombre }).where(eq(schema.adelantos.id, id));
  await registrar(db, u.nombre, "Adelanto rechazado", `${await nombreDe(db, a.comercioId)}: ${motivo.trim()}`, a.comercioId);
}

/** Desembolso en Bs a la tasa BCV del día. `fecha` solo cambia en la semilla de la demo. */
export async function desembolsar(db: DB, actor: string, id: string, referencia: string, fecha = hoy()) {
  const a = await adelanto(db, id);
  if (a.estado !== "aprobado") throw conflicto("Solo se desembolsan adelantos aprobados.");
  if (referencia.trim().length < 4) throw invalido("Indica la referencia bancaria del desembolso.");
  const t = await tasaDelDia(db, fecha);
  if (!t) throw invalido(`No hay tasa BCV registrada para el ${fecha}. Regístrala en Tasas BCV antes de desembolsar.`);
  const montoBs = r2(a.montoUsd * t.tasa);
  await db.update(schema.adelantos).set({
    estado: "desembolsado", tasaDesembolso: t.tasa, montoBs, referenciaDesembolso: referencia.trim(), desembolsadoEn: fecha,
    venceEn: isoDay(addDays(new Date(fecha + "T12:00:00"), a.plazoDias)), ultimoCierre: fecha,
  }).where(eq(schema.adelantos.id, id));
  await registrar(db, actor, "Desembolso", `${await nombreDe(db, a.comercioId)}: USD ${a.montoUsd} = Bs ${montoBs.toLocaleString("es-VE")} a ${t.tasa} Bs/USD (BCV ${fecha}) · ref. ${referencia.trim()}`, a.comercioId);
}

export async function desembolsarAdmin(db: DB, u: Admin, id: string, referencia: string) {
  exigir(u, "mover_dinero");
  await desembolsar(db, u.nombre, id, referencia);
}

export const zPagoManual = z.object({ id: z.string(), montoBs: z.number().positive(), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), referencia: z.string().min(4) });

/** Pago fuera de la retención (p. ej. transferencia del comercio): se convierte a la tasa BCV de la fecha del pago. */
export async function pagoManual(db: DB, u: Admin, x: z.infer<typeof zPagoManual>) {
  exigir(u, "mover_dinero");
  const a = await adelanto(db, x.id);
  if (!["desembolsado", "vencido"].includes(a.estado)) throw conflicto("El adelanto no tiene saldo por cobrar.");
  if (x.fecha > hoy() || (a.desembolsadoEn && x.fecha < a.desembolsadoEn)) throw invalido("La fecha debe estar entre el desembolso y hoy.");
  const tasa = tasaEn(await tasas(db), x.fecha);
  if (!tasa) throw invalido("No hay tasa BCV para esa fecha.");
  const ab = abonoDelDia(a.saldoUsd, x.montoBs, 1, tasa);
  const [ya] = await db.select({ id: schema.pagos.id }).from(schema.pagos).where(and(eq(schema.pagos.adelantoId, a.id), eq(schema.pagos.fecha, x.fecha), eq(schema.pagos.origen, "manual")));
  if (ya) throw conflicto("Ya hay un pago manual registrado ese día para este adelanto.");
  await db.insert(schema.pagos).values({ adelantoId: a.id, fecha: x.fecha, ventasBs: 0, montoBs: ab.montoBs, tasaBcv: tasa, montoUsd: ab.montoUsd, saldoUsd: ab.saldoUsd, origen: "manual", registradoPor: `${u.nombre} · ref. ${x.referencia}` });
  await db.update(schema.adelantos).set({ saldoUsd: ab.saldoUsd, estado: ab.saldoUsd <= 0 ? "pagado" : a.estado }).where(eq(schema.adelantos.id, a.id));
  await registrar(db, u.nombre, "Pago manual", `${await nombreDe(db, a.comercioId)}: Bs ${ab.montoBs.toLocaleString("es-VE")} a ${tasa} = USD ${ab.montoUsd} · saldo USD ${ab.saldoUsd}${x.montoBs > ab.montoBs ? ` (excedente de Bs ${r2(x.montoBs - ab.montoBs)} no aplicado)` : ""}`, a.comercioId);
}

/**
 * Cierre diario: para cada adelanto con saldo, toma las ventas de los días ya cerrados (hasta ayer),
 * retiene el % pactado en Bs y lo abona en USD a la tasa BCV de cada día. Marca pagados y vencidos.
 */
export async function cierreDiario(db: DB, actor: string) {
  await asegurarTasaDeHoy(db);
  const ts = await tasas(db);
  const ayer = isoDay(addDays(new Date(), -1));
  const abiertos = await db.select().from(schema.adelantos).where(inArray(schema.adelantos.estado, ["desembolsado", "vencido"]));
  let nPagos = 0, cerrados = 0, vencidos = 0;
  for (const a of abiertos) {
    const desde = isoDay(addDays(new Date((a.ultimoCierre ?? a.desembolsadoEn!) + "T12:00:00"), 1));
    let saldo = a.saldoUsd, estado: Adelanto["estado"] = a.estado;
    if (desde <= ayer) {
      const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, a.comercioId));
      let dias;
      try { dias = await disglobal.ventas(c.rif, desde, ayer, tasaFn(ts)); } catch (e) { console.error("[cierre]", e); continue; }
      for (const d of dias) {
        if (saldo <= 0 || d.ventasBs <= 0) continue;
        const tasa = tasaEn(ts, d.fecha)!;
        const ab = abonoDelDia(saldo, d.ventasBs, a.retencionPct, tasa);
        await db.insert(schema.pagos).values({ adelantoId: a.id, fecha: d.fecha, ventasBs: d.ventasBs, montoBs: ab.montoBs, tasaBcv: tasa, montoUsd: ab.montoUsd, saldoUsd: ab.saldoUsd, origen: "retencion" }).onConflictDoNothing();
        saldo = ab.saldoUsd;
        nPagos++;
      }
    }
    const { diasGracia } = (await params(db, a.paramsVersion)).precio;
    if (saldo <= 0) { estado = "pagado"; cerrados++; }
    else if (a.venceEn && isoDay(addDays(new Date(a.venceEn + "T12:00:00"), diasGracia)) < hoy()) { if (estado !== "vencido") vencidos++; estado = "vencido"; }
    await db.update(schema.adelantos).set({ saldoUsd: saldo, estado, ultimoCierre: ayer > (a.ultimoCierre ?? "") ? ayer : a.ultimoCierre }).where(eq(schema.adelantos.id, a.id));
    if (estado === "pagado" && a.estado !== "pagado") await registrar(db, actor, "Adelanto pagado", `${await nombreDe(db, a.comercioId)} terminó de pagar USD ${a.totalUsd}`, a.comercioId);
    if (estado === "vencido" && a.estado !== "vencido") await registrar(db, actor, "Adelanto vencido", `${await nombreDe(db, a.comercioId)}: saldo USD ${saldo} pasado el plazo y los días de gracia`, a.comercioId);
  }
  if (nPagos || cerrados || vencidos) await registrar(db, actor, "Cierre diario", `${nPagos} abono(s) por retención · ${cerrados} adelanto(s) pagado(s) · ${vencidos} vencido(s)`);
  return { pagos: nPagos, cerrados, vencidos };
}

export async function bloquear(db: DB, u: Admin, comercioId: string, bloqueado: boolean, motivo: string) {
  exigir(u, "comercios");
  const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, comercioId));
  if (!c) throw noEncontrado();
  if (bloqueado && motivo.trim().length < 5) throw invalido("Escribe el motivo del bloqueo.");
  await db.update(schema.comercios).set({ estado: bloqueado ? "bloqueado" : "activo" }).where(eq(schema.comercios.id, comercioId));
  await registrar(db, u.nombre, bloqueado ? "Comercio bloqueado" : "Comercio desbloqueado", `${c.nombreComercial}${motivo ? `: ${motivo}` : ""}`, c.id);
}

export async function reevaluar(db: DB, u: Admin, comercioId: string) {
  exigir(u, "decidir");
  const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, comercioId));
  if (!c) throw noEncontrado();
  await evaluarComercio(db, c, u.nombre);
}

/** Ventas por mes en USD para el detalle del comercio en el backoffice (últimos 12 meses). */
export async function ventasMensuales(db: DB, c: Comercio) {
  const ts = await tasas(db);
  const dias = await disglobal.ventas(c.rif, isoDay(addDays(new Date(), -365)), isoDay(addDays(new Date(), -1)), tasaFn(ts));
  const porMes = new Map<string, { usd: number; bs: number; tx: number }>();
  for (const d of dias) {
    const k = d.fecha.slice(0, 7);
    const x = porMes.get(k) ?? { usd: 0, bs: 0, tx: 0 };
    x.bs += d.ventasBs; x.usd += d.ventasBs / (tasaEn(ts, d.fecha) ?? BCV_REFERENCIA); x.tx += d.transacciones;
    porMes.set(k, x);
  }
  return [...porMes.entries()].map(([mes, x]) => ({ mes, usd: r2(x.usd), bs: r2(x.bs), tx: x.tx }));
}

