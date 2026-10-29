import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluarKyc, similitudNombre, type ResultadoKyc } from "./kyc";

const rep = { nombre: "María Fernanda Pérez", cedula: "V-12345678" };
const cfg = { coincidenciaRostroMin: 70 };
const HOY = "2026-10-29";
const base: ResultadoKyc = { decisionProveedor: "aprobado", documento: "12.345.678", nombre: "PEREZ MARIA FERNANDA", vencimiento: "2030-01-01", vivo: true, coincidenciaRostro: 92 };

test("nombres: tolera orden, mayúsculas, acentos y nombres faltantes", () => {
  assert.equal(similitudNombre("PEREZ MARIA FERNANDA", "María Fernanda Pérez"), 1);
  assert.equal(similitudNombre("María Pérez", "María Fernanda Pérez Gómez"), 1);
  assert.equal(similitudNombre("Pedro Martínez", "María Fernanda Pérez"), 0);
});

test("el representante legal con todo en verde se aprueba", () => {
  assert.equal(evaluarKyc(base, rep, cfg, HOY).estado, "aprobado");
});

test("otra persona (cédula distinta) se rechaza aunque Didit apruebe el documento", () => {
  const r = evaluarKyc({ ...base, documento: "V-14555666", nombre: "PEDRO MARTINEZ" }, rep, cfg, HOY);
  assert.equal(r.estado, "rechazado");
  assert.equal(r.checks.find((c) => c.id === "cedula")!.estado, "fail");
});

test("sin prueba de vida o rechazado por el proveedor: rechazado", () => {
  assert.equal(evaluarKyc({ ...base, vivo: false }, rep, cfg, HOY).estado, "rechazado");
  assert.equal(evaluarKyc({ ...base, decisionProveedor: "rechazado" }, rep, cfg, HOY).estado, "rechazado");
});

test("rostro bajo el mínimo, cédula vencida o nombre parcial: a revisión", () => {
  assert.equal(evaluarKyc({ ...base, coincidenciaRostro: 55 }, rep, cfg, HOY).estado, "en_revision");
  assert.equal(evaluarKyc({ ...base, vencimiento: "2025-01-01" }, rep, cfg, HOY).estado, "en_revision");
  assert.equal(evaluarKyc({ ...base, nombre: "MARIA GONZALEZ" }, rep, cfg, HOY).estado, "en_revision");
  assert.equal(evaluarKyc({ ...base, documento: null }, rep, cfg, HOY).estado, "en_revision");
});
