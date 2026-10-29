import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

/** Error de negocio con código HTTP: el mensaje se muestra tal cual al usuario. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const noAutorizado = () => new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
export const prohibido = (m = "No tienes permiso para esta acción.") => new ApiError(403, m);
export const noEncontrado = (m = "No encontrado.") => new ApiError(404, m);
export const invalido = (m: string) => new ApiError(400, m);
export const conflicto = (m: string) => new ApiError(409, m);

export const ok = (data: unknown = { ok: true }, init?: ResponseInit) => NextResponse.json(data, init);

/** Envuelve un handler: convierte ApiError/ZodError en respuestas JSON `{ error }` y oculta los errores internos. */
export function ruta<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Datos inválidos: " + e.issues.map((i) => `${i.path.join(".") || "cuerpo"} ${i.message}`).join("; ") }, { status: 400 });
      console.error("[api]", e);
      return NextResponse.json({ error: "Error interno. Intenta de nuevo." }, { status: 500 });
    }
  };
}

export async function cuerpo<T>(req: Request, esquema: ZodType<T>): Promise<T> {
  let raw: unknown = {};
  try { const t = await req.text(); raw = t ? JSON.parse(t) : {}; } catch { throw invalido("El cuerpo debe ser JSON."); }
  return esquema.parse(raw);
}

/** Mutaciones en serie dentro del proceso: evita que el motor y dos analistas decidan sobre el mismo estado a la vez. */
let cola: Promise<unknown> = Promise.resolve();
export function enSerie<T>(fn: () => Promise<T>): Promise<T> {
  const p = cola.then(fn, fn);
  cola = p.catch(() => {});
  return p;
}

export const DEMO = process.env.INVESTA_DEMO ? process.env.INVESTA_DEMO === "1" : process.env.NODE_ENV !== "production";
