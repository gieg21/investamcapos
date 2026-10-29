import assert from "node:assert/strict";
import { test } from "node:test";
import { abonoDelDia, cotizar, factorPrecio } from "./mca";
import { CONFIG_DEFAULT as cfg, validar } from "./params";
import { evaluar, metricas, tasaEn, type DiaVentas, type Tasa } from "./scoring";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const HOY = "2026-10-29";
const dias = (n: number, f: (i: number) => number): DiaVentas[] =>
  Array.from({ length: n }, (_, i) => ({ fecha: iso(new Date(Date.parse(HOY) - (n - i) * 86_400_000)), ventasBs: f(i), transacciones: 20, rechazadas: 0 }));
const tasasPlanas: Tasa[] = [{ fecha: "2025-01-01", tasa: 100 }];

test("los parámetros iniciales son coherentes", () => assert.deepEqual(validar(cfg), []));

test("tasaEn usa la última tasa publicada en o antes de la fecha (fines de semana)", () => {
  const ts = [{ fecha: "2026-10-23", tasa: 10 }, { fecha: "2026-10-26", tasa: 11 }];
  assert.equal(tasaEn(ts, "2026-10-25"), 10);
  assert.equal(tasaEn(ts, "2026-10-26"), 11);
  assert.equal(tasaEn(ts, "2026-12-01"), 11);
});

test("las ventas en Bs se convierten a USD con la tasa de cada día", () => {
  // Mismo volumen en USD aunque los Bs se dupliquen por la devaluación.
  const ts: Tasa[] = [{ fecha: "2025-01-01", tasa: 100 }, { fecha: iso(new Date(Date.parse(HOY) - 90 * 86_400_000)), tasa: 200 }];
  const d = dias(180, (i) => (i < 90 ? 100 * 100 : 100 * 200));
  const m = metricas(d, ts, HOY, "2024-01-01", cfg);
  assert.ok(Math.abs(m.ventasMensualesUsd - 3000) < 1, `ventas ${m.ventasMensualesUsd}`);
  assert.ok(m.cv < 0.01);
});

test("comercio sólido: oferta topada en USD 5.000", () => {
  const m = metricas(dias(400, () => 800 * 100), tasasPlanas, HOY, "2023-01-01", cfg); // USD 800/día ≈ 24.000/mes
  const ev = evaluar(m, cfg);
  assert.deepEqual(ev.cortes, []);
  assert.equal(ev.montoMaxUsd, 5000);
  assert.ok(ev.score >= 80);
});

test("oferta entre el mínimo y el máximo, en múltiplos del redondeo", () => {
  const m = metricas(dias(200, () => 120 * 100), tasasPlanas, HOY, "2025-06-01", cfg); // ≈ USD 3.600/mes
  const ev = evaluar(m, cfg);
  assert.ok(ev.montoMaxUsd >= cfg.oferta.montoMin && ev.montoMaxUsd <= cfg.oferta.montoMax, String(ev.montoMaxUsd));
  assert.equal(ev.montoMaxUsd % cfg.oferta.redondeo, 0);
});

test("poca historia o suspendido en Disglobal: sin oferta", () => {
  const nuevo = evaluar(metricas(dias(45, () => 500 * 100), tasasPlanas, HOY, "2026-09-01", cfg), cfg);
  assert.equal(nuevo.montoMaxUsd, 0);
  assert.match(nuevo.cortes.join(" "), /mes\(es\) de ventas/);
  const susp = evaluar(metricas(dias(400, () => 800 * 100), tasasPlanas, HOY, "2023-01-01", cfg), cfg, "suspendido");
  assert.equal(susp.montoMaxUsd, 0);
});

test("cotización: total, retención y plazo no disponible", () => {
  const q = cotizar(1000, 60, 100, cfg);
  assert.ok(Math.abs(q.totalUsd - 1000 * factorPrecio(60, cfg)) < 0.01);
  assert.equal(q.totalUsd, 1160); // 7% × 2 meses + 2% de apertura
  assert.equal(q.retencionPct, 0.195); // 1160 / (60 × 100) = 19,33% → 19,5%
  assert.ok(q.disponible);
  assert.equal(cotizar(1000, 30, 100, cfg).disponible, false); // necesitaría 36% de retención
});

test("abono diario en Bs a la tasa del día, sin pasarse del saldo", () => {
  const a = abonoDelDia(100, 50_000, 0.1, 900); // retiene Bs 5.000 = USD 5,56
  assert.equal(a.montoBs, 5000);
  assert.equal(a.montoUsd, 5.56);
  assert.equal(a.saldoUsd, 94.44);
  const ultimo = abonoDelDia(2, 50_000, 0.1, 900); // solo le quedan USD 2 = Bs 1.800
  assert.equal(ultimo.montoBs, 1800);
  assert.equal(ultimo.saldoUsd, 0);
});

test("comportamiento de pago: bueno sube el cupo, lento lo baja, moroso lo corta", async () => {
  const { comportamientoPago } = await import("./scoring");
  const fechas = (desde: string, n: number, cada = 1) => Array.from({ length: n }, (_, i) => iso(new Date(Date.parse(desde) + (i * cada + 1) * 86_400_000)));
  const a = { id: "a", desembolsadoEn: "2026-07-01", venceEn: "2026-08-30", plazoDias: 60, totalUsd: 1160 };
  // Pagó en 50 días con abono diario: bueno.
  const bueno = comportamientoPago({ ...a, saldoUsd: 0 }, fechas("2026-07-01", 50), HOY, cfg);
  assert.equal(bueno.clase, "bueno");
  assert.equal(bueno.multiplicador, cfg.comportamiento.multiplicadorBueno);
  // En curso: a 40 días del desembolso lleva 30% pagado, abonando día por medio: lento.
  const lento = comportamientoPago({ ...a, saldoUsd: 812 }, fechas("2026-07-01", 20, 2), "2026-08-10", cfg);
  assert.equal(lento.clase, "lento");
  // Pagó 40 días después del vencimiento: moroso → sin oferta.
  const moroso = comportamientoPago({ ...a, saldoUsd: 0 }, [...fechas("2026-07-01", 60), "2026-10-09"], HOY, cfg);
  assert.equal(moroso.clase, "moroso");
  const m = metricas(dias(400, () => 800 * 100), tasasPlanas, HOY, "2023-01-01", cfg);
  assert.equal(evaluar(m, cfg, "activo", moroso).montoMaxUsd, 0);
  // El ajuste multiplica la base por ventas (antes de los topes).
  const mm = metricas(dias(200, () => 60 * 100), tasasPlanas, HOY, "2025-06-01", cfg);
  assert.ok(evaluar(mm, cfg, "activo", bueno).montoMaxUsd > evaluar(mm, cfg).montoMaxUsd);
  assert.ok(evaluar(mm, cfg, "activo", lento).montoMaxUsd < evaluar(mm, cfg).montoMaxUsd);
});
