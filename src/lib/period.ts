import type { DateRange, PeriodKey } from "./types";

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function rangeFor(key: PeriodKey, now = new Date()): DateRange {
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 14;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const from = addDays(to, -(days - 1));
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return {
    key,
    from: isoDate(from),
    to: isoDate(to),
    previousFrom: isoDate(previousFrom),
    previousTo: isoDate(previousTo)
  };
}

export function parsePeriod(value?: string | null): PeriodKey {
  if (value === "7d" || value === "30d" || value === "14d") return value;
  return "14d";
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function ruDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
