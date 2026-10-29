import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { isoDay } from "@/lib/format";
import { evaluarKyc, soloDigitos, type ResultadoKyc } from "@/lib/kyc";
import { exigir, nuevoId, type Admin } from "./auth";
import { schema, type DB } from "./db";
import { ApiError, conflicto, DEMO, invalido, noEncontrado, prohibido } from "./http";
import { paramsVigente, registrar } from "./repo";

/**
 * KYC del representante legal con Didit (el mismo proveedor que el portal de factoring).
 *
 * 1. El POS pide una sesión (`iniciarKyc`); Didit devuelve la URL de su flujo: foto de la cédula, selfie y prueba de vida.
 * 2. Al terminar, Didit redirige a /pos?kyc=listo y avisa por webhook (`webhookDidit`, firmado con HMAC).
 * 3. Se lee la decisión de Didit y se compara con el representante que Disglobal tiene para el RIF (lib/kyc.ts).
 *
 * TODO(Didit): confirmar con la documentación vigente de Didit los nombres exactos de los campos de la
 * decisión (normalizarDidit) y el formato de la firma del webhook, y configurar el workflow con
 * documento venezolano + liveness + face match. En demo, sin DIDIT_API_KEY, el flujo se simula.
 */

const DIDIT_URL = process.env.DIDIT_API_URL || "https://verification.didit.me";
const diditConfigurado = () => !!(process.env.DIDIT_API_KEY && process.env.DIDIT_WORKFLOW_ID);
export const kycSimulado = () => !diditConfigurado() && DEMO;

type Comercio = typeof schema.comercios.$inferSelect;
type Kyc = typeof schema.kyc.$inferSelect;

async function didit(path: string, init?: RequestInit) {
  const r = await fetch(DIDIT_URL + path, { ...init, headers: { "x-api-key": process.env.DIDIT_API_KEY!, "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  if (!r.ok) {
    console.error("[didit]", r.status, await r.text().catch(() => ""));
    throw new ApiError(502, "No pudimos conectar con el servicio de verificación. Intenta de nuevo en unos minutos.");
  }
  return r.json() as Promise<Record<string, unknown>>;
}

/** Decisión de Didit → formato propio. Tolerante a campos ausentes: lo que falte queda en revisión. */
export function normalizarDidit(d: Record<string, any>): ResultadoKyc {
  const st = String(d?.status ?? "").toLowerCase();
  const idv = d?.id_verification ?? {};
  const live = d?.liveness ?? {};
  const face = d?.face_match ?? {};
  const nombre = idv.full_name || [idv.first_name, idv.last_name].filter(Boolean).join(" ") || null;
  return {
    decisionProveedor: st === "approved" ? "aprobado" : st === "declined" ? "rechazado" : "en_revision",
    documento: idv.personal_number || idv.document_number || null,
    nombre,
    vencimiento: idv.expiration_date || null,
    vivo: live.status ? String(live.status).toLowerCase() === "approved" : null,
    coincidenciaRostro: typeof face.score === "number" ? face.score : null,
  };
}

const representanteDe = (c: Comercio) => ({ nombre: c.disglobal.representante.nombre, cedula: c.disglobal.representante.cedula });
const enmascararCedula = (ci: string) => ci.replace(/\d(?=\d{3})/g, "•");

/** Último intento del comercio. */
async function ultimo(db: DB, comercioId: string) {
  const [k] = await db.select().from(schema.kyc).where(eq(schema.kyc.comercioId, comercioId)).orderBy(desc(schema.kyc.creado)).limit(1);
  return k ?? null;
}

/** El KYC vale si está aprobado y fue de la persona que hoy es representante legal en Disglobal. */
export async function kycAprobado(db: DB, c: Comercio) {
  const k = await ultimo(db, c.id);
  return !!k && k.estado === "aprobado" && soloDigitos(k.representante.cedula) === soloDigitos(c.disglobal.representante.cedula);
}

async function intentosUsados(db: DB, comercioId: string) {
  const rows = await db.select({ id: schema.kyc.id }).from(schema.kyc)
    .where(and(eq(schema.kyc.comercioId, comercioId), eq(schema.kyc.estado, "rechazado"), eq(schema.kyc.cuentaIntento, true)));
  return rows.length;
}

/** Lo que ve el comercio en el POS (sin los chequeos internos). */
export async function estadoKyc(db: DB, c: Comercio) {
  const { valores: cfg } = await paramsVigente(db);
  const k = await ultimo(db, c.id);
  const rep = representanteDe(c);
  const vigente = !!k && soloDigitos(k.representante.cedula) === soloDigitos(rep.cedula);
  const usados = await intentosUsados(db, c.id);
  return {
    estado: (vigente ? k!.estado : "sin_iniciar") as Kyc["estado"] | "sin_iniciar",
    motivo: vigente ? k!.motivo : null,
    representante: { nombre: rep.nombre, cedula: enmascararCedula(rep.cedula) },
    intentosRestantes: Math.max(0, cfg.kyc.intentosMax - usados),
    simulado: kycSimulado(),
    // Si quedó una sesión de Didit abierta (cerraron la app a mitad), se retoma la misma.
    url: vigente && k!.estado === "pendiente" ? k!.urlProveedor : null,
  };
}

/** Abre un intento de KYC. Devuelve la URL de Didit, o el id del intento simulado en demo. */
export async function iniciarKyc(db: DB, c: Comercio, origen: string) {
  if (await kycAprobado(db, c)) throw conflicto("Tu identidad ya está verificada.");
  const { valores: cfg } = await paramsVigente(db);
  if ((await intentosUsados(db, c.id)) >= cfg.kyc.intentosMax)
    throw prohibido("Superaste los intentos de verificación. Comunícate con Investa para revisarlo.");
  const k = await ultimo(db, c.id);
  if (k?.estado === "en_revision" && soloDigitos(k.representante.cedula) === soloDigitos(c.disglobal.representante.cedula))
    throw conflicto("Tu verificación está en revisión. Te avisamos cuando esté lista.");
  // Pendiente con el mismo representante: se cancela y se abre uno nuevo (la URL de Didit pudo vencer).
  if (k?.estado === "pendiente") await db.update(schema.kyc).set({ estado: "rechazado", motivo: "Abandonado: se inició otro intento", cuentaIntento: false, decidido: new Date(), decididoPor: "Sistema" }).where(eq(schema.kyc.id, k.id));

  const id = nuevoId("k_");
  const representante = representanteDe(c);
  if (diditConfigurado()) {
    const s = await didit("/v2/session/", {
      method: "POST",
      body: JSON.stringify({ workflow_id: process.env.DIDIT_WORKFLOW_ID, vendor_data: id, callback: `${process.env.INVESTA_PUBLIC_URL || origen}/pos?kyc=listo` }),
    });
    const sesion = String(s.session_id ?? ""), url = String(s.url ?? "");
    if (!sesion || !url) throw new ApiError(502, "El servicio de verificación no devolvió una sesión. Intenta de nuevo.");
    await db.insert(schema.kyc).values({ id, comercioId: c.id, proveedor: "didit", sesionProveedor: sesion, urlProveedor: url, estado: "pendiente", representante });
    await registrar(db, c.nombreComercial, "KYC iniciado", `Didit · representante ${representante.nombre}`, c.id);
    return { id, url };
  }
  if (!DEMO) throw new ApiError(503, "La verificación de identidad no está disponible en este momento.");
  await db.insert(schema.kyc).values({ id, comercioId: c.id, proveedor: "simulado", estado: "pendiente", representante });
  await registrar(db, c.nombreComercial, "KYC iniciado", `Simulado (demo) · representante ${representante.nombre}`, c.id);
  return { id, url: null };
}

/** Aplica el resultado del proveedor: decide con las reglas de lib/kyc.ts y deja constancia. */
async function aplicar(db: DB, k: Kyc, resultado: ResultadoKyc) {
  if (k.estado !== "pendiente") return k.estado;
  const { valores: cfg } = await paramsVigente(db);
  const ev = evaluarKyc(resultado, k.representante, cfg.kyc, isoDay(new Date()));
  const fallo = ev.checks.find((x) => x.estado === "fail") ?? ev.checks.find((x) => x.estado === "warn");
  const motivo = ev.estado === "aprobado" ? null
    : ev.checks.find((x) => x.id === "cedula")?.estado === "fail" ? "La persona verificada no es el representante legal registrado en Disglobal."
      : fallo ? `${fallo.label}: ${fallo.detalle}` : null;
  await db.update(schema.kyc).set({ estado: ev.estado, resultado, checks: ev.checks, motivo, decididoPor: "Motor", decidido: new Date() }).where(eq(schema.kyc.id, k.id));
  const [c] = await db.select({ n: schema.comercios.nombreComercial }).from(schema.comercios).where(eq(schema.comercios.id, k.comercioId));
  await registrar(db, "Motor", `KYC ${{ aprobado: "aprobado", rechazado: "rechazado", en_revision: "a revisión", pendiente: "pendiente" }[ev.estado]}`,
    `${c?.n ?? k.comercioId}: ${resultado.nombre ?? "sin nombre"} C.I. ${resultado.documento ?? "?"} vs. representante ${k.representante.nombre} C.I. ${k.representante.cedula}${motivo ? ` · ${motivo}` : ""}`, k.comercioId);
  return ev.estado;
}

/** Al volver de Didit: si el webhook no llegó todavía, se consulta la decisión. */
export async function consultarKyc(db: DB, c: Comercio) {
  const k = await ultimo(db, c.id);
  if (!k || k.estado !== "pendiente" || k.proveedor !== "didit" || !k.sesionProveedor) return;
  const d = await didit(`/v2/session/${encodeURIComponent(k.sesionProveedor)}/decision/`);
  if (["approved", "declined", "in review"].includes(String(d.status ?? "").toLowerCase())) await aplicar(db, k, normalizarDidit(d));
}

/** Webhook de Didit. Firma: HMAC-SHA256 del cuerpo crudo con DIDIT_WEBHOOK_SECRET (cabecera x-signature) y marca de tiempo reciente. */
export async function webhookDidit(db: DB, crudo: string, firma: string | null, marca: string | null) {
  const secreto = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secreto) throw new ApiError(503, "Webhook no configurado.");
  const esperada = createHmac("sha256", secreto).update(crudo).digest("hex");
  const ok = !!firma && firma.length === esperada.length && timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
  if (!ok) throw new ApiError(401, "Firma inválida.");
  if (marca && Math.abs(Date.now() / 1000 - Number(marca)) > 300) throw new ApiError(401, "Webhook vencido.");
  const body = JSON.parse(crudo) as Record<string, any>;
  const [k] = await db.select().from(schema.kyc).where(eq(schema.kyc.sesionProveedor, String(body.session_id ?? "")));
  if (!k) return; // sesión que no es nuestra: se ignora sin error para que Didit no reintente
  const st = String(body.status ?? "").toLowerCase();
  if (!["approved", "declined", "in review"].includes(st)) return;
  // La decisión se lee de la API (no del cuerpo del webhook) para no depender de lo que traiga el aviso.
  await aplicar(db, k, normalizarDidit(await didit(`/v2/session/${encodeURIComponent(k.sesionProveedor!)}/decision/`)));
}

/* ---------- Demo ---------- */

export const zSimulado = z.object({ escenario: z.enum(["representante", "otra_persona", "dudoso"]) });

/** Solo demo: resultado como lo devolvería Didit para cada escenario. */
export async function completarSimulado(db: DB, c: Comercio, escenario: z.infer<typeof zSimulado>["escenario"]) {
  if (!kycSimulado()) throw prohibido();
  const k = await ultimo(db, c.id);
  if (!k || k.estado !== "pendiente" || k.proveedor !== "simulado") throw invalido("No hay una verificación en curso.");
  const rep = k.representante;
  const vence = isoDay(new Date(Date.now() + 3 * 365 * 86_400_000));
  const r: Record<typeof escenario, ResultadoKyc> = {
    representante: { decisionProveedor: "aprobado", documento: rep.cedula, nombre: rep.nombre.toUpperCase(), vencimiento: vence, vivo: true, coincidenciaRostro: 94 },
    otra_persona: { decisionProveedor: "aprobado", documento: "V-14555666", nombre: "PEDRO JOSÉ MARTÍNEZ", vencimiento: vence, vivo: true, coincidenciaRostro: 91 },
    dudoso: { decisionProveedor: "aprobado", documento: rep.cedula, nombre: rep.nombre.toUpperCase(), vencimiento: vence, vivo: true, coincidenciaRostro: 58 },
  };
  await aplicar(db, k, r[escenario]);
}

/** Semilla de la demo: comercios con KYC ya aprobado. */
export async function sembrarKycAprobado(db: DB, c: Comercio) {
  const rep = representanteDe(c);
  const r: ResultadoKyc = { decisionProveedor: "aprobado", documento: rep.cedula, nombre: rep.nombre.toUpperCase(), vencimiento: "2030-01-01", vivo: true, coincidenciaRostro: 92 };
  const ev = evaluarKyc(r, rep, { coincidenciaRostroMin: 70 }, isoDay(new Date()));
  await db.insert(schema.kyc).values({ id: nuevoId("k_"), comercioId: c.id, proveedor: "simulado", estado: ev.estado, representante: rep, resultado: r, checks: ev.checks, decididoPor: "Motor", decidido: new Date() });
}

/* ---------- Backoffice ---------- */

export const zRevision = z.object({ id: z.string(), aprobar: z.boolean(), motivo: z.string().max(500) });

/** Riesgo decide un KYC que quedó en revisión (nombre, rostro o vigencia dudosos). */
export async function revisarKyc(db: DB, u: Admin, x: z.infer<typeof zRevision>) {
  exigir(u, "decidir");
  const [k] = await db.select().from(schema.kyc).where(eq(schema.kyc.id, x.id));
  if (!k) throw noEncontrado("Verificación no encontrada.");
  if (k.estado !== "en_revision") throw conflicto("Solo se deciden verificaciones en revisión.");
  if (x.motivo.trim().length < 5) throw invalido("Escribe el motivo de la decisión.");
  // Una cédula distinta a la del representante nunca se aprueba a mano: es otra persona.
  if (x.aprobar && k.checks?.some((c) => c.id === "cedula" && c.estado === "fail")) throw prohibido("La cédula verificada no es la del representante legal; no se puede aprobar.");
  await db.update(schema.kyc).set({ estado: x.aprobar ? "aprobado" : "rechazado", motivo: x.motivo.trim(), decididoPor: u.nombre, decidido: new Date() }).where(eq(schema.kyc.id, k.id));
  await registrar(db, u.nombre, x.aprobar ? "KYC aprobado (revisión)" : "KYC rechazado (revisión)", x.motivo.trim(), k.comercioId);
}

/** Habilita un intento más a un comercio que agotó los suyos. */
export async function habilitarIntento(db: DB, u: Admin, comercioId: string) {
  exigir(u, "decidir");
  await db.update(schema.kyc).set({ cuentaIntento: false }).where(and(eq(schema.kyc.comercioId, comercioId), eq(schema.kyc.estado, "rechazado")));
  await registrar(db, u.nombre, "KYC: nuevo intento habilitado", "Se reiniciaron los intentos de verificación", comercioId);
}

export async function kycDeComercio(db: DB, comercioId: string) {
  return db.select().from(schema.kyc).where(eq(schema.kyc.comercioId, comercioId)).orderBy(desc(schema.kyc.creado));
}
