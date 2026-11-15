"use client";

import { useDashboard } from "./useDashboard";
import { Delta, PageIntro, StateScreen, formatKpi, RoleLabel, SeverityDot } from "./ui";
import { FunnelChart, TrendChart } from "./Charts";
import { money, num, pct } from "@/lib/format";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LINE_LABEL } from "@/lib/catalog";
import { buildQuery } from "@/lib/href";

const HEALTH_LABEL = { ok: "online", partial: "часть кабинетов не отвечает", down: "нет подключения" } as const;

const HEALTH_STYLE = {
  ok: "border-emerald-400/30 text-emerald-300",
  partial: "border-amber-400/30 text-amber-300",
  down: "border-white/10 text-mute"
} as const;

export function OverviewPage() {
  const { data, loading, error, refreshing } = useDashboard();
  const search = useSearchParams();
  const q = buildQuery(search, {});

  if (!data) {
    return (
      <>
        <PageIntro title="Обзор digital" lead="Сводка по Директу подрядчиков, качественным лидам Calltouch и поведению на сайтах." />
        <StateScreen loading={loading} error={error} />
      </>
    );
  }

  const critical = data.alerts.filter((a) => a.severity === "critical");
  const topInsights = data.insights.filter((i) => i.severity === "critical").slice(0, 3);

  return (
    <>
      <PageIntro
        title="Обзор digital"
        lead="Контроль холдинга по подрядчикам Tandem и RTA, направлениям NC (продажи) и AFS (сервис) и брендам из рабочих таблиц."
        data={data}
        refreshing={refreshing}
        error={error}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {data.health.map((h) => {
          const state = h.state ?? (h.ok ? "ok" : "down");
          return (
            <span
              key={h.source}
              className={`border px-2 py-1 text-[11px] ${HEALTH_STYLE[state]}`}
              title={h.message}
            >
              {h.name}: {HEALTH_LABEL[state]}
            </span>
          );
        })}
      </div>

      {data.health.some((h) => !h.ok) && (
        <div className="mb-6 border border-white/10 p-3 text-[11px] leading-relaxed text-mute">
          {data.health
            .filter((h) => !h.ok)
            .map((h) => (
              <p key={h.source}>
                <span className="text-paper">{h.name}.</span> {h.message}
              </p>
            ))}
        </div>
      )}

      <section className="grid grid-cols-2 gap-px bg-white/[0.06] lg:grid-cols-4">
        {data.kpis.map((k) => (
          <div key={k.key} className="bg-ink-950 p-5">
            <div className="text-[11px] uppercase tracking-[0.14em] text-mute">{k.label}</div>
            <div className="mt-3 font-display text-[28px] leading-none">{formatKpi(k)}</div>
            <div className="mt-2 text-xs">
              <Delta current={k.value} previous={k.previous} invert={k.invert} />
            </div>
            <div className="mt-3 text-[11px] text-mute">{k.hint}</div>
          </div>
        ))}
      </section>

      {data.hypotheses?.length > 0 && (
        <section className="mt-8 border border-white/[0.08] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-mute">Гипотезы по сайтам</div>
            <Link href={`/behavior${q}`} className="text-xs text-gold-400">
              Как проверять
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.hypotheses.slice(0, 2).map((item) => (
              <div key={item.id} className="text-sm leading-relaxed">
                <div className="text-paper">{item.title}</div>
                <div className="mt-1 text-mute">
                  ICE {item.ice.score.toFixed(1)} · смотреть {item.test.primaryMetric}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {critical.length > 0 && (
        <section className="mt-8 border border-rose-400/25 bg-rose-400/[0.04] p-5">
          <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-rose-300">Критичные отклонения</div>
          <div className="grid gap-3 md:grid-cols-2">
            {critical.slice(0, 4).map((a) => (
              <div key={a.id} className="text-sm leading-relaxed">
                <div className="text-paper">{a.entity}</div>
                <div className="mt-1 text-mute">{a.message}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 grid gap-10 xl:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="mb-4 font-display text-xl">Динамика расхода и визитов</h2>
          <TrendChart data={data.series} />
        </div>
        <div>
          <h2 className="mb-4 font-display text-xl">Воронка</h2>
          <FunnelChart data={data.behavior.funnel} />
        </div>
      </section>

      <section className="mt-12 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 font-display text-xl">Подрядчики</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Кабинет</th>
                <th className="py-2 font-normal">Расход</th>
                <th className="py-2 font-normal">Уник. звонки</th>
                <th className="py-2 font-normal">CPL</th>
              </tr>
            </thead>
            <tbody>
              {data.contractors.map((c) => (
                <tr key={c.name} className="border-t border-white/[0.06]">
                  <td className="py-3">
                    <Link href={`/${buildQuery(search, { contractor: c.name })}`} className="hover:text-gold-400">
                      {c.name}
                    </Link>
                  </td>
                  <td>{money(c.spend)}</td>
                  <td>{num(c.totalLeads)}</td>
                  <td>
                    {money(c.cpl)}{" "}
                    <span className="text-xs">
                      <Delta current={c.cpl} previous={c.prevCpl} invert />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="mb-4 font-display text-xl">Направления</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Линия</th>
                <th className="py-2 font-normal">Расход</th>
                <th className="py-2 font-normal">Уник. звонки</th>
                <th className="py-2 font-normal">CPL</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.line} className="border-t border-white/[0.06]">
                  <td className="py-3">
                    <Link href={`/${buildQuery(search, { line: l.line })}`} className="hover:text-gold-400">
                      {LINE_LABEL[l.line]}
                    </Link>
                  </td>
                  <td>{money(l.spend)}</td>
                  <td>{num(l.totalLeads)}</td>
                  <td>
                    {money(l.cpl)}{" "}
                    <span className="text-xs">
                      <Delta current={l.cpl} previous={l.prevCpl} invert />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl">Бренды</h2>
          <Link href={`/brands${q}`} className="text-xs text-gold-400">
            Справочник кабинетов
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Бренд</th>
                <th className="py-2 font-normal">Подрядчик</th>
                <th className="py-2 font-normal">NC</th>
                <th className="py-2 font-normal">AFS</th>
                <th className="py-2 font-normal">Итого</th>
                <th className="py-2 font-normal">Уник. звонки</th>
                <th className="py-2 font-normal">Визиты</th>
                <th className="py-2 font-normal">CPL</th>
              </tr>
            </thead>
            <tbody>
              {data.brands.map((b) => (
                <tr key={b.name} className="border-t border-white/[0.06]">
                  <td className="py-2">
                    <Link href={`/${buildQuery(search, { brand: b.name })}`} className="hover:text-gold-400">
                      {b.name}
                    </Link>
                  </td>
                  <td className="text-mute">{b.contractor}</td>
                  <td>{b.ncSpend ? money(b.ncSpend) : "—"}</td>
                  <td>{b.afsSpend ? money(b.afsSpend) : "—"}</td>
                  <td>{money(b.spend)}</td>
                  <td>{num(b.totalLeads)}</td>
                  <td>{num(b.visits || 0)}</td>
                  <td>
                    {money(b.cpl)}{" "}
                    <span className="text-xs">
                      <Delta current={b.cpl} previous={b.prevCpl} invert />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12 grid gap-10 lg:grid-cols-2">
        <div>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="font-display text-xl">Что делать сейчас</h2>
            <Link href={`/insights${q}`} className="text-xs text-gold-400">
              Все инсайты
            </Link>
          </div>
          <div className="space-y-4">
            {topInsights.map((item) => (
              <article key={item.id} className="border-t border-white/[0.06] pt-4">
                <div className="flex items-center gap-2">
                  <SeverityDot severity={item.severity} />
                  <RoleLabel role={item.role} />
                </div>
                <h3 className="mt-2 text-[15px]">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-mute">{item.action}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-4 font-display text-xl">Качество лидов по тегам</h2>
        <div className="flex flex-wrap gap-2">
          {data.leads.byTag.slice(0, 10).map((t) => (
            <span key={t.tag} className="border border-white/[0.08] px-3 py-2 text-sm">
              {t.tag} <span className="text-mute">{t.count}</span>
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-mute">
          Доля целевых {pct((data.leads.quality / Math.max(data.leads.total, 1)) * 100)} · теги:{" "}
          {data.qualityTags.join(", ")}
        </p>
      </section>
    </>
  );
}
