"use client";

import clsx from "clsx";
import { ArrowLeft, CheckCircle2, Clock, Loader2, LogOut, Pencil, ShieldCheck, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiFallo } from "@/lib/api";
import { bs, fecha, usd } from "@/lib/format";
import { cotizar } from "@/lib/mca";
import { CONFIG_DEFAULT } from "@/lib/params";
import { parseRif } from "@/lib/rif";
import type { estadoPos, consultarRif } from "@/server/mca";

/**
 * App del punto de venta. La abre el WebView de la app Android (carpeta /android) en la terminal Disglobal,
 * que pasa el serial de la terminal en `?serial=` o por el puente `window.InvestaPOS.serial()`.
 */

type Estado = Awaited<ReturnType<typeof estadoPos>>;
type Consulta = Awaited<ReturnType<typeof consultarRif>>;
declare global { interface Window { InvestaPOS?: { serial(): string; modelo(): string } } }

function serialTerminal() {
  if (typeof window === "undefined") return "";
  try { if (window.InvestaPOS) return window.InvestaPOS.serial(); } catch { /* puente no disponible */ }
  return new URLSearchParams(location.search).get("serial") ?? sessionStorage.getItem("serial") ?? "";
}

export default function Pos() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [rif, setRif] = useState("");
  const [serial, setSerial] = useState("");

  const recargar = useCallback(async () => {
    try {
      // De vuelta del flujo de Didit: se lee la decisión por si el webhook todavía no llegó.
      if (new URLSearchParams(location.search).get("kyc") === "listo") {
        history.replaceState(null, "", location.pathname);
        setEstado(await api<Estado>("/pos/kyc-consultar", {}));
      } else setEstado(await api<Estado>("/pos/estado"));
    }
    catch (e) { if (e instanceof ApiFallo && e.status === 401) setEstado(null); else throw e; }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { setSerial(serialTerminal()); recargar(); }, [recargar]);
  useEffect(() => { if (serial) try { sessionStorage.setItem("serial", serial); } catch { /* sin almacenamiento */ } }, [serial]);

  const salir = async () => { await api("/pos/salir", {}); setEstado(null); setConsulta(null); setRif(""); };

  let cuerpo: ReactNode;
  if (cargando) cuerpo = <Cargando texto="Cargando…" />;
  else if (estado) cuerpo = estado.activo ? <Activo e={estado} />
    : estado.oferta.montoMaxUsd && estado.kyc.estado !== "aprobado" ? <Kyc e={estado} onListo={setEstado} />
      : <Oferta e={estado} onListo={setEstado} />;
  else if (consulta) cuerpo = <Confirmar c={consulta} rif={rif} serial={serial} onVolver={() => setConsulta(null)} onListo={recargar} />;
  else cuerpo = <PasoRif rif={rif} setRif={setRif} serial={serial} setSerial={setSerial} onEncontrado={setConsulta} />;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-sand">
      <header className="flex items-center justify-between bg-white px-5 py-4 shadow-[0_1px_0_rgba(0,0,0,.05)]">
        <img src="/brand/investa-color.svg" alt="Investa" className="h-6 w-auto" />
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">con Disglobal</span>
          {estado && <button onClick={salir} className="rounded-lg p-1.5 text-neutral-400 hover:bg-sand" aria-label="Salir"><LogOut className="h-4 w-4" /></button>}
        </div>
      </header>
      {estado && (
        <div className="bg-ink px-5 py-3 text-white">
          <p className="truncate text-sm font-semibold">{estado.comercio.nombre}</p>
          <p className="text-xs text-white/60">{estado.comercio.rif}</p>
        </div>
      )}
      <main className="flex flex-1 flex-col px-5 py-6">{cuerpo}</main>
    </div>
  );
}

/* ---------- Piezas ---------- */

function Cargando({ texto }: { texto: string }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-500"><Loader2 className="h-8 w-8 animate-spin text-brand" /><p className="text-sm">{texto}</p></div>;
}
function Fallo({ msg }: { msg: string }) {
  return msg ? <p className="rounded-xl bg-coral-100 px-4 py-3 text-sm text-coral">{msg}</p> : null;
}
function Boton({ children, cargando, className, ...p }: { cargando?: boolean } & React.ComponentProps<"button">) {
  return (
    <button {...p} disabled={p.disabled || cargando} className={clsx("flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-base font-semibold text-white transition active:scale-[.99] disabled:opacity-40", className)}>
      {cargando && <Loader2 className="h-5 w-5 animate-spin" />}{children}
    </button>
  );
}
function Tarjeta({ titulo, children, accion }: { titulo?: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-card">
      {titulo && <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{titulo}</h3>{accion}</div>}
      {children}
    </section>
  );
}
function Dato({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 text-sm"><span className="text-neutral-500">{k}</span><span className="text-right font-medium">{v}</span></div>;
}
const inputCls = "h-14 w-full rounded-2xl border border-black/10 bg-white px-4 text-lg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

/* ---------- 1. RIF ---------- */

function PasoRif({ rif, setRif, serial, setSerial, onEncontrado }: { rif: string; setRif: (s: string) => void; serial: string; setSerial: (s: string) => void; onEncontrado: (c: Consulta) => void }) {
  const [letra, setLetra] = useState(rif[0] || "J");
  const [num, setNum] = useState(rif.replace(/\D/g, ""));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ rif: string; nombre: string; serial: string; modelo: string }[]>([]);
  useEffect(() => { api<typeof demo>("/pos/demo").then(setDemo).catch(() => {}); }, []);

  const buscar = async (r = `${letra}${num}`, s = serial) => {
    const p = parseRif(r);
    if (!p) return setErr("Escribe los 9 números del RIF (8 + el dígito final).");
    setErr(""); setBusy(true);
    try { setRif(p.canon); onEncontrado(await api<Consulta>("/pos/consulta", { rif: p.canon, serial: s || undefined })); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="font-display text-[28px] leading-tight">Adelanto de capital para tu negocio</h1>
        <p className="mt-2 text-neutral-500">Desde USD 200 hasta USD 5.000, en bolívares a tasa BCV. Lo pagas con un pequeño % de tus ventas diarias en este punto.</p>
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium">RIF del comercio</label>
        <div className="flex gap-2">
          <select value={letra} onChange={(e) => setLetra(e.target.value)} className={clsx(inputCls, "!w-20 shrink-0 px-3 font-semibold")} aria-label="Tipo de RIF">
            {["J", "V", "E", "G", "P"].map((l) => <option key={l}>{l}</option>)}
          </select>
          <input value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 9))} inputMode="numeric" placeholder="123456789" className={clsx(inputCls, "min-w-0 tracking-widest tabular-nums")} aria-label="Números del RIF" onKeyDown={(e) => e.key === "Enter" && buscar()} />
        </div>
        <p className="mt-2 text-xs text-neutral-500">Con tu RIF traemos tus datos de Disglobal. Solo tienes que confirmarlos.</p>
      </div>
      <Fallo msg={err} />
      <div className="mt-auto space-y-4">
        <Boton onClick={() => buscar()} cargando={busy} disabled={num.length < 9}>Continuar</Boton>
        <p className="flex items-center justify-center gap-1.5 text-xs text-neutral-400"><ShieldCheck className="h-3.5 w-3.5" /> Terminal {serial || "sin serial"}</p>
      </div>
      {demo.length > 0 && (
        <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-700">Demo · comercios de Disglobal simulados</p>
          <div className="grid gap-1.5">
            {demo.map((d) => (
              <button key={d.rif} onClick={() => { setLetra(d.rif[0]); setNum(d.rif.replace(/\D/g, "")); setSerial(d.serial); buscar(d.rif, d.serial); }} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-left text-sm ring-1 ring-violet-200">
                <span className="font-medium">{d.nombre}</span><span className="text-xs text-neutral-500">{d.rif} · {d.modelo}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 2. Confirmar datos de Disglobal ---------- */

function Confirmar({ c, rif, serial, onVolver, onListo }: { c: Consulta; rif: string; serial: string; onVolver: () => void; onListo: () => Promise<void> }) {
  const f = c.ficha;
  const [telefono, setTelefono] = useState(c.contacto?.telefono ?? f.telefono);
  const [email, setEmail] = useState(c.contacto?.email ?? f.email);
  const [editar, setEditar] = useState(false);
  const [nota, setNota] = useState("");
  const [malo, setMalo] = useState(false);
  const [acepto, setAcepto] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const terminal = f.terminales.find((t) => t.serial === serial);

  const confirmar = async () => {
    setErr(""); setBusy(true);
    try { await api("/pos/confirmar", { rif, serial: serial || undefined, telefono, email, nota: malo ? nota : undefined, acepto: true }); await onListo(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  if (busy && !err) return <Cargando texto="Analizando tus ventas en Disglobal…" />;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <button onClick={onVolver} className="flex items-center gap-1 self-start text-sm text-neutral-500"><ArrowLeft className="h-4 w-4" /> Cambiar RIF</button>
      <div>
        <h1 className="font-display text-2xl">¿Estos son tus datos?</h1>
        <p className="mt-1 text-sm text-neutral-500">Los trajimos de Disglobal con tu RIF. Revisa y confirma.</p>
      </div>
      {f.estatus !== "activo" && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Tu afiliación figura como <strong>{f.estatus}</strong> en Disglobal.</p>}
      <Tarjeta titulo="Comercio">
        <p className="font-display text-lg">{f.nombreComercial}</p>
        <p className="text-sm text-neutral-500">{f.razonSocial}</p>
        <div className="mt-2 border-t border-black/5 pt-2">
          <Dato k="RIF" v={f.rif} />
          <Dato k="Actividad" v={f.actividad} />
          <Dato k="Dirección" v={<span className="block max-w-[14rem]">{f.direccion}, {f.ciudad}, {f.estado}</span>} />
          <Dato k="Afiliado desde" v={fecha(f.afiliadoDesde)} />
        </div>
      </Tarjeta>
      <Tarjeta titulo="Representante legal">
        <Dato k="Nombre" v={f.representante.nombre} />
        <Dato k="Cédula" v={f.representante.cedula} />
      </Tarjeta>
      <Tarjeta titulo="Contacto" accion={!editar && <button onClick={() => setEditar(true)} className="flex items-center gap-1 text-xs font-semibold text-brand"><Pencil className="h-3 w-3" /> Cambiar</button>}>
        {editar ? (
          <div className="space-y-2">
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" className={clsx(inputCls, "h-12 text-base")} aria-label="Teléfono" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" className={clsx(inputCls, "h-12 text-base")} aria-label="Correo" />
          </div>
        ) : (<><Dato k="Teléfono" v={telefono} /><Dato k="Correo" v={email} /></>)}
      </Tarjeta>
      <Tarjeta titulo="Cuenta donde recibes el adelanto">
        <Dato k="Banco" v={f.cuentaLiquidacion.banco} />
        <Dato k="Cuenta" v={f.cuentaLiquidacion.numero} />
        <p className="mt-1 text-xs text-neutral-400">Es la misma cuenta donde Disglobal te liquida las ventas.</p>
      </Tarjeta>
      <Tarjeta titulo="Este punto de venta">
        <Dato k="Equipo" v={terminal ? `${terminal.modelo} · ${terminal.serial}` : serial || "—"} />
        {!c.terminalVerificada && <p className="mt-1 text-xs text-amber-700">Demo: este serial no figura en Disglobal para el RIF. En producción no se podría continuar.</p>}
      </Tarjeta>
      <label className="flex items-start gap-3 text-sm text-neutral-600">
        <input type="checkbox" checked={malo} onChange={(e) => setMalo(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand" /> Algo de esto no está bien
      </label>
      {malo && <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} placeholder="Cuéntanos qué hay que corregir. Lo revisará Investa." className="w-full rounded-2xl border border-black/10 p-3 text-sm" />}
      <label className="flex items-start gap-3 text-sm text-neutral-600">
        <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand" />
        Confirmo que los datos son correctos y autorizo a Investa a consultar mis ventas en Disglobal para calcular mi adelanto.
      </label>
      <Fallo msg={err} />
      <Boton onClick={confirmar} disabled={!acepto || (malo && nota.trim().length < 5)} cargando={busy}>Confirmar y ver mi oferta</Boton>
    </div>
  );
}

/* ---------- 3. KYC del representante legal ---------- */

function Kyc({ e, onListo }: { e: Estado; onListo: (e: Estado) => void }) {
  const k = e.kyc;
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setErr(""); setBusy(true); try { await fn(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  const iniciar = () => run(async () => {
    const r = await api<{ url: string | null; estado: Estado }>("/pos/kyc-iniciar", {});
    if (r.url) location.href = r.url; // flujo de Didit: cédula, selfie y prueba de vida
    else onListo(r.estado);
  });
  const simular = (escenario: string) => run(async () => onListo(await api<Estado>("/pos/kyc-simular", { escenario })));

  const quien = (
    <Tarjeta titulo="Quién debe hacerlo">
      <p className="font-semibold">{k.representante.nombre}</p>
      <p className="text-sm text-neutral-500">C.I. {k.representante.cedula} · representante legal registrado en Disglobal</p>
    </Tarjeta>
  );

  if (k.estado === "en_revision") return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-card"><Clock className="h-8 w-8 text-amber-500" /></div>
      <h1 className="text-center font-display text-2xl">Estamos revisando tu verificación</h1>
      <p className="text-center text-sm text-neutral-500">Un analista de Investa la revisa a mano. Te avisamos por {e.comercio.telefono}; suele tomar menos de un día hábil.</p>
      {quien}
    </div>
  );

  if (k.estado === "pendiente" && k.simulado) return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="font-display text-2xl">Verificación de identidad</h1>
      <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-3xl bg-ink text-white/70">
        <ShieldCheck className="h-12 w-12" />
        <p className="px-8 text-center text-sm">Aquí se abre el flujo de Didit: foto de la cédula por ambos lados, selfie y prueba de vida.</p>
      </div>
      <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-700">Demo · ¿quién se verificó?</p>
        <div className="grid gap-1.5">
          <button disabled={busy} onClick={() => simular("representante")} className="rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-violet-200">El representante legal</button>
          <button disabled={busy} onClick={() => simular("dudoso")} className="rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-violet-200">El representante, con selfie poco clara</button>
          <button disabled={busy} onClick={() => simular("otra_persona")} className="rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-violet-200">Otra persona (un empleado)</button>
        </div>
      </div>
      <Fallo msg={err} />
    </div>
  );

  const sinIntentos = k.estado === "rechazado" && k.intentosRestantes === 0;
  return (
    <div className="flex flex-1 flex-col gap-4">
      {e.oferta.montoMaxUsd > 0 && (
        <div className="rounded-3xl bg-brand p-5 text-white">
          <p className="text-sm text-white/80">Tienes disponible hasta</p>
          <p className="font-display text-3xl">{usd(e.oferta.montoMaxUsd)}</p>
          <p className="mt-1 text-xs text-white/70">Solo falta verificar la identidad del representante legal.</p>
        </div>
      )}
      <div>
        <h1 className="font-display text-2xl">Verifica tu identidad</h1>
        <p className="mt-1 text-sm text-neutral-500">Por seguridad, el adelanto solo lo puede pedir el representante legal del comercio.</p>
      </div>
      {quien}
      {k.estado === "rechazado" && (
        <p className="rounded-xl bg-coral-100 px-4 py-3 text-sm text-coral">
          {k.motivo ?? "No pudimos verificar la identidad."} {sinIntentos ? "Ya no quedan intentos: comunícate con Investa." : `Te ${k.intentosRestantes === 1 ? "queda 1 intento" : `quedan ${k.intentosRestantes} intentos`}.`}
        </p>
      )}
      {!sinIntentos && (
        <Tarjeta titulo="Ten a mano">
          <ul className="space-y-1.5 text-sm text-neutral-600">
            <li>• La cédula de identidad del representante, vigente</li>
            <li>• Buena luz y la cara descubierta (sin lentes oscuros ni gorra)</li>
            <li>• Unos 2 minutos</li>
          </ul>
        </Tarjeta>
      )}
      <Fallo msg={err} />
      {!sinIntentos && (
        <div className="mt-auto">
          <Boton onClick={k.estado === "pendiente" && k.url ? () => { location.href = k.url!; } : iniciar} cargando={busy}>
            {k.estado === "pendiente" ? "Continuar verificación" : k.estado === "rechazado" ? "Intentar de nuevo" : "Comenzar verificación"}
          </Boton>
          <p className="mt-3 text-center text-xs text-neutral-400">La verificación la hace Didit; Investa recibe el resultado y los datos de la cédula.</p>
        </div>
      )}
    </div>
  );
}

/* ---------- 4. Oferta ---------- */

function Oferta({ e, onListo }: { e: Estado; onListo: (e: Estado) => void }) {
  const o = e.oferta;
  const cfg = useMemo(() => ({ ...CONFIG_DEFAULT, precio: o.precio, oferta: { ...CONFIG_DEFAULT.oferta, montoMin: o.montoMinUsd, redondeo: o.redondeo } }), [o]);
  const [monto, setMonto] = useState(o.montoMaxUsd);
  const cotis = useMemo(() => o.precio.plazos.map((p) => cotizar(monto, p, o.ventasDiariasUsd, cfg)), [monto, o, cfg]);
  const [plazo, setPlazo] = useState(() => cotis.find((q) => q.disponible)?.plazoDias ?? o.precio.plazos[o.precio.plazos.length - 1]);
  const q = cotis.find((x) => x.plazoDias === plazo)!;
  const [acepto, setAcepto] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!q.disponible) { const d = cotis.find((x) => x.disponible); if (d) setPlazo(d.plazoDias); } }, [q, cotis]);

  if (!o.montoMaxUsd) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-card"><Store className="h-8 w-8 text-neutral-400" /></div>
        <h1 className="text-center font-display text-2xl">Por ahora no tenemos una oferta para ti</h1>
        <Tarjeta titulo="Por qué">
          <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-600">{o.cortes.map((c) => <li key={c}>{c}</li>)}</ul>
        </Tarjeta>
        <p className="text-center text-sm text-neutral-500">Sigue vendiendo con tu punto Disglobal: revisamos tu oferta de nuevo a partir del {fecha(o.vence)}.</p>
        {e.historial.length > 0 && <Historial h={e.historial} />}
      </div>
    );
  }

  const solicitar = async () => {
    setErr(""); setBusy(true);
    try { onListo(await api<Estado>("/pos/solicitar", { montoUsd: monto, plazoDias: plazo, acepto: true })); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const pasos = Math.round((o.montoMaxUsd - o.montoMinUsd) / o.redondeo);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-3xl bg-brand p-5 text-white shadow-card">
        <p className="text-sm text-white/80">Tienes disponible hasta</p>
        <p className="font-display text-4xl">{usd(o.montoMaxUsd)}</p>
        <p className="mt-1 text-xs text-white/70">Oferta válida hasta el {fecha(o.vence)} · basada en tus ventas de ~{usd(o.ventasMensualesUsd)} al mes</p>
      </div>

      <Tarjeta titulo="¿Cuánto necesitas?">
        <p className="text-center font-display text-3xl tabular-nums">{usd(monto)}</p>
        {e.tasaHoy && <p className="text-center text-sm text-neutral-500">≈ {bs(monto * e.tasaHoy)} hoy</p>}
        {pasos > 0 && <input type="range" min={o.montoMinUsd} max={o.montoMaxUsd} step={o.redondeo} value={monto} onChange={(x) => setMonto(Number(x.target.value))} className="mt-4 w-full accent-brand" aria-label="Monto" />}
        <div className="mt-1 flex justify-between text-xs text-neutral-400"><span>{usd(o.montoMinUsd)}</span><span>{usd(o.montoMaxUsd)}</span></div>
      </Tarjeta>

      <Tarjeta titulo="¿En cuánto tiempo lo pagas?">
        <div className="grid grid-cols-3 gap-2">
          {cotis.map((x) => (
            <button key={x.plazoDias} disabled={!x.disponible} onClick={() => setPlazo(x.plazoDias)} className={clsx("rounded-xl py-3 text-sm font-semibold ring-1 transition disabled:opacity-30", plazo === x.plazoDias ? "bg-ink text-white ring-ink" : "bg-white ring-black/10")}>
              {x.plazoDias} días
            </button>
          ))}
        </div>
        {cotis.some((x) => !x.disponible) && <p className="mt-2 text-xs text-neutral-400">Los plazos atenuados necesitarían retener más del {Math.round(o.precio.retencionMaxPct * 100)}% de tus ventas.</p>}
      </Tarjeta>

      <Tarjeta titulo="Resumen">
        <Dato k="Recibes" v={usd(q.montoUsd)} />
        <Dato k={`Cargo (${(o.precio.costoMensual * 100).toLocaleString("es-VE")}% mensual × ${q.plazoDias / 30} mes${q.plazoDias > 30 ? "es" : ""})`} v={usd(q.cargoUsd)} />
        {q.comisionUsd > 0 && <Dato k={`Comisión de apertura (${(o.precio.comisionApertura * 100).toLocaleString("es-VE")}%)`} v={usd(q.comisionUsd)} />}
        <div className="my-1 border-t border-black/5" />
        <Dato k="Total a pagar" v={<span className="font-display text-base">{usd(q.totalUsd)}</span>} />
        <Dato k="Se retiene de tus ventas" v={`${(q.retencionPct * 100).toLocaleString("es-VE")}% diario`} />
        <Dato k="Cuota diaria estimada" v={`${usd(q.cuotaDiariaUsd)}${e.tasaHoy ? ` ≈ ${bs(q.cuotaDiariaUsd * e.tasaHoy)}` : ""}`} />
        <p className="mt-2 rounded-xl bg-sand p-3 text-xs text-neutral-600">
          Te depositamos en bolívares a la tasa BCV del día del desembolso. Cada día se retiene el {(q.retencionPct * 100).toLocaleString("es-VE")}% de lo que vendas en este punto, en bolívares, y se abona a tu deuda en dólares a la tasa BCV de ese día. Si un día vendes menos, pagas menos.
        </p>
      </Tarjeta>

      <label className="flex items-start gap-3 text-sm text-neutral-600">
        <input type="checkbox" checked={acepto} onChange={(x) => setAcepto(x.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand" />
        Acepto las condiciones del adelanto y autorizo a Disglobal a retener el {(q.retencionPct * 100).toLocaleString("es-VE")}% de mis ventas diarias hasta pagar {usd(q.totalUsd)}.
      </label>
      <Fallo msg={err} />
      <Boton onClick={solicitar} disabled={!acepto || !q.disponible} cargando={busy}>Solicitar {usd(monto)}</Boton>
      {e.historial.length > 0 && <Historial h={e.historial} />}
    </div>
  );
}

/* ---------- 5. Adelanto en curso ---------- */

const ESTADO_TXT: Record<string, { t: string; c: string }> = {
  en_revision: { t: "En revisión", c: "bg-amber-50 text-amber-700" },
  aprobado: { t: "Aprobado", c: "bg-brand-50 text-brand" },
  desembolsado: { t: "Pagando", c: "bg-emerald-50 text-emerald-700" },
  vencido: { t: "Vencido", c: "bg-coral-100 text-coral" },
  pagado: { t: "Pagado", c: "bg-neutral-100 text-neutral-600" },
  rechazado: { t: "Rechazado", c: "bg-neutral-100 text-neutral-600" },
  cancelado: { t: "Cancelado", c: "bg-neutral-100 text-neutral-600" },
};

function Activo({ e }: { e: Estado }) {
  const a = e.activo!;
  const avance = a.totalUsd ? a.pagadoUsd / a.totalUsd : 0;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Tu adelanto</h1>
        <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold", ESTADO_TXT[a.estado].c)}>{ESTADO_TXT[a.estado].t}</span>
      </div>

      {a.estado === "en_revision" && (
        <Tarjeta><div className="flex gap-3"><Clock className="h-6 w-6 shrink-0 text-amber-500" /><div><p className="font-semibold">Estamos revisando tu solicitud</p><p className="text-sm text-neutral-500">Te avisamos por {e.comercio.telefono} apenas esté lista. Suele tomar menos de un día hábil.</p></div></div></Tarjeta>
      )}
      {a.estado === "aprobado" && (
        <Tarjeta><div className="flex gap-3"><CheckCircle2 className="h-6 w-6 shrink-0 text-brand" /><div><p className="font-semibold">¡Aprobado! El dinero va en camino</p><p className="text-sm text-neutral-500">Recibirás {usd(a.montoUsd)} en bolívares{e.tasaHoy ? ` (≈ ${bs(a.montoUsd * e.tasaHoy)} a la tasa de hoy)` : ""} en tu cuenta {e.comercio.banco} {e.comercio.cuenta}. Se calcula con la tasa BCV del día del depósito.</p></div></div></Tarjeta>
      )}

      {a.desembolsadoEn && (
        <>
          <section className="rounded-3xl bg-ink p-5 text-white">
            <p className="text-sm text-white/60">Te falta pagar</p>
            <p className="font-display text-4xl tabular-nums">{usd(a.saldoUsd)}</p>
            {e.tasaHoy && <p className="text-sm text-white/60">≈ {bs(a.saldoUsd * e.tasaHoy)} a la tasa de hoy</p>}
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-brand-300" style={{ width: `${Math.min(100, avance * 100)}%` }} /></div>
            <div className="mt-2 flex justify-between text-xs text-white/60"><span>Pagado {usd(a.pagadoUsd)}</span><span>Total {usd(a.totalUsd)}</span></div>
          </section>
          <Tarjeta titulo="Condiciones">
            <Dato k="Recibiste" v={`${bs(a.montoBs!)} (${usd(a.montoUsd)})`} />
            <Dato k="Tasa BCV del desembolso" v={`${a.tasaDesembolso!.toLocaleString("es-VE")} Bs/USD`} />
            <Dato k="Fecha" v={fecha(a.desembolsadoEn)} />
            <Dato k="Retención diaria" v={`${(a.retencionPct * 100).toLocaleString("es-VE")}% de tus ventas`} />
            <Dato k="Plazo" v={`${a.plazoDias} días · hasta el ${fecha(a.venceEn!)}`} />
          </Tarjeta>
          <Tarjeta titulo={`Pagos (${a.pagos.length})`}>
            {a.pagos.length === 0 ? <p className="py-2 text-sm text-neutral-500">El primer abono se toma de las ventas de mañana.</p> : (
              <ul className="divide-y divide-black/5">
                {a.pagos.slice(0, 30).map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <div><p className="font-medium">{fecha(p.fecha)}</p><p className="text-xs text-neutral-400">{bs(p.montoBs)} · BCV {p.tasaBcv.toLocaleString("es-VE")}</p></div>
                    <span className="font-semibold tabular-nums text-emerald-700">−{usd(p.montoUsd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </>
      )}
      {!a.desembolsadoEn && (
        <Tarjeta titulo="Lo que pediste">
          <Dato k="Monto" v={usd(a.montoUsd)} />
          <Dato k="Plazo" v={`${a.plazoDias} días`} />
          <Dato k="Total a pagar" v={usd(a.totalUsd)} />
          <Dato k="Retención diaria" v={`${(a.retencionPct * 100).toLocaleString("es-VE")}%`} />
        </Tarjeta>
      )}
    </div>
  );
}

function Historial({ h }: { h: Estado["historial"] }) {
  return (
    <Tarjeta titulo="Adelantos anteriores">
      <ul className="divide-y divide-black/5">
        {h.map((x) => (
          <li key={x.id} className="flex items-center justify-between py-2 text-sm">
            <div><p className="font-medium">{usd(x.montoUsd)}</p><p className="text-xs text-neutral-400">{fecha(String(x.creado))}{x.motivo ? ` · ${x.motivo}` : ""}</p></div>
            <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", ESTADO_TXT[x.estado].c)}>{ESTADO_TXT[x.estado].t}</span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
