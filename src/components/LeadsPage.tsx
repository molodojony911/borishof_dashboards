"use client";

import { useDashboard } from "./useDashboard";
import { Delta, PageIntro, StateScreen } from "./ui";
import { money, num, pct } from "@/lib/format";

export function LeadsPage() {
  const { data, loading, error, refreshing } = useDashboard();
  if (!data) {
    return (
      <>
        <PageIntro title="Качественные лиды" lead="Calltouch: звонки, теги качества, источники." />
        <StateScreen loading={loading} error={error} />
      </>
    );
  }

  const share = (data.leads.quality / Math.max(data.leads.total, 1)) * 100;
  const prevShare = (data.leads.previousQuality / Math.max(data.leads.previousTotal, 1)) * 100;

  return (
    <>
      <PageIntro
        title="Качественные лиды"
        lead="Целевой лид — точный тег Calltouch: NC «Новый» / «Новый А/м», AFS «Новый звонок» / «Сервис». Остальное не идёт в CPL."
        data={data}
        refreshing={refreshing}
        error={error}
      />

      <section className="grid grid-cols-2 gap-px bg-white/[0.06] md:grid-cols-4">
        <Stat label="Все звонки" value={num(data.leads.total)} extra={<Delta current={data.leads.total} previous={data.leads.previousTotal} />} />
        <Stat label="Уникальные" value={num(data.leads.unique)} extra="по правилам Calltouch" />
        <Stat label="Качественные" value={num(data.leads.quality)} extra={<Delta current={data.leads.quality} previous={data.leads.previousQuality} />} />
        <Stat
          label="Доля качества"
          value={pct(share)}
          extra={<Delta current={share} previous={prevShare} />}
        />
      </section>

      {data.leads.forms > 0 && (
        <section className="mt-4 border border-white/[0.08] px-4 py-3 text-sm">
          Заявки с форм сайта: <span className="font-display text-lg">{num(data.leads.forms)}</span>{" "}
          <span className="text-mute">
            (было {num(data.leads.previousForms)}). Считаются отдельно от звонков и не входят в CPL по тегам качества.
          </span>
        </section>
      )}

      {data.leads.shortQuality > 0 && (
        <p className="mt-4 text-sm text-mute">
          Из них {num(data.leads.shortQuality)} с разговором короче 20 секунд — тег стоит, но лидом это обычно не является.
          Стоит перепроверить простановку тегов у этих звонков.
        </p>
      )}

      <section className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 font-display text-xl">Теги</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Тег</th>
                <th className="py-2 font-normal">Сейчас</th>
                <th className="py-2 font-normal">Было</th>
                <th className="py-2 font-normal">Тип</th>
              </tr>
            </thead>
            <tbody>
              {data.leads.byTag.map((t) => (
                <tr key={t.tag} className="border-t border-white/[0.06]">
                  <td className="py-2">{t.tag}</td>
                  <td>{t.count}</td>
                  <td className="text-mute">{t.previous}</td>
                  <td className="text-mute">{t.quality ? "качество" : "служебный"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="mb-4 font-display text-xl">Источники (UTM campaign)</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Кампания</th>
                <th className="py-2 font-normal">Звонки</th>
                <th className="py-2 font-normal">Целевые</th>
                <th className="py-2 font-normal">CPL</th>
              </tr>
            </thead>
            <tbody>
              {data.leads.bySource.slice(0, 12).map((s) => (
                <tr key={s.source} className="border-t border-white/[0.06]">
                  <td className="max-w-[220px] truncate py-2">
                    <div>{s.source}</div>
                    <div className="text-[11px] text-mute">
                      {s.paid ? "Директ" : "вне Директа"} · целевых {pct((s.quality / Math.max(s.total, 1)) * 100, 0)}
                    </div>
                  </td>
                  <td>{s.total}</td>
                  <td>{s.quality}</td>
                  <td>{s.paid && s.quality ? money(s.cpl) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra: React.ReactNode }) {
  return (
    <div className="bg-ink-950 p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-mute">{label}</div>
      <div className="mt-3 font-display text-2xl">{value}</div>
      <div className="mt-2 text-xs text-mute">{extra}</div>
    </div>
  );
}
