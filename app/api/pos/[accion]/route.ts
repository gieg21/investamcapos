import { cerrarSesion, frenarFuerzaBruta, registrarFallo, requierePos } from "@/server/auth";
import { getDb } from "@/server/db";
import { DEMO_COMERCIOS } from "@/server/disglobal";
import { ApiError, cuerpo, DEMO, enSerie, noEncontrado, ok, ruta } from "@/server/http";
import { completarSimulado, consultarKyc, iniciarKyc, zSimulado } from "@/server/kyc";
import { z } from "zod";
import { confirmarOnboarding, consultarRif, estadoPos, marcarLeido, reportarPago, solicitar, zConfirmar, zConsulta, zReporte, zSolicitud } from "@/server/mca";

export const dynamic = "force-dynamic";

/**
 * API de la app del POS (la abre el WebView Android en la terminal Disglobal).
 *   POST /api/pos/consulta   { rif, serial }            → ficha de Disglobal para autocompletar
 *   POST /api/pos/confirmar  { rif, serial, telefono, email, nota?, acepto } → abre sesión del POS y corre el scoring
 *   GET  /api/pos/estado                                 → oferta, adelanto en curso y pagos
 *   POST /api/pos/kyc-iniciar                           → URL del flujo de Didit (o intento simulado en demo)
 *   POST /api/pos/kyc-consultar                         → al volver de Didit, lee la decisión si el webhook no llegó
 *   POST /api/pos/kyc-simular { escenario }             → solo demo
 *   POST /api/pos/solicitar  { montoUsd, plazoDias, acepto } (exige KYC aprobado)
 *   POST /api/pos/aviso-reportar { id, referencia, montoBs, fecha } → pago voluntario en un día sin ventas
 *   POST /api/pos/aviso-leido { id }
 *   POST /api/pos/salir
 */
export const GET = ruta(async (_req: Request, { params }: { params: { accion: string } }) => {
  // Solo demo: comercios de la base simulada de Disglobal con el serial de su terminal, para probar sin un POS.
  if (params.accion === "demo") return ok(DEMO ? DEMO_COMERCIOS.map((c) => ({ rif: c.rif, nombre: c.nombre, serial: c.serial, modelo: c.modelo })) : []);
  if (params.accion !== "estado") throw noEncontrado();
  const { comercio } = await requierePos();
  return ok(await estadoPos(await getDb(), comercio));
});

export const POST = ruta(async (req: Request, { params }: { params: { accion: string } }) => {
  const db = await getDb();
  switch (params.accion) {
    case "consulta": {
      const x = await cuerpo(req, zConsulta);
      // Por terminal: evita que alguien recorra RIFs desde un mismo equipo.
      const clave = `pos:${x.serial ?? req.headers.get("x-forwarded-for") ?? "?"}`;
      frenarFuerzaBruta(clave, 10);
      try { return ok(await consultarRif(db, x)); } catch (e) { if (e instanceof ApiError && e.status !== 503) registrarFallo(clave); throw e; }
    }
    case "confirmar": {
      const x = await cuerpo(req, zConfirmar);
      await enSerie(() => confirmarOnboarding(db, x));
      return ok();
    }
    case "solicitar": {
      const { comercio, serial } = await requierePos();
      const x = await cuerpo(req, zSolicitud);
      await enSerie(() => solicitar(db, comercio, serial, x));
      return ok(await estadoPos(db, comercio));
    }
    case "kyc-iniciar": {
      const { comercio } = await requierePos();
      const r = await enSerie(() => iniciarKyc(db, comercio, new URL(req.url).origin));
      return ok({ ...r, estado: await estadoPos(db, comercio) });
    }
    case "kyc-consultar": {
      const { comercio } = await requierePos();
      await enSerie(() => consultarKyc(db, comercio));
      return ok(await estadoPos(db, comercio));
    }
    case "kyc-simular": {
      const { comercio } = await requierePos();
      const x = await cuerpo(req, zSimulado);
      await enSerie(() => completarSimulado(db, comercio, x.escenario));
      return ok(await estadoPos(db, comercio));
    }
    case "aviso-reportar": {
      const { comercio } = await requierePos();
      const x = await cuerpo(req, zReporte);
      await enSerie(() => reportarPago(db, comercio, x));
      return ok(await estadoPos(db, comercio));
    }
    case "aviso-leido": {
      const { comercio } = await requierePos();
      const x = await cuerpo(req, z.object({ id: z.string() }));
      await marcarLeido(db, comercio, x.id);
      return ok(await estadoPos(db, comercio));
    }
    case "salir": await cerrarSesion("pos"); return ok();
    default: throw noEncontrado();
  }
});
