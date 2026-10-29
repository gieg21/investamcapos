import Link from "next/link";

export default function Inicio() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <img src="/brand/investa-color.svg" alt="Investa" className="h-8 w-auto self-start" />
      <div>
        <h1 className="font-display text-3xl">Adelanto de capital para POS Disglobal</h1>
        <p className="mt-2 text-sm text-neutral-500">La app del punto de venta y el backoffice comparten este servidor.</p>
      </div>
      <div className="grid gap-3">
        <Link href="/pos" className="rounded-2xl bg-brand px-5 py-4 font-semibold text-white">App del POS →</Link>
        <Link href="/admin" className="rounded-2xl bg-white px-5 py-4 font-semibold ring-1 ring-black/10">Backoffice →</Link>
      </div>
    </main>
  );
}
