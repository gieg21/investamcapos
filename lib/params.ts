/**
 * Parámetros del adelanto de capital (MCA) para comercios con POS Disglobal.
 *
 * Los valores de abajo son solo los iniciales: en producción viven en la tabla `parametros`
 * (versionados, con doble aprobación) y se editan en Backoffice → Parámetros.
 * Deben validarlos Riesgo y Finanzas antes de salir a producción.
 */

export type Peso = "volumen" | "estabilidad" | "tendencia" | "actividad" | "antiguedad" | "rechazos";
export const PESO_LABEL: Record<Peso, string> = {
  volumen: "Volumen de ventas",
  estabilidad: "Estabilidad mes a mes",
  tendencia: "Tendencia reciente",
  actividad: "Días con ventas",
  antiguedad: "Antigüedad con Disglobal",
  rechazos: "Transacciones rechazadas",
};

export type Config = {
  oferta: {
    montoMin: number; // USD
    montoMax: number; // USD
    redondeo: number; // la oferta se redondea hacia abajo a este múltiplo
    pctVentasMensuales: number; // tope: % de las ventas mensuales promedio en USD
    /** Multiplicador sobre el tope según el score (escalones; se usa el más alto alcanzado). */
    escalones: { scoreMin: number; multiplicador: number }[];
  };
  precio: {
    costoMensual: number; // cargo por mes de plazo sobre el monto adelantado
    comisionApertura: number; // % sobre el monto, se suma al total a pagar
    plazos: number[]; // días que el comercio puede elegir
    retencionMinPct: number; // % de las ventas diarias que se retiene
    retencionMaxPct: number;
    diasGracia: number; // días después del plazo antes de marcar el adelanto como vencido
  };
  scoring: {
    ventanaMeses: number; // meses de ingresos que se analizan (los más recientes); la tendencia compara con los meses anteriores
    historialMinMeses: number; // corte: menos historia → sin oferta
    ventasMinUsd: number; // corte: ventas mensuales promedio mínimas
    diasActivosMinPct: number; // corte: % mínimo de días con ventas
    rechazoMaxPct: number; // corte: tasa de rechazo máxima
    scoreMin: number; // por debajo no hay oferta
    volumenRefUsd: number; // ventas mensuales que dan 100 puntos de volumen
    pesos: Record<Peso, number>; // suman 100
  };
  aprobacion: {
    automaticaHastaUsd: number; // solicitudes hasta este monto se aprueban solas…
    scoreAutoMin: number; // …si además el score es al menos este
    vigenciaOfertaDias: number; // la evaluación vale estos días; después se recalcula
  };
  /**
   * Comportamiento de pago del último adelanto desembolsado: sube o baja el cupo.
   * frecuencia = días con abono / días transcurridos; ritmo = % pagado / % del plazo transcurrido (1 = al día).
   */
  comportamiento: {
    frecuenciaBuena: number; // con esta frecuencia…
    ritmoBueno: number; // …y este ritmo, sin atraso: buen pagador
    multiplicadorBueno: number; // el cupo sube
    frecuenciaMin: number; // por debajo de esta frecuencia…
    ritmoMin: number; // …o de este ritmo: pago lento
    multiplicadorLento: number; // el cupo baja
    diasAtrasoMax: number; // más días de atraso sobre el plazo: sin oferta
  };
  /** Agentes de IA (Claude + Jev). Por defecto solo recomiendan; un rechazo nunca se aplica solo. */
  ia: {
    aplicarAutomatico: boolean; // aprobar solicitudes y KYC cuando Claude y Jev coinciden en aprobar
    confianzaMin: number; // 0–1: confianza mínima de ambos para aplicar
    montoAutoMaxUsd: number; // tope de monto para que el agente apruebe solo
  };
  /** Cobro voluntario: si un día no hay ventas por el POS, Disglobal no retiene nada; se avisa al comercio. */
  cobranza: {
    avisarSinVentas: boolean;
    diasSinVentasAviso: number; // días seguidos sin ventas antes de avisar
    seguimientoDiasEstancado: number; // días en la misma etapa del registro antes del aviso de seguimiento
  };
  kyc: {
    coincidenciaRostroMin: number; // % mínimo selfie vs. foto de la cédula para aprobar sin revisión
    intentosMax: number; // verificaciones rechazadas antes de exigir revisión del backoffice
  };
};

export const CONFIG_DEFAULT: Config = {
  oferta: {
    montoMin: 200,
    montoMax: 5000,
    redondeo: 50,
    pctVentasMensuales: 0.35,
    escalones: [
      { scoreMin: 50, multiplicador: 0.5 },
      { scoreMin: 65, multiplicador: 0.75 },
      { scoreMin: 80, multiplicador: 1 },
    ],
  },
  precio: {
    costoMensual: 0.07, // igual que el adelanto de capital de develop.grupoinvesta.com
    comisionApertura: 0.02,
    plazos: [30, 60, 90],
    retencionMinPct: 0.05,
    retencionMaxPct: 0.2,
    diasGracia: 15,
  },
  scoring: {
    ventanaMeses: 3,
    historialMinMeses: 3,
    ventasMinUsd: 600,
    diasActivosMinPct: 0.5,
    rechazoMaxPct: 0.15,
    scoreMin: 50,
    volumenRefUsd: 15000,
    pesos: { volumen: 30, estabilidad: 20, tendencia: 15, actividad: 15, antiguedad: 10, rechazos: 10 },
  },
  aprobacion: {
    automaticaHastaUsd: 1000,
    scoreAutoMin: 80,
    vigenciaOfertaDias: 7,
  },
  comportamiento: {
    frecuenciaBuena: 0.8,
    ritmoBueno: 1,
    multiplicadorBueno: 1.25,
    frecuenciaMin: 0.5,
    ritmoMin: 0.8,
    multiplicadorLento: 0.6,
    diasAtrasoMax: 15,
  },
  ia: {
    aplicarAutomatico: false,
    confianzaMin: 0.85,
    montoAutoMaxUsd: 1500,
  },
  cobranza: {
    avisarSinVentas: true,
    diasSinVentasAviso: 1,
    seguimientoDiasEstancado: 3,
  },
  kyc: {
    coincidenciaRostroMin: 70,
    intentosMax: 3,
  },
};

/** Validación de coherencia: la usa el servidor antes de aceptar una propuesta. Devuelve la lista de errores. */
export function validar(c: Config): string[] {
  const e: string[] = [];
  const { oferta: o, precio: p, scoring: s, aprobacion: a } = c;
  if (!(o.montoMin > 0)) e.push("El monto mínimo debe ser mayor que 0.");
  if (!(o.montoMax >= o.montoMin)) e.push("El monto máximo no puede ser menor que el mínimo.");
  if (!(o.redondeo > 0 && o.redondeo <= o.montoMin)) e.push("El redondeo debe ser mayor que 0 y no superar el monto mínimo.");
  if (!(o.pctVentasMensuales > 0 && o.pctVentasMensuales <= 2)) e.push("El % de ventas mensuales debe estar entre 0 y 200%.");
  if (!o.escalones.length) e.push("Debe haber al menos un escalón de score.");
  for (const x of o.escalones) {
    if (!(x.scoreMin >= 0 && x.scoreMin <= 100)) e.push("Los escalones usan score entre 0 y 100.");
    if (!(x.multiplicador > 0 && x.multiplicador <= 1.5)) e.push("El multiplicador de cada escalón va de 0 a 1,5.");
  }
  if (!(p.costoMensual >= 0 && p.costoMensual < 0.3)) e.push("El costo mensual debe estar entre 0% y 30%.");
  if (!(p.comisionApertura >= 0 && p.comisionApertura < 0.1)) e.push("La comisión de apertura debe estar entre 0% y 10%.");
  if (!p.plazos.length || p.plazos.some((d) => !(Number.isInteger(d) && d >= 7 && d <= 365))) e.push("Los plazos son días enteros entre 7 y 365.");
  if (!(p.retencionMinPct > 0 && p.retencionMinPct <= p.retencionMaxPct && p.retencionMaxPct <= 0.5)) e.push("La retención va de mínimo > 0 a máximo ≤ 50%, con mínimo ≤ máximo.");
  if (!(p.diasGracia >= 0)) e.push("Los días de gracia no pueden ser negativos.");
  if (!(s.ventanaMeses >= s.historialMinMeses && s.ventanaMeses <= 24)) e.push("La ventana de análisis debe ser ≥ historia mínima y ≤ 24 meses.");
  if (!(s.historialMinMeses >= 1)) e.push("La historia mínima es al menos 1 mes.");
  if (!(s.diasActivosMinPct >= 0 && s.diasActivosMinPct <= 1)) e.push("El % de días activos va de 0 a 100%.");
  if (!(s.rechazoMaxPct > 0 && s.rechazoMaxPct <= 1)) e.push("La tasa de rechazo máxima va de 0 a 100%.");
  if (!(s.scoreMin >= 0 && s.scoreMin <= 100)) e.push("El score mínimo va de 0 a 100.");
  if (!(s.volumenRefUsd > s.ventasMinUsd)) e.push("Las ventas de referencia deben superar las ventas mínimas.");
  const suma = Object.values(s.pesos).reduce((x, y) => x + y, 0);
  if (Math.abs(suma - 100) > 0.001) e.push(`Los pesos del score deben sumar 100 (hoy suman ${suma}).`);
  if (Object.values(s.pesos).some((w) => w < 0)) e.push("Ningún peso puede ser negativo.");
  if (!(a.automaticaHastaUsd >= 0)) e.push("El tope de aprobación automática no puede ser negativo.");
  if (!(a.vigenciaOfertaDias >= 1)) e.push("La oferta debe tener al menos 1 día de vigencia.");
  const b = c.comportamiento;
  if (!(b.frecuenciaMin >= 0 && b.frecuenciaMin <= b.frecuenciaBuena && b.frecuenciaBuena <= 1)) e.push("Frecuencias de pago: 0 ≤ mínima ≤ buena ≤ 100%.");
  if (!(b.ritmoMin > 0 && b.ritmoMin <= b.ritmoBueno && b.ritmoBueno <= 3)) e.push("Ritmos de pago: 0 < mínimo ≤ bueno ≤ 3.");
  if (!(b.multiplicadorBueno >= 1 && b.multiplicadorBueno <= 3)) e.push("El multiplicador de buen pagador va de 1 a 3.");
  if (!(b.multiplicadorLento > 0 && b.multiplicadorLento <= 1)) e.push("El multiplicador de pago lento va de 0 a 1.");
  if (!(b.diasAtrasoMax >= 0)) e.push("Los días de atraso máximos no pueden ser negativos.");
  if (!(c.ia.confianzaMin >= 0.5 && c.ia.confianzaMin <= 1)) e.push("La confianza mínima de los agentes va de 50% a 100%.");
  if (!(c.ia.montoAutoMaxUsd >= 0)) e.push("El tope de aprobación del agente no puede ser negativo.");
  if (!(Number.isInteger(c.cobranza.diasSinVentasAviso) && c.cobranza.diasSinVentasAviso >= 1)) e.push("Los días sin ventas antes del aviso son un entero ≥ 1.");
  if (!(c.cobranza.seguimientoDiasEstancado >= 1)) e.push("Los días de estancamiento son al menos 1.");
  if (!(c.kyc.coincidenciaRostroMin >= 0 && c.kyc.coincidenciaRostroMin <= 100)) e.push("La coincidencia de rostro va de 0 a 100%.");
  if (!(Number.isInteger(c.kyc.intentosMax) && c.kyc.intentosMax >= 1)) e.push("Los intentos de KYC son un entero ≥ 1.");
  return e;
}
