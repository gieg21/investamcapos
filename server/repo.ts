import "server-only";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { isoDay } from "@/lib/format";
import { CONFIG_DEFAULT, type Config } from "@/lib/params";
import type { Tasa } from "@/lib/scoring";
import { schema, type DB } from "./db";

export async function registrar(db: DB, actor: string, accion: string, detalle: string, comercioId?: string) {
  await db.insert(schema.bitacora).values({ actor, accion, detalle, comercioId });
}

/** Versión vigente: la última aprobada con vigencia hasta hoy. */
export async function paramsVigente(db: DB): Promise<{ id: number; valores: Config }> {
  const [v] = await db.select().from(schema.parametros)
    .where(and(eq(schema.parametros.estado, "aprobada"), lte(schema.parametros.vigenteDesde, isoDay(new Date()))))
    .orderBy(desc(schema.parametros.vigenteDesde), desc(schema.parametros.id)).limit(1);
  // Completa con los valores de fábrica por si una versión vieja no trae un campo nuevo.
  return v ? { id: v.id, valores: mezclar(CONFIG_DEFAULT, v.valores) } : { id: 0, valores: CONFIG_DEFAULT };
}

function mezclar<T>(base: T, x: unknown): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return (x ?? base) as T;
  const o = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(o)) if (x && typeof x === "object" && k in x) o[k] = mezclar(o[k], (x as Record<string, unknown>)[k]);
  return o as T;
}

export async function params(db: DB, id: number): Promise<Config> {
  const [v] = await db.select().from(schema.parametros).where(eq(schema.parametros.id, id));
  return v ? mezclar(CONFIG_DEFAULT, v.valores) : CONFIG_DEFAULT;
}

/** Todas las tasas BCV, ascendentes (unos cientos de filas al año). */
export async function tasas(db: DB): Promise<Tasa[]> {
  return db.select({ fecha: schema.tasasBcv.fecha, tasa: schema.tasasBcv.tasa }).from(schema.tasasBcv).orderBy(asc(schema.tasasBcv.fecha));
}

export async function tasaDelDia(db: DB, fecha = isoDay(new Date())) {
  const [t] = await db.select().from(schema.tasasBcv).where(eq(schema.tasasBcv.fecha, fecha));
  return t ?? null;
}
