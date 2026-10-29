import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { ok, ruta } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = ruta(async () => {
  await (await getDb()).execute(sql`select 1`);
  return ok({ ok: true });
});
