export const usd = (n: number) =>
  "USD " + n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const bs = (n: number) =>
  "Bs. " + n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number, d = 1) => (n * 100).toLocaleString("es-VE", { maximumFractionDigits: d }) + "%";

const asLocal = (v: string | Date) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T12:00:00") : new Date(v));
export const fecha = (iso: string | Date) =>
  asLocal(iso).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" });

export const fechaLarga = (d: Date) => {
  const s = d.toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const isoDay = (d: Date) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
