"use client";

import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialogo } from "@/components/Dialogo";
import { Aviso, Button, Card, CardHead, Field, inputCls, PageTitle, Pill } from "@/components/ui";
import { useEstado } from "@/lib/admin-store";
import { fecha, isoDay, usd } from "@/lib/format";
import { factorPrecio } from "@/lib/mca";
import { PESO_LABEL, validar, type Config, type Peso } from "@/lib/params";

const clon = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Aplana la config para comparar versiones: { "precio.costoMensual": 0.07, … }. */
function plano(o: unknown, pre = ""): Record<string, string> {
  if (Array.isArray(o)) return { [pre]: JSON.stringify(o) };
  if (o && typeof o === "object") return Object.assign({}, ...Object.entries(o).map(([k, v]) => plano(v, pre ? `${pre}.${k}` : k)));
  return { [pre]: String(o) };
}

/** Oferta para un comercio de ejemplo (mismas reglas que lib/scoring.evaluar, sin las métricas de detalle). */
function ofertaEjemplo(cfg: Config, ventasMes: number, score: number) {
  const o = cfg.oferta, p = cfg.precio;
  if (ventasMes < cfg.scoring.ventasMinUsd || score < cfg.scoring.scoreMin) return 0;
  const mult = [...o.escalones].sort((a, b) => b.scoreMin - a.scoreMin).find((e) => score >= e.scoreMin)?.multiplicador ?? 0;
  const plazoMax = Math.max(...p.plazos);
  const cap = ((ventasMes / 30) * p.retencionMaxPct * plazoMax) / factorPrecio(plazoMax, cfg);
  const tope = Math.floor(Math.min(ventasMes * o.pctVentasMensuales * mult, cap, o.montoMax) / o.redondeo) * o.redondeo;
  return tope >= o.montoMin ? tope : 0;
}

function Num({ label, value, onChange, pct, suf, hint, disabled }: { label: string; value: number; onChange: (n: number) => void; pct?: boolean; suf?: string; hint?: ReactNode; disabled?: boolean }) {
  const shown = pct ? Math.round(value * 10000) / 100 : value;
  const [txt, setTxt] = useState(String(shown));
  useEffect(() => setTxt(String(shown)), [shown]);
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input className={clsx(inputCls, "pr-12 tabular-nums")} inputMode="decimal" value={txt} disabled={disabled}
          onChange={(e) => { setTxt(e.target.value); const n = Number(e.target.value.replace(",", ".")); if (Number.isFinite(n)) onChange(pct ? n / 100 : n); }} />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{pct ? "%" : suf}</span>
      </div>
    </Field>
  );
}

function Seccion({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return <Card><CardHead title={titulo} sub={sub} /><div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div></Card>;
}

export default function Parametros() {
  const { e, accion } = useEstado();
  const vig = e.parametros.vigente;
  const pend = e.parametros.versiones.find((v) => v.estado === "pendiente");
  const editable = e.usuario.permisos.parametros && !pend;
  const [c, setC] = useState<Config>(() => clon(vig.valores));
  const [plazosTxt, setPlazosTxt] = useState(vig.valores.precio.plazos.join(", "));
  const [nota, setNota] = useState("");
  const [desde, setDesde] = useState(isoDay(new Date()));
  const [msg, setMsg] = useState<{ tone: "green" | "red"; t: string } | null>(null);
  const [rechazo, setRechazo] = useState<string | null>(null);
  useEffect(() => { setC(clon(vig.valores)); setPlazosTxt(vig.valores.precio.plazos.join(", ")); }, [vig.id, vig.valores]);

  const set = (fn: (x: Config) => void) => setC((prev) => { const x = clon(prev); fn(x); return x; });
  const errores = validar(c);
  const cambios = useMemo(() => {
    const a = plano(vig.valores), b = plano(c);
    return Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => ({ k, antes: a[k], ahora: b[k] }));
  }, [c, vig.valores]);
  const pendCambios = useMemo(() => {
    if (!pend) return [];
    const a = plano(vig.valores), b = plano(pend.valores);
    return Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => ({ k, antes: a[k], ahora: b[k] }));
  }, [pend, vig.valores]);
  const sumaPesos = Object.values(c.scoring.pesos).reduce((x, y) => x + y, 0);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ tone: "green", t: ok }); } catch (x) { setMsg({ tone: "red", t: (x as Error).message }); }
  };

  return (
    <>
      <PageTitle title="Parámetros" sub={`Vigente: versión ${vig.id}. Cada cambio crea una versión nueva; la aprueba otro Administrador. Las ofertas y adelantos guardan la versión con la que se calcularon.`} />
      {msg && <div className="mb-4"><Aviso tone={msg.tone}>{msg.t}</Aviso></div>}

      {pend && (
        <Card className="mb-6 ring-2 ring-amber-300">
          <CardHead title={`Propuesta pendiente · versión ${pend.id}`} sub={`${pend.propuestoPor} · ${new Date(pend.propuestoEn).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })} · vigente desde ${fecha(pend.vigenteDesde)}`}
            action={e.usuario.permisos.parametros && (
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => setRechazo("")}>Rechazar</Button>
                <Button disabled={pend.propuestoPorId === e.usuario.id} title={pend.propuestoPorId === e.usuario.id ? "Quien propone no puede aprobar" : undefined} onClick={() => run(() => accion("parametros-aprobar"), "Versión aprobada.")}>Aprobar</Button>
              </div>
            )} />
          <div className="p-5 text-sm">
            <p className="mb-3">{pend.nota}</p>
            <Cambios lista={pendCambios} />
            {pend.propuestoPorId === e.usuario.id && <p className="mt-3 text-xs text-neutral-500">La propusiste tú: debe aprobarla otro Administrador.</p>}
          </div>
        </Card>
      )}
      {!e.usuario.permisos.parametros && <div className="mb-4"><Aviso tone="blue">Solo los Administradores proponen y aprueban cambios. Puedes ver los valores vigentes.</Aviso></div>}

      <div className="space-y-6">
        <Seccion titulo="Oferta" sub="Monto máximo de adelanto por comercio">
          <Num label="Monto mínimo" suf="USD" value={c.oferta.montoMin} onChange={(n) => set((x) => { x.oferta.montoMin = n; })} disabled={!editable} />
          <Num label="Monto máximo" suf="USD" value={c.oferta.montoMax} onChange={(n) => set((x) => { x.oferta.montoMax = n; })} disabled={!editable} />
          <Num label="Redondeo" suf="USD" value={c.oferta.redondeo} onChange={(n) => set((x) => { x.oferta.redondeo = n; })} disabled={!editable} hint="La oferta se redondea hacia abajo a este múltiplo" />
          <Num label="Tope sobre ventas mensuales" pct value={c.oferta.pctVentasMensuales} onChange={(n) => set((x) => { x.oferta.pctVentasMensuales = n; })} disabled={!editable} hint="Antes del multiplicador por score" />
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium">Multiplicador por score</p>
            <div className="space-y-2">
              {c.oferta.escalones.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-neutral-500">Desde score</span>
                  <input className={clsx(inputCls, "!w-20")} inputMode="numeric" value={s.scoreMin} disabled={!editable} onChange={(e) => set((x) => { x.oferta.escalones[i].scoreMin = Number(e.target.value) || 0; })} />
                  <span className="text-neutral-500">×</span>
                  <input className={clsx(inputCls, "!w-20")} inputMode="decimal" value={s.multiplicador} disabled={!editable} onChange={(e) => set((x) => { x.oferta.escalones[i].multiplicador = Number(e.target.value.replace(",", ".")) || 0; })} />
                  {editable && <button onClick={() => set((x) => { x.oferta.escalones.splice(i, 1); })} className="rounded-lg p-2 text-neutral-400 hover:bg-sand" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
              {editable && <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => set((x) => { x.oferta.escalones.push({ scoreMin: 90, multiplicador: 1 }); })}><Plus className="h-3.5 w-3.5" /> Escalón</Button>}
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Precio y cobro" sub="Total a pagar = monto × (1 + costo mensual × meses + comisión). Se cobra reteniendo un % de las ventas diarias en Bs, a la tasa BCV de cada día.">
          <Num label="Costo mensual" pct value={c.precio.costoMensual} onChange={(n) => set((x) => { x.precio.costoMensual = n; })} disabled={!editable} />
          <Num label="Comisión de apertura" pct value={c.precio.comisionApertura} onChange={(n) => set((x) => { x.precio.comisionApertura = n; })} disabled={!editable} />
          <Field label="Plazos (días)" hint="Separados por coma">
            <input className={inputCls} value={plazosTxt} disabled={!editable} onChange={(e) => { setPlazosTxt(e.target.value); const ps = e.target.value.split(/[,\s]+/).filter(Boolean).map(Number); set((x) => { x.precio.plazos = ps; }); }} />
          </Field>
          <Num label="Retención mínima" pct value={c.precio.retencionMinPct} onChange={(n) => set((x) => { x.precio.retencionMinPct = n; })} disabled={!editable} />
          <Num label="Retención máxima" pct value={c.precio.retencionMaxPct} onChange={(n) => set((x) => { x.precio.retencionMaxPct = n; })} disabled={!editable} hint="Limita monto y plazos disponibles" />
          <Num label="Días de gracia" suf="días" value={c.precio.diasGracia} onChange={(n) => set((x) => { x.precio.diasGracia = n; })} disabled={!editable} hint="Después del plazo, antes de marcar vencido" />
        </Seccion>

        <Seccion titulo="Scoring con la data transaccional de Disglobal" sub="Cortes que impiden ofrecer y pesos del score (0–100)">
          <Num label="Meses de ingresos analizados" hint="Los más recientes (3 por defecto); la tendencia los compara con los anteriores" suf="meses" value={c.scoring.ventanaMeses} onChange={(n) => set((x) => { x.scoring.ventanaMeses = n; })} disabled={!editable} />
          <Num label="Historia mínima" suf="meses" value={c.scoring.historialMinMeses} onChange={(n) => set((x) => { x.scoring.historialMinMeses = n; })} disabled={!editable} />
          <Num label="Ventas mensuales mínimas" suf="USD" value={c.scoring.ventasMinUsd} onChange={(n) => set((x) => { x.scoring.ventasMinUsd = n; })} disabled={!editable} />
          <Num label="Ventas para 100 pts de volumen" suf="USD" value={c.scoring.volumenRefUsd} onChange={(n) => set((x) => { x.scoring.volumenRefUsd = n; })} disabled={!editable} />
          <Num label="Días con ventas mínimos" pct value={c.scoring.diasActivosMinPct} onChange={(n) => set((x) => { x.scoring.diasActivosMinPct = n; })} disabled={!editable} />
          <Num label="Rechazos máximos" pct value={c.scoring.rechazoMaxPct} onChange={(n) => set((x) => { x.scoring.rechazoMaxPct = n; })} disabled={!editable} />
          <Num label="Score mínimo para ofertar" suf="pts" value={c.scoring.scoreMin} onChange={(n) => set((x) => { x.scoring.scoreMin = n; })} disabled={!editable} />
          <div className="sm:col-span-2 lg:col-span-3">
            <p className={clsx("mb-2 text-sm font-medium", sumaPesos !== 100 && "text-coral")}>Pesos del score (suman {sumaPesos} de 100)</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {(Object.keys(c.scoring.pesos) as Peso[]).map((k) => <Num key={k} label={PESO_LABEL[k]} suf="pts" value={c.scoring.pesos[k]} onChange={(n) => set((x) => { x.scoring.pesos[k] = n; })} disabled={!editable} />)}
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Aprobación">
          <Num label="Aprobación automática hasta" suf="USD" value={c.aprobacion.automaticaHastaUsd} onChange={(n) => set((x) => { x.aprobacion.automaticaHastaUsd = n; })} disabled={!editable} hint="0 = todo pasa por Riesgo" />
          <Num label="…con score de al menos" suf="pts" value={c.aprobacion.scoreAutoMin} onChange={(n) => set((x) => { x.aprobacion.scoreAutoMin = n; })} disabled={!editable} />
          <Num label="Vigencia de la oferta" suf="días" value={c.aprobacion.vigenciaOfertaDias} onChange={(n) => set((x) => { x.aprobacion.vigenciaOfertaDias = n; })} disabled={!editable} />
        </Seccion>

        <Seccion titulo="Comportamiento de pago del último adelanto" sub="Sube o baja el cupo según cómo pagó la última línea tomada. Frecuencia = días con abono / días transcurridos. Ritmo = % pagado / % del plazo transcurrido (1 = al día).">
          <Num label="Frecuencia de buen pagador" pct value={c.comportamiento.frecuenciaBuena} onChange={(n) => set((x) => { x.comportamiento.frecuenciaBuena = n; })} disabled={!editable} />
          <Num label="Ritmo de buen pagador" suf="×" value={c.comportamiento.ritmoBueno} onChange={(n) => set((x) => { x.comportamiento.ritmoBueno = n; })} disabled={!editable} hint="Sin atraso sobre el plazo" />
          <Num label="Aumento de cupo (buen pagador)" suf="×" value={c.comportamiento.multiplicadorBueno} onChange={(n) => set((x) => { x.comportamiento.multiplicadorBueno = n; })} disabled={!editable} hint="Ej.: 1,25 = +25%" />
          <Num label="Frecuencia mínima" pct value={c.comportamiento.frecuenciaMin} onChange={(n) => set((x) => { x.comportamiento.frecuenciaMin = n; })} disabled={!editable} hint="Por debajo: pago lento" />
          <Num label="Ritmo mínimo" suf="×" value={c.comportamiento.ritmoMin} onChange={(n) => set((x) => { x.comportamiento.ritmoMin = n; })} disabled={!editable} hint="Por debajo: pago lento" />
          <Num label="Reducción de cupo (pago lento)" suf="×" value={c.comportamiento.multiplicadorLento} onChange={(n) => set((x) => { x.comportamiento.multiplicadorLento = n; })} disabled={!editable} hint="Ej.: 0,6 = −40%" />
          <Num label="Atraso máximo sobre el plazo" suf="días" value={c.comportamiento.diasAtrasoMax} onChange={(n) => set((x) => { x.comportamiento.diasAtrasoMax = n; })} disabled={!editable} hint="Más atraso: sin oferta" />
        </Seccion>

        <Seccion titulo="Agentes de IA (Claude + Jev)" sub="Por defecto solo recomiendan. Un rechazo nunca se aplica solo.">
          <Field label="Aprobación automática" hint="Aprueban solicitudes y KYC cuando Claude y Jev coinciden en aprobar">
            <select className={inputCls} disabled={!editable} value={c.ia.aplicarAutomatico ? "si" : "no"} onChange={(x) => set((y) => { y.ia.aplicarAutomatico = x.target.value === "si"; })}>
              <option value="no">No: solo recomiendan</option><option value="si">Sí, dentro de los límites</option>
            </select>
          </Field>
          <Num label="Confianza mínima de ambos" pct value={c.ia.confianzaMin} onChange={(n) => set((x) => { x.ia.confianzaMin = n; })} disabled={!editable} />
          <Num label="Monto máximo que aprueba el agente" suf="USD" value={c.ia.montoAutoMaxUsd} onChange={(n) => set((x) => { x.ia.montoAutoMaxUsd = n; })} disabled={!editable} />
        </Seccion>

        <Seccion titulo="Cobranza y seguimiento" sub="Disglobal retiene la cuota antes de liquidar las ventas. Si un día no hay ventas por el POS, el agente avisa al comercio para que abone por su voluntad.">
          <Field label="Aviso de cobro voluntario">
            <select className={inputCls} disabled={!editable} value={c.cobranza.avisarSinVentas ? "si" : "no"} onChange={(x) => set((y) => { y.cobranza.avisarSinVentas = x.target.value === "si"; })}>
              <option value="si">Activo</option><option value="no">Desactivado</option>
            </select>
          </Field>
          <Num label="Días sin ventas antes del aviso" suf="días" value={c.cobranza.diasSinVentasAviso} onChange={(n) => set((x) => { x.cobranza.diasSinVentasAviso = n; })} disabled={!editable} />
          <Num label="Días estancado en el registro" suf="días" value={c.cobranza.seguimientoDiasEstancado} onChange={(n) => set((x) => { x.cobranza.seguimientoDiasEstancado = n; })} disabled={!editable} hint="Antes del aviso de seguimiento" />
        </Seccion>

        <Seccion titulo="KYC del representante legal" sub="La cédula verificada debe ser la del representante que Disglobal tiene para el RIF">
          <Num label="Coincidencia selfie / cédula" pct={false} suf="%" value={c.kyc.coincidenciaRostroMin} onChange={(n) => set((x) => { x.kyc.coincidenciaRostroMin = n; })} disabled={!editable} hint="Por debajo, el KYC pasa a revisión manual" />
          <Num label="Intentos rechazados permitidos" suf="intentos" value={c.kyc.intentosMax} onChange={(n) => set((x) => { x.kyc.intentosMax = n; })} disabled={!editable} hint="Después, solo el backoffice puede habilitar otro" />
        </Seccion>

        <Card>
          <CardHead title="Ejemplo: oferta máxima con estos parámetros" sub="Según ventas mensuales en USD y score del comercio" />
          <div className="overflow-x-auto p-5">
            <table className="w-full text-sm tabular-nums">
              <thead><tr className="text-xs text-neutral-500"><th className="pb-2 text-left font-medium">Ventas/mes</th>{[55, 70, 90].map((s) => <th key={s} className="pb-2 text-right font-medium">Score {s}</th>)}</tr></thead>
              <tbody className="divide-y divide-black/5">
                {[800, 2000, 5000, 10000, 20000].map((v) => (
                  <tr key={v}><td className="py-2">{usd(v)}</td>{[55, 70, 90].map((s) => { const x = errores.length ? 0 : ofertaEjemplo(c, v, s); return <td key={s} className={clsx("py-2 text-right", !x && "text-neutral-400")}>{x ? usd(x) : "—"}</td>; })}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {editable && (
          <Card className="p-5">
            <h2 className="font-display text-base">Proponer cambio</h2>
            {errores.length > 0 && <div className="mt-3"><Aviso tone="red">{errores.join(" ")}</Aviso></div>}
            {cambios.length > 0 ? <div className="mt-3"><Cambios lista={cambios} /></div> : <p className="mt-2 text-sm text-neutral-500">Modifica algún valor arriba para proponer una versión nueva.</p>}
            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <Field label="Motivo del cambio"><input className={inputCls} value={nota} onChange={(x) => setNota(x.target.value)} placeholder="Ej.: subir retención máxima por comité de riesgo del 28/10" /></Field>
              <Field label="Vigente desde"><input type="date" className={inputCls} value={desde} min={isoDay(new Date())} onChange={(x) => setDesde(x.target.value)} /></Field>
              <Button disabled={!cambios.length || errores.length > 0 || nota.trim().length < 5} onClick={() => run(async () => { await accion("parametros-proponer", { valores: c, nota, vigenteDesde: desde }); setNota(""); }, "Propuesta enviada: falta la aprobación de otro Administrador.")}>Proponer</Button>
            </div>
          </Card>
        )}

        <Card>
          <CardHead title="Historial de versiones" />
          <ul className="divide-y divide-black/5">
            {e.parametros.versiones.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div><p className="font-medium">v{v.id} · {v.nota}</p><p className="text-xs text-neutral-500">Propuso {v.propuestoPor}{v.aprobadoPor ? ` · ${v.estado === "rechazada" ? "rechazó" : "aprobó"} ${v.aprobadoPor}` : ""} · vigente desde {fecha(v.vigenteDesde)}{v.motivoRechazo ? ` · ${v.motivoRechazo}` : ""}</p></div>
                <Pill tone={v.id === vig.id ? "green" : v.estado === "pendiente" ? "amber" : v.estado === "rechazada" ? "red" : "neutral"}>{v.id === vig.id ? "Vigente" : v.estado}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {rechazo != null && (
        <Dialogo titulo="Rechazar propuesta" okTxt="Rechazar" okVariant="danger" okDisabled={rechazo.trim().length < 5} onClose={() => setRechazo(null)} onOk={() => accion("parametros-rechazar", { motivo: rechazo })}>
          <textarea className={inputCls} rows={3} value={rechazo} onChange={(x) => setRechazo(x.target.value)} placeholder="Motivo" />
        </Dialogo>
      )}
    </>
  );
}

function Cambios({ lista }: { lista: { k: string; antes: string; ahora: string }[] }) {
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-neutral-500"><th className="pb-1 text-left font-medium">Campo</th><th className="text-right font-medium">Antes</th><th className="text-right font-medium">Ahora</th></tr></thead>
      <tbody>{lista.map((x) => <tr key={x.k}><td className="py-0.5 font-mono">{x.k}</td><td className="text-right text-neutral-500">{x.antes}</td><td className="text-right font-semibold">{x.ahora}</td></tr>)}</tbody>
    </table>
  );
}
