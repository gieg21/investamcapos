import { detalleComercio } from "@/server/admin";
import { requiereAdmin } from "@/server/auth";
import { getDb } from "@/server/db";
import { ok, ruta } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = ruta(async (_req: Request, { params }: { params: { id: string } }) => {
  await requiereAdmin();
  return ok(await detalleComercio(await getDb(), params.id));
});
