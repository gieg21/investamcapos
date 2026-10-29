export type Rol = "admin" | "riesgo" | "operaciones";
export type Permiso = "decidir" | "mover_dinero" | "tasas" | "parametros" | "comercios";

export const ROL_LABEL: Record<Rol, string> = { admin: "Administrador", riesgo: "Riesgo", operaciones: "Operaciones" };

/** Todos los roles ven todo el backoffice; esto define quién puede actuar. */
const MATRIZ: Record<Rol, Permiso[]> = {
  admin: ["decidir", "mover_dinero", "tasas", "parametros", "comercios"],
  riesgo: ["decidir", "comercios"],
  operaciones: ["mover_dinero", "tasas"],
};

export const puede = (roles: Rol[], p: Permiso) => roles.some((r) => MATRIZ[r]?.includes(p));
