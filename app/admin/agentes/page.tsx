"use client";

import clsx from "clsx";
import { Bot, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Aviso, Button, Card, CardHead, PageTitle, Pill, Tabs, Td, Th } from "@/components/ui";
import { DECISION_TONE, useEstado } from "@/lib/admin-store";
import { bs, fecha, usd } from "@/lib/format";


function Motor({ nombre, rol, activo, simulado }: { nombre: string; rol: string; activo: boolean; simulado: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between"><p className="font-display text-lg">{nombre}</p><Pill tone={activo ? "green" : simulado ? "violet" : "neutral"}>{activo ? "Conectado" : simulado ? "Simulado (demo)" : "Sin configurar"}</Pill></div>
      <p className="mt-1 text-sm text-neutral-500">{rol}</p>
    </Card>
  );
}

export default function Agentes() {
  const { e, accion } = useEstado();
  const [tab, setTab] = useState<"recomendaciones" | "cobranza" | "seguimiento">("recomendaciones");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; t: string } | null>(null);
  const ia = e.ia, m = ia.motores, cfg = e.parametros.vigente.valores;
  const cobros = ia.avisos.filter((a) => a.tipo === "cobro_voluntario");
  const seguimientos = ia.avisos.filter((a) => a.tipo === "seguimiento");
  const reportados = cobros.filter((a) => a.estado === "reportada");

  const correr = async () => {
    setMsg(null);
    try {
      const r = await accion<{ analizadas: number; cobros: number; seguimientos: number; resumen: boolean }>("agentes");
      setMsg({ tone: "green", t: `${r.analizadas} caso(s) analizados · ${r.cobros} aviso(s) de cobro · ${r.seguimientos} de seguimiento${r.resumen ? " · resumen del día escrito" : ""}.` });
    } catch (x) { setMsg({ tone: "red", t: (x as Error).message }); }
  };
  const run = async (fn: () => Promise<unknown>) => { setMsg(null); try { await fn(); } catch (x) { setMsg({ tone: "red", t: (x as Error).message }); } };

  return (
    <>
      <PageTitle title="Agentes de IA" sub="Analizan solicitudes y KYC dudosos, avisan el cobro voluntario cuando no hay ventas, hacen seguimiento del registro y escriben el resumen diario"
        action={e.usuario.permisos.decidir && <Button onClick={correr}><Play className="h-4 w-4" /> Correr agentes ahora</Button>} />
      {msg && <div className="mb-4"><Aviso tone={msg.tone}>{msg.t}</Aviso></div>}

      <div className="grid gap-3 md:grid-cols-3">
        <Motor nombre="Claude" rol="Analiza cada caso, explica riesgos y mitigantes, y redacta los avisos y el resumen diario." activo={m.claude} simulado={m.simulados} />
        <Motor nombre="Jev · TypeSafe" rol="Decisión rápida y calibrada (probabilidades) sobre los datos del caso; no genera texto." activo={m.jev} simulado={m.simulados} />
        <Motor nombre="Hex" rol="Tableros de cartera sobre las vistas hex_* de la base; el resumen diario refresca el proyecto." activo={m.hex} simulado={false} />
      </div>

      <div className="mt-4">
        <Aviso tone="blue">
          {cfg.ia.aplicarAutomatico
            ? <>Los agentes <strong>aprueban solos</strong> solicitudes hasta {usd(cfg.ia.montoAutoMaxUsd)} y KYC cuando Claude y Jev coinciden en aprobar con al menos {Math.round(cfg.ia.confianzaMin * 100)}% de confianza. Los rechazos siempre los decide una persona.</>
            : <>Los agentes <strong>solo recomiendan</strong>: Riesgo decide. Se puede activar la aprobación automática en <Link href="/admin/parametros" className="font-semibold underline">Parámetros</Link>.</>}
          {" "}Cobro voluntario: {cfg.cobranza.avisarSinVentas ? `aviso tras ${cfg.cobranza.diasSinVentasAviso} día(s) sin ventas por el POS` : "desactivado"}.
        </Aviso>
      </div>

      {ia.informe && (
        <Card className="mt-6">
          <CardHead title={`Resumen del ${fecha(ia.informe.fecha)}`} sub={`Escrito por ${ia.informe.motor}${ia.informe.hex ? ` · Hex: ${ia.informe.hex}` : ""}`} action={<Bot className="h-5 w-5 text-brand" />} />
          <p className="whitespace-pre-line px-5 py-4 text-sm leading-relaxed">{ia.informe.texto}</p>
        </Card>
      )}

      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} items={[{ k: "recomendaciones", t: "Recomendaciones", n: ia.recomendaciones.length }, { k: "cobranza", t: "Cobro voluntario", n: cobros.length }, { k: "seguimiento", t: "Seguimiento", n: seguimientos.length }]} />
        {tab === "recomendaciones" && (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-black/5"><tr><Th>Fecha</Th><Th>Caso</Th><Th>Recomendación</Th><Th>Motores</Th><Th>Análisis</Th></tr></thead>
              <tbody className="divide-y divide-black/5">
                {ia.recomendaciones.map((r) => (
                  <tr key={r.id} className="align-top">
                    <Td>{new Date(r.creado).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}</Td>
                    <Td><Link href={`/admin/comercios/${r.comercioId}`} className="font-medium hover:underline">{r.comercio}</Link><p className="text-xs text-neutral-400">{r.tipo === "kyc" ? "KYC" : "Solicitud"}</p></Td>
                    <Td><Pill tone={DECISION_TONE[r.decision]}>{r.decision} · {Math.round(r.confianza * 100)}%</Pill>{r.aplicada && <p className="mt-1 text-xs text-emerald-700">Aplicada por el agente</p>}</Td>
                    <Td><p className="text-xs">Claude: {r.motores.claude}</p><p className="text-xs">Jev: {r.motores.jev}</p></Td>
                    <Td className="!whitespace-normal"><p className="max-w-md text-sm">{r.resumen}</p>{!!r.detalle.riesgos?.length && <p className="mt-1 max-w-md text-xs text-coral">{r.detalle.riesgos.join(" · ")}</p>}</Td>
                  </tr>
                ))}
                {!ia.recomendaciones.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">Aún no hay casos analizados.</td></tr>}
              </tbody>
            </table>
          </Card>
        )}
        {tab === "cobranza" && (
          <>
            {reportados.length > 0 && <div className="mb-3"><Aviso>{reportados.length} pago(s) reportado(s) por comercios esperan conciliación con el banco.</Aviso></div>}
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-black/5"><tr><Th>Fecha</Th><Th>Comercio</Th><Th>Aviso</Th><Th right>Cuota sugerida</Th><Th>Estado</Th><Th /></tr></thead>
                <tbody className="divide-y divide-black/5">
                  {cobros.map((a) => (
                    <tr key={a.id} className="align-top">
                      <Td>{fecha(String(a.creado))}</Td>
                      <Td><Link href={`/admin/comercios/${a.comercioId}`} className="font-medium hover:underline">{a.comercio}</Link></Td>
                      <Td className="!whitespace-normal"><p className="max-w-sm font-medium">{a.titulo}</p><p className="max-w-sm text-xs text-neutral-500">{a.mensaje}</p><p className="text-[11px] text-neutral-400">Redactó: {a.redactadoPor}</p></Td>
                      <Td right>{a.montoUsd ? usd(a.montoUsd) : "—"}{a.montoBs && <p className="text-xs text-neutral-400">{bs(a.montoBs)}</p>}</Td>
                      <Td><Pill tone={{ pendiente: "amber", leida: "neutral", reportada: "blue", conciliada: "green", descartada: "neutral" }[a.estado] as "amber"}>{a.estado}</Pill>{a.reporte && <p className="mt-1 text-xs text-neutral-500">{bs(a.reporte.montoBs)} · ref. {a.reporte.referencia}</p>}</Td>
                      <Td>{a.estado === "reportada" && e.usuario.permisos.moverDinero && (
                        <div className="flex gap-1.5">
                          <Button className="!px-3 !py-1.5 text-xs" onClick={() => run(() => accion("aviso-conciliar", { id: a.id, confirmar: true }))}>Conciliar</Button>
                          <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => run(() => accion("aviso-conciliar", { id: a.id, confirmar: false }))}>No apareció</Button>
                        </div>
                      )}</Td>
                    </tr>
                  ))}
                  {!cobros.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-neutral-500">Ningún comercio con adelanto activo dejó de vender por el POS.</td></tr>}
                </tbody>
              </table>
            </Card>
          </>
        )}
        {tab === "seguimiento" && (
          <Card>
            <ul className="divide-y divide-black/5">
              {seguimientos.map((a) => (
                <li key={a.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[8rem_12rem_1fr_6rem]">
                  <span className="text-xs text-neutral-500">{fecha(String(a.creado))}</span>
                  <Link href={`/admin/comercios/${a.comercioId}`} className="font-medium hover:underline">{a.comercio}</Link>
                  <span><strong className="font-medium">{a.titulo}</strong> <span className="text-neutral-600">{a.mensaje}</span></span>
                  <span className={clsx("text-right text-xs", a.estado === "pendiente" ? "text-amber-700" : "text-neutral-400")}>{a.estado === "pendiente" ? "Sin leer" : "Visto"}</span>
                </li>
              ))}
              {!seguimientos.length && <li className="px-5 py-8 text-center text-sm text-neutral-500">Sin avisos de seguimiento.</li>}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
