import "server-only";
import { desc, gte } from "drizzle-orm";
import { addDays, isoDay } from "@/lib/format";
import { r2 } from "@/lib/mca";
import { schema, type DB } from "./db";

/**
 * Seguimiento de comercios: etapa del registro, frecuencia de uso de la app del POS
 * y segmentación por actividad y geografía (estado de Venezuela).
 */

export const ETAPAS = [
  { k: "consulto", t: "Consultó su RIF", d: "Vio sus datos pero no confirmó" },
  { k: "sin_oferta", t: "Sin oferta", d: "Confirmó, pero hoy no califica" },
  { k: "kyc", t: "Falta KYC", d: "Tiene oferta; el representante no se ha verificado" },
  { k: "kyc_revision", t: "KYC en revisión", d: "Espera decisión de Riesgo" },
  { k: "listo", t: "Listo para pedir", d: "KYC aprobado y oferta vigente, sin solicitud" },
  { k: "solicitud", t: "Solicitud en curso", d: "En revisión o por desembolsar" },
  { k: "activo", t: "Pagando", d: "Adelanto desembolsado con saldo" },
  { k: "recurrente", t: "Ya pagó", d: "Terminó al menos un adelanto y no tiene otro" },
] as const;
export type Etapa = (typeof ETAPAS)[number]["k"];

export type Frecuencia = "frecuente" | "ocasional" | "esporadico" | "inactivo";
const frecuenciaDe = (dias: number): Frecuencia => (dias >= 8 ? "frecuente" : dias >= 2 ? "ocasional" : dias === 1 ? "esporadico" : "inactivo");

export async function estadoSeguimiento(db: DB) {
  const hace30 = isoDay(addDays(new Date(), -30));
  const [prospectos, comercios, evals, kycs, adelantos, usos] = await Promise.all([
    db.select().from(schema.prospectos),
    db.select().from(schema.comercios),
    db.select({ comercioId: schema.evaluaciones.comercioId, montoMaxUsd: schema.evaluaciones.montoMaxUsd, score: schema.evaluaciones.score, fecha: schema.evaluaciones.fecha }).from(schema.evaluaciones).orderBy(desc(schema.evaluaciones.id)),
    db.select({ comercioId: schema.kyc.comercioId, estado: schema.kyc.estado, creado: schema.kyc.creado, decidido: schema.kyc.decidido }).from(schema.kyc).orderBy(desc(schema.kyc.creado)),
    db.select().from(schema.adelantos).orderBy(desc(schema.adelantos.creado)),
    db.select().from(schema.usos).where(gte(schema.usos.fecha, hace30)),
  ]);
  const primero = <T extends { comercioId: string }>(xs: T[]) => { const m = new Map<string, T>(); for (const x of xs) if (!m.has(x.comercioId)) m.set(x.comercioId, x); return m; };
  const evalDe = primero(evals), kycDe = primero(kycs);
  const adsDe = new Map<string, typeof adelantos>();
  for (const a of adelantos) adsDe.set(a.comercioId, [...(adsDe.get(a.comercioId) ?? []), a]);
  const usoDe = new Map<string, { dias: number; interacciones: number; ultimo: string }>();
  for (const u of usos) {
    const x = usoDe.get(u.comercioId) ?? { dias: 0, interacciones: 0, ultimo: "" };
    x.dias++; x.interacciones += u.interacciones; if (u.fecha > x.ultimo) x.ultimo = u.fecha;
    usoDe.set(u.comercioId, x);
  }

  type Fila = {
    rif: string; comercioId: string | null; nombre: string; actividad: string; ciudad: string; estadoGeo: string;
    etapa: Etapa; desde: string; bloqueado: boolean; score: number | null; ofertaUsd: number | null;
    diasUso30: number; interacciones30: number; ultimoUso: string | null; frecuencia: Frecuencia;
    adelantos: number; desembolsadoUsd: number; saldoUsd: number; consultas: number;
  };
  const filas: Fila[] = [];
  const vistos = new Set<string>();

  for (const c of comercios) {
    vistos.add(c.rif);
    const ev = evalDe.get(c.id), k = kycDe.get(c.id), ads = adsDe.get(c.id) ?? [];
    const abierto = ads.find((a) => ["desembolsado", "vencido"].includes(a.estado));
    const solicitud = ads.find((a) => ["en_revision", "aprobado"].includes(a.estado));
    const pagados = ads.filter((a) => a.estado === "pagado");
    let etapa: Etapa, desde: Date | string;
    if (abierto) { etapa = "activo"; desde = abierto.desembolsadoEn!; }
    else if (solicitud) { etapa = "solicitud"; desde = solicitud.creado; }
    else if (pagados.length) { etapa = "recurrente"; desde = pagados[0].creado; }
    else if (!ev?.montoMaxUsd) { etapa = "sin_oferta"; desde = ev?.fecha ?? c.confirmadoEn ?? c.creado; }
    else if (k?.estado === "aprobado") { etapa = "listo"; desde = k.decidido ?? k.creado; }
    else if (k?.estado === "en_revision") { etapa = "kyc_revision"; desde = k.creado; }
    else { etapa = "kyc"; desde = c.confirmadoEn ?? c.creado; }
    const u = usoDe.get(c.id);
    filas.push({
      rif: c.rif, comercioId: c.id, nombre: c.nombreComercial, actividad: c.disglobal.actividad, ciudad: c.disglobal.ciudad, estadoGeo: c.disglobal.estado,
      etapa, desde: typeof desde === "string" ? desde : isoDay(desde), bloqueado: c.estado === "bloqueado",
      score: ev?.score ?? null, ofertaUsd: ev?.montoMaxUsd ?? null,
      diasUso30: u?.dias ?? 0, interacciones30: u?.interacciones ?? 0, ultimoUso: u?.ultimo || null, frecuencia: frecuenciaDe(u?.dias ?? 0),
      adelantos: ads.filter((a) => a.desembolsadoEn).length,
      desembolsadoUsd: r2(ads.filter((a) => a.desembolsadoEn).reduce((s, a) => s + a.montoUsd, 0)),
      saldoUsd: r2(ads.filter((a) => ["desembolsado", "vencido"].includes(a.estado)).reduce((s, a) => s + a.saldoUsd, 0)),
      consultas: prospectos.find((p) => p.rif === c.rif)?.consultas ?? 1,
    });
  }
  for (const p of prospectos) {
    if (vistos.has(p.rif)) continue;
    filas.push({
      rif: p.rif, comercioId: null, nombre: p.nombre, actividad: p.actividad, ciudad: p.ciudad, estadoGeo: p.estado,
      etapa: "consulto", desde: isoDay(p.ultima), bloqueado: false, score: null, ofertaUsd: null,
      diasUso30: 0, interacciones30: 0, ultimoUso: null, frecuencia: "inactivo", adelantos: 0, desembolsadoUsd: 0, saldoUsd: 0, consultas: p.consultas,
    });
  }

  /** Segmento: cuántos hay, cuántos avanzan y cuánto se colocó. */
  const segmentar = (clave: (f: Fila) => string) => {
    const m = new Map<string, { nombre: string; total: number; registrados: number; conOferta: number; kycOk: number; conAdelanto: number; frecuentes: number; desembolsadoUsd: number; saldoUsd: number }>();
    for (const f of filas) {
      const k = clave(f) || "Sin dato";
      const x = m.get(k) ?? { nombre: k, total: 0, registrados: 0, conOferta: 0, kycOk: 0, conAdelanto: 0, frecuentes: 0, desembolsadoUsd: 0, saldoUsd: 0 };
      x.total++;
      if (f.comercioId) x.registrados++;
      if (f.ofertaUsd) x.conOferta++;
      if (["listo", "solicitud", "activo", "recurrente"].includes(f.etapa)) x.kycOk++;
      if (f.adelantos) x.conAdelanto++;
      if (f.frecuencia === "frecuente") x.frecuentes++;
      x.desembolsadoUsd = r2(x.desembolsadoUsd + f.desembolsadoUsd);
      x.saldoUsd = r2(x.saldoUsd + f.saldoUsd);
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };

  return {
    filas: filas.sort((a, b) => ETAPAS.findIndex((e) => e.k === a.etapa) - ETAPAS.findIndex((e) => e.k === b.etapa) || a.nombre.localeCompare(b.nombre)),
    embudo: ETAPAS.map((e) => ({ ...e, n: filas.filter((f) => f.etapa === e.k).length })),
    frecuencias: (["frecuente", "ocasional", "esporadico", "inactivo"] as Frecuencia[]).map((k) => ({ k, n: filas.filter((f) => f.comercioId && f.frecuencia === k).length })),
    porActividad: segmentar((f) => f.actividad),
    porEstado: segmentar((f) => f.estadoGeo),
    porCiudad: segmentar((f) => `${f.ciudad}, ${f.estadoGeo}`),
  };
}

/** Demo: uso de la app de los últimos 60 días para los comercios sembrados, y algunos RIF que solo consultaron. */
export async function sembrarSeguimiento(db: DB, comercios: { id: string; diasPorSemana: number }[], soloConsultas: { rif: string; nombre: string; actividad: string; ciudad: string; estado: string }[]) {
  for (const c of comercios) {
    for (let i = 0; i < 60; i++) {
      if (Math.random() * 7 >= c.diasPorSemana) continue;
      await db.insert(schema.usos).values({ comercioId: c.id, fecha: isoDay(addDays(new Date(), -i)), interacciones: 1 + Math.floor(Math.random() * 6) }).onConflictDoNothing();
    }
  }
  for (const p of soloConsultas) await db.insert(schema.prospectos).values({ ...p, consultas: 1 + Math.floor(Math.random() * 3), primera: addDays(new Date(), -Math.floor(Math.random() * 20)) }).onConflictDoNothing();
}
