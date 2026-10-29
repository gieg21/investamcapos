/** RIF venezolano: formato y dígito verificador oficial (módulo 11), igual que en el portal de factoring. */

const LETRA_VALOR: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5 };
const PESOS = [4, 3, 2, 7, 6, 5, 4, 3, 2];

export function dvRif(letra: string, numero8: string): number | null {
  const lv = LETRA_VALOR[letra.toUpperCase()];
  if (!lv || !/^\d{8}$/.test(numero8)) return null;
  const dig = [lv, ...numero8.split("").map(Number)];
  const suma = dig.reduce((a, d, i) => a + d * PESOS[i], 0);
  const r = 11 - (suma % 11);
  return r >= 10 ? 0 : r;
}

export type RifParts = { letra: string; numero: string; dv: number; canon: string };

/** Acepta "J-50848176-3", "J508481763", "j 50848176 3", etc. */
export function parseRif(s: string | undefined | null): RifParts | null {
  if (!s) return null;
  const c = s.toUpperCase().replace(/[^VEJPG0-9]/g, "");
  const m = c.match(/^([VEJPG])(\d{8})(\d)$/);
  if (!m) return null;
  return { letra: m[1], numero: m[2], dv: Number(m[3]), canon: `${m[1]}-${m[2]}-${m[3]}` };
}

export function rifValido(s: string) {
  const p = parseRif(s);
  return !!p && dvRif(p.letra, p.numero) === p.dv;
}

/** RIF canónico con su dígito verificador correcto (para la semilla de demostración). */
export function rifCon(letra: string, numero8: string) {
  return `${letra}-${numero8}-${dvRif(letra, numero8)}`;
}
