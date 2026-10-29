/**
 * Scoring del comercio a partir de su data transaccional en Disglobal.
 *
 * Funciones puras: el servidor las llama con la data del conector y la versión vigente de parámetros,
 * y la pantalla de Parámetros del backoffice las usa para simular el efecto de un cambio.
 *
 * Las ventas se registran en Bs; cada día se convierte a USD con la tasa BCV de ese día, para que la
 * devaluación no infle el volumen de los meses recientes.
 */
import type { Config, Peso } from "./params";
import { factorPrecio } from "./mca";

export type DiaVentas = { fecha: string; ventasBs: number; transacciones: number; rechazadas: number };
export type Tasa = { fecha: string; tasa: number };

export type Metricas = {
  mesesHistorial: number;
  ventasMensualesUsd: number; // promedio de los meses analizados
  ventasDiariasUsd: number;
  meses: { desde: string; ventasUsd: number }[]; // del más antiguo al más reciente
  cv: number; // coeficiente de variación mes a mes
  tendencia: number; // promedio de los últimos 3 meses / promedio de los anteriores
  diasActivosPct: number;
  rechazoPct: number;
  ticketPromedioUsd: number;
  antiguedadMeses: number;
};

export type Evaluacion = {
  score: number;
  subscores: Record<Peso, number>;
  metricas: Metricas;
  cortes: string[]; // motivos que impiden ofrecer (vacío si califica)
  montoMaxUsd: number; // 0 si no hay oferta
  calculo: { base: number; multiplicador: number; capacidad: number; tope: number };
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const DIA = 86_400_000;
const dia = (iso: string) => Date.parse(iso + "T12:00:00Z");
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Tasa BCV vigente en una fecha: la última publicada en o antes de ese día. `tasas` ordenadas por fecha ascendente. */
export function tasaEn(tasas: Tasa[], fecha: string): number | null {
  let lo = 0, hi = tasas.length - 1, r: number | null = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (tasas[m].fecha <= fecha) { r = tasas[m].tasa; lo = m + 1; } else hi = m - 1;
  }
  return r ?? tasas[0]?.tasa ?? null;
}

export function metricas(dias: DiaVentas[], tasas: Tasa[], hoy: string, afiliadoDesde: string, cfg: Config): Metricas {
  const fin = dia(hoy); // la ventana termina ayer
  const conVentas = dias.filter((d) => d.ventasBs > 0).map((d) => d.fecha).sort();
  const primera = conVentas[0];
  const mesesHistorial = primera ? Math.floor((fin - dia(primera)) / DIA / 30) : 0;
  const nMeses = Math.max(1, Math.min(cfg.scoring.ventanaMeses, mesesHistorial));
  const inicio = fin - nMeses * 30 * DIA;

  const meses = Array.from({ length: nMeses }, (_, i) => ({ desde: iso(inicio + i * 30 * DIA), ventasUsd: 0 }));
  let activos = 0, tx = 0, rech = 0, usdTotal = 0;
  for (const d of dias) {
    const t = dia(d.fecha);
    if (t < inicio || t >= fin) continue;
    const tasa = tasaEn(tasas, d.fecha);
    const usd = tasa ? d.ventasBs / tasa : 0;
    meses[Math.min(nMeses - 1, Math.floor((t - inicio) / DIA / 30))].ventasUsd += usd;
    usdTotal += usd;
    if (d.ventasBs > 0) activos++;
    tx += d.transacciones;
    rech += d.rechazadas;
  }
  const vals = meses.map((m) => m.ventasUsd);
  const media = vals.reduce((a, b) => a + b, 0) / nMeses;
  const desv = Math.sqrt(vals.reduce((a, v) => a + (v - media) ** 2, 0) / nMeses);
  const ult = vals.slice(-3), ant = vals.slice(0, -3);
  const prom = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const tendencia = ant.length && prom(ant) > 0 ? prom(ult) / prom(ant) : 1;

  return {
    mesesHistorial,
    ventasMensualesUsd: media,
    ventasDiariasUsd: media / 30,
    meses: meses.map((m) => ({ ...m, ventasUsd: Math.round(m.ventasUsd * 100) / 100 })),
    cv: media > 0 ? desv / media : 1,
    tendencia,
    diasActivosPct: activos / (nMeses * 30),
    rechazoPct: tx + rech > 0 ? rech / (tx + rech) : 0,
    ticketPromedioUsd: tx > 0 ? usdTotal / tx : 0,
    antiguedadMeses: Math.max(0, Math.floor((fin - dia(afiliadoDesde)) / DIA / 30)),
  };
}

export function subscores(m: Metricas, cfg: Config): Record<Peso, number> {
  const s = cfg.scoring;
  const min = Math.max(1, s.ventasMinUsd);
  const r = (x: number) => Math.round(clamp(x) * 100);
  return {
    volumen: m.ventasMensualesUsd > 0 ? r(Math.log(m.ventasMensualesUsd / min) / Math.log(s.volumenRefUsd / min)) : 0,
    estabilidad: r(1 - m.cv / 0.6),
    tendencia: r((m.tendencia - 0.7) / 0.4),
    actividad: r((m.diasActivosPct - 0.3) / 0.65),
    antiguedad: r(m.antiguedadMeses / 24),
    rechazos: r(1 - m.rechazoPct / s.rechazoMaxPct),
  };
}

/** Evalúa al comercio: score, cortes y monto máximo de adelanto (entre montoMin y montoMax, o 0 si no califica). */
export function evaluar(m: Metricas, cfg: Config, estatusDisglobal: "activo" | "suspendido" | "retirado" = "activo"): Evaluacion {
  const s = cfg.scoring, o = cfg.oferta, p = cfg.precio;
  const sub = subscores(m, cfg);
  const score = Math.round((Object.keys(sub) as Peso[]).reduce((a, k) => a + sub[k] * s.pesos[k], 0) / 100);

  const cortes: string[] = [];
  if (estatusDisglobal !== "activo") cortes.push(`El comercio figura como ${estatusDisglobal} en Disglobal.`);
  if (m.mesesHistorial < s.historialMinMeses) cortes.push(`Tiene ${m.mesesHistorial} mes(es) de ventas con el POS; se piden al menos ${s.historialMinMeses}.`);
  if (m.ventasMensualesUsd < s.ventasMinUsd) cortes.push(`Vende en promedio USD ${Math.round(m.ventasMensualesUsd)} al mes; el mínimo es USD ${s.ventasMinUsd}.`);
  if (m.diasActivosPct < s.diasActivosMinPct) cortes.push(`Vendió ${Math.round(m.diasActivosPct * 100)}% de los días; el mínimo es ${Math.round(s.diasActivosMinPct * 100)}%.`);
  if (m.rechazoPct > s.rechazoMaxPct) cortes.push(`Rechazos de ${(m.rechazoPct * 100).toFixed(1)}%; el máximo es ${Math.round(s.rechazoMaxPct * 100)}%.`);
  if (score < s.scoreMin) cortes.push(`Score ${score}; el mínimo para recibir oferta es ${s.scoreMin}.`);

  const escalon = [...o.escalones].sort((a, b) => b.scoreMin - a.scoreMin).find((e) => score >= e.scoreMin);
  const multiplicador = escalon?.multiplicador ?? 0;
  const base = m.ventasMensualesUsd * o.pctVentasMensuales * multiplicador;
  // Lo que puede devolver en el plazo más largo reteniendo el máximo permitido de sus ventas diarias.
  const plazoMax = Math.max(...p.plazos);
  const capacidad = (m.ventasDiariasUsd * p.retencionMaxPct * plazoMax) / factorPrecio(plazoMax, cfg);
  const tope = Math.floor(Math.min(base, capacidad, o.montoMax) / o.redondeo) * o.redondeo;
  if (!cortes.length && tope < o.montoMin) cortes.push(`Su capacidad de pago alcanza para USD ${Math.max(0, tope)}; el adelanto mínimo es USD ${o.montoMin}.`);

  return {
    score,
    subscores: sub,
    metricas: m,
    cortes,
    montoMaxUsd: cortes.length ? 0 : tope,
    calculo: { base: Math.round(base), multiplicador, capacidad: Math.round(capacidad), tope: Math.max(0, tope) },
  };
}
