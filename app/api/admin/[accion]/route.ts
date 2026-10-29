import { z } from "zod";
import { estadoAdmin } from "@/server/admin";
import { exigir, requiereAdmin } from "@/server/auth";
import { getDb } from "@/server/db";
import { cuerpo, enSerie, noEncontrado, ok, ruta } from "@/server/http";
import { aprobar, bloquear, cierreDiario, desembolsarAdmin, pagoManual, rechazar, reevaluar, zPagoManual } from "@/server/mca";
import { habilitarIntento, revisarKyc, zRevision } from "@/server/kyc";
import { aprobarPropuesta, proponer, rechazarPropuesta, zPropuesta } from "@/server/parametros";
import { historialTasas, importarTasas, registrarTasa, zTasa } from "@/server/tasas";

export const dynamic = "force-dynamic";

const zId = z.object({ id: z.string().min(1) });
const zMotivo = zId.extend({ motivo: z.string().max(500) });

/** Acciones del backoffice. Cada servicio valida el permiso del rol; devuelven el estado actualizado. */
export const POST = ruta(async (req: Request, { params }: { params: { accion: string } }) => {
  const u = await requiereAdmin();
  const db = await getDb();
  let resultado: unknown = null;
  await enSerie(async () => {
    switch (params.accion) {
      case "aprobar": return aprobar(db, u, (await cuerpo(req, zId)).id);
      case "rechazar": { const x = await cuerpo(req, zMotivo); return rechazar(db, u, x.id, x.motivo); }
      case "desembolsar": { const x = await cuerpo(req, zId.extend({ referencia: z.string() })); return desembolsarAdmin(db, u, x.id, x.referencia); }
      case "pago-manual": return pagoManual(db, u, await cuerpo(req, zPagoManual));
      case "cierre": exigir(u, "mover_dinero"); resultado = await cierreDiario(db, u.nombre); return;
      case "reevaluar": return reevaluar(db, u, (await cuerpo(req, zId)).id);
      case "bloquear": { const x = await cuerpo(req, zMotivo.extend({ bloqueado: z.boolean() })); return bloquear(db, u, x.id, x.bloqueado, x.motivo); }
      case "kyc-revisar": return revisarKyc(db, u, await cuerpo(req, zRevision));
      case "kyc-habilitar": return habilitarIntento(db, u, (await cuerpo(req, zId)).id);
      case "tasa": return registrarTasa(db, u, await cuerpo(req, zTasa));
      case "tasas-importar": resultado = await importarTasas(db, u, (await cuerpo(req, z.object({ texto: z.string().max(200_000) }))).texto); return;
      case "tasas": resultado = await historialTasas(db, 120); return;
      case "parametros-proponer": return proponer(db, u, await cuerpo(req, zPropuesta));
      case "parametros-aprobar": return aprobarPropuesta(db, u);
      case "parametros-rechazar": return rechazarPropuesta(db, u, (await cuerpo(req, z.object({ motivo: z.string().max(500) }))).motivo);
      default: throw noEncontrado();
    }
  });
  return ok({ resultado, estado: await estadoAdmin(db, u) });
});
