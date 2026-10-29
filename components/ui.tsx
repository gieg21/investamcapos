"use client";

import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Card({ className, children, ...p }: ComponentProps<"section">) {
  return <section className={clsx("rounded-2xl bg-white shadow-card ring-1 ring-black/5", className)} {...p}>{children}</section>;
}

export function CardHead({ title, action, sub }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4">
      <div>
        <h2 className="font-display text-base font-medium text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-neutral-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

type BtnProps = { variant?: "primary" | "secondary" | "ghost" | "dark" | "danger"; href?: string; className?: string; children: ReactNode } & ComponentProps<"button">;

export function Button({ variant = "primary", href, className, children, ...p }: BtnProps) {
  const cls = clsx(
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    variant === "primary" && "bg-brand text-white hover:bg-brand-600",
    variant === "dark" && "bg-ink text-white hover:bg-black",
    variant === "secondary" && "bg-white text-ink ring-1 ring-black/10 hover:bg-sand",
    variant === "ghost" && "text-brand hover:bg-brand-50",
    variant === "danger" && "bg-white text-coral ring-1 ring-coral-300 hover:bg-coral-100",
    className
  );
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button className={cls} {...p}>{children}</button>;
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-coral">{error}</span> : hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-neutral-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

/** `wrap`: valores de texto largos (correo, cuenta) que deben partirse en vez de desbordar. */
export function Row({ k, v, strong, muted, wrap }: { k: ReactNode; v: ReactNode; strong?: boolean; muted?: boolean; wrap?: boolean }) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-4 py-2 text-sm", muted && "text-neutral-500")}>
      <span className="shrink-0">{k}</span>
      <span className={clsx("text-right tabular-nums", wrap ? "min-w-0 break-all" : "shrink-0 whitespace-nowrap", strong ? "font-display text-base font-medium text-ink" : "font-medium")}>{v}</span>
    </div>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink md:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-neutral-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" | "violet" }) {
  const t = {
    neutral: "bg-neutral-100 text-neutral-600 ring-neutral-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-coral-100 text-coral ring-coral-300",
    blue: "bg-brand-50 text-brand-600 ring-brand-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
  }[tone];
  return <span className={clsx("inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", t)}>{children}</span>;
}

export function Kpi({ label, value, sub, tone = "brand" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "brand" | "green" | "amber" | "red" | "violet" }) {
  const b = { brand: "border-brand", green: "border-emerald-500", amber: "border-amber-500", red: "border-coral", violet: "border-violet-500" }[tone];
  return (
    <Card className={clsx("border-t-4 p-4", b)}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 font-display text-2xl font-medium tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </Card>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { k: T; t: string; n?: number }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {items.map((x) => (
        <button key={x.k} onClick={() => onChange(x.k)} className={clsx("rounded-full px-3 py-1.5 text-xs font-medium transition", value === x.k ? "bg-ink text-white" : "bg-white text-neutral-600 ring-1 ring-black/5 hover:bg-neutral-100")}>
          {x.t}{x.n != null && <span className="ml-1 opacity-60">{x.n}</span>}
        </button>
      ))}
    </div>
  );
}

export function Aviso({ tone = "amber", children }: { tone?: "amber" | "red" | "blue" | "green"; children: ReactNode }) {
  const t = { amber: "bg-amber-50 text-amber-900 ring-amber-200", red: "bg-coral-100 text-coral ring-coral-300", blue: "bg-brand-50 text-brand-900 ring-brand-100", green: "bg-emerald-50 text-emerald-800 ring-emerald-200" }[tone];
  return <div className={clsx("rounded-xl px-4 py-3 text-sm ring-1", t)}>{children}</div>;
}

export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th className={clsx("whitespace-nowrap px-4 py-2.5 text-xs font-medium text-neutral-500", right ? "text-right" : "text-left")}>{children}</th>
);
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={clsx("whitespace-nowrap px-4 py-3", right && "text-right tabular-nums", className)}>{children}</td>
);
