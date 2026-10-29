"use client";

import clsx from "clsx";
import { Coins, Gauge, History, LogOut, Menu, SlidersHorizontal, Store, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAdmin } from "@/lib/admin-store";
import { fechaLarga } from "@/lib/format";
import { ROL_LABEL } from "@/lib/permisos";

const NAV = [
  { href: "/admin", label: "Panel", icon: Gauge },
  { href: "/admin/adelantos", label: "Adelantos", icon: Coins, badge: "a" as const },
  { href: "/admin/comercios", label: "Comercios", icon: Store, badge: "k" as const },
  { href: "/admin/tasas-bcv", label: "Tasas BCV", icon: TrendingUp },
  { href: "/admin/parametros", label: "Parámetros", icon: SlidersHorizontal, badge: "p" as const },
  { href: "/admin/bitacora", label: "Bitácora", icon: History },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname().replace(/\/$/, "") || "/";
  const router = useRouter();
  const { ready, e, logout } = useAdmin();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { if (ready && !e && path !== "/admin/login") router.replace("/admin/login"); }, [ready, e, path, router]);

  if (path === "/admin/login") return <>{children}</>;
  if (!ready || !e) return <div className="min-h-screen bg-sand" />;

  const pend = e.parametros.versiones.find((v) => v.estado === "pendiente");
  const badges = { a: e.kpis.porAprobar + e.kpis.porDesembolsar, k: e.kpis.kycPorRevisar, p: pend && pend.propuestoPorId !== e.usuario.id && e.usuario.permisos.parametros ? 1 : 0 };

  return (
    <div className="min-h-screen lg:pl-64">
      <div className={clsx("fixed inset-0 z-40 bg-black/40 transition lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={() => setOpen(false)} />
      <aside className={clsx("fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-ink text-white transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2">
            <img src="/brand/investa-white.svg" alt="Investa" className="h-6 w-auto" />
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">MCA POS</span>
          </div>
          <button className="rounded-lg p-1 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X className="h-5 w-5" /></button>
        </div>
        <div className="mx-3 mb-3 rounded-xl bg-white/5 px-3 py-2.5">
          <p className="truncate text-sm font-medium">{e.usuario.nombre}</p>
          <p className="text-xs text-white/50">{e.usuario.roles.map((r) => ROL_LABEL[r]).join(" · ")}</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n) => {
            const act = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
            const b = n.badge ? badges[n.badge] : 0;
            return (
              <Link key={n.href} href={n.href} className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition", act ? "bg-brand text-white" : "text-white/70 hover:bg-white/5 hover:text-white")}>
                <n.icon className="h-4 w-4" /><span className="flex-1">{n.label}</span>
                {b > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-ink">{b}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          <Link href="/pos" target="_blank" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white">↗ Abrir app del POS</Link>
          <button onClick={async () => { await logout(); router.push("/admin/login"); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" /> Cerrar sesión</button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-black/5 bg-sand/90 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 md:px-8">
          <button className="rounded-lg p-2 hover:bg-black/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu className="h-5 w-5" /></button>
          <p className="hidden flex-1 text-xs text-neutral-500 sm:block">{fechaLarga(new Date())}</p>
          <div className="flex-1 sm:hidden" />
          <Link href="/admin/tasas-bcv" className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold ring-1 ring-black/5">
            <TrendingUp className="h-3.5 w-3.5 text-brand" /> BCV {e.tasaHoy ? `${e.tasaHoy.tasa.toLocaleString("es-VE")} Bs/USD` : "sin tasa hoy"}
          </Link>
          {e.disglobalSimulado && <span className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200">Disglobal simulado</span>}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        {!e.tasaHoy && (
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <TrendingUp className="h-4 w-4 shrink-0" />
            <p className="min-w-[14rem] flex-1"><strong>No hay tasa BCV de hoy.</strong> No se puede desembolsar hasta que Operaciones la registre.</p>
            {path !== "/admin/tasas-bcv" && <Link href="/admin/tasas-bcv" className="font-semibold underline underline-offset-2">Registrar tasa</Link>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
