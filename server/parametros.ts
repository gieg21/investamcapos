import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { isoDay } from "@/lib/format";
import { validar, type Config } from "@/lib/params";
import { exigir, type Admin } from "./auth";
import { schema, type DB } from "./db";
import { conflicto, invalido, prohibido } from "./http";
import { registrar } from "./repo";

/**
 * Parámetros con el mismo gobierno que el factoring: cada cambio es una versión nueva e inmutable,
 * solo Administradores proponen/aprueban, quien propone no aprueba, y una propuesta pendiente a la vez.
 * Cada evaluación y cada adelanto guardan la versión con la que se calcularon.
 */

const n = z.number().finite();
const zConfig = z.object({
  oferta: z.object({ montoMin: n, montoMax: n, redondeo: n, pctVentasMensuales: n, escalones: z.array(z.object({ scoreMin: n, multiplicador: n })).max(10) }),
  precio: z.object({ costoMensual: n, comisionApertura: n, plazos: z.array(n).max(12), retencionMinPct: n, retencionMaxPct: n, diasGracia: n }),
  scoring: z.object({
    ventanaMeses: n, historialMinMeses: n, ventasMinUsd: n, diasActivosMinPct: n, rechazoMaxPct: n, scoreMin: n, volumenRefUsd: n,
    pesos: z.object({ volumen: n, estabilidad: n, tendencia: n, actividad: n, antiguedad: n, rechazos: n }),
  }),
  aprobacion: z.object({ automaticaHastaUsd: n, scoreAutoMin: n, vigenciaOfertaDias: n }),
  kyc: z.object({ coincidenciaRostroMin: n, intentosMax: n }),
}) satisfies z.ZodType<Config>;

export const zPropuesta = z.object({ valores: zConfig, nota: z.string().min(5).max(500), vigenteDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function proponer(db: DB, u: Admin, x: z.infer<typeof zPropuesta>) {
  exigir(u, "parametros");
  const errores = validar(x.valores);
  if (errores.length) throw invalido(errores.join(" "));
  if (x.vigenteDesde < isoDay(new Date())) throw invalido("La vigencia no puede ser una fecha pasada.");
  const [pend] = await db.select({ id: schema.parametros.id }).from(schema.parametros).where(eq(schema.parametros.estado, "pendiente"));
  if (pend) throw conflicto("Ya hay una propuesta pendiente. Apruébala o recházala antes de proponer otra.");
  const valores = { ...x.valores, precio: { ...x.valores.precio, plazos: [...new Set(x.valores.precio.plazos)].sort((a, b) => a - b) } };
  await db.insert(schema.parametros).values({ valores, estado: "pendiente", nota: x.nota, propuestoPor: u.nombre, propuestoPorId: u.id, vigenteDesde: x.vigenteDesde });
  await registrar(db, u.nombre, "Parámetros propuestos", `${x.nota} (vigente desde ${x.vigenteDesde})`);
}

async function pendiente(db: DB) {
  const [p] = await db.select().from(schema.parametros).where(eq(schema.parametros.estado, "pendiente"));
  if (!p) throw conflicto("No hay propuestas pendientes.");
  return p;
}

export async function aprobarPropuesta(db: DB, u: Admin) {
  exigir(u, "parametros");
  const p = await pendiente(db);
  if (p.propuestoPorId === u.id) throw prohibido("Quien propone un cambio no puede aprobarlo. Pide la aprobación a otro Administrador.");
  await db.update(schema.parametros).set({ estado: "aprobada", aprobadoPor: u.nombre, aprobadoEn: new Date() }).where(eq(schema.parametros.id, p.id));
  await registrar(db, u.nombre, "Parámetros aprobados", `Versión ${p.id}: ${p.nota} (vigente desde ${p.vigenteDesde})`);
}

export async function rechazarPropuesta(db: DB, u: Admin, motivo: string) {
  exigir(u, "parametros");
  const p = await pendiente(db);
  if (motivo.trim().length < 5) throw invalido("Escribe el motivo del rechazo.");
  await db.update(schema.parametros).set({ estado: "rechazada", motivoRechazo: motivo.trim(), aprobadoPor: u.nombre, aprobadoEn: new Date() }).where(eq(schema.parametros.id, p.id));
  await registrar(db, u.nombre, "Parámetros rechazados", `Versión ${p.id}: ${motivo.trim()}`);
}

export async function versiones(db: DB) {
  return db.select().from(schema.parametros).orderBy(desc(schema.parametros.id));
}
