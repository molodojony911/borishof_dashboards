"use client";

import { useDashboard } from "./useDashboard";
import { Delta, PageIntro, StateScreen } from "./ui";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/types";
import { BENCHMARKS } from "@/lib/benchmarks";
import { LINE_LABEL } from "@/lib/catalog";
import { money, num, pct } from "@/lib/format";

export function CampaignsPage() {
  const { data, loading, error, refreshing } = useDashboard();
  if (!data) {
    return (
      <>
        <PageIntro title="Рекламные кампании" lead="Директ подрядчиков: CTR, CPC, CPL и отклонения к прошлому периоду." />
        <StateScreen loading={loading} error={error} />
      </>
    );
  }

  return (
    <>
      <PageIntro
        title="Рекламные кампании"
        lead="Уник. звонки — цель Директа. Целевые — качественные звонки Calltouch, приклеенные к кампании по utm_campaign; по ним и считается CPL целевой."
        data={data}
        refreshing={refreshing}
        error={error}
      />
      {data.campaigns.length === 0 ? (
        <p className="text-sm text-mute">В этом срезе кампаний нет. Смените бренд, линию или период.</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
            <tr>
              <th className="py-2 font-normal">Кампания</th>
              <th className="py-2 font-normal">Направление</th>
              <th className="py-2 font-normal">Тип</th>
              <th className="py-2 font-normal">Расход</th>
              <th className="py-2 font-normal">CTR</th>
              <th className="py-2 font-normal">CPC</th>
              <th className="py-2 font-normal">Уник. звонки</th>
              <th className="py-2 font-normal">Целевые</th>
              <th className="py-2 font-normal">CPL целевой</th>
              <th className="py-2 font-normal">К коридору</th>
            </tr>
          </thead>
          <tbody>
            {data.campaigns.map((c) => {
              const bench = BENCHMARKS[c.type];
              const ctrBad = c.ctrDelta <= -20;
              const cpcBad = c.cpcDelta >= 25;
              const cplBad = c.cplQualityDelta >= 30 || (c.current.cost > 40000 && c.qualityLeads <= 3);
              return (
                <tr key={c.id} className="border-t border-white/[0.06] align-top">
                  <td className="py-3 pr-3">
                    <div>{c.name}</div>
                    <div className="text-[11px] text-mute">
                      {c.contractor} · {c.brand} · {c.login}
                    </div>
                  </td>
                  <td className="text-mute">{LINE_LABEL[c.line]}</td>
                  <td className="text-mute">{CAMPAIGN_TYPE_LABEL[c.type]}</td>
                  <td>
                    {money(c.current.cost)}
                    <div className="text-[11px]">
                      <Delta current={c.current.cost} previous={c.previous.cost} />
                    </div>
                  </td>
                  <td className={ctrBad ? "text-rose-300" : ""}>
                    {pct(c.ctr)}
                    <div className="text-[11px]">
                      <Delta current={c.ctr} previous={c.prevCtr} />
                    </div>
                  </td>
                  <td className={cpcBad ? "text-rose-300" : ""}>
                    {money(c.cpc)}
                    <div className="text-[11px]">
                      <Delta current={c.cpc} previous={c.prevCpc} invert />
                    </div>
                  </td>
                  <td>
                    {num(c.totalLeads)}
                    <div className="text-[11px] text-mute">было {num(c.previousTotalLeads)}</div>
                  </td>
                  <td>
                    {num(c.qualityLeads)}
                    <div className="text-[11px] text-mute">
                      {c.calls ? `из ${num(c.calls)} звонков` : "нет звонков с меткой"}
                    </div>
                  </td>
                  <td className={cplBad ? "text-rose-300" : ""}>
                    {c.qualityLeads ? money(c.cplQuality) : "—"}
                    <div className="text-[11px]">
                      {c.qualityLeads ? (
                        <Delta current={c.cplQuality} previous={c.prevCplQuality} invert />
                      ) : (
                        "нет целевых"
                      )}
                    </div>
                  </td>
                  <td className="text-[11px] text-mute">
                    CTR {bench.ctr}% · CPC {money(bench.cpc)}
                    <div>CPL {money(bench.cpl)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
