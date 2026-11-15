"use client";

import { useState } from "react";
import { useDirectDeep } from "./useDirectDeep";
import { PageIntro, RoleLabel, SeverityDot, StateScreen } from "./ui";
import { money, num, pct, safeDiv } from "@/lib/format";
import type { SliceRow } from "@/lib/connectors/direct-deep";

const TABS = [
  { id: "queries", label: "Запросы" },
  { id: "ads", label: "Тексты" },
  { id: "placements", label: "Площадки" },
  { id: "audience", label: "Аудитории" }
] as const;

type Tab = (typeof TABS)[number]["id"];

export function DirectPage() {
  const { data, loading, error, refreshing } = useDirectDeep();
  const [tab, setTab] = useState<Tab>("queries");

  if (!data) {
    return (
      <>
        <PageIntro
          title="Директ вглубь"
          lead="Поисковые запросы, тексты объявлений, площадки сетей и аудиторные срезы из кабинетов подрядчиков."
        />
        <StateScreen loading={loading} error={error} />
      </>
    );
  }

  return (
    <>
      <PageIntro
        title="Директ вглубь"
        lead="То, что не видно в разрезе кампаний: по каким фразам уходят деньги, какие площадки сетей не дают звонков, что написано в объявлениях и кто их видит."
        refreshing={refreshing}
        error={error}
      />

      {data.errors.length > 0 && (
        <div className="mb-6 border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs text-amber-200">
          {data.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {data.insights.length > 0 && (
        <section className="mb-10 grid gap-4 lg:grid-cols-2">
          {data.insights.map((item) => (
            <article key={item.id} className="border border-white/[0.08] p-5">
              <div className="flex items-center gap-2">
                <SeverityDot severity={item.severity} />
                <RoleLabel role={item.role} />
              </div>
              <h3 className="mt-3 font-display text-lg">{item.title}</h3>
              {item.moneyAtStake && item.moneyAtStake > 0 ? (
                <div className="mt-1 text-sm text-[#C4A35A]">На кону {money(item.moneyAtStake)} за период</div>
              ) : null}
              <p className="mt-3 text-sm leading-relaxed text-paper/90">{item.finding}</p>
              <p className="mt-2 text-sm leading-relaxed text-mute">{item.hypothesis}</p>
              <p className="mt-2 text-sm leading-relaxed text-paper/90">{item.action}</p>
              <ul className="mt-3 space-y-1 text-xs text-mute">
                {item.evidence.slice(0, 6).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border px-3 py-1.5 text-xs ${
              tab === t.id ? "border-paper bg-paper text-ink-950" : "border-white/10 text-mute"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "queries" && <Queries data={data} />}
      {tab === "ads" && <Ads data={data} />}
      {tab === "placements" && <Placements data={data} />}
      {tab === "audience" && <Audience data={data} />}
    </>
  );
}

function Queries({ data }: { data: NonNullable<ReturnType<typeof useDirectDeep>["data"]> }) {
  const q = data.queries;
  if (!q.waste.length && !q.best.length) {
    return <Empty text="Отчёт по поисковым запросам пуст: у кампаний в срезе нет показов на поиске за период." />;
  }
  return (
    <div className="space-y-10">
      <section className="grid grid-cols-2 gap-px bg-white/[0.06] md:grid-cols-4">
        <Stat label="Расход на поиске" value={money(q.cost)} extra={`${num(q.clicks)} кликов`} />
        <Stat label="Конверсии" value={num(q.conversions)} extra="цель «уникальный звонок»" />
        <Stat label="Без конверсий" value={money(q.wasteCost)} extra={`${pct(safeDiv(q.wasteCost, q.cost) * 100, 0)} расхода`} />
        <Stat label="Явный мусор" value={money(q.junkCost)} extra={`${num(q.junk.length)} запросов`} />
      </section>

      {q.negatives.length > 0 && (
        <section>
          <h2 className="mb-1 font-display text-xl">Кандидаты в минус-слова</h2>
          <p className="mb-4 max-w-3xl text-sm text-mute">
            Слова, которые встречаются минимум в двух запросах без конверсий и ни разу — в запросах со звонком.
            Список нужно прочитать глазами: модели и комплектации минусовать нельзя.
          </p>
          <div className="flex flex-wrap gap-2">
            {q.negatives.map((w) => (
              <span key={w.word} className="border border-white/[0.08] px-3 py-1.5 text-sm">
                {w.word}
                <span className="ml-2 text-xs text-mute">
                  {money(w.cost)} · {num(w.clicks)} кл.
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <QueryTable title="Съедают бюджет без конверсий" rows={q.waste} />
      {q.junk.length > 0 && <QueryTable title="Запросы не про покупку" rows={q.junk} reason />}
      {q.research.length > 0 && <QueryTable title="Ещё выбирают: кандидаты в ретаргетинг" rows={q.research} reason />}
      {q.best.length > 0 && <QueryTable title="Приносят звонки" rows={q.best} />}
    </div>
  );
}

function QueryTable({
  title,
  rows,
  reason
}: {
  title: string;
  rows: Array<{ query: string; campaign: string; clicks: number; cost: number; conversions: number; reason?: string }>;
  reason?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-4 font-display text-xl">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
            <tr>
              <th className="py-2 font-normal">Запрос</th>
              <th className="py-2 font-normal">Кампания</th>
              <th className="py-2 font-normal">Клики</th>
              <th className="py-2 font-normal">Расход</th>
              <th className="py-2 font-normal">{reason ? "Почему" : "Конверсии"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map((r) => (
              <tr key={`${r.query}-${r.campaign}`} className="border-t border-white/[0.06]">
                <td className="py-2 pr-4">{r.query}</td>
                <td className="max-w-[220px] truncate text-mute">{r.campaign}</td>
                <td>{num(r.clicks)}</td>
                <td>{money(r.cost)}</td>
                <td className="text-mute">{reason ? r.reason : num(r.conversions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Ads({ data }: { data: NonNullable<ReturnType<typeof useDirectDeep>["data"]> }) {
  const a = data.ads;
  if (!a.rows.length) {
    return (
      <Empty text="Текстов объявлений нет: в срезе только Мастер кампаний и автоматические форматы, где текст генерирует Директ. Разбор текстов появится, как только в кабинете будут обычные текстово-графические объявления." />
    );
  }
  return (
    <div className="space-y-10">
      <section className="grid grid-cols-2 gap-px bg-white/[0.06] md:grid-cols-4">
        <Stat label="Объявлений с текстом" value={num(a.rows.length)} extra="в срезе" />
        <Stat label="Без второго заголовка" value={num(a.noTitle2.count)} extra={money(a.noTitle2.cost)} />
        <Stat label="Короткий заголовок" value={num(a.shortTitle.count)} extra="меньше 25 знаков" />
        <Stat label="Без быстрых ссылок или уточнений" value={num(a.noExtensions.count)} extra={money(a.noExtensions.cost)} />
      </section>

      <AdTable title="Работают хуже своих же" rows={a.burning} />
      <AdTable title="Лидеры по CTR — образец для переписывания" rows={a.leaders} />
    </div>
  );
}

function AdTable({
  title,
  rows
}: {
  title: string;
  rows: Array<{
    adId: string;
    title: string;
    title2: string;
    text: string;
    campaign: string;
    ctr: number;
    cost: number;
    sitelinks: number;
    callouts: number;
  }>;
}) {
  if (!rows.length) return null;
  return (
    <section>
      <h2 className="mb-4 font-display text-xl">{title}</h2>
      <div className="space-y-px bg-white/[0.06]">
        {rows.map((r) => (
          <div key={r.adId} className="bg-ink-950 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="font-display text-base">
                {r.title}
                {r.title2 ? <span className="text-mute"> — {r.title2}</span> : null}
              </div>
              <div className="text-xs text-mute">
                CTR {r.ctr.toFixed(2)}% · {money(r.cost)}
              </div>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-paper/80">{r.text}</p>
            <div className="mt-2 text-[11px] text-mute">
              {r.campaign} · {r.title2 ? "второй заголовок есть" : "второго заголовка нет"} ·{" "}
              {r.sitelinks ? "быстрые ссылки есть" : "быстрых ссылок нет"} · уточнений {r.callouts}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Placements({ data }: { data: NonNullable<ReturnType<typeof useDirectDeep>["data"]> }) {
  const p = data.placements;
  if (!p.rows.length) return <Empty text="В срезе нет показов в сетях за период." />;
  return (
    <div className="space-y-10">
      <section className="grid grid-cols-2 gap-px bg-white/[0.06] md:grid-cols-3">
        <Stat label="Расход в сетях" value={money(p.cost)} extra={`${num(p.rows.length)} площадок в топе`} />
        <Stat label="Без конверсий" value={money(p.wasteCost)} extra={`${num(p.waste.length)} площадок`} />
        <Stat
          label="Доля пустого расхода"
          value={pct(safeDiv(p.wasteCost, p.cost) * 100, 0)}
          extra="кандидаты в запрещённые"
        />
      </section>
      <section>
        <h2 className="mb-4 font-display text-xl">Площадки по расходу</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Площадка</th>
                <th className="py-2 font-normal">Показы</th>
                <th className="py-2 font-normal">Клики</th>
                <th className="py-2 font-normal">Расход</th>
                <th className="py-2 font-normal">Конверсии</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.placement} className="border-t border-white/[0.06]">
                  <td className="py-2 pr-4">{r.placement}</td>
                  <td>{num(r.impressions)}</td>
                  <td>{num(r.clicks)}</td>
                  <td className={r.conversions === 0 && r.clicks >= 10 ? "text-rose-300" : ""}>{money(r.cost)}</td>
                  <td>{num(r.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Audience({ data }: { data: NonNullable<ReturnType<typeof useDirectDeep>["data"]> }) {
  const a = data.audience;
  const empty = !a.age.length && !a.gender.length && !a.device.length && !a.geo.length;
  if (empty) return <Empty text="Аудиторные срезы недоступны: кабинет не отдал отчёт по полу, возрасту и устройствам." />;
  return (
    <div className="space-y-10">
      <SliceTable title="Возраст" rows={a.age} />
      <SliceTable title="Пол" rows={a.gender} />
      <SliceTable title="Устройства" rows={a.device} />
      <SliceTable title="География" rows={a.geo.slice(0, 15)} />
    </div>
  );
}

function SliceTable({ title, rows }: { title: string; rows: SliceRow[] }) {
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <section>
      <h2 className="mb-4 font-display text-xl">{title}</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
          <tr>
            <th className="py-2 font-normal">Сегмент</th>
            <th className="py-2 font-normal">Расход</th>
            <th className="py-2 font-normal">Доля</th>
            <th className="py-2 font-normal">Клики</th>
            <th className="py-2 font-normal">Конверсии</th>
            <th className="py-2 font-normal">Цена конверсии</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/[0.06]">
              <td className="py-2">{r.label}</td>
              <td>{money(r.cost)}</td>
              <td className="text-mute">{pct(safeDiv(r.cost, total) * 100, 0)}</td>
              <td>{num(r.clicks)}</td>
              <td className={r.conversions === 0 && r.clicks >= 30 ? "text-rose-300" : ""}>{num(r.conversions)}</td>
              <td>{r.conversions ? money(safeDiv(r.cost, r.conversions)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra: string }) {
  return (
    <div className="bg-ink-950 p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-mute">{label}</div>
      <div className="mt-3 font-display text-2xl">{value}</div>
      <div className="mt-2 text-xs text-mute">{extra}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="border border-white/[0.08] px-4 py-6 text-sm text-mute">{text}</div>;
}
