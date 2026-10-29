"use client";

import Link from "next/link";
import { Card, CardHead, Kpi, PageTitle, Pill } from "@/components/ui";
import { ESTADO_ADELANTO, useEstado } from "@/lib/admin-store";
import { fecha, usd } from "@/lib/format";

export default function Panel() {
  const { e } = useEstado();
  const k = e.kpis;
  const pendientes = e.adelantos.filter((a) => a.estado === "en_revision" || a.estado === "aprobado");
  const cartera = e.adelantos.filter((a) => a.estado === "desembolsado" || a.estado === "vencido");
  return (
    <>
      <PageTitle title="Panel" sub="Adelantos de capital para comercios con POS Android de Disglobal" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cartera vigente" value={usd(k.carteraUsd)} sub={`${cartera.length} adelanto(s) cobrándose`} />
        <Kpi label="Vencido" value={usd(k.vencidoUsd)} tone={k.vencidoUsd ? "red" : "green"} sub={k.carteraUsd ? `${((k.vencidoUsd / k.carteraUsd) * 100).toFixed(1)}% de la cartera` : "—"} />
        <Kpi label="Desembolsado histórico" value={usd(k.desembolsadoUsd)} tone="violet" sub={`Cobrado ${usd(k.cobradoUsd)}`} />
        <Kpi label="Comercios" value={k.comercios} tone="amber" sub={`${k.conOferta} con oferta vigente`} />
      </div>
      {e.ia.informe && (
        <Card className="mt-6">
          <CardHead title={`Resumen del día · Agente IA`} sub={`${fecha(e.ia.informe.fecha)} · escrito por ${e.ia.informe.motor}`} action={<Link href="/admin/agentes" className="text-sm font-semibold text-brand">Agentes</Link>} />
          <p className="whitespace-pre-line px-5 py-4 text-sm leading-relaxed">{e.ia.informe.texto}</p>
        </Card>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead title="Por decidir o desembolsar" sub={`${k.porAprobar} en revisión · ${k.porDesembolsar} aprobado(s)`} action={<Link href="/admin/adelantos" className="text-sm font-semibold text-brand">Ver todos</Link>} />
          <ul className="divide-y divide-black/5">
            {pendientes.length === 0 && <li className="px-5 py-6 text-sm text-neutral-500">Nada pendiente.</li>}
            {pendientes.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0"><Link href={`/admin/comercios/${a.comercioId}`} className="font-medium hover:underline">{a.comercio}</Link><p className="text-xs text-neutral-500">{usd(a.montoUsd)} · {a.plazoDias} días · score {a.score ?? "—"}</p></div>
                <Pill tone={ESTADO_ADELANTO[a.estado].tone}>{ESTADO_ADELANTO[a.estado].t}</Pill>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead title="Cobranza por retención" sub="Avance de cada adelanto activo" />
          <ul className="divide-y divide-black/5">
            {cartera.length === 0 && <li className="px-5 py-6 text-sm text-neutral-500">Sin adelantos activos.</li>}
            {cartera.map((a) => {
              const av = (a.totalUsd - a.saldoUsd) / a.totalUsd;
              return (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <div className="flex justify-between"><Link href={`/admin/comercios/${a.comercioId}`} className="font-medium hover:underline">{a.comercio}</Link><span className="tabular-nums">{usd(a.saldoUsd)} por cobrar</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand"><div className={a.estado === "vencido" ? "h-full bg-coral" : "h-full bg-brand"} style={{ width: `${av * 100}%` }} /></div>
                  <p className="mt-1 text-xs text-neutral-500">{Math.round(av * 100)}% pagado · retención {(a.retencionPct * 100).toLocaleString("es-VE")}% · vence {a.venceEn ? fecha(a.venceEn) : "—"} · último abono {a.ultimoPago ? fecha(a.ultimoPago) : "—"}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
