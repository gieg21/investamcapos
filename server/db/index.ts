import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Conexión a PostgreSQL.
 * - Con `DATABASE_URL`: Postgres real (node-postgres).
 * - Sin ella: PGlite (Postgres embebido) en `.data/pg`, para desarrollo sin instalar nada.
 * Las migraciones (carpeta `drizzle/`) se aplican al arrancar y la semilla corre si la base está vacía.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export const DATA_DIR = process.env.INVESTA_DATA_DIR || path.join(process.cwd(), ".data");
const MIGRACIONES = path.join(process.cwd(), "drizzle");

const g = globalThis as unknown as { __mcaDb?: Promise<DB> };

async function conectar(): Promise<DB> {
  let db: DB;
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    const d = drizzle(pool, { schema });
    await migrate(d, { migrationsFolder: MIGRACIONES });
    db = d as unknown as DB;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = path.join(DATA_DIR, "pg");
    mkdirSync(dir, { recursive: true });
    const client = await PGlite.create(dir);
    const d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: MIGRACIONES });
    db = d as unknown as DB;
  }
  const { sembrarSiVacia } = await import("../seed");
  await sembrarSiVacia(db);
  // Las ventas de los días que el servidor estuvo apagado se cobran al arrancar.
  const { cierreDiario } = await import("../mca");
  await cierreDiario(db, "Sistema");
  return db;
}

/** Una sola conexión por proceso (sobrevive al hot reload de Next en desarrollo). */
export function getDb(): Promise<DB> {
  if (!g.__mcaDb) g.__mcaDb = conectar().catch((e) => { g.__mcaDb = undefined; throw e; });
  return g.__mcaDb;
}

export { schema };
