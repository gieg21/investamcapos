"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Demo: lo que vería el teléfono al escanear el QR. En producción el QR abre directamente el flujo de Didit. */
export default function KycSimulado() {
  const [t, setT] = useState("");
  const [info, setInfo] = useState<{ estado: string; representante: { nombre: string; cedula: string } } | null>(null);
  const [err, setErr] = useState("");
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const tok = new URLSearchParams(location.search).get("t") ?? "";
    setT(tok);
    api<NonNullable<typeof info>>(`/kyc/simulado?t=${encodeURIComponent(tok)}`).then(setInfo).catch((e) => setErr(e.message));
  }, []);
  const enviar = async (escenario: string) => {
    setErr("");
    try { await api("/kyc/simulado", { t, escenario }); setListo(true); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-5 px-5 py-8">
      <img src="/brand/investa-color.svg" alt="Investa" className="h-6 w-auto self-start" />
      {listo || (info && info.estado !== "pendiente") ? (
        <div className="mt-10 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-4 font-display text-2xl">Listo, recibimos tu verificación</h1>
          <p className="mt-2 text-sm text-neutral-500">Vuelve al punto de venta: allí verás el resultado.</p>
        </div>
      ) : (
        <>
          <h1 className="font-display text-2xl">Verificación de identidad</h1>
          {info && <p className="text-sm text-neutral-500">Debe hacerla <strong className="text-ink">{info.representante.nombre}</strong> (C.I. {info.representante.cedula}), representante legal.</p>}
          <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-3xl bg-ink text-white/70">
            <ShieldCheck className="h-12 w-12" />
            <p className="px-8 text-center text-sm">Aquí va el flujo de Didit con la cámara del teléfono: cédula por ambos lados, selfie y prueba de vida.</p>
          </div>
          <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-700">Demo · ¿quién se verificó?</p>
            <div className="grid gap-1.5">
              <button onClick={() => enviar("representante")} className="rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-violet-200">El representante legal</button>
              <button onClick={() => enviar("dudoso")} className="rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-violet-200">El representante, con selfie poco clara</button>
              <button onClick={() => enviar("otra_persona")} className="rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-violet-200">Otra persona (un empleado)</button>
            </div>
          </div>
        </>
      )}
      {err && <p className="rounded-xl bg-coral-100 px-4 py-3 text-sm text-coral">{err}</p>}
    </main>
  );
}
