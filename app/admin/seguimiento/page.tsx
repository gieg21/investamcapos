"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Aviso, Card, CardHead, inputCls, Kpi, PageTitle, Pill, Tabs, Td, Th } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { api } from "@/lib/api";
import { fecha, usd } from "@/lib/format";
import type { estadoSeguimiento } from "@/server/seguimiento";

type S = Awaited<ReturnType<typeof estadoSeguimiento>>;
type Fila = S["filas"][number];

const FREC: Record<Fila["frecuencia"], { t: string; tone: "green" | "blue" | "amber" | "neutral"; d: string }> = {
  frecuente: { t: "Frecuente", tone: "green", d: "8+ días con uso en 30" },
  ocasional: { t: "Ocasional", tone: "blue", d: "2 a 7 días" },
  esporadico: { t: "Esporádico", tone: "amber", d: "1 día" },
  inactivo: { t: "Inactivo", tone: "neutral", d: "Sin uso en 30 días" },
};
const ETAPA_TONE: Record<Fila["etapa"], "neutral" | "amber" | "blue" | "green" | "violet" | "red"> = {
  consulto: "neutral", sin_oferta: "neutral", kyc: "amber", kyc_revision: "amber", listo: "blue", solicitud: "violet", activo: "green", recurrente: "green",
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const diasDesde = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso + "T12:00:00").getTime()) / 86_400_000));

export default function Seguimiento() {
  const { e } = useAdmin();
  const [s, setS] = useState<S | null>(null);
  const [err, setErr] = useState("");
  const [vista, setVista] = useState<"comercios" | "actividad" | "geografia">("comercios");
  const [geo, setGeo] = useState<"estado" | "ciudad">("estado");
  const [etapa, setEtapa] = useState("");
  const [actividad, setActividad] = useState("");
  const [estadoGeo, setEstadoGeo] = useState("");
  const [frec, setFrec] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { api<S>("/admin/seguimiento").then(setS).catch((x) => setErr(x.message)); }, [e]);

  const filas = useMemo(() => (s?.filas ?? []).filter((f) =>
    (!etapa || f.etapa === etapa) && (!actividad || f.actividad === actividad) && (!estadoGeo || f.estadoGeo === estadoGeo) && (!frec || f.frecuencia === frec)
    && (!q || `${f.nombre} ${f.rif} ${f.ciudad}`.toLowerCase().includes(q.toLowerCase()))), [s, etapa, actividad, estadoGeo, frec, q]);

  if (err) return <Aviso tone="red">{err}</Aviso>;
  if (!s) return null;
  const total = s.filas.length;
  const max = Math.max(1, ...s.embudo.map((x) => x.n));
  const registrados = s.filas.filter((f) => f.comercioId).length;
  const conAdelanto = s.filas.filter((f) => f.adelantos > 0).length;
  const segmentos = vista === "actividad" ? s.porActividad : geo === "estado" ? s.porEstado : s.porCiudad;
  const etapaT = (k: string) => s.embudo.find((x) => x.k === k)!.t;

  return (
    <>
      <PageTitle title="Seguimiento de comercios" sub="Etapa del registro, frecuencia de uso de la app del POS y segmentación por actividad y geografía" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Consultaron su RIF" value={total} sub="Todos los que entraron a la app" />
        <Kpi label="Confirmaron datos" value={registrados} tone="violet" sub={`${pct(registrados, total)} de los que consultaron`} />
        <Kpi label="Tomaron un adelanto" value={conAdelanto} tone="green" sub={`${pct(conAdelanto, registrados)} de los registrados`} />
        <Kpi label="Usan la app con frecuencia" value={s.frecuencias.find((x) => x.k === "frecuente")!.n} tone="amber" sub={`de ${registrados} registrados · últimos 30 días`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="Embudo de registro" sub="Etapa actual de cada comercio. Toca una para filtrar la lista." />
          <div className="space-y-2 p-5">
            {s.embudo.map((x) => (
              <button key={x.k} onClick={() => { setVista("comercios"); setEtapa(etapa === x.k ? "" : x.k); }} className={clsx("grid w-full grid-cols-[9.5rem_1fr_3rem] items-center gap-3 rounded-lg px-2 py-1 text-left text-sm hover:bg-sand", etapa === x.k && "bg-brand-50")}>
                <span title={x.d}>{x.t}</span>
                <span className="h-5 overflow-hidden rounded bg-sand"><span className="block h-full rounded bg-brand" style={{ width: `${(x.n / max) * 100}%` }} /></span>
                <span className="text-right tabular-nums">{x.n}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Frecuencia de uso" sub="Días con uso de la app en los últimos 30" />
          <div className="space-y-2 p-5">
            {s.frecuencias.map((x) => (
              <button key={x.k} onClick={() => { setVista("comercios"); setFrec(frec === x.k ? "" : x.k); }} className={clsx("flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-sand", frec === x.k && "bg-brand-50")}>
                <span className="flex items-center gap-2"><Pill tone={FREC[x.k].tone}>{FREC[x.k].t}</Pill><span className="text-xs text-neutral-500">{FREC[x.k].d}</span></span>
                <span className="tabular-nums">{x.n}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Tabs value={vista} onChange={setVista} items={[{ k: "comercios", t: "Comercios", n: filas.length }, { k: "actividad", t: "Por actividad", n: s.porActividad.length }, { k: "geografia", t: "Por geografía", n: s.porEstado.length }]} />

        {vista === "comercios" ? (
          <>
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <input className={inputCls} value={q} onChange={(x) => setQ(x.target.value)} placeholder="Buscar nombre, RIF o ciudad" />
              <select className={inputCls} value={etapa} onChange={(x) => setEtapa(x.target.value)}><option value="">Todas las etapas</option>{s.embudo.map((x) => <option key={x.k} value={x.k}>{x.t}</option>)}</select>
              <select className={inputCls} value={actividad} onChange={(x) => setActividad(x.target.value)}><option value="">Todas las actividades</option>{s.porActividad.map((x) => <option key={x.nombre}>{x.nombre}</option>)}</select>
              <select className={inputCls} value={estadoGeo} onChange={(x) => setEstadoGeo(x.target.value)}><option value="">Todos los estados</option>{s.porEstado.map((x) => <option key={x.nombre}>{x.nombre}</option>)}</select>
              <select className={inputCls} value={frec} onChange={(x) => setFrec(x.target.value)}><option value="">Toda frecuencia</option>{(Object.keys(FREC) as Fila["frecuencia"][]).map((k) => <option key={k} value={k}>{FREC[k].t}</option>)}</select>
            </div>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-black/5"><tr><Th>Comercio</Th><Th>Etapa</Th><Th>Actividad</Th><Th>Ubicación</Th><Th>Uso (30 días)</Th><Th right>Oferta</Th><Th right>Adelantos</Th><Th right>Saldo</Th></tr></thead>
                <tbody className="divide-y divide-black/5">
                  {filas.map((f) => (
                    <tr key={f.rif} className="hover:bg-sand/50">
                      <Td>{f.comercioId ? <Link href={`/admin/comercios/${f.comercioId}`} className="font-medium hover:underline">{f.nombre}</Link> : <span className="font-medium">{f.nombre}</span>}<p className="text-xs text-neutral-400">{f.rif}{f.bloqueado ? " · bloqueado" : ""}</p></Td>
                      <Td><Pill tone={ETAPA_TONE[f.etapa]}>{etapaT(f.etapa)}</Pill><p className="mt-0.5 text-xs text-neutral-400">hace {diasDesde(f.desde)} días{f.etapa === "consulto" && f.consultas > 1 ? ` · ${f.consultas} consultas` : ""}</p></Td>
                      <Td>{f.actividad}</Td>
                      <Td>{f.ciudad}<p className="text-xs text-neutral-400">{f.estadoGeo}</p></Td>
                      <Td>{f.comercioId ? <><Pill tone={FREC[f.frecuencia].tone}>{FREC[f.frecuencia].t}</Pill><p className="mt-0.5 text-xs text-neutral-400">{f.diasUso30} días · {f.interacciones30} interacciones{f.ultimoUso ? ` · último ${fecha(f.ultimoUso)}` : ""}</p></> : <span className="text-neutral-400">—</span>}</Td>
                      <Td right>{f.ofertaUsd == null ? "—" : f.ofertaUsd ? usd(f.ofertaUsd) : <span className="text-neutral-400">Sin oferta</span>}</Td>
                      <Td right>{f.adelantos || "—"}</Td>
                      <Td right>{f.saldoUsd ? usd(f.saldoUsd) : "—"}</Td>
                    </tr>
                  ))}
                  {!filas.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-neutral-500">Ningún comercio con esos filtros.</td></tr>}
                </tbody>
              </table>
            </Card>
          </>
        ) : (
          <Card className="overflow-x-auto">
            {vista === "geografia" && (
              <div className="flex gap-2 border-b border-black/5 px-4 py-3">
                {(["estado", "ciudad"] as const).map((g) => <button key={g} onClick={() => setGeo(g)} className={clsx("rounded-full px-3 py-1 text-xs font-medium", geo === g ? "bg-ink text-white" : "bg-sand")}>{g === "estado" ? "Por estado" : "Por ciudad"}</button>)}
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="border-b border-black/5"><tr><Th>{vista === "actividad" ? "Actividad" : geo === "estado" ? "Estado" : "Ciudad"}</Th><Th right>Consultaron</Th><Th right>Registrados</Th><Th right>Con oferta</Th><Th right>KYC ok</Th><Th right>Con adelanto</Th><Th right>Conversión</Th><Th right>Uso frecuente</Th><Th right>Desembolsado</Th><Th right>Cartera</Th></tr></thead>
              <tbody className="divide-y divide-black/5">
                {segmentos.map((x) => (
                  <tr key={x.nombre} className="hover:bg-sand/50">
                    <Td>
                      <button className="font-medium hover:underline" onClick={() => {
                        setVista("comercios"); setEtapa(""); setFrec("");
                        if (vista === "actividad") { setActividad(x.nombre); setEstadoGeo(""); } else if (geo === "estado") { setEstadoGeo(x.nombre); setActividad(""); } else { setQ(x.nombre.split(",")[0]); }
                      }}>{x.nombre}</button>
                    </Td>
                    <Td right>{x.total}</Td><Td right>{x.registrados}</Td><Td right>{x.conOferta}</Td><Td right>{x.kycOk}</Td><Td right>{x.conAdelanto}</Td>
                    <Td right>{pct(x.conAdelanto, x.total)}</Td><Td right>{x.frecuentes}</Td><Td right>{usd(x.desembolsadoUsd)}</Td><Td right>{usd(x.saldoUsd)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
