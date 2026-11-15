"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ACCOUNTS, LINE_LABEL } from "@/lib/catalog";
import { PageIntro } from "./ui";
import { buildQuery } from "@/lib/href";
import { money, num } from "@/lib/format";
import { eachDate } from "@/lib/period";
import { factsFromDashboard, joinPlanFact, type PlanRow } from "@/lib/plan-model";
import { useDashboard } from "./useDashboard";

export function BrandsPage() {
  const search = useSearchParams();
  const { data } = useDashboard();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const contractor = search.get("contractor") || "";
  const line = search.get("line") || "";
  const brand = search.get("brand") || "";
  useEffect(() => {
    fetch("/api/plans")
      .then((res) => res.json())
      .then((json: { rows?: PlanRow[] }) => setPlans(json.rows || []))
      .catch(() => undefined);
  }, []);
  const visible = ACCOUNTS.filter(
    (row) =>
      (!contractor || row.contractor === contractor) &&
      (!line || row.line === line) &&
      (!brand || row.brand === brand)
  );
  const month = data?.range.to.slice(0, 7) || "";
  const periodDays = data ? eachDate(data.range.from, data.range.to).length : 0;
  const factRows =
    data && month
      ? joinPlanFact(plans, factsFromDashboard(data.campaigns, data.projects || []), month, periodDays)
      : [];
  const planOf = (row: (typeof ACCOUNTS)[number]) =>
    factRows.find((item) => item.contractor === row.contractor && item.brand === row.brand && (item.line === "" || item.line === row.line));
  const visitsOf = (id: string) => data?.projects?.find((project) => project.projectId === id);

  const grouped = visible.reduce<Record<string, typeof ACCOUNTS>>((acc, row) => {
    acc[row.contractor] = acc[row.contractor] || [];
    acc[row.contractor].push(row);
    return acc;
  }, {});

  return (
    <>
      <PageIntro
        title="Бренды и кабинеты"
        lead="Справочник кабинетов и визиты Метрики по проекту. План месяца подрядчика сравнивается с фактом выбранного периода, пропорционально числу дней."
      />
      {visible.length === 0 ? <p className="text-sm text-mute">В справочнике нет кабинетов под этот фильтр.</p> : null}
      {Object.entries(grouped).map(([contractorName, rows]) => (
        <section key={contractorName} className="mb-12">
          <h2 className="mb-4 font-display text-xl">{contractorName}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th className="py-2 font-normal">Бренд</th>
                  <th className="py-2 font-normal">Направление</th>
                  <th className="py-2 font-normal">Login Директа</th>
                  <th className="py-2 font-normal">Счётчик Метрики</th>
                  <th className="py-2 font-normal">Визиты</th>
                  <th className="py-2 font-normal">План РЛ / прогноз</th>
                  <th className="py-2 font-normal">План CPL / факт</th>
                  <th className="py-2 font-normal">Сайт</th>
                  <th className="py-2 font-normal">Бюджет/мес</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-white/[0.06] align-top">
                    <td className="py-2">
                      <Link href={`/${buildQuery(search, { contractor: row.contractor, brand: row.brand, line: row.line })}`} className="hover:text-gold-400">
                        {row.brand}
                      </Link>
                      <div className="text-[11px] text-mute">{row.legalEntity}</div>
                    </td>
                    <td className="text-mute">{LINE_LABEL[row.line]}</td>
                    <td className="font-mono text-xs">{row.clientLogin}</td>
                    <td className="font-mono text-xs">{row.counterIds.join(", ")}</td>
                    <td>
                      {visitsOf(row.id) ? num(visitsOf(row.id)?.visits || 0) : "—"}
                      {visitsOf(row.id)?.sharedCounter ? <div className="text-[11px] text-mute">общий счётчик</div> : null}
                    </td>
                    <td>
                      {planOf(row)?.leads != null ? (
                        <span>
                          {num(planOf(row)?.leads || 0)} / {num(Math.round(planOf(row)?.forecastLeads || 0))}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {planOf(row)?.cpl != null ? (
                        <span>
                          {money(planOf(row)?.cpl || 0)} / {planOf(row)?.factCpl != null ? money(planOf(row)?.factCpl || 0) : "—"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[220px] truncate text-mute">
                      <a href={row.site} target="_blank" rel="noreferrer" className="hover:text-gold-400">
                        {row.site.replace(/^https?:\/\//, "")}
                      </a>
                    </td>
                    <td>{row.monthlyBudget ? money(row.monthlyBudget) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
