import "server-only";
import { parseRif, rifCon } from "@/lib/rif";
import type { DiaVentas } from "@/lib/scoring";
import { ApiError, DEMO } from "./http";

/**
 * Conector con la base de datos de Disglobal.
 *
 * Disglobal es el dueño de la relación con el comercio y de su POS: conoce su ficha (RIF, razón social,
 * representante, cuenta de liquidación, terminales) y cada transacción que pasa por sus terminales.
 * Con eso, el onboarding solo pide el RIF y el scoring usa ventas reales.
 *
 * TODO(Disglobal): conectar la API real cuando Disglobal entregue la documentación. Lo que se necesita:
 *   GET  {DISGLOBAL_API_URL}/comercios/{rif}                 → ficha del comercio y sus terminales
 *   GET  {DISGLOBAL_API_URL}/comercios/{rif}/ventas?desde&hasta → ventas diarias en Bs (aprobadas y rechazadas)
 *   Retención en la liquidación: que Disglobal retenga el % del adelanto de las ventas del día y lo
 *   abone a la cuenta de Investa (o, si no, que lo informe para cobrarlo por domiciliación).
 * Sin DISGLOBAL_API_URL se usa una base simulada y determinística: el mismo RIF siempre devuelve los mismos datos.
 */

export type Terminal = { serial: string; modelo: "N62" | "N80" | "N82" | "N86" | "N92" | "AF910"; afiliadaDesde: string };
export type ComercioDisglobal = {
  rif: string;
  razonSocial: string;
  nombreComercial: string;
  actividad: string;
  direccion: string;
  ciudad: string;
  estado: string;
  telefono: string;
  email: string;
  representante: { nombre: string; cedula: string; telefono: string; email: string };
  cuentaLiquidacion: { banco: string; numero: string };
  afiliadoDesde: string;
  estatus: "activo" | "suspendido" | "retirado";
  terminales: Terminal[];
};

export interface Disglobal {
  comercio(rif: string): Promise<ComercioDisglobal | null>;
  ventas(rif: string, desde: string, hasta: string, tasaEn: (fecha: string) => number): Promise<DiaVentas[]>;
}

/* ---------- Base simulada ---------- */

function semilla(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
/** Generador pseudoaleatorio reproducible (mulberry32). */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const elegir = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const haceMeses = (m: number, extra = 0) => isoDia(new Date(Date.now() - (m * 30 + extra) * 86_400_000));

type Perfil = { ventasMesUsd: number; meses: number; volatilidad: number; crecimiento: number; diasCerrado: number; rechazo: number; ticketUsd: number; estatus: ComercioDisglobal["estatus"] };

/** Comercios fijos para la demo, con perfiles que cubren los casos del scoring. */
export const DEMO_COMERCIOS: { rif: string; nombre: string; razon: string; actividad: string; perfil: Perfil; serial: string; modelo: Terminal["modelo"] }[] = [
  { rif: rifCon("J", "40123456"), nombre: "Panadería La Espiga", razon: "Inversiones La Espiga 2019, C.A.", actividad: "Panadería y pastelería", serial: "N86A7310042", modelo: "N86",
    perfil: { ventasMesUsd: 21000, meses: 34, volatilidad: 0.06, crecimiento: 0.01, diasCerrado: 0.03, rechazo: 0.02, ticketUsd: 9, estatus: "activo" } },
  { rif: rifCon("J", "41234567"), nombre: "Farmacia Santa Rosa", razon: "Farmacia Santa Rosa de Lima, C.A.", actividad: "Farmacia", serial: "N92B2205518", modelo: "N92",
    perfil: { ventasMesUsd: 7200, meses: 14, volatilidad: 0.12, crecimiento: 0.005, diasCerrado: 0.08, rechazo: 0.04, ticketUsd: 18, estatus: "activo" } },
  { rif: rifCon("J", "29876543"), nombre: "Bodega El Rincón", razon: "Comercial El Rincón de Petare, C.A.", actividad: "Víveres", serial: "N62C0091273", modelo: "N62",
    perfil: { ventasMesUsd: 1900, meses: 8, volatilidad: 0.3, crecimiento: -0.02, diasCerrado: 0.25, rechazo: 0.07, ticketUsd: 6, estatus: "activo" } },
  { rif: rifCon("V", "18765432"), nombre: "Arepera Doña Carmen", razon: "Carmen Elena Rivas (firma personal)", actividad: "Restaurante", serial: "N80D4410087", modelo: "N80",
    perfil: { ventasMesUsd: 4800, meses: 2, volatilidad: 0.1, crecimiento: 0.03, diasCerrado: 0.1, rechazo: 0.03, ticketUsd: 7, estatus: "activo" } },
  { rif: rifCon("J", "50777888"), nombre: "Ferretería Los Andes", razon: "Ferretería Los Andes Mérida, C.A.", actividad: "Ferretería", serial: "N82E1180334", modelo: "N82",
    perfil: { ventasMesUsd: 11000, meses: 20, volatilidad: 0.15, crecimiento: 0, diasCerrado: 0.15, rechazo: 0.03, ticketUsd: 35, estatus: "suspendido" } },
];

const NOMBRES = ["Panadería", "Charcutería", "Farmacia", "Ferretería", "Zapatería", "Licorería", "Óptica", "Frutería", "Peluquería", "Repuestos"];
const APELLIDOS = ["Los Próceres", "El Valle", "La Candelaria", "Santa Mónica", "El Paraíso", "Altamira", "La Trinidad", "Las Mercedes", "San Bernardino", "El Cafetal"];
const PERSONAS = ["María Fernanda Pérez", "José Gregorio Díaz", "Ana Karina Mendoza", "Luis Alberto Rojas", "Daniela Herrera", "Carlos Eduardo Blanco"];
const CIUDADES: [string, string][] = [["Caracas", "Distrito Capital"], ["Maracaibo", "Zulia"], ["Valencia", "Carabobo"], ["Barquisimeto", "Lara"], ["Lechería", "Anzoátegui"], ["Mérida", "Mérida"]];
const BANCOS: [string, string][] = [["Banesco Banco Universal", "0134"], ["Banco Mercantil", "0105"], ["BBVA Provincial", "0108"], ["Banco Nacional de Crédito (BNC)", "0191"], ["Bancamiga", "0172"], ["R4 Banco Microfinanciero", "0169"]];
const MODELOS: Terminal["modelo"][] = ["N62", "N80", "N82", "N86", "N92"];

function perfilAleatorio(r: () => number): Perfil {
  return {
    ventasMesUsd: Math.round(Math.exp(Math.log(700) + r() * Math.log(35000 / 700))),
    meses: Math.floor(1 + r() * 40),
    volatilidad: 0.04 + r() * 0.35,
    crecimiento: -0.03 + r() * 0.06,
    diasCerrado: r() * 0.35,
    rechazo: 0.01 + r() * 0.12,
    ticketUsd: 5 + r() * 40,
    estatus: r() < 0.06 ? "suspendido" : "activo",
  };
}

function fichaSimulada(rif: string): { ficha: ComercioDisglobal; perfil: Perfil } | null {
  const fijo = DEMO_COMERCIOS.find((c) => c.rif === rif);
  const r = prng(semilla(rif));
  // ~1 de cada 8 RIF no está afiliado a Disglobal
  if (!fijo && r() < 0.125) return null;
  const perfil = fijo?.perfil ?? perfilAleatorio(r);
  const [ciudad, estado] = elegir(r, CIUDADES);
  const [banco, cod] = elegir(r, BANCOS);
  const persona = elegir(r, PERSONAS);
  const nombre = fijo?.nombre ?? `${elegir(r, NOMBRES)} ${elegir(r, APELLIDOS)}`;
  const slug = nombre.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "").slice(0, 14);
  const tel = () => `0${elegir(r, ["412", "414", "424", "416", "426"])}-${String(Math.floor(r() * 1e7)).padStart(7, "0")}`;
  const afiliadoDesde = haceMeses(perfil.meses + 1, 5);
  const nTerm = fijo ? 1 : 1 + Math.floor(r() * 2);
  const terminales: Terminal[] = Array.from({ length: nTerm }, (_, i) => {
    const modelo = i === 0 && fijo ? fijo.modelo : elegir(r, MODELOS);
    return { serial: i === 0 && fijo ? fijo.serial : `${modelo}${String.fromCharCode(65 + Math.floor(r() * 6))}${String(Math.floor(r() * 1e7)).padStart(7, "0")}`, modelo, afiliadaDesde: afiliadoDesde };
  });
  return {
    perfil,
    ficha: {
      rif,
      razonSocial: fijo?.razon ?? `Inversiones ${nombre}, C.A.`,
      nombreComercial: nombre,
      actividad: fijo?.actividad ?? nombre.split(" ")[0],
      direccion: `Av. principal ${elegir(r, APELLIDOS)}, local ${1 + Math.floor(r() * 40)}`,
      ciudad, estado,
      telefono: tel(),
      email: `${slug}@gmail.com`,
      representante: { nombre: persona, cedula: `V-${1e7 + Math.floor(r() * 2e7)}`, telefono: tel(), email: `${persona.split(" ")[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.${slug}@gmail.com` },
      cuentaLiquidacion: { banco, numero: `${cod}${String(Math.floor(r() * 1e8)).padStart(8, "0")}${String(Math.floor(r() * 1e8)).padStart(8, "0")}` },
      afiliadoDesde,
      estatus: perfil.estatus,
      terminales,
    },
  };
}

const simulada: Disglobal = {
  async comercio(rif) {
    const p = parseRif(rif);
    return p ? fichaSimulada(p.canon)?.ficha ?? null : null;
  },
  async ventas(rif, desde, hasta, tasaEn) {
    const x = fichaSimulada(rif);
    if (!x) return [];
    const { perfil: p, ficha } = x;
    const dias: DiaVentas[] = [];
    const inicio = Math.max(Date.parse(desde + "T12:00:00Z"), Date.parse(haceMeses(p.meses) + "T12:00:00Z"));
    const fin = Date.parse(hasta + "T12:00:00Z");
    const hoy = Date.now();
    for (let t = inicio; t <= fin; t += 86_400_000) {
      const fecha = isoDia(new Date(t));
      const r = prng(semilla(ficha.rif + fecha));
      const dow = new Date(t).getUTCDay();
      const mesesAtras = (hoy - t) / (30 * 86_400_000);
      const cerrado = dow === 0 ? r() < 0.6 : r() < p.diasCerrado;
      if (cerrado) { dias.push({ fecha, ventasBs: 0, transacciones: 0, rechazadas: 0 }); continue; }
      const estacional = [0.6, 0.9, 0.95, 1, 1.05, 1.25, 1.3][dow];
      const tendencia = Math.pow(1 + p.crecimiento, -mesesAtras);
      const ruido = Math.exp((r() - 0.5) * 2 * p.volatilidad * 2);
      const usd = (p.ventasMesUsd / 26) * estacional * tendencia * ruido;
      const transacciones = Math.max(1, Math.round(usd / p.ticketUsd));
      dias.push({ fecha, ventasBs: Math.round(usd * tasaEn(fecha) * 100) / 100, transacciones, rechazadas: Math.round(transacciones * p.rechazo * (0.5 + r())) });
    }
    return dias;
  },
};

/** Mientras no exista la API real, producción no debe ofrecer adelantos con datos inventados. */
const pendiente: Disglobal = {
  async comercio() { throw new ApiError(503, "La consulta a Disglobal todavía no está conectada. Intenta más tarde."); },
  async ventas() { throw new ApiError(503, "La consulta a Disglobal todavía no está conectada. Intenta más tarde."); },
};

export const disglobal: Disglobal = process.env.DISGLOBAL_API_URL || !DEMO ? pendiente : simulada;
export const disglobalSimulado = disglobal === simulada;
