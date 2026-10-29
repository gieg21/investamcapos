"use client";

import { useCallback, useEffect, useState } from "react";
import { Aviso, Button, Card, CardHead, Field, inputCls, PageTitle, Pill, Td, Th } from "@/components/ui";
import { useEstado } from "@/lib/admin-store";
import { fecha, isoDay } from "@/lib/format";

type Tasa = { fecha: string; tasa: number; fuente: string; registradoPor: string | null };

export default function TasasBcv() {
  const { e, accion } = useEstado();
  const [tasas, setTasas] = useState<Tasa[]>([]);
  const [f, setF] = useState(isoDay(new Date()));
  const [t, setT] = useState("");
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; t: string } | null>(null);
  const puede = e.usuario.permisos.tasas;
  const cargar = useCallback(async () => setTasas(await accion<Tasa[]>("tasas")), [accion]);
  useEffect(() => { cargar(); }, [cargar]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); await cargar(); setMsg({ tone: "green", t: ok }); } catch (x) { setMsg({ tone: "red", t: (x as Error).message }); }
  };
  const num = (s: string) => Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);

  return (
    <>
      <PageTitle title="Tasas BCV" sub="El desembolso usa la tasa del día en que se transfiere; cada abono diario, la tasa del día de la venta. Sin tasa publicada (fines de semana y feriados) rige la última." />
      {msg && <div className="mb-4"><Aviso tone={msg.tone}>{msg.t}</Aviso></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-display text-base">Registrar tasa</h2>
            <div className="mt-4 space-y-3">
              <Field label="Fecha"><input type="date" className={inputCls} value={f} onChange={(x) => setF(x.target.value)} disabled={!puede} /></Field>
              <Field label="Bs por USD"><input className={inputCls} inputMode="decimal" value={t} onChange={(x) => setT(x.target.value)} placeholder="883,40" disabled={!puede} /></Field>
              <Button className="w-full" disabled={!puede || !(num(t) > 0)} onClick={() => run(() => accion("tasa", { fecha: f, tasa: num(t) }), `Tasa del ${fecha(f)} registrada.`)}>Guardar</Button>
              {!puede && <p className="text-xs text-neutral-500">Solo Operaciones o Administrador registran tasas.</p>}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-display text-base">Importar histórico</h2>
            <p className="mt-1 text-xs text-neutral-500">Una línea por día: <code>2026-10-24;883,40</code></p>
            <textarea className={inputCls + " mt-3 font-mono text-xs"} rows={6} value={csv} onChange={(x) => setCsv(x.target.value)} disabled={!puede} />
            <Button variant="secondary" className="mt-3 w-full" disabled={!puede || !csv.trim()} onClick={() => run(async () => { const r = await accion<{ importadas: number }>("tasas-importar", { texto: csv }); setCsv(""); return r; }, "Histórico importado.")}>Importar</Button>
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHead title="Últimos 120 días" />
          <div className="max-h-[36rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-black/5 bg-white"><tr><Th>Fecha</Th><Th right>Bs/USD</Th><Th>Fuente</Th><Th>Registró</Th></tr></thead>
              <tbody className="divide-y divide-black/5">
                {tasas.map((x) => (
                  <tr key={x.fecha}><Td>{fecha(x.fecha)}</Td><Td right>{x.tasa.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</Td>
                    <Td><Pill tone={x.fuente === "simulada" ? "violet" : x.fuente === "manual" ? "blue" : "neutral"}>{x.fuente}</Pill></Td><Td>{x.registradoPor ?? "—"}</Td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
