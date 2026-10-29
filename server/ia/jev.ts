import "server-only";

/**
 * Jev (TypeSafe AI): modelo de decisión "System One", no generativo. Recibe un estado JSON y preguntas tipadas
 * (noul = probabilidad de sí, choice = una opción con probabilidades, score = nivel en una escala) y responde
 * solo valores, en milisegundos. Lo usamos para la decisión rápida y calibrada; Claude explica y redacta.
 *
 * TODO(TypeSafe): Jev está en acceso anticipado. Confirmar contra https://docs.typesafe.ai el endpoint, el alias
 * del modelo y la cabecera de autenticación. Lo de abajo sigue la forma publicada: POST /v1/systemone,
 * Authorization: Bearer, cuerpo { model, state, questions }, respuesta { answers, model, usage }.
 */

const URL_JEV = process.env.TYPESAFE_API_URL || "https://api.typesafe.ai/v1/systemone";
const MODELO = process.env.TYPESAFE_MODEL || "jev-latest";
export const jevConfigurado = () => !!process.env.TYPESAFE_API_KEY;

export type Pregunta =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Respuesta =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

/** Devuelve las respuestas por id de pregunta, o null si Jev no está configurado. Reintenta 429/529. */
export async function preguntarJev(state: unknown, questions: Record<string, Pregunta>): Promise<Record<string, Respuesta> | null> {
  if (!jevConfigurado()) return null;
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(URL_JEV, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELO, state, questions }),
      cache: "no-store",
    });
    if (r.ok) return ((await r.json()) as { answers: Record<string, Respuesta> }).answers;
    if (r.status !== 429 && r.status !== 529) throw new Error(`Jev respondió ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, 500 * 2 ** intento));
  }
  throw new Error("Jev no respondió (limitado o sobrecargado).");
}
