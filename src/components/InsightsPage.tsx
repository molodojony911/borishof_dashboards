"use client";

import { useMemo, useState } from "react";
import { useDashboard } from "./useDashboard";
import { PageIntro, RoleLabel, SeverityDot, StateScreen } from "./ui";
import { ROLE_LABEL, type ExpertRole } from "@/lib/types";
import { money } from "@/lib/format";

const ROLES: Array<ExpertRole | "all"> = ["all", "analyst", "contextologist", "developer", "marketer"];

export function InsightsPage() {
  const { data, loading, error, refreshing } = useDashboard();
  const [role, setRole] = useState<ExpertRole | "all">("all");

  const items = useMemo(() => {
    if (!data) return [];
    return role === "all" ? data.insights : data.insights.filter((i) => i.role === role);
  }, [data, role]);

  if (!data) {
    return (
      <>
        <PageIntro title="Экспертные инсайты" lead="Рекомендации аналитика, контекстолога, разработчика и маркетолога." />
        <StateScreen loading={loading} error={error} />
      </>
    );
  }

  return (
    <>
      <PageIntro
        title="Экспертные инсайты"
        lead="Каждая карточка появляется только когда в данных есть отклонение, значимое по объёму. Сортировка — по деньгам на кону, ориентиры CPL берутся по своим же кампаниям."
        data={data}
        refreshing={refreshing}
        error={error}
      />
      <div className="mb-8 flex flex-wrap gap-2">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`border px-3 py-1.5 text-xs ${
              role === r ? "border-paper bg-paper text-ink-950" : "border-white/10 text-mute"
            }`}
          >
            {r === "all" ? "Все роли" : ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="border border-white/[0.08] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SeverityDot severity={item.severity} />
                <RoleLabel role={item.role} />
              </div>
              <span className="text-[11px] uppercase tracking-[0.14em] text-mute">{item.severity}</span>
            </div>
            <h3 className="mt-3 font-display text-xl">{item.title}</h3>
            {item.moneyAtStake && item.moneyAtStake > 0 ? (
              <div className="mt-2 text-sm text-[#C4A35A]">На кону {money(item.moneyAtStake)} за период</div>
            ) : null}
            <Block title="Наблюдение" text={item.finding} />
            <Block title="Гипотеза" text={item.hypothesis} />
            <Block title="Действие" text={item.action} />
            <Block title="Ожидаемый эффект" text={item.impact} />
            <ul className="mt-3 space-y-1 text-xs text-mute">
              {item.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {item.ruleSource ? <p className="mt-3 text-[11px] leading-relaxed text-mute">{item.ruleId} · {item.ruleSource}</p> : null}
          </article>
        ))}
      </div>
    </>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-mute">{title}</div>
      <p className="mt-1 text-sm leading-relaxed text-paper/90">{text}</p>
    </div>
  );
}
