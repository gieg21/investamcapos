"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { estadoAdmin } from "@/server/admin";
import { api, ApiFallo } from "./api";

export type EstadoAdmin = Awaited<ReturnType<typeof estadoAdmin>>;
export type AdelantoAdmin = EstadoAdmin["adelantos"][number];

type Ctx = {
  ready: boolean;
  e: EstadoAdmin | null;
  recargar: () => Promise<void>;
  /** POST /api/admin/{nombre}: actualiza el estado y devuelve el `resultado` del servidor. Lanza con el mensaje del servidor. */
  accion: <T = unknown>(nombre: string, body?: unknown) => Promise<T>;
  logout: () => Promise<void>;
};

const C = createContext<Ctx | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [e, setE] = useState<EstadoAdmin | null>(null);
  const [ready, setReady] = useState(false);

  const recargar = useCallback(async () => {
    try { setE(await api<EstadoAdmin>("/admin")); }
    catch (x) { if (x instanceof ApiFallo && x.status === 401) setE(null); }
    finally { setReady(true); }
  }, []);

  useEffect(() => {
    recargar();
    const t = setInterval(() => document.visibilityState === "visible" && recargar(), 30_000);
    const v = () => document.visibilityState === "visible" && recargar();
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [recargar]);

  const accion = useCallback(async <T,>(nombre: string, body: unknown = {}) => {
    const r = await api<{ resultado: T; estado: EstadoAdmin }>(`/admin/${nombre}`, body);
    setE(r.estado);
    return r.resultado;
  }, []);

  const logout = useCallback(async () => { await api("/admin/auth/logout", {}); setE(null); }, []);

  return <C.Provider value={{ ready, e, recargar, accion, logout }}>{children}</C.Provider>;
}

export function useAdmin() {
  const c = useContext(C);
  if (!c) throw new Error("useAdmin fuera de AdminProvider");
  return c;
}

/** Estado listo (solo dentro del shell, que ya garantiza la sesión). */
export function useEstado() {
  const { e, accion } = useAdmin();
  return { e: e!, accion };
}

export const ESTADO_ADELANTO: Record<string, { t: string; tone: "neutral" | "green" | "amber" | "red" | "blue" | "violet" }> = {
  en_revision: { t: "En revisión", tone: "amber" },
  aprobado: { t: "Por desembolsar", tone: "blue" },
  desembolsado: { t: "Cobrando", tone: "green" },
  vencido: { t: "Vencido", tone: "red" },
  pagado: { t: "Pagado", tone: "neutral" },
  rechazado: { t: "Rechazado", tone: "neutral" },
  cancelado: { t: "Cancelado", tone: "neutral" },
};
