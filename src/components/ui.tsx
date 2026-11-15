import { money, num, pct, seconds, deltaPct } from "@/lib/format";
import { ruDate } from "@/lib/period";
import type { DashboardPayload, KpiValue, Severity } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";

export function formatKpi(item: KpiValue): string {
  if (item.format === "rub") return money(item.value);
  if (item.format === "percent") return pct(item.value);
  if (item.format === "seconds") return seconds(item.value);
  return num(item.value);
}

export function Delta({
  current,
  previous,
  invert,
  unit
}: {
  current: number;
  previous: number;
  invert?: boolean;
  unit?: "pp" | "pct" | "num";
}) {
  const d = deltaPct(current, previous);
  if (!Number.isFinite(d) || Math.abs(d) < 0.4) {
    return <span className="text-mute">без изменений</span>;
  }
  const good = invert ? d < 0 : d > 0;
  const label = unit === "pp" ? `${d > 0 ? "+" : ""}${d.toFixed(1)} п.п.` : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
  return <span className={good ? "text-emerald-400/90" : "text-rose-400/90"}>{label}</span>;
}

export function ModeBadge({ mode }: { mode: DashboardPayload["mode"] }) {
  const map = {
    demo: "Демо-данные",
    live: "Живые API",
    mixed: "Частично live"
  };
  return (
    <span className="border border-white/[0.1] px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-mute">
      {map[mode]}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  const color =
    severity === "critical" ? "bg-rose-400" : severity === "warning" ? "bg-amber-400" : "bg-sky-400";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

export function PageIntro({
  title,
  lead,
  data,
  refreshing,
  error
}: {
  title: string;
  lead: string;
  data?: DashboardPayload | null;
  refreshing?: boolean;
  error?: string | null;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">{lead}</p>
        {refreshing ? <p className="mt-2 text-xs text-mute">Обновляем срез… предыдущие цифры на экране, пока не придут новые.</p> : null}
        {error && data ? (
          <p className="mt-2 text-xs text-rose-200">{error}. Показан предыдущий успешный срез.</p>
        ) : null}
      </div>
      {data ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
          <ModeBadge mode={data.mode} />
          <span>
            {ruDate(data.range.from)} — {ruDate(data.range.to)}
          </span>
          <span>vs {ruDate(data.range.previousFrom)} — {ruDate(data.range.previousTo)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function StateScreen({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="py-20 text-sm text-mute">
        Собираем срез за выбранный период. Без токенов цифры пустые: в шапке будет, какого ключа не хватает. С токенами первый запрос может занять несколько минут.
      </div>
    );
  }
  if (error) {
    return <div className="border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">{error}</div>;
  }
  return null;
}

export function RoleLabel({ role }: { role: keyof typeof ROLE_LABEL }) {
  return <span className="text-[11px] uppercase tracking-[0.16em] text-gold-500">{ROLE_LABEL[role]}</span>;
}

export { ROLE_LABEL };
