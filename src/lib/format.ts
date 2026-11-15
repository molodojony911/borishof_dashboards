export function money(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(value);
}

export function num(value: number, digits = 0): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

export function pct(value: number, digits = 1): string {
  return `${num(value, digits)}%`;
}

export function deltaPct(current: number, previous: number): number {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function ratio(a: number, b: number): number {
  if (!b) return 0;
  return a / b;
}

export function seconds(value: number): string {
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function safeDiv(a: number, b: number): number {
  if (!b) return 0;
  return a / b;
}

export function clsxJoin(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
