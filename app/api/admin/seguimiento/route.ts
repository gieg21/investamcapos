import { requiereAdmin } from "@/server/auth";
import { getDb } from "@/server/db";
import { ok, ruta } from "@/server/http";
import { estadoSeguimiento } from "@/server/seguimiento";

export const dynamic = "force-dynamic";

/** Seguimiento de comercios: embudo, frecuencia de uso y segmentación. */
export const GET = ruta(async () => {
  await requiereAdmin();
  return ok(await estadoSeguimiento(await getDb()));
});
