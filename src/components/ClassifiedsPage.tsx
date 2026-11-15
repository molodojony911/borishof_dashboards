"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageIntro } from "./ui";
import { money, num, pct } from "@/lib/format";
import { canonicalBrand, exeedEsteoKind } from "@/lib/brand-alias";
import { fulfillment } from "@/lib/plan-model";
import type { ClassifiedProject, PlatformForecast, WalletTopup, ClassifiedRow } from "@/lib/plan-model";

interface Payload {
  month?: string;
  updatedAt?: string;
  source?: string;
  projects?: ClassifiedProject[];
  platformForecast?: PlatformForecast[];
  wallets?: WalletTopup[];
  rows?: ClassifiedRow[];
}

interface SyncStatus {
  lastSuccessAt?: string;
  lastError?: string;
  intervalHours?: number;
}

function share(fact: number | null, plan: number | null): string {
  if (fact == null || plan == null) return "—";
  const value = fulfillment(fact, plan);
  return value == null ? "—" : pct(value, 0);
}

function rub(value: number | null): string {
  return value == null ? "—" : money(value);
}

function pieces(value: number | null): string {
  return value == null ? "—" : num(value);
}

export function ClassifiedsPage() {
  const search = useSearchParams();
  const brandQuery = (search.get("brand") || "").trim();
  const brand = brandQuery.toLowerCase();
  const family = exeedEsteoKind(brandQuery) !== "other";
  const matchesProject = (project: string) => {
    if (!brandQuery) return true;
    if (family) return exeedEsteoKind(project) !== "other" || canonicalBrand(project) === canonicalBrand(brandQuery);
    return project.toLowerCase().includes(brand);
  };
  const [data, setData] = useState<Payload | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const [sheetRes, syncRes] = await Promise.all([fetch("/api/classifieds"), fetch("/api/sheets/status")]);
    setData(await sheetRes.json());
    setSync(await syncRes.json());
  }

  useEffect(() => {
    load().catch(() => setMessage("Не удалось загрузить классифайды"));
  }, []);

  async function refresh() {
    setMessage("Тянем таблицу…");
    const res = await fetch("/api/sheets/sync", { method: "POST" });
    const json = (await res.json()) as SyncStatus;
    setSync(json);
    setMessage(json.lastError || "Готово");
    await load();
  }

  const projects = (data?.projects || []).filter((row) => {
    if (row.kind === "total") return !brand;
    if (!brandQuery) return true;
    return matchesProject(row.project);
  });
  const flat = (data?.rows || []).filter(
    (row) => !brandQuery || matchesProject(row.brand) || (!family && row.platform.toLowerCase().includes(brand))
  );

  return (
    <>
      <PageIntro
        title="Классифайды"
        lead="План и факт подрядчика из Google Таблицы текущего месяца: расход и лиды. Цифры Директа сюда не подмешиваются."
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-xs text-mute">
        <button type="button" onClick={refresh} className="border border-white/15 px-3 py-2 text-paper">
          Обновить сейчас
        </button>
        <span>
          Месяц {data?.month || "—"} · синхронизация каждые {sync?.intervalHours ?? 3} ч
          {sync?.lastSuccessAt ? ` · последний раз ${new Date(sync.lastSuccessAt).toLocaleString("ru-RU")}` : ""}
        </span>
        {sync?.lastError ? <span className="text-rose-200">{sync.lastError}</span> : null}
        {message ? <span className="text-paper">{message}</span> : null}
      </div>

      {projects.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Проект</th>
                <th className="py-2 font-normal">План расход</th>
                <th className="py-2 font-normal">Факт расход</th>
                <th className="py-2 font-normal">%</th>
                <th className="py-2 font-normal">План лиды</th>
                <th className="py-2 font-normal">Факт лиды</th>
                <th className="py-2 font-normal">%</th>
                <th className="py-2 font-normal">Прогноз расход</th>
                <th className="py-2 font-normal">Run-rate</th>
                <th className="py-2 font-normal">CPL план</th>
                <th className="py-2 font-normal">CPL факт</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((row) => (
                <tr key={`${row.kind}-${row.project}-${row.externalId}`} className="border-t border-white/[0.06]">
                  <td className="py-2">
                    <div className={row.kind === "total" ? "font-medium" : ""}>{row.project}</div>
                    {row.externalId ? <div className="text-[11px] text-mute">{row.externalId}</div> : null}
                  </td>
                  <td>{rub(row.planSpend)}</td>
                  <td>{rub(row.factSpend)}</td>
                  <td className="text-mute">{share(row.factSpend, row.planSpend)}</td>
                  <td>{pieces(row.planLeads)}</td>
                  <td>{pieces(row.factLeads)}</td>
                  <td className="text-mute">{share(row.factLeads, row.planLeads)}</td>
                  <td>{rub(row.forecastSpend)}</td>
                  <td>{row.runRate == null ? "—" : pct(row.runRate, 0)}</td>
                  <td>{rub(row.cplPlan)}</td>
                  <td>{rub(row.cplFact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {flat.length > 0 ? (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
              <tr>
                <th className="py-2 font-normal">Месяц</th>
                <th className="py-2 font-normal">Подрядчик</th>
                <th className="py-2 font-normal">Бренд</th>
                <th className="py-2 font-normal">Площадка</th>
                <th className="py-2 font-normal">Метрика</th>
                <th className="py-2 font-normal">План</th>
                <th className="py-2 font-normal">Факт</th>
                <th className="py-2 font-normal">%</th>
              </tr>
            </thead>
            <tbody>
              {flat.map((row) => (
                <tr key={`${row.month}-${row.brand}-${row.platform}-${row.metric}`} className="border-t border-white/[0.06]">
                  <td className="py-2">{row.month}</td>
                  <td>{row.contractor || "—"}</td>
                  <td>{row.brand || "—"}</td>
                  <td>{row.platform}</td>
                  <td>{row.metric}</td>
                  <td>{pieces(row.plan)}</td>
                  <td>{pieces(row.fact)}</td>
                  <td className="text-mute">{share(row.fact, row.plan)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!projects.length && !flat.length ? (
        <p className="text-sm text-mute">
          Пока пусто. Нажмите «Обновить сейчас» или загрузите файл в разделе «Подключение». Если таблица закрыта, откройте доступ по ссылке
          или укажите сервисный аккаунт.
        </p>
      ) : null}

      {(data?.platformForecast || []).length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-xl">Прогноз расхода по площадкам</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th className="py-2 font-normal">Проект</th>
                  <th className="py-2 font-normal">Площадка</th>
                  <th className="py-2 font-normal">Прогноз</th>
                </tr>
              </thead>
              <tbody>
                {(data?.platformForecast || [])
                  .filter((row) => matchesProject(row.project))
                  .map((row) => (
                    <tr key={`${row.project}-${row.platform}`} className="border-t border-white/[0.06]">
                      <td className="py-2">{row.project}</td>
                      <td>{row.platform}</td>
                      <td>{rub(row.forecastSpend)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {(data?.wallets || []).length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-xl">Кошельки и пополнение</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th className="py-2 font-normal">Проект</th>
                  <th className="py-2 font-normal">Авто.ру с НДС</th>
                  <th className="py-2 font-normal">Авито с НДС</th>
                  <th className="py-2 font-normal">Аванс с НДС</th>
                  <th className="py-2 font-normal">Авто.ру без НДС</th>
                  <th className="py-2 font-normal">Авито без НДС</th>
                  <th className="py-2 font-normal">Пополнение Авто.ру</th>
                  <th className="py-2 font-normal">Пополнение Авито</th>
                </tr>
              </thead>
              <tbody>
                {(data?.wallets || [])
                  .filter((row) => matchesProject(row.project))
                  .map((row) => (
                    <tr key={row.project} className="border-t border-white/[0.06]">
                      <td className="py-2">{row.project}</td>
                      <td>{rub(row.withVatAuto)}</td>
                      <td>{rub(row.withVatAvito)}</td>
                      <td>{rub(row.withVatAdvance)}</td>
                      <td>{rub(row.noVatAuto)}</td>
                      <td>{rub(row.noVatAvito)}</td>
                      <td>{rub(row.refillAuto)}</td>
                      <td>{rub(row.refillAvito)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
