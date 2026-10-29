import { estadoAdmin } from "@/server/admin";
import { requiereAdmin } from "@/server/auth";
import { getDb } from "@/server/db";
import { ok, ruta } from "@/server/http";

export const dynamic = "force-dynamic";

/** Estado del backoffice: comercios, adelantos, KPIs, parámetros y bitácora. */
export const GET = ruta(async () => {
  const u = await requiereAdmin();
  return ok(await estadoAdmin(await getDb(), u));
});
