import "server-only";
import { eq, sql } from "drizzle-orm";
import { addDays, isoDay } from "@/lib/format";
import { CONFIG_DEFAULT } from "@/lib/params";
import { hashPassword, nuevoId } from "./auth";
import { schema, type DB } from "./db";
import { DEMO_COMERCIOS, disglobal } from "./disglobal";
import { DEMO } from "./http";
import { desembolsar, evaluarComercio } from "./mca";
import { cotizar } from "@/lib/mca";
import { sembrarKycAprobado } from "./kyc";
import { registrar } from "./repo";
import { sembrarTasas } from "./tasas";

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Investa2026!";
export const DEMO_ADMINS = [
  { email: "admin@grupoinvesta.com", nombre: "Gabriela Admin", roles: ["admin"] as const },
  { email: "admin2@grupoinvesta.com", nombre: "Andrés Admin", roles: ["admin"] as const },
  { email: "riesgo@grupoinvesta.com", nombre: "Rosa Riesgo", roles: ["riesgo"] as const },
  { email: "operaciones@grupoinvesta.com", nombre: "Óscar Operaciones", roles: ["operaciones"] as const },
];

export async function sembrarSiVacia(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.usuarios);
  if (n > 0) return;

  await db.insert(schema.parametros).values({ valores: CONFIG_DEFAULT, estado: "aprobada", nota: "Valores iniciales (provisionales: validar con Riesgo y Finanzas)", propuestoPor: "Sistema", propuestoPorId: "sistema", aprobadoPor: "Sistema", aprobadoEn: new Date(), vigenteDesde: "2026-01-01" });

  if (!DEMO) {
    const email = process.env.ADMIN_EMAIL, pwd = process.env.ADMIN_PASSWORD;
    if (!email || !pwd) throw new Error("Base vacía: define ADMIN_EMAIL y ADMIN_PASSWORD para crear el primer Administrador.");
    await db.insert(schema.usuarios).values({ id: nuevoId("u_"), email, nombre: process.env.ADMIN_NOMBRE || "Administrador", hash: await hashPassword(pwd), roles: ["admin"] });
    return;
  }

  const hash = await hashPassword(DEMO_PASSWORD);
  for (const u of DEMO_ADMINS) await db.insert(schema.usuarios).values({ id: nuevoId("u_"), email: u.email, nombre: u.nombre, hash, roles: [...u.roles] });
  await sembrarTasas(db);

  // Tres comercios que ya pasaron por el onboarding, para que el backoffice tenga cartera.
  const ids: Record<string, string> = {};
  for (const d of DEMO_COMERCIOS.slice(0, 3)) {
    const f = (await disglobal.comercio(d.rif))!;
    const id = nuevoId("c_");
    ids[d.rif] = id;
    await db.insert(schema.comercios).values({ id, rif: f.rif, razonSocial: f.razonSocial, nombreComercial: f.nombreComercial, telefono: f.telefono, email: f.email, disglobal: f, confirmadoEn: addDays(new Date(), -50) });
    await db.insert(schema.terminales).values({ serial: d.serial, comercioId: id, modelo: d.modelo, verificada: true });
    await registrar(db, f.nombreComercial, "Onboarding desde POS", `RIF ${f.rif} desde ${d.modelo} ${d.serial} (demo)`, id);
    const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, id));
    await sembrarKycAprobado(db, c);
  }

  // Panadería: adelanto desembolsado hace 40 días, cobrándose con la retención diaria.
  // Farmacia: uno ya pagado y uno nuevo en revisión. Bodega: sin adelanto.
  const crear = async (rif: string, monto: number, plazo: number, diasAtras: number | null, estado: "aprobado" | "en_revision") => {
    const [c] = await db.select().from(schema.comercios).where(eq(schema.comercios.id, ids[rif]));
    const ev = await evaluarComercio(db, c, "Sistema");
    const q = cotizar(monto, plazo, ev.detalle.metricas.ventasDiariasUsd, CONFIG_DEFAULT);
    const id = nuevoId("a_");
    await db.insert(schema.adelantos).values({
      id, comercioId: c.id, evaluacionId: ev.id, paramsVersion: ev.paramsVersion, estado, montoUsd: q.montoUsd, plazoDias: q.plazoDias,
      cargoUsd: q.cargoUsd, comisionUsd: q.comisionUsd, totalUsd: q.totalUsd, retencionPct: q.retencionPct, saldoUsd: q.totalUsd,
      aprobadoPor: estado === "aprobado" ? "Rosa Riesgo" : null, aceptadoEn: addDays(new Date(), -(diasAtras ?? 0) - 1), creado: addDays(new Date(), -(diasAtras ?? 0) - 1),
    });
    if (diasAtras != null) {
      // Si el día cae en fin de semana no hay tasa publicada: se usa el hábil anterior.
      let d = addDays(new Date(), -diasAtras);
      while ([0, 6].includes(d.getDay())) d = addDays(d, -1);
      await desembolsar(db, "Óscar Operaciones", id, `R4-${Math.floor(1e7 + Math.random() * 9e7)}`, isoDay(d));
    }
  };
  await crear(DEMO_COMERCIOS[0].rif, 4000, 90, 40, "aprobado");
  await crear(DEMO_COMERCIOS[1].rif, 1500, 60, 75, "aprobado");
  await crear(DEMO_COMERCIOS[1].rif, 2000, 60, null, "en_revision");
  // El cierre diario que corre al conectar cobra los días transcurridos: el de la Farmacia (75 días, plazo 60) queda pagado.
}
