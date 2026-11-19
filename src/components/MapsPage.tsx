"use client";

import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageIntro } from "./ui";
import { num } from "@/lib/format";
import type { MapsCampaignRow, MapsCardRow, MapsQueryRow, MapsReport } from "@/lib/maps-report";

const PROMO: Record<MapsCardRow["promotion"], string> = {
  active: "Есть активная",
  finished: "Только завершённые",
  none: "Нет кампании"
};

const CAMPAIGN_TYPE: Record<string, string> = {
  UNIFIED: "Рекламная",
  BRANDING: "Брендирование"
};

function hostOf(site: string): string {
  try {
    return new URL(site).hostname.replace(/^www\./, "");
  } catch {
    return site.replace(/^https?:\/\//, "");
  }
}

export function MapsPage() {
  const search = useSearchParams();
  const brand = (search.get("brand") || "").trim().toLowerCase();
  const [data, setData] = useState<MapsReport | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    fetch("/api/maps")
      .then((res) => res.json())
      .then((json: MapsReport) => setData(json))
      .catch(() => setError("Не удалось загрузить срез Яндекс Бизнеса"));
  }, []);

  const cards = (data?.cards || []).filter((card) => !brand || `${card.name} ${card.site}`.toLowerCase().includes(brand));
  const queries = brand
    ? cards
        .flatMap((card) => card.queries.map((row) => ({ ...row, cards: 1 })))
        .reduce<MapsQueryRow[]>((acc, row) => {
          const found = acc.find((item) => item.query === row.query);
          if (found) {
            found.visits += row.visits;
            found.actions += row.actions;
            found.cards += 1;
          } else acc.push({ ...row });
          return acc;
        }, [])
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 25)
    : data?.queries || [];
  const campaigns = brand ? [] : data?.campaigns || [];
  const searchVisits = cards.reduce((sum, card) => sum + card.searchVisits, 0);
  const activeCards = cards.filter((card) => card.promotion === "active").length;

  return (
    <div>
      <PageIntro
        title="Яндекс Бизнес"
        lead="Карточки со статусом «Работает»: продвижение и запросы из «Как вас находят». Это срез кабинета, не ответ Метрики."
      />
      {error ? <p className="mb-4 text-sm text-rose-200">{error}</p> : null}
      {data ? <p className="mb-6 text-sm text-mute">{data.note}</p> : <p className="text-sm text-mute">Собираем срез…</p>}
      {data?.collectedAt ? (
        <p className="mb-6 text-xs uppercase tracking-[0.14em] text-mute">
          Срез {new Date(data.collectedAt).toLocaleString("ru-RU")}
        </p>
      ) : null}

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Работает" value={num(cards.length)} hint="филиалы и отдельные карточки" />
        <Stat label="С активным продвижением" value={num(activeCards)} hint="есть кампания в статусе «активна»" />
        <Stat label="Поисковые визиты" value={num(searchVisits)} hint="Карты и Навигатор, последние обработанные" />
      </div>

      {campaigns.length ? (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-xl">Активные кампании</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th className="py-2 font-normal">Кампания</th>
                  <th className="py-2 font-normal">Тип</th>
                  <th className="py-2 font-normal">Осталось дней</th>
                  <th className="py-2 font-normal">Карточек</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row) => (
                  <CampaignRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 font-display text-xl">Карточки</h2>
        {cards.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th className="py-2 font-normal">Карточка</th>
                  <th className="py-2 font-normal">Продвижение</th>
                  <th className="py-2 font-normal">Поиск</th>
                  <th className="py-2 font-normal">По ссылке</th>
                  <th className="py-2 font-normal">С действием</th>
                  <th className="py-2 font-normal">Запросы до</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <Fragment key={card.id}>
                    <tr
                      className="cursor-pointer border-t border-white/[0.06] hover:bg-white/[0.03]"
                      onClick={() => setOpenId(openId === card.id ? "" : card.id)}
                    >
                      <td className="py-2">
                        <div>{card.name}</div>
                        <div className="text-[11px] text-mute">
                          {card.address}
                          {card.site ? ` · ${hostOf(card.site)}` : ""}
                          {card.online ? " · онлайн" : ""}
                        </div>
                      </td>
                      <td>{PROMO[card.promotion]}</td>
                      <td>{num(card.searchVisits)}</td>
                      <td>{num(card.linkVisits)}</td>
                      <td>{num(card.actionVisits)}</td>
                      <td className="text-mute">{card.lastProcessed || "—"}</td>
                    </tr>
                    {openId === card.id ? (
                      <tr key={`${card.id}-queries`} className="border-t border-white/[0.06] bg-white/[0.03]">
                        <td colSpan={6} className="px-3 py-3 text-sm text-mute">
                          {card.queries.length ? (
                            <ul className="space-y-1">
                              {card.queries.map((row) => (
                                <li key={row.query}>
                                  {row.query} · {num(row.visits)}
                                  {row.actions ? ` · действий ${num(row.actions)}` : ""}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span>Поисковых запросов в последнем срезе нет.</span>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-mute">В этом фильтре карточек нет.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl">Как вас находят</h2>
        <p className="mb-3 max-w-2xl text-sm text-mute">
          Частые запросы из последних обработанных визитов. Запрос без действия в профиле нашли, но маршрута или звонка по нему не было.
        </p>
        {queries.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th className="py-2 font-normal">Запрос</th>
                  <th className="py-2 font-normal">Визиты</th>
                  <th className="py-2 font-normal">Карточек</th>
                  <th className="py-2 font-normal">С действием</th>
                </tr>
              </thead>
              <tbody>
                {queries.map((row) => (
                  <tr key={row.query} className="border-t border-white/[0.06]">
                    <td className="py-2">{row.query}</td>
                    <td>{num(row.visits)}</td>
                    <td>{num(row.cards)}</td>
                    <td>{num(row.actions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-mute">Запросов в срезе нет.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border border-white/[0.08] p-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-mute">{label}</div>
      <div className="mt-2 font-display text-3xl">{value}</div>
      <div className="mt-1 text-xs text-mute">{hint}</div>
    </div>
  );
}

function CampaignRow({ row }: { row: MapsCampaignRow }) {
  return (
    <tr className="border-t border-white/[0.06]">
      <td className="py-2">№ {row.id}</td>
      <td>{CAMPAIGN_TYPE[row.type] || row.type || "—"}</td>
      <td>{row.remainingDays == null ? "—" : num(row.remainingDays)}</td>
      <td>{num(row.cards)}</td>
    </tr>
  );
}
