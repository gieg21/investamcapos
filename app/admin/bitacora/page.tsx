"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, inputCls, PageTitle } from "@/components/ui";
import { useEstado } from "@/lib/admin-store";

export default function Bitacora() {
  const { e } = useEstado();
  const [q, setQ] = useState("");
  const filas = e.bitacora.filter((b) => !q || `${b.actor} ${b.accion} ${b.detalle}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageTitle title="Bitácora" sub="Cada decisión del sistema, del comercio en el POS y del backoffice (últimos 300 eventos)"
        action={<input className={inputCls + " sm:w-72"} value={q} onChange={(x) => setQ(x.target.value)} placeholder="Filtrar" />} />
      <Card>
        <ul className="divide-y divide-black/5">
          {filas.map((b) => (
            <li key={b.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[10rem_12rem_1fr]">
              <span className="text-xs text-neutral-500">{new Date(b.fecha).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}</span>
              <span className="font-medium">{b.accion}<span className="block text-xs font-normal text-neutral-500">{b.actor}</span></span>
              <span className="text-neutral-700">{b.detalle}{b.comercioId && <> · <Link href={`/admin/comercios/${b.comercioId}`} className="text-brand hover:underline">ver comercio</Link></>}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
