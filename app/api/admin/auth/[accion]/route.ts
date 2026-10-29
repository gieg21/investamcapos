import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminActual, cerrarSesion, crearSesion, frenarFuerzaBruta, limpiarFallos, registrarFallo, verificarPassword } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { ApiError, cuerpo, DEMO, noEncontrado, ok, ruta } from "@/server/http";
import { DEMO_ADMINS } from "@/server/seed";

export const dynamic = "force-dynamic";

const zLogin = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = ruta(async (req: Request, { params }: { params: { accion: string } }) => {
  if (params.accion === "logout") { await cerrarSesion("admin"); return ok(); }
  if (params.accion !== "login") throw noEncontrado();
  const x = await cuerpo(req, zLogin);
  const email = x.email.toLowerCase();
  frenarFuerzaBruta(email);
  const db = await getDb();
  const [u] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.email, email));
  if (!u || !u.activo || !(await verificarPassword(x.password, u.hash))) {
    registrarFallo(email);
    throw new ApiError(401, "Correo o contraseña incorrectos.");
  }
  limpiarFallos(email);
  await crearSesion(db, "admin", u.id);
  return ok();
});

/** Sesión actual y, en demo, los usuarios para entrar con un clic. */
export const GET = ruta(async () => ok({ usuario: await adminActual(), demo: DEMO ? DEMO_ADMINS.map((u) => ({ email: u.email, nombre: u.nombre, roles: u.roles })) : null }));
