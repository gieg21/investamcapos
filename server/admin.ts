import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { r2 } from "@/lib/mca";
import { puede } from "@/lib/permisos";
import type { Admin } from "./auth";
import { schema, type DB } from "./db";
import { disglobalSimulado } from "./disglobal";
import { DEMO, noEncontrado } from "./http";
import { ventasMensuales } from "./mca";
import { paramsVigente, tasaDelDia } from "./repo";
import { versiones } from "./parametros";

/** Estado del backoffice: comercios, adelantos, KPIs, parámetros y bitácora. Es poco volumen; se manda completo. */
export async function estadoAdmin(db: DB, u: Admin) {
  const comercios = await db.select().from(schema.comercios).orderBy(desc(schema.comercios.creado));
  const evals = await db.select({ id: schema.evaluaciones.id, comercioId: schema.evaluaciones.comercioId, score: schema.evaluaciones.score, montoMaxUsd: schema.evaluaciones.montoMaxUsd, fecha: schema.evaluaciones.fecha, vence: schema.evaluaciones.vence })
    .from(schema.evaluaciones).orderBy(desc(schema.evaluaciones.id));
  const ultima = new Map<string, (typeof evals)[number]>();
  for (const e of evals) if (!ultima.has(e.comercioId)) ultima.set(e.comercioId, e);
  const adelantos = await db.select().from(schema.adelantos).orderBy(desc(schema.adelantos.creado));
  const nombre = new Map(comercios.map((c) => [c.id, c.nombreComercial]));
  const scoreDe = new Map(evals.map((e) => [e.id, e.score]));
  const vivos = adelantos.filter((a) => ["desembolsado", "vencido"].includes(a.estado));
  const pagos = vivos.length ? await db.select({ adelantoId: schema.pagos.adelantoId, fecha: schema.pagos.fecha }).from(schema.pagos).where(inArray(schema.pagos.adelantoId, vivos.map((a) => a.id))) : [];
  const ultimoPago = new Map<string, string>();
  for (const p of pagos) if ((ultimoPago.get(p.adelantoId) ?? "") < p.fecha) ultimoPago.set(p.adelantoId, p.fecha);
  const desembolsados = adelantos.filter((a) => a.desembolsadoEn);
  const tasa = await tasaDelDia(db);

  return {
    usuario: { ...u, permisos: { decidir: puede(u.roles, "decidir"), moverDinero: puede(u.roles, "mover_dinero"), tasas: puede(u.roles, "tasas"), parametros: puede(u.roles, "parametros"), comercios: puede(u.roles, "comercios") } },
    demo: DEMO,
    disglobalSimulado,
    tasaHoy: tasa ? { tasa: tasa.tasa, fuente: tasa.fuente } : null,
    kpis: {
      comercios: comercios.length,
      conOferta: [...ultima.values()].filter((e) => e.montoMaxUsd > 0).length,
      carteraUsd: r2(vivos.reduce((a, x) => a + x.saldoUsd, 0)),
      vencidoUsd: r2(vivos.filter((x) => x.estado === "vencido").reduce((a, x) => a + x.saldoUsd, 0)),
      desembolsadoUsd: r2(desembolsados.reduce((a, x) => a + x.montoUsd, 0)),
      cobradoUsd: r2(desembolsados.reduce((a, x) => a + (x.totalUsd - x.saldoUsd), 0)),
      porAprobar: adelantos.filter((a) => a.estado === "en_revision").length,
      porDesembolsar: adelantos.filter((a) => a.estado === "aprobado").length,
    },
    comercios: comercios.map((c) => ({
      id: c.id, rif: c.rif, nombre: c.nombreComercial, razonSocial: c.razonSocial, ciudad: c.disglobal.ciudad, estado: c.estado, estatusDisglobal: c.disglobal.estatus,
      terminales: c.disglobal.terminales.length, confirmadoEn: c.confirmadoEn, correcciones: c.correcciones,
      score: ultima.get(c.id)?.score ?? null, montoMaxUsd: ultima.get(c.id)?.montoMaxUsd ?? null, evaluadoEn: ultima.get(c.id)?.fecha ?? null,
    })),
    adelantos: adelantos.map((a) => ({ ...a, comercio: nombre.get(a.comercioId) ?? "", score: scoreDe.get(a.evaluacionId) ?? null, ultimoPago: ultimoPago.get(a.id) ?? null })),
    parametros: { vigente: await paramsVigente(db), versiones: await versiones(db) },
    bitacora: await db.select().from(schema.bitacora).orderBy(desc(schema.bitacora.id)).limit(300),
  };
}

export async function detalleComercio(db: DB, id: string) {
  const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, id));
  if (!c) throw noEncontrado("Comercio no encontrado.");
  const evaluaciones = await db.select().from(schema.evaluaciones).where(eq(schema.evaluaciones.comercioId, id)).orderBy(desc(schema.evaluaciones.id)).limit(20);
  const adelantos = await db.select().from(schema.adelantos).where(eq(schema.adelantos.comercioId, id)).orderBy(desc(schema.adelantos.creado));
  const pagos = adelantos.length ? await db.select().from(schema.pagos).where(inArray(schema.pagos.adelantoId, adelantos.map((a) => a.id))).orderBy(desc(schema.pagos.fecha)) : [];
  const terminales = await db.select().from(schema.terminales).where(eq(schema.terminales.comercioId, id));
  let ventas: Awaited<ReturnType<typeof ventasMensuales>> = [];
  try { ventas = await ventasMensuales(db, c); } catch { /* Disglobal no disponible: el detalle se muestra sin el gráfico */ }
  return { comercio: c, evaluaciones, adelantos: adelantos.map((a) => ({ ...a, pagos: pagos.filter((p) => p.adelantoId === a.id) })), terminales, ventas };
}
