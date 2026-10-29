"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, Field, inputCls } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { api } from "@/lib/api";
import { ROL_LABEL, type Rol } from "@/lib/permisos";

type Demo = { email: string; nombre: string; roles: Rol[] }[] | null;

export default function Login() {
  const router = useRouter();
  const { recargar } = useAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<Demo>(null);
  useEffect(() => { api<{ demo: Demo }>("/admin/auth/sesion").then((r) => setDemo(r.demo)).catch(() => {}); }, []);

  const entrar = async (em = email, pw = password) => {
    setErr(""); setBusy(true);
    try { await api("/admin/auth/login", { email: em, password: pw }); await recargar(); router.replace("/admin"); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-sand px-4">
      <div className="w-full max-w-sm space-y-4">
        <img src="/brand/investa-color.svg" alt="Investa" className="mx-auto h-8 w-auto" />
        <Card className="p-6">
          <h1 className="font-display text-xl">Backoffice · Adelantos POS</h1>
          <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); entrar(); }}>
            <Field label="Correo"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
            <Field label="Contraseña"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
            {err && <p className="text-sm text-coral">{err}</p>}
            <Button className="w-full" disabled={busy || !email || !password}>Entrar</Button>
          </form>
        </Card>
        {demo && (
          <Card className="p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-700">Demo · contraseña Investa2026!</p>
            <div className="grid gap-1.5">
              {demo.map((u) => (
                <button key={u.email} onClick={() => entrar(u.email, "Investa2026!")} className="flex justify-between rounded-lg px-3 py-2 text-left text-sm ring-1 ring-black/5 hover:bg-sand">
                  <span className="font-medium">{u.nombre}</span><span className="text-xs text-neutral-500">{u.roles.map((r) => ROL_LABEL[r]).join(", ")}</span>
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
