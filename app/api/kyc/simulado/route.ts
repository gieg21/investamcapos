import { z } from "zod";
import { getDb } from "@/server/db";
import { cuerpo, enSerie, invalido, ok, ruta } from "@/server/http";
import { completarSimuladoTelefono, intentoPorToken, zSimuladoTelefono } from "@/server/kyc";

export const dynamic = "force-dynamic";

/** Solo demo: la página que abre el teléfono al escanear el QR del POS (reemplaza el flujo de Didit). */
export const GET = ruta(async (req: Request) => {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!z.string().min(10).max(64).safeParse(t).success) throw invalido("Código no válido.");
  return ok(await intentoPorToken(await getDb(), t));
});

export const POST = ruta(async (req: Request) => {
  const db = await getDb();
  const x = await cuerpo(req, zSimuladoTelefono);
  await enSerie(() => completarSimuladoTelefono(db, x));
  return ok();
});
