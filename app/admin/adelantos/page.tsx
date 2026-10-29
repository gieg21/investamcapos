"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialogo } from "@/components/Dialogo";
import { Button, Card, inputCls, PageTitle, Pill, Row, Tabs, Td, Th } from "@/components/ui";
import { ESTADO_ADELANTO, useEstado, type AdelantoAdmin } from "@/lib/admin-store";
import { bs, fecha, isoDay, usd } from "@/lib/format";

type Filtro = "pendientes" | "cobrando" | "cerrados" | "todos";
type Accion = { tipo: "aprobar" | "rechazar" | "desembolsar" | "pago"; a: AdelantoAdmin } | null;

export default function Adelantos() {
  const { e, accion } = useEstado();
  const [f, setF] = useState<Filtro>("pendientes");
  const [dlg, setDlg] = useState<Accion>(null);
  const [motivo, setMotivo] = useState("");
  const [ref, setRef] = useState("");
  const [montoBs, setMontoBs] = useState("");
  const [fechaPago, setFechaPago] = useState(isoDay(new Date()));
  const [cierre, setCierre] = useState("");
  const p = e.usuario.permisos;

  const grupos: Record<Filtro, AdelantoAdmin[]> = {
    pendientes: e.adelantos.filter((a) => ["en_revision", "aprobado"].includes(a.estado)),
    cobrando: e.adelantos.filter((a) => ["desembolsado", "vencido"].includes(a.estado)),
    cerrados: e.adelantos.filter((a) => ["pagado", "rechazado", "cancelado"].includes(a.estado)),
    todos: e.adelantos,
  };
  const abrir = (tipo: NonNullable<Accion>["tipo"], a: AdelantoAdmin) => { setMotivo(""); setRef(""); setMontoBs(""); setDlg({ tipo, a }); };

  const correrCierre = async () => {
    const r = await accion<{ pagos: number; cerrados: number; vencidos: number }>("cierre");
    setCierre(`${r.pagos} abono(s), ${r.cerrados} pagado(s), ${r.vencidos} vencido(s).`);
  };

  return (
    <>
      <PageTitle title="Adelantos" sub="Solicitudes hechas desde los POS, desembolsos en Bs a tasa BCV y cobro por retención diaria"
        action={p.moverDinero && <div className="text-right"><Button variant="secondary" onClick={correrCierre}>Correr cierre diario</Button>{cierre && <p className="mt-1 text-xs text-neutral-500">{cierre}</p>}</div>} />
      <Tabs value={f} onChange={setF} items={[
        { k: "pendientes", t: "Por decidir / desembolsar", n: grupos.pendientes.length },
        { k: "cobrando", t: "Cobrando", n: grupos.cobrando.length },
        { k: "cerrados", t: "Cerrados", n: grupos.cerrados.length },
        { k: "todos", t: "Todos", n: grupos.todos.length },
      ]} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-black/5"><tr><Th>Comercio</Th><Th>Estado</Th><Th right>Score</Th><Th right>Monto</Th><Th right>Plazo</Th><Th right>Total</Th><Th right>Retención</Th><Th right>Saldo</Th><Th>Desembolso</Th></tr></thead>
          <tbody className="divide-y divide-black/5">
            {grupos[f].length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-neutral-500">Sin adelantos en este grupo.</td></tr>}
            {grupos[f].map((a) => (
              <tr key={a.id} className="hover:bg-sand/50">
                <Td><Link href={`/admin/comercios/${a.comercioId}`} className="font-medium hover:underline">{a.comercio}</Link><p className="text-xs text-neutral-400">Solicitado {fecha(String(a.creado))}{a.aprobadoPor ? ` · ${a.aprobadoPor}` : ""}</p>
                  <div className="mt-2 flex gap-1.5 empty:hidden">
                    {a.estado === "en_revision" && p.decidir && <Button className="!px-3 !py-1.5 text-xs" onClick={() => abrir("aprobar", a)}>Aprobar</Button>}
                    {["en_revision", "aprobado"].includes(a.estado) && p.decidir && <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => abrir("rechazar", a)}>Rechazar</Button>}
                    {a.estado === "aprobado" && p.moverDinero && <Button variant="dark" className="!px-3 !py-1.5 text-xs" onClick={() => abrir("desembolsar", a)}>Desembolsar</Button>}
                    {["desembolsado", "vencido"].includes(a.estado) && p.moverDinero && <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => abrir("pago", a)}>Pago manual</Button>}
                  </div>
                </Td>
                <Td><Pill tone={ESTADO_ADELANTO[a.estado].tone}>{ESTADO_ADELANTO[a.estado].t}</Pill></Td>
                <Td right>{a.score ?? "—"}</Td>
                <Td right>{usd(a.montoUsd)}</Td>
                <Td right>{a.plazoDias} d</Td>
                <Td right>{usd(a.totalUsd)}</Td>
                <Td right>{(a.retencionPct * 100).toLocaleString("es-VE")}%</Td>
                <Td right>{usd(a.saldoUsd)}</Td>
                <Td>{a.desembolsadoEn ? <><p>{bs(a.montoBs!)}</p><p className="text-xs text-neutral-400">{fecha(a.desembolsadoEn)} · BCV {a.tasaDesembolso!.toLocaleString("es-VE")}</p></> : <span className="text-neutral-400">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {dlg?.tipo === "aprobar" && (
        <Dialogo titulo={`Aprobar adelanto de ${dlg.a.comercio}`} okTxt="Aprobar" onClose={() => setDlg(null)} onOk={() => accion("aprobar", { id: dlg.a.id })}>
          <Row k="Monto" v={usd(dlg.a.montoUsd)} /><Row k="Plazo" v={`${dlg.a.plazoDias} días`} /><Row k="Total a cobrar" v={usd(dlg.a.totalUsd)} /><Row k="Retención diaria" v={`${(dlg.a.retencionPct * 100).toLocaleString("es-VE")}%`} /><Row k="Score" v={dlg.a.score ?? "—"} />
          <p className="text-neutral-500">Pasa a Operaciones para el desembolso.</p>
        </Dialogo>
      )}
      {dlg?.tipo === "rechazar" && (
        <Dialogo titulo={`Rechazar adelanto de ${dlg.a.comercio}`} okTxt="Rechazar" okVariant="danger" okDisabled={motivo.trim().length < 5} onClose={() => setDlg(null)} onOk={() => accion("rechazar", { id: dlg.a.id, motivo })}>
          <p className="text-neutral-500">El comercio verá el motivo en su POS.</p>
          <textarea className={inputCls} rows={3} value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder="Motivo" />
        </Dialogo>
      )}
      {dlg?.tipo === "desembolsar" && (
        <Dialogo titulo={`Desembolsar a ${dlg.a.comercio}`} okTxt="Registrar desembolso" okVariant="dark" okDisabled={ref.trim().length < 4 || !e.tasaHoy} onClose={() => setDlg(null)} onOk={() => accion("desembolsar", { id: dlg.a.id, referencia: ref })}>
          <Row k="Monto" v={usd(dlg.a.montoUsd)} />
          <Row k="Tasa BCV de hoy" v={e.tasaHoy ? `${e.tasaHoy.tasa.toLocaleString("es-VE")} Bs/USD` : "sin registrar"} />
          <Row k="A transferir" v={e.tasaHoy ? bs(Math.round(dlg.a.montoUsd * e.tasaHoy.tasa * 100) / 100) : "—"} strong />
          <p className="text-neutral-500">Transfiere a la cuenta de liquidación del comercio en Disglobal y registra la referencia bancaria.</p>
          <input className={inputCls} value={ref} onChange={(x) => setRef(x.target.value)} placeholder="Referencia bancaria" />
        </Dialogo>
      )}
      {dlg?.tipo === "pago" && (
        <Dialogo titulo={`Pago manual de ${dlg.a.comercio}`} okTxt="Registrar pago" okDisabled={!(Number(montoBs) > 0) || ref.trim().length < 4} onClose={() => setDlg(null)}
          onOk={() => accion("pago-manual", { id: dlg.a.id, montoBs: Number(montoBs), fecha: fechaPago, referencia: ref })}>
          <p className="text-neutral-500">Para pagos fuera de la retención (transferencia o pago móvil del comercio). Se abona en USD a la tasa BCV de la fecha del pago. Saldo: {usd(dlg.a.saldoUsd)}.</p>
          <input className={inputCls} inputMode="decimal" value={montoBs} onChange={(x) => setMontoBs(x.target.value.replace(",", "."))} placeholder="Monto en Bs" />
          <input className={inputCls} type="date" value={fechaPago} onChange={(x) => setFechaPago(x.target.value)} />
          <input className={inputCls} value={ref} onChange={(x) => setRef(x.target.value)} placeholder="Referencia bancaria" />
        </Dialogo>
      )}
    </>
  );
}
