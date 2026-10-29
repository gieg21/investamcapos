"use client";

import clsx from "clsx";
import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Dialogo } from "@/components/Dialogo";
import { Aviso, Button, Card, CardHead, inputCls, Pill, Row, Td, Th } from "@/components/ui";
import { ESTADO_ADELANTO, useEstado } from "@/lib/admin-store";
import { api } from "@/lib/api";
import { bs, fecha, pct, usd } from "@/lib/format";
import { PESO_LABEL, type Peso } from "@/lib/params";
import type { detalleComercio } from "@/server/admin";

type Detalle = Awaited<ReturnType<typeof detalleComercio>>;

export default function Comercio({ params }: { params: { id: string } }) {
  const { e, accion } = useEstado();
  const [d, setD] = useState<Detalle | null>(null);
  const [err, setErr] = useState("");
  const [bloq, setBloq] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const cargar = useCallback(() => api<Detalle>(`/admin/comercios/${params.id}`).then(setD).catch((x) => setErr(x.message)), [params.id]);
  useEffect(() => { cargar(); }, [cargar, e]);

  if (err) return <Aviso tone="red">{err}</Aviso>;
  if (!d) return null;
  const c = d.comercio, f = c.disglobal, ev = d.evaluaciones[0];
  const cfg = e.parametros.vigente.valores;
  const maxVentas = Math.max(1, ...d.ventas.map((v) => v.usd));

  return (
    <>
      <Link href="/admin/comercios" className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-ink"><ArrowLeft className="h-4 w-4" /> Comercios</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl">{c.nombreComercial}</h1>
          <p className="text-sm text-neutral-500">{c.razonSocial} · {c.rif}</p>
        </div>
        <div className="flex gap-2">
          {e.usuario.permisos.decidir && <Button variant="secondary" onClick={() => accion("reevaluar", { id: c.id })}><RefreshCw className="h-4 w-4" /> Recalcular scoring</Button>}
          {e.usuario.permisos.comercios && (c.estado === "bloqueado"
            ? <Button variant="secondary" onClick={() => accion("bloquear", { id: c.id, bloqueado: false, motivo: "" })}>Desbloquear</Button>
            : <Button variant="danger" onClick={() => { setMotivo(""); setBloq(true); }}>Bloquear</Button>)}
        </div>
      </div>
      {c.estado === "bloqueado" && <div className="mb-4"><Aviso tone="red">Comercio bloqueado: no puede pedir adelantos desde el POS.</Aviso></div>}
      {c.correcciones && <div className="mb-4"><Aviso>El comercio pidió corregir datos al confirmar: {Object.entries(c.correcciones).map(([k, v]) => `${k}: ${v}`).join(" · ")}</Aviso></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="Scoring" sub={ev ? `Calculado el ${fecha(String(ev.fecha))} con parámetros v${ev.paramsVersion} · vigente hasta ${fecha(ev.vence)}` : "Sin evaluación"} />
          {ev && (
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <div>
                <div className="flex items-end gap-4">
                  <div><p className="text-xs text-neutral-500">Score</p><p className="font-display text-5xl">{ev.score}</p></div>
                  <div className="pb-1"><p className="text-xs text-neutral-500">Oferta máxima</p><p className="font-display text-2xl">{ev.montoMaxUsd ? usd(ev.montoMaxUsd) : "Sin oferta"}</p></div>
                </div>
                {ev.detalle.cortes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-coral">{ev.detalle.cortes.map((x) => <li key={x}>{x}</li>)}</ul>}
                <div className="mt-4 space-y-2.5">
                  {(Object.keys(ev.detalle.subscores) as Peso[]).map((k) => (
                    <div key={k}>
                      <div className="flex justify-between text-xs"><span>{PESO_LABEL[k]} <span className="text-neutral-400">· peso {cfg.scoring.pesos[k]}</span></span><span className="font-semibold tabular-nums">{ev.detalle.subscores[k]}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-brand" style={{ width: `${ev.detalle.subscores[k]}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-black/5">
                <Row k="Ventas mensuales promedio" v={usd(ev.detalle.metricas.ventasMensualesUsd)} />
                <Row k="Ventas diarias promedio" v={usd(ev.detalle.metricas.ventasDiariasUsd)} />
                <Row k="Meses con ventas" v={ev.detalle.metricas.mesesHistorial} />
                <Row k="Variación mes a mes (CV)" v={pct(ev.detalle.metricas.cv)} />
                <Row k="Tendencia (últ. 3 m vs. previos)" v={`${ev.detalle.metricas.tendencia >= 1 ? "+" : ""}${pct(ev.detalle.metricas.tendencia - 1)}`} />
                <Row k="Días con ventas" v={pct(ev.detalle.metricas.diasActivosPct, 0)} />
                <Row k="Transacciones rechazadas" v={pct(ev.detalle.metricas.rechazoPct)} />
                <Row k="Ticket promedio" v={usd(ev.detalle.metricas.ticketPromedioUsd)} />
                <Row k="Antigüedad con Disglobal" v={`${ev.detalle.metricas.antiguedadMeses} meses`} />
                <div className="pt-2 text-xs text-neutral-500">
                  Tope por ventas {usd(ev.detalle.calculo.base)} ({pct(cfg.oferta.pctVentasMensuales, 0)} × multiplicador {ev.detalle.calculo.multiplicador}) · capacidad de pago {usd(ev.detalle.calculo.capacidad)} · límite {usd(cfg.oferta.montoMax)}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Ficha Disglobal" sub={<>Estatus <strong>{f.estatus}</strong> · afiliado desde {fecha(f.afiliadoDesde)}</>} />
          <div className="divide-y divide-black/5 px-5 pb-3">
            <Row wrap k="Actividad" v={f.actividad} />
            <Row wrap k="Ciudad" v={`${f.ciudad}, ${f.estado}`} />
            <Row wrap k="Teléfono" v={c.telefono} />
            <Row wrap k="Correo" v={c.email} />
            <Row wrap k="Representante" v={f.representante.nombre} />
            <Row wrap k="Cédula" v={f.representante.cedula} />
            <Row wrap k="Banco" v={f.cuentaLiquidacion.banco} />
            <Row wrap k="Cuenta" v={f.cuentaLiquidacion.numero} />
            <div className="py-2 text-sm">
              <p className="mb-1 text-neutral-500">Terminales</p>
              {f.terminales.map((t) => {
                const v = d.terminales.find((x) => x.serial === t.serial);
                return <p key={t.serial} className="flex justify-between"><span>{t.modelo} · {t.serial}</span>{v ? <Pill tone="green">Usa la app</Pill> : <span className="text-xs text-neutral-400">sin uso</span>}</p>;
              })}
              {d.terminales.filter((t) => !t.verificada).map((t) => <p key={t.serial} className="mt-1 flex justify-between text-coral"><span>{t.serial}</span><Pill tone="red">No verificada</Pill></p>)}
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHead title="Ventas por mes en el POS" sub="En USD, convirtiendo cada día a la tasa BCV de ese día" />
        <div className="flex h-48 items-end gap-2 overflow-x-auto px-5 pb-2 pt-4">
          {d.ventas.map((v) => (
            <div key={v.mes} className="flex min-w-[2.5rem] flex-1 flex-col items-center gap-1" title={`${usd(v.usd)} · ${bs(v.bs)} · ${v.tx} transacciones`}>
              <span className="text-[10px] tabular-nums text-neutral-500">{Math.round(v.usd / 100) / 10}k</span>
              <div className="w-full rounded-t-md bg-brand" style={{ height: `${(v.usd / maxVentas) * 120}px` }} />
              <span className="text-[10px] text-neutral-500">{v.mes.slice(2).replace("-", "/")}</span>
            </div>
          ))}
          {!d.ventas.length && <p className="text-sm text-neutral-500">Sin ventas registradas.</p>}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHead title="Adelantos" sub="Toca uno para ver sus abonos diarios" />
        <table className="w-full text-sm">
          <thead className="border-b border-black/5"><tr><Th>Solicitado</Th><Th>Estado</Th><Th right>Monto</Th><Th right>Total</Th><Th right>Saldo</Th><Th>Desembolso</Th></tr></thead>
          <tbody className="divide-y divide-black/5">
            {d.adelantos.map((a) => (
              <Fragment key={a.id}>
                <tr className="cursor-pointer hover:bg-sand/50" onClick={() => setAbierto(abierto === a.id ? null : a.id)}>
                  <Td>{fecha(String(a.creado))}</Td>
                  <Td><Pill tone={ESTADO_ADELANTO[a.estado].tone}>{ESTADO_ADELANTO[a.estado].t}</Pill></Td>
                  <Td right>{usd(a.montoUsd)}</Td><Td right>{usd(a.totalUsd)}</Td><Td right>{usd(a.saldoUsd)}</Td>
                  <Td>{a.desembolsadoEn ? `${bs(a.montoBs!)} · ${fecha(a.desembolsadoEn)} · BCV ${a.tasaDesembolso}` : a.motivo ?? "—"}</Td>
                </tr>
                {abierto === a.id && (
                  <tr><td colSpan={6} className="bg-sand/40 px-4 py-3">
                    {a.pagos.length === 0 ? <p className="text-sm text-neutral-500">Sin abonos todavía.</p> : (
                      <table className="w-full text-xs">
                        <thead><tr className="text-neutral-500"><th className="py-1 text-left">Fecha</th><th className="text-right">Ventas del día</th><th className="text-right">Retenido</th><th className="text-right">Tasa BCV</th><th className="text-right">Abono</th><th className="text-right">Saldo</th><th className="text-left pl-4">Origen</th></tr></thead>
                        <tbody>{a.pagos.map((p) => (
                          <tr key={p.id} className="tabular-nums"><td className="py-1">{fecha(p.fecha)}</td><td className="text-right">{p.ventasBs ? bs(p.ventasBs) : "—"}</td><td className="text-right">{bs(p.montoBs)}</td><td className="text-right">{p.tasaBcv.toLocaleString("es-VE")}</td><td className="text-right font-semibold">{usd(p.montoUsd)}</td><td className="text-right">{usd(p.saldoUsd)}</td><td className={clsx("pl-4", p.origen === "manual" && "text-violet-700")}>{p.origen === "manual" ? `Manual · ${p.registradoPor}` : "Retención"}</td></tr>
                        ))}</tbody>
                      </table>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!d.adelantos.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">Sin adelantos.</td></tr>}
          </tbody>
        </table>
      </Card>

      {bloq && (
        <Dialogo titulo={`Bloquear ${c.nombreComercial}`} okTxt="Bloquear" okVariant="danger" okDisabled={motivo.trim().length < 5} onClose={() => setBloq(false)} onOk={() => accion("bloquear", { id: c.id, bloqueado: true, motivo })}>
          <p className="text-neutral-500">No podrá pedir adelantos nuevos. Lo que ya debe se sigue cobrando.</p>
          <textarea className={inputCls} rows={3} value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder="Motivo" />
        </Dialogo>
      )}
    </>
  );
}
