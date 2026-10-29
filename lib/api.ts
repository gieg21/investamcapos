/** Llamadas del navegador a la API. Lanza `ApiFallo` con el mensaje del servidor para mostrarlo tal cual. */
export class ApiFallo extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = unknown>(ruta: string, body?: unknown): Promise<T> {
  const r = await fetch("/api" + ruta, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFallo(r.status, (data as { error?: string }).error ?? "No se pudo completar. Intenta de nuevo.");
  return data as T;
}
