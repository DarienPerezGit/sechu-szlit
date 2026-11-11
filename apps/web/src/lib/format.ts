/** "2026-11-20" → "20/11/2026" (sin desfase de zona horaria). */
export function fmtDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-11-20" → "Viernes 20 de noviembre de 2026". */
export function fmtDateLong(ymd: string): string {
  const text = parseYmd(ymd).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return capitalize(text);
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "10:00:00" → "10:00". */
export const fmtHora = (hora: string | null | undefined) => (hora ? hora.slice(0, 5) : "");

/** Alias corto a partir del email: "maria.lopez@x" → "maria.lopez". */
export const alias = (email: string | null | undefined) => (email ? email.split("@")[0] : "—");

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Fecha local → "YYYY-MM-DD" (no usa toISOString para no correrse de día en UTC-3). */
export function toYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Color estable para un abogado según su email (los usuarios no tienen color propio). */
const PALETTE = ["#185FA5", "#3B6D11", "#854F0B", "#A32D2D", "#3C3489", "#0E7490", "#9D174D"];
export function colorFor(key: string | null | undefined): string {
  if (!key) return "#6b6b66";
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** Clase visual para el estado del caso según su código de catálogo. */
export function estadoCasoTone(codigo: string | undefined): string {
  switch (codigo) {
    case "conciliado":
      return "success";
    case "desestimado":
      return "danger";
    case "archivado":
      return "muted";
    default:
      return "info";
  }
}

/** Traduce acciones técnicas de bitácora a texto legible. */
export function describirAccion(accion: string, metadata: Record<string, unknown> | null): string {
  if (accion === "acta_vinculada") {
    const nuevo = typeof metadata?.estado_nuevo === "string" ? metadata.estado_nuevo : null;
    return nuevo ? `Acta vinculada · estado → ${nuevo.replace("_", " ")}` : "Acta vinculada";
  }
  return accion;
}
