"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui";

/** Modal simple con una acción confirmable. `onOk` puede lanzar: el mensaje se muestra en el diálogo. */
export function Dialogo({ titulo, children, okTxt = "Confirmar", okVariant = "primary", okDisabled, onOk, onClose }: {
  titulo: string; children: ReactNode; okTxt?: string; okVariant?: "primary" | "danger" | "dark"; okDisabled?: boolean; onOk: () => Promise<unknown>; onClose: () => void;
}) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = async () => {
    setErr(""); setBusy(true);
    try { await onOk(); onClose(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-lg">{titulo}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-sand" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 text-sm">{children}</div>
        {err && <p className="mt-3 rounded-lg bg-coral-100 px-3 py-2 text-sm text-coral">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant={okVariant} onClick={ok} disabled={busy || okDisabled}>{okTxt}</Button>
        </div>
      </div>
    </div>
  );
}
