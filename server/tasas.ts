import "server-only";
import { desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { addDays, isoDay } from "@/lib/format";
import { exigir, type Admin } from "./auth";
import { schema, type DB } from "./db";
import { DEMO, invalido } from "./http";
import { registrar } from "./repo";

/**
 * Tasa oficial BCV (Bs por USD). Con ella se calcula el desembolso (tasa del día del desembolso)
 * y cada abono diario (tasa del día del pago), y se pasan a USD las ventas históricas del scoring.
 * Igual que en el factoring: Operaciones registra la tasa del día o importa el histórico.
 * TODO(R4/BCV): consulta automática cuando haya una fuente con API. En demo se simula.
 */

export const BCV_REFERENCIA = 883.4; // Bs/USD de referencia para la semilla de la demo

/** La llama el cierre diario: en demo, sin fuente oficial, simula la tasa de hoy. */
export async function asegurarTasaDeHoy(db: DB) {
  const hoy = isoDay(new Date());
  const [ya] = await db.select({ f: schema.tasasBcv.fecha }).from(schema.tasasBcv).where(eq(schema.tasasBcv.fecha, hoy));
  if (ya || !DEMO) return;
  const [ult] = await db.select().from(schema.tasasBcv).orderBy(desc(schema.tasasBcv.fecha)).limit(1);
  const tasa = Math.round((ult?.tasa ?? BCV_REFERENCIA) * 1.0015 * 10000) / 10000;
  await db.insert(schema.tasasBcv).values({ fecha: hoy, tasa, fuente: "simulada" }).onConflictDoNothing();
}

export const zTasa = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tasa: z.number().positive().max(1e9) });
export async function registrarTasa(db: DB, u: Admin, x: z.infer<typeof zTasa>) {
  exigir(u, "tasas");
  if (x.fecha > isoDay(addDays(new Date(), 1))) throw invalido("La fecha no puede ser futura.");
  const [antes] = await db.select().from(schema.tasasBcv).where(eq(schema.tasasBcv.fecha, x.fecha));
  await db.insert(schema.tasasBcv).values({ fecha: x.fecha, tasa: x.tasa, fuente: "manual", registradoPor: u.nombre })
    .onConflictDoUpdate({ target: schema.tasasBcv.fecha, set: { tasa: x.tasa, fuente: "manual", registradoPor: u.nombre } });
  await registrar(db, u.nombre, "Tasa BCV", `Tasa del ${x.fecha}: ${fmt(x.tasa)} Bs/USD${antes ? ` (antes ${fmt(antes.tasa)}, ${antes.fuente})` : ""}`);
}

const fmt = (t: number) => t.toLocaleString("es-VE", { maximumFractionDigits: 4 });

function numero(s: string) {
  const t = s.trim().replace(/\s|Bs\.?/gi, "");
  if (/,\d+$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(/,/g, ""));
}
function fecha(s: string) {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const b = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return b ? `${b[3]}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}` : null;
}

/** Importa el histórico: una línea por fecha, "fecha;tasa". Las fechas existentes se actualizan. */
export async function importarTasas(db: DB, u: Admin, texto: string) {
  exigir(u, "tasas");
  const filas: { fecha: string; tasa: number }[] = [];
  let descartadas = 0;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const [f, t] = linea.split(/[;\t]|,(?=\s*\d+(?:[.,]\d+)?\s*$)/);
    const fe = f ? fecha(f) : null, ta = t ? numero(t) : NaN;
    if (!fe || !(ta > 0)) { descartadas++; continue; }
    filas.push({ fecha: fe, tasa: ta });
  }
  if (!filas.length) throw invalido("No se encontraron filas con fecha y tasa. Formato: 2026-10-24;883,40");
  for (const r of filas) await db.insert(schema.tasasBcv).values({ ...r, fuente: "importada", registradoPor: u.nombre })
    .onConflictDoUpdate({ target: schema.tasasBcv.fecha, set: { tasa: r.tasa, fuente: "importada", registradoPor: u.nombre } });
  const ord = filas.map((r) => r.fecha).sort();
  await registrar(db, u.nombre, "Tasa BCV", `Histórico importado: ${filas.length} fecha(s) del ${ord[0]} al ${ord[ord.length - 1]}${descartadas ? ` (${descartadas} líneas descartadas)` : ""}`);
  return { importadas: filas.length, descartadas };
}

export async function historialTasas(db: DB, dias = 90) {
  const desde = isoDay(addDays(new Date(), -dias));
  const rows = await db.select().from(schema.tasasBcv).where(gte(schema.tasasBcv.fecha, desde)).orderBy(desc(schema.tasasBcv.fecha));
  return rows.map((r) => ({ fecha: r.fecha, tasa: r.tasa, fuente: r.fuente, registradoPor: r.registradoPor }));
}

/** Demo: ~14 meses de tasas en días hábiles, con devaluación gradual hasta la tasa de referencia. */
export async function sembrarTasas(db: DB) {
  const hoy = new Date();
  const vals: { fecha: string; tasa: number; fuente: "simulada" }[] = [];
  for (let i = 420; i >= 1; i--) {
    const d = addDays(hoy, -i), dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const ruido = Math.sin(i / 7) * 0.004;
    vals.push({ fecha: isoDay(d), tasa: Math.round(BCV_REFERENCIA * Math.exp(-0.0019 * i) * (1 + ruido) * 10000) / 10000, fuente: "simulada" });
  }
  vals.push({ fecha: isoDay(hoy), tasa: BCV_REFERENCIA, fuente: "simulada" });
  for (let i = 0; i < vals.length; i += 200) await db.insert(schema.tasasBcv).values(vals.slice(i, i + 200)).onConflictDoNothing();
}
