"use client";

import { useState } from "react";
import { useDashboard } from "./useDashboard";
import { PageIntro, RoleLabel, SeverityDot, StateScreen } from "./ui";
import { num } from "@/lib/format";

export function AlertsPage() {
  const { data, loading, error, refreshing, query } = useDashboard();
  const [status, setStatus] = useState<string | null>(null);

  async function send() {
    setStatus("Отправка…");
    const res = await fetch(`/api/alerts/dispatch?${query}`, { method: "POST" });
    const json = await res.json();
    setStatus(json.sent ? `Отправлено ${json.count} алертов в Telegram` : json.error || "Не отправлено");
  }

  if (!data) {
    return (
      <>
        <PageIntro title="Алерты" lead="Пороги по CTR, CPC, CPL, доле качества, отказам и разрыву трекинга." />
        <StateScreen loading={loading} error={error} />
      </>
    );
  }

  return (
    <>
      <PageIntro
        title="Алерты"
        lead="Пороги, объём и робастный z-score. Мелкий шум не показывается. Пороги задаются в разделе «Подключение», Telegram — переменными TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID."
        data={data}
        refreshing={refreshing}
        error={error}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={send} className="bg-paper px-4 py-2 text-sm text-ink-950">
          Отправить в Telegram
        </button>
        {status ? <span className="text-sm text-mute">{status}</span> : <span className="text-sm text-mute">Нужны bot token и chat id</span>}
      </div>
      <div className="space-y-4">
        {data.alerts.map((a) => (
          <article key={a.id} className="border-t border-white/[0.08] pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityDot severity={a.severity} />
              <RoleLabel role={a.role} />
              <span className="text-[11px] uppercase tracking-[0.14em] text-mute">{a.metric}</span>
            </div>
            <h3 className="mt-2 text-[15px]">{a.entity}</h3>
            <p className="mt-1 text-sm text-mute">{a.message}</p>
            {a.explanation ? <p className="mt-2 text-sm text-paper/80">{a.explanation}</p> : null}
            <p className="mt-2 text-sm">{a.recommendation}</p>
            <p className="mt-2 text-xs text-mute">
              {a.baseline ? `${a.baseline}. ` : ""}
              Сейчас {num(a.current, 1)} · было {num(a.previous, 1)} · порог {a.thresholdPct}
              {a.metric === "quality_share" || a.metric === "bounce" ? " п.п." : a.metric === "goals" ? "" : "%"}
            </p>
            {a.ruleSource ? <p className="mt-1 text-[11px] text-mute">{a.ruleId} · {a.ruleSource}</p> : null}
          </article>
        ))}
        {data.alerts.length === 0 ? <p className="text-sm text-mute">За период отклонений выше порога нет.</p> : null}
      </div>
    </>
  );
}
