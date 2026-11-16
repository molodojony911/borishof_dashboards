"use client";

import { useDashboard } from "./useDashboard";
import { Delta, PageIntro, StateScreen } from "./ui";
import { FunnelChart } from "./Charts";
import { num, pct, seconds } from "@/lib/format";
import type { ProjectVisit } from "@/lib/types";

export function BehaviorPage() {
  const { data, loading, error, refreshing } = useDashboard();
  if (!data) {
    return (
      <>
        <PageIntro title="Поведение и путь" lead="Метрика: отказы, устройства, посадочные, пользовательские пути." />
        <StateScreen loading={loading} error={error} />
      </>
    );
  }

  const b = data.behavior;
  const loss = b.directClicks ? 100 - (b.metrikaDirectVisits / b.directClicks) * 100 : 0;

  return (
    <>
      <PageIntro
        title="Поведение и путь"
        lead="Метрика: визиты, отказы, цели «уникальный звонок». Воронка показывает конверсию между шагами, качественные лиды — Calltouch."
        data={data}
        refreshing={refreshing}
        error={error}
      />

      <section className="grid grid-cols-2 gap-px bg-white/[0.06] md:grid-cols-3 lg:grid-cols-6">
        <Box label="Визиты" value={num(b.visits)} extra={<Delta current={b.visits} previous={b.previousVisits} />} />
        <Box label="Лиды Метрики" value={num(b.goalLeads)} extra={<Delta current={b.goalLeads} previous={b.previousGoalLeads} />} />
        <Box
          label="CR визит → лид"
          value={pct(b.visits ? (b.goalLeads / b.visits) * 100 : 0, 2)}
          extra={<Delta current={b.visits ? (b.goalLeads / b.visits) * 100 : 0} previous={b.previousVisits ? (b.previousGoalLeads / b.previousVisits) * 100 : 0} />}
        />
        <Box label="Отказы" value={pct(b.bounceRate)} extra={<Delta current={b.bounceRate} previous={b.previousBounceRate} invert />} />
        <Box label="Длительность" value={seconds(b.avgDurationSec)} extra={<Delta current={b.avgDurationSec} previous={b.previousDurationSec} />} />
        <Box label="Глубина" value={b.pageDepth.toFixed(1)} extra={<Delta current={b.pageDepth} previous={b.previousPageDepth} />} />
      </section>

      <p className="mt-4 text-sm text-mute">
        Клики Директа {num(b.directClicks)} · визиты с Директа в Метрике {num(b.metrikaDirectVisits)}
        {loss > 10 ? <span className="text-rose-300"> · разрыв {pct(loss, 0)}</span> : null}
      </p>

      <SitesInReport projects={data.projects || []} totalVisits={b.visits} health={data.health.find((row) => row.source === "metrika")?.message || ""} />

      {data.hypotheses?.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 font-display text-xl">Гипотезы по сайту</h2>
          <p className="mb-4 max-w-3xl text-sm text-mute">
            Каждая карточка — проверяемое изменение, а не совет «улучшить конверсию». ICE и PIE: произведение трёх оценок 1–10, делённое на 100.
            Записи Вебвизора API статистики не отдаёт; если в выгрузке есть скролл или мёртвые клики, они указаны в наблюдении.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.hypotheses.map((item) => (
              <article key={item.id} className="border border-white/[0.08] p-5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-mute">
                  <span className={item.priority === "high" ? "text-rose-300" : "text-amber-200"}>{item.priority}</span>
                  <span>ICE {item.ice.score.toFixed(1)}</span>
                  <span>PIE {item.pie.score.toFixed(1)}</span>
                </div>
                <h3 className="mt-2 font-display text-lg">{item.title}</h3>
                <p className="mt-2 text-sm text-mute">{item.observation}</p>
                <p className="mt-2 text-sm">{item.hypothesis}</p>
                <p className="mt-2 text-sm text-paper/80">{item.expectedImpact}</p>
                <div className="mt-3 text-xs leading-relaxed text-mute">
                  <div>A: {item.test.variantA}</div>
                  <div>B: {item.test.variantB}</div>
                  <div>Кто: {item.test.audience}. Срок: {item.test.duration}.</div>
                  <div>Метрика: {item.test.primaryMetric}. Сторож: {item.test.guardrail}.</div>
                </div>
                <p className="mt-2 text-[11px] text-mute">{item.ruleId} · {item.ruleSource}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 grid gap-10 xl:grid-cols-2">
        <div>
          <h2 className="mb-4 font-display text-xl">Воронка</h2>
          <FunnelChart data={b.funnel} />
        </div>
        <div>
          <h2 className="mb-4 font-display text-xl">Устройства</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Тип</th>
                <th className="py-2 font-normal">Визиты</th>
                <th className="py-2 font-normal">Отказы</th>
                <th className="py-2 font-normal">Лиды</th>
                <th className="py-2 font-normal">CR в лид</th>
              </tr>
            </thead>
            <tbody>
              {b.devices.map((d) => (
                <tr key={d.device} className="border-t border-white/[0.06]">
                  <td className="py-2 capitalize">{d.device}</td>
                  <td>{num(d.visits)}</td>
                  <td>{pct(d.bounceRate)}</td>
                  <td>{num(d.calls)}</td>
                  <td className={d.device === "mobile" && d.cr < 1.2 ? "text-rose-300" : ""}>{pct(d.cr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {b.byCampaign?.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 font-display text-xl">Что происходит на сайте после клика</h2>
          <p className="mb-4 max-w-3xl text-sm text-mute">
            Разрез по utm_campaign: сюда попадает не только Директ. Если у кампании много визитов и мало целей —
            вопрос к посадочной, а не к закупке трафика.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th className="py-2 font-normal">Кампания</th>
                  <th className="py-2 font-normal">Визиты</th>
                  <th className="py-2 font-normal">Отказы</th>
                  <th className="py-2 font-normal">Время на сайте</th>
                  <th className="py-2 font-normal">Цели Метрики</th>
                  <th className="py-2 font-normal">CR в цель</th>
                </tr>
              </thead>
              <tbody>
                {b.byCampaign.slice(0, 15).map((c) => (
                  <tr key={c.campaign} className="border-t border-white/[0.06]">
                    <td className="max-w-[280px] truncate py-2">{c.campaign}</td>
                    <td>{num(c.visits)}</td>
                    <td className={c.bounceRate > b.bounceRate + 12 ? "text-rose-300" : ""}>{pct(c.bounceRate)}</td>
                    <td className="text-mute">{Math.round(c.durationSec)} с</td>
                    <td>{num(c.goalLeads)}</td>
                    <td>{pct((c.goalLeads / Math.max(c.visits, 1)) * 100, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {b.sources.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-xl">Источники</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Источник</th>
                <th className="py-2 font-normal">Визиты</th>
                <th className="py-2 font-normal">Отказы</th>
                <th className="py-2 font-normal">Лиды</th>
                <th className="py-2 font-normal">CR</th>
              </tr>
            </thead>
            <tbody>
              {b.sources.slice(0, 12).map((s) => (
                <tr key={s.source} className="border-t border-white/[0.06]">
                  <td className="py-2">{s.source}</td>
                  <td>{num(s.visits)}</td>
                  <td>{pct(s.bounceRate)}</td>
                  <td>{num(s.calls)}</td>
                  <td>{pct(s.visits ? (s.calls / s.visits) * 100 : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-4 font-display text-xl">Посадочные</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Сайт</th>
                <th className="py-2 font-normal">Страница</th>
                <th className="py-2 font-normal">Визиты</th>
                <th className="py-2 font-normal">Отказы</th>
                <th className="py-2 font-normal">Время</th>
                <th className="py-2 font-normal">Глубина</th>
                <th className="py-2 font-normal">Лиды</th>
                <th className="py-2 font-normal">CR</th>
              </tr>
            </thead>
            <tbody>
              {b.pages.map((p) => (
                <tr key={`${p.site || ""}-${p.path}`} className="border-t border-white/[0.06]">
                  <td className="py-2 text-mute">{p.site || "—"}</td>
                  <td className="py-2">
                    <div>{p.title}</div>
                    <div className="text-[11px] text-mute">{p.path}</div>
                  </td>
                  <td>{num(p.visits)}</td>
                  <td className={p.bounceRate > 45 ? "text-rose-300" : ""}>{pct(p.bounceRate)}</td>
                  <td>{seconds(p.avgDurationSec)}</td>
                  <td>{p.pageDepth.toFixed(1)}</td>
                  <td>{p.calls}</td>
                  <td>{pct(p.cr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {b.paths.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-xl">Пользовательские пути</h2>
          <div className="space-y-3">
            {b.paths.map((p) => (
              <div key={p.steps.join()} className="flex flex-wrap items-baseline justify-between gap-3 border-t border-white/[0.06] pt-3 text-sm">
                <div>{p.steps.join(" → ")}</div>
                <div className="text-mute">
                  {num(p.sessions)} сессий · {p.calls} звонков · CR {pct(p.cr)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function siteHost(site: string): string {
  const raw = site.trim();
  if (!raw) return "сайт не указан";
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).host.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

function siteStatus(row: ProjectVisit): string {
  if (row.visits <= 0) return "не попал в отчёт";
  if (row.sharedCounter) return "общий счётчик";
  return "в отчёте";
}

function SitesInReport({ projects, totalVisits, health }: { projects: ProjectVisit[]; totalVisits: number; health: string }) {
  const rows = [...projects].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name, "ru"));
  const loaded = rows.filter((row) => row.visits > 0);
  const missed = rows.filter((row) => row.visits <= 0);
  return (
    <section className="mt-10">
      <h2 className="mb-1 font-display text-xl">Сайты в этой выгрузке</h2>
      <p className="mb-4 max-w-3xl text-sm text-mute">
        В срез запрашивались сайты: {num(rows.length)}. С визитами: {num(loaded.length)}. Карточка «Визиты» ({num(totalVisits)}) считает счётчики один раз. Строка «не попал в отчёт» в посадочные и источники не входит.
        {missed.length ? ` Без визитов: ${missed.map((row) => siteHost(row.site) || row.name).join(", ")}.` : ""}
      </p>
      {health ? <p className="mb-4 text-xs text-amber-200">{health.split(";")[0]}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-mute">Счётчики Метрики для этого фильтра не запрашивались.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Сайт</th>
                <th className="py-2 font-normal">Проект</th>
                <th className="py-2 font-normal">Счётчик</th>
                <th className="py-2 font-normal">Визиты</th>
                <th className="py-2 font-normal">Было</th>
                <th className="py-2 font-normal">Лиды</th>
                <th className="py-2 font-normal">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.projectId} className="border-t border-white/[0.06]">
                  <td className="py-2">{siteHost(row.site)}</td>
                  <td>{row.name || row.brand}</td>
                  <td className="font-mono text-xs text-mute">{row.counterIds.join(", ") || "—"}</td>
                  <td>{num(row.visits)}</td>
                  <td className="text-mute">{num(row.previousVisits)}</td>
                  <td>{num(row.goalLeads)}</td>
                  <td className={row.visits <= 0 ? "text-rose-300" : "text-mute"}>{siteStatus(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Box({ label, value, extra }: { label: string; value: string; extra: React.ReactNode }) {
  return (
    <div className="bg-ink-950 p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-mute">{label}</div>
      <div className="mt-3 font-display text-2xl">{value}</div>
      <div className="mt-2 text-xs">{extra}</div>
    </div>
  );
}
