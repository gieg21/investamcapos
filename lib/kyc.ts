/**
 * KYC del onboarding: la persona frente al POS debe ser el representante legal que Disglobal tiene
 * registrado para el RIF. Funciones puras: el servidor las corre con el resultado del proveedor
 * (Didit) y el backoffice muestra los mismos chequeos.
 */

export type EstadoKyc = "pendiente" | "aprobado" | "en_revision" | "rechazado";
export type EstadoCheck = "ok" | "warn" | "fail";
export type CheckKyc = { id: string; label: string; estado: EstadoCheck; detalle: string };

/** Resultado del proveedor, ya normalizado (ver server/kyc.ts). */
export type ResultadoKyc = {
  decisionProveedor: "aprobado" | "rechazado" | "en_revision";
  documento: string | null; // número de cédula leído del documento
  nombre: string | null; // nombre completo leído del documento
  vencimiento: string | null; // aaaa-mm-dd
  vivo: boolean | null; // prueba de vida
  coincidenciaRostro: number | null; // 0–100, selfie vs. foto del documento
};

export type Representante = { nombre: string; cedula: string };

/** Solo dígitos: "V-12.345.678" → "12345678". */
export const soloDigitos = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((p) => p.length > 1);

/**
 * Parecido entre dos nombres (0–1): qué parte de las palabras del nombre más corto aparece en el otro.
 * Tolera el orden (apellidos primero en la cédula) y que falte el segundo nombre o apellido.
 */
export function similitudNombre(a: string, b: string) {
  const x = normal(a), y = normal(b);
  if (!x.length || !y.length) return 0;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  return corto.filter((p) => largo.includes(p)).length / corto.length;
}

/** Decide el KYC: la cédula tiene que ser la del representante; nombre, rostro o vigencia dudosos van a revisión. */
export function evaluarKyc(r: ResultadoKyc, rep: Representante, cfg: { coincidenciaRostroMin: number }, hoy: string) {
  const checks: CheckKyc[] = [];
  const add = (id: string, label: string, estado: EstadoCheck, detalle: string) => checks.push({ id, label, estado, detalle });

  add("proveedor", "Verificación del proveedor", r.decisionProveedor === "aprobado" ? "ok" : r.decisionProveedor === "en_revision" ? "warn" : "fail",
    { aprobado: "Documento y selfie válidos", en_revision: "El proveedor la dejó en revisión", rechazado: "El proveedor rechazó la verificación" }[r.decisionProveedor]);

  add("vida", "Prueba de vida", r.vivo === true ? "ok" : r.vivo === false ? "fail" : "warn", r.vivo === true ? "Persona presente" : r.vivo === false ? "No superó la prueba de vida" : "Sin resultado");

  const cedula = r.documento ? soloDigitos(r.documento) : "";
  const esperada = soloDigitos(rep.cedula);
  add("cedula", "Cédula = representante legal", !cedula ? "warn" : cedula === esperada ? "ok" : "fail",
    !cedula ? "No se pudo leer el número del documento" : cedula === esperada ? `C.I. ${rep.cedula}` : `El documento es la C.I. ${r.documento}; el representante en Disglobal es la C.I. ${rep.cedula}`);

  const sim = r.nombre ? similitudNombre(r.nombre, rep.nombre) : 0;
  add("nombre", "Nombre = representante legal", !r.nombre ? "warn" : sim >= 0.99 ? "ok" : sim >= 0.5 ? "warn" : "fail",
    !r.nombre ? "No se pudo leer el nombre" : `${r.nombre} (documento) vs. ${rep.nombre} (Disglobal)`);

  const rostro = r.coincidenciaRostro;
  add("rostro", "Selfie = foto del documento", rostro == null ? "warn" : rostro >= cfg.coincidenciaRostroMin ? "ok" : "warn",
    rostro == null ? "Sin resultado" : `Coincidencia ${Math.round(rostro)}% (mínimo ${cfg.coincidenciaRostroMin}%)`);

  add("vigencia", "Documento vigente", !r.vencimiento ? "warn" : r.vencimiento >= hoy ? "ok" : "warn", r.vencimiento ? `Vence ${r.vencimiento}` : "Sin fecha de vencimiento");

  // La cédula y la prueba de vida deciden solas; lo demás, si no está en verde, lo revisa una persona.
  const duros = ["proveedor", "vida", "cedula"].map((id) => checks.find((c) => c.id === id)!);
  const estado: EstadoKyc =
    duros.some((c) => c.estado === "fail") || checks.find((c) => c.id === "nombre")!.estado === "fail" ? "rechazado"
      : checks.every((c) => c.estado === "ok") ? "aprobado"
        : "en_revision";
  return { estado, checks };
}
