import "server-only";

/**
 * Hex: tableros y análisis de la cartera. Hex se conecta directo a la base (solo lectura) y usa las vistas
 * `hex_*` (migración drizzle/*_hex_vistas.sql). El resumen diario dispara una corrida del proyecto para
 * refrescar el tablero.
 *
 * TODO(Hex): confirmar con la documentación de la API de Hex la ruta para correr un proyecto
 * (por defecto POST {HEX_API_URL}/v1/project/{HEX_PROJECT_ID}/run con token Bearer) y crear en Hex
 * un usuario de base de datos de solo lectura limitado a las vistas hex_*.
 */

const URL_HEX = process.env.HEX_API_URL || "https://app.hex.tech/api";
export const hexConfigurado = () => !!(process.env.HEX_API_TOKEN && process.env.HEX_PROJECT_ID);

export async function correrProyectoHex(): Promise<string> {
  if (!hexConfigurado()) return "Hex no configurado";
  const r = await fetch(`${URL_HEX}/v1/project/${encodeURIComponent(process.env.HEX_PROJECT_ID!)}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HEX_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ updatePublishedResults: true }),
    cache: "no-store",
  });
  if (!r.ok) return `Hex respondió ${r.status}`;
  const d = (await r.json().catch(() => ({}))) as { runId?: string; runUrl?: string };
  return d.runUrl ?? (d.runId ? `Corrida ${d.runId}` : "Corrida iniciada");
}
