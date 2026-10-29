"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, inputCls, PageTitle, Pill, Td, Th } from "@/components/ui";
import { useEstado } from "@/lib/admin-store";
import { fecha, usd } from "@/lib/format";

export default function Comercios() {
  const { e } = useEstado();
  const [q, setQ] = useState("");
  const lista = e.comercios.filter((c) => !q || `${c.nombre} ${c.razonSocial} ${c.rif} ${c.ciudad}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageTitle title="Comercios" sub="Se registran solos desde el POS con su RIF; la ficha viene de Disglobal"
        action={<input className={inputCls + " sm:w-72"} value={q} onChange={(x) => setQ(x.target.value)} placeholder="Buscar por nombre, RIF o ciudad" />} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-black/5"><tr><Th>Comercio</Th><Th>RIF</Th><Th>Ciudad</Th><Th right>Score</Th><Th right>Oferta máx.</Th><Th>Evaluado</Th><Th>Estado</Th></tr></thead>
          <tbody className="divide-y divide-black/5">
            {lista.map((c) => (
              <tr key={c.id} className="hover:bg-sand/50">
                <Td><Link href={`/admin/comercios/${c.id}`} className="font-medium hover:underline">{c.nombre}</Link><p className="text-xs text-neutral-400">{c.razonSocial}</p></Td>
                <Td>{c.rif}</Td>
                <Td>{c.ciudad}</Td>
                <Td right>{c.score ?? "—"}</Td>
                <Td right>{c.montoMaxUsd == null ? "—" : c.montoMaxUsd ? usd(c.montoMaxUsd) : <span className="text-neutral-400">Sin oferta</span>}</Td>
                <Td>{c.evaluadoEn ? fecha(String(c.evaluadoEn)) : "—"}</Td>
                <Td>
                  <div className="flex gap-1">
                    {c.estado === "bloqueado" ? <Pill tone="red">Bloqueado</Pill> : c.estatusDisglobal !== "activo" ? <Pill tone="amber">Disglobal: {c.estatusDisglobal}</Pill> : <Pill tone="green">Activo</Pill>}
                    {c.correcciones && <Pill tone="amber">Correcciones</Pill>}
                  </div>
                </Td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">Sin comercios.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
