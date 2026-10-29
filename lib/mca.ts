/**
 * Precio y cobro del adelanto (MCA).
 *
 * - El comercio elige monto y plazo. Total a pagar = monto × (1 + costoMensual × plazo/30 + comisión de apertura).
 * - Se cobra reteniendo un % de sus ventas diarias del POS, calculado para pagar en el plazo elegido.
 * - La deuda está en USD. El desembolso se hace en Bs a la tasa BCV del día del desembolso, y cada
 *   retención en Bs abona al saldo en USD a la tasa BCV del día del pago.
 */
import type { Config } from "./params";

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Multiplicador del total a pagar para un plazo: 1 + cargo por plazo + comisión de apertura. */
export function factorPrecio(plazoDias: number, cfg: Config) {
  return 1 + cfg.precio.costoMensual * (plazoDias / 30) + cfg.precio.comisionApertura;
}

export type Cotizacion = {
  montoUsd: number;
  plazoDias: number;
  cargoUsd: number;
  comisionUsd: number;
  totalUsd: number;
  retencionPct: number;
  cuotaDiariaUsd: number; // estimada con las ventas diarias promedio
  diasEstimados: number;
  disponible: boolean;
  motivo?: string;
};

/** Retención en pasos de 0,5%, nunca menor que el mínimo. */
const redondearRetencion = (x: number, min: number) => Math.max(min, Math.ceil(x * 200) / 200);

export function cotizar(montoUsd: number, plazoDias: number, ventasDiariasUsd: number, cfg: Config): Cotizacion {
  const p = cfg.precio;
  const cargoUsd = r2(montoUsd * p.costoMensual * (plazoDias / 30));
  const comisionUsd = r2(montoUsd * p.comisionApertura);
  const totalUsd = r2(montoUsd + cargoUsd + comisionUsd);
  const necesaria = ventasDiariasUsd > 0 ? totalUsd / (plazoDias * ventasDiariasUsd) : Infinity;
  const retencionPct = redondearRetencion(necesaria, p.retencionMinPct);
  const cuotaDiariaUsd = r2(ventasDiariasUsd * retencionPct);
  const base = { montoUsd, plazoDias, cargoUsd, comisionUsd, totalUsd, retencionPct, cuotaDiariaUsd, diasEstimados: cuotaDiariaUsd > 0 ? Math.ceil(totalUsd / cuotaDiariaUsd) : 0 };
  if (montoUsd < cfg.oferta.montoMin) return { ...base, disponible: false, motivo: `El mínimo es USD ${cfg.oferta.montoMin}.` };
  if (!p.plazos.includes(plazoDias)) return { ...base, disponible: false, motivo: "Plazo no disponible." };
  if (necesaria > p.retencionMaxPct)
    return { ...base, disponible: false, motivo: `Para pagar en ${plazoDias} días habría que retener ${(necesaria * 100).toFixed(1)}% de tus ventas; el máximo es ${Math.round(p.retencionMaxPct * 100)}%. Elige un plazo más largo o un monto menor.` };
  return { ...base, disponible: true };
}

/** Abono de un día: retención sobre las ventas en Bs, convertida a USD con la tasa BCV del día, sin pasarse del saldo. */
export function abonoDelDia(saldoUsd: number, ventasBs: number, retencionPct: number, tasaBcv: number) {
  const tope = saldoUsd * tasaBcv;
  const montoBs = r2(Math.min(ventasBs * retencionPct, tope));
  const montoUsd = montoBs >= tope - 0.005 ? saldoUsd : r2(montoBs / tasaBcv);
  return { montoBs, montoUsd, saldoUsd: r2(Math.max(0, saldoUsd - montoUsd)) };
}
