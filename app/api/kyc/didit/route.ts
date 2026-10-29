import { getDb } from "@/server/db";
import { enSerie, ok, ruta } from "@/server/http";
import { webhookDidit } from "@/server/kyc";

export const dynamic = "force-dynamic";

/** Webhook de Didit: avisa cuando una verificación termina. La firma se valida con el cuerpo crudo. */
export const POST = ruta(async (req: Request) => {
  const crudo = await req.text();
  const db = await getDb();
  await enSerie(() => webhookDidit(db, crudo, req.headers.get("x-signature"), req.headers.get("x-timestamp")));
  return ok();
});
