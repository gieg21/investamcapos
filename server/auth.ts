import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { isoDay } from "@/lib/format";
import { puede, ROL_LABEL, type Permiso, type Rol } from "@/lib/permisos";
import { getDb, schema, type DB } from "./db";
import { ApiError, noAutorizado, prohibido } from "./http";

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const N = 16384;

export async function hashPassword(pwd: string) {
  const salt = randomBytes(16);
  const h = await scrypt(pwd, salt, 64, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString("base64")}$${h.toString("base64")}`;
}

export async function verificarPassword(pwd: string, guardado: string) {
  const [alg, n, salt, hash] = guardado.split("$");
  if (alg !== "scrypt") return false;
  const esperado = Buffer.from(hash, "base64");
  const h = await scrypt(pwd, Buffer.from(salt, "base64"), esperado.length, { N: Number(n), r: 8, p: 1 });
  return timingSafeEqual(h, esperado);
}

type Tipo = "admin" | "pos";
const COOKIE: Record<Tipo, string> = { admin: "mca_adm", pos: "mca_pos" };
// El POS queda en el mostrador del comercio: sesión larga, atada al serial de la terminal.
const DURACION_H: Record<Tipo, number> = { admin: 12, pos: 24 * 30 };
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
export const nuevoId = (p = "") => p + randomBytes(9).toString("base64url");

export async function crearSesion(db: DB, tipo: Tipo, usuarioId: string, serial?: string) {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DURACION_H[tipo] * 3600_000);
  await db.insert(schema.sesiones).values({ tokenHash: sha(token), tipo, usuarioId, serial, expira });
  await db.delete(schema.sesiones).where(lt(schema.sesiones.expira, new Date()));
  // El POS abre la app en un WebView del mismo origen: cookie httpOnly normal.
  cookies().set(COOKIE[tipo], token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expira });
}

export async function cerrarSesion(tipo: Tipo) {
  const token = cookies().get(COOKIE[tipo])?.value;
  if (token) await (await getDb()).delete(schema.sesiones).where(eq(schema.sesiones.tokenHash, sha(token)));
  cookies().delete(COOKIE[tipo]);
}

async function sesion(tipo: Tipo) {
  const token = cookies().get(COOKIE[tipo])?.value;
  if (!token) return null;
  const db = await getDb();
  const [s] = await db.select().from(schema.sesiones).where(and(eq(schema.sesiones.tokenHash, sha(token)), eq(schema.sesiones.tipo, tipo), gt(schema.sesiones.expira, new Date())));
  return s ?? null;
}

export type Admin = { id: string; email: string; nombre: string; roles: Rol[] };

export async function adminActual(): Promise<Admin | null> {
  const s = await sesion("admin");
  if (!s) return null;
  const db = await getDb();
  const [u] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, s.usuarioId));
  return u?.activo ? { id: u.id, email: u.email, nombre: u.nombre, roles: u.roles } : null;
}

export async function requiereAdmin(permiso?: Permiso): Promise<Admin> {
  const u = await adminActual();
  if (!u) throw noAutorizado();
  if (permiso) exigir(u, permiso);
  return u;
}

const PERMISO_TXT: Record<Permiso, string> = { decidir: "aprobar o rechazar adelantos", mover_dinero: "registrar desembolsos y pagos", tasas: "registrar tasas BCV", parametros: "cambiar parámetros", comercios: "modificar comercios" };
export function exigir(u: Admin, p: Permiso) {
  if (!puede(u.roles, p)) throw prohibido(`Tus roles (${u.roles.map((r) => ROL_LABEL[r]).join(", ")}) no permiten ${PERMISO_TXT[p]}.`);
}

/** Comercio con sesión abierta en un POS. */
export async function requierePos() {
  const s = await sesion("pos");
  if (!s) throw noAutorizado();
  const db = await getDb();
  const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, s.usuarioId));
  if (!c) throw noAutorizado();
  if (c.estado === "bloqueado") throw prohibido("Tu comercio está bloqueado para adelantos. Comunícate con Investa.");
  if (s.serial) await db.update(schema.terminales).set({ ultimoUso: new Date() }).where(eq(schema.terminales.serial, s.serial));
  // Frecuencia de uso para el seguimiento del backoffice.
  await db.insert(schema.usos).values({ comercioId: c.id, fecha: isoDay(new Date()) })
    .onConflictDoUpdate({ target: [schema.usos.comercioId, schema.usos.fecha], set: { interacciones: sql`${schema.usos.interacciones} + 1` } });
  return { comercio: c, serial: s.serial };
}

/* Límite de intentos en memoria: 5 fallos por clave cada 15 minutos. */
const intentos = new Map<string, { n: number; desde: number }>();
export function frenarFuerzaBruta(clave: string, max = 5) {
  const x = intentos.get(clave);
  if (x && Date.now() - x.desde < 15 * 60_000 && x.n >= max) throw new ApiError(429, "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.");
}
export function registrarFallo(clave: string) {
  const x = intentos.get(clave);
  if (!x || Date.now() - x.desde > 15 * 60_000) intentos.set(clave, { n: 1, desde: Date.now() });
  else x.n++;
}
export const limpiarFallos = (clave: string) => intentos.delete(clave);
