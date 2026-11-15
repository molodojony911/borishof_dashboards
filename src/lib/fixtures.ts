import { eachDate } from "./period";
import { ACCOUNTS, LINE_LABEL, matchAccount, type DashboardFilter } from "./catalog";
import { AFS_QUALITY_TAGS, NC_QUALITY_TAGS } from "./calltouch-catalog";
import type { AdRow, AudiencePack, PlacementRow, QueryRow } from "./connectors/direct-deep";
import type {
  BehaviorSnapshot,
  CampaignRow,
  CampaignType,
  DailyPoint,
  DateRange,
  HealthStatus,
  LeadRow,
  Line
} from "./types";

/**
 * Демо-срез той же формы, что живые CampaignRow / LeadRow / BehaviorSnapshot.
 * Цифры зашиты под 14 дней и масштабируются длиной периода, чтобы фильтр 7/14/30
 * менял объёмы, но не «лечил» заранее заложенные аномалии (доли и CTR).
 * Аномалии нарочные и немногочисленные: остальной холдинг спокойный, иначе алерты шумят.
 */

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

function vol(base: number, days: number): number {
  return Math.max(0, Math.round((base * days) / 14));
}

function directId(id: string): string {
  return String(100000000 + (hash(id) % 800000000));
}

interface BuiltCampaign {
  row: CampaignRow;
  /** Целевые и все звонки, уже в штуках периода, из них собираются лиды. */
  quality: number;
  prevQuality: number;
  calls: number;
  prevCalls: number;
}

function campaign(input: {
  id: string;
  brand: string;
  line: Line;
  contractor: string;
  login: string;
  type: CampaignType;
  title: string;
  days: number;
  impressions: number;
  clicks: number;
  cost: number;
  prevImpressions: number;
  prevClicks: number;
  prevCost: number;
  totalLeads: number;
  prevTotalLeads: number;
  quality: number;
  prevQuality: number;
  calls: number;
  prevCalls: number;
}): BuiltCampaign {
  const days = input.days;
  return {
    quality: vol(input.quality, days),
    prevQuality: vol(input.prevQuality, days),
    calls: vol(input.calls, days),
    prevCalls: vol(input.prevCalls, days),
    row: {
      id: input.id,
      directId: directId(input.id),
      name: input.title,
      contractor: input.contractor,
      brand: input.brand,
      line: input.line,
      type: input.type,
      login: input.login,
      current: {
        impressions: vol(input.impressions, days),
        clicks: vol(input.clicks, days),
        cost: vol(input.cost, days),
        conversions: vol(input.totalLeads, days)
      },
      previous: {
        impressions: vol(input.prevImpressions, days),
        clicks: vol(input.prevClicks, days),
        cost: vol(input.prevCost, days),
        conversions: vol(input.prevTotalLeads, days)
      },
      totalLeads: vol(input.totalLeads, days),
      previousTotalLeads: vol(input.prevTotalLeads, days),
      qualityLeads: vol(input.quality, days),
      previousQualityLeads: vol(input.prevQuality, days),
      calls: vol(input.calls, days),
      previousCalls: vol(input.prevCalls, days),
      formLeads: vol(Math.round(input.quality * 0.15), days),
      previousFormLeads: vol(Math.round(input.prevQuality * 0.15), days)
    }
  };
}

function healthy(acc: (typeof ACCOUNTS)[number], days: number): BuiltCampaign {
  const monthly = acc.monthlyBudget || (acc.line === "nc" ? 400000 : 120000);
  const cost = Math.round(monthly * (14 / 30) * 0.92);
  const cpc = acc.line === "nc" ? 95 : 62;
  const ctr = acc.line === "nc" ? 0.062 : 0.048;
  const clicks = Math.max(120, Math.round(cost / cpc));
  const impressions = Math.round(clicks / ctr);
  const cpl = acc.line === "nc" ? 4300 : 2700;
  const quality = Math.max(6, Math.round(cost / cpl));
  return campaign({
    id: `${acc.id}-search`,
    brand: acc.brand,
    line: acc.line,
    contractor: acc.contractor,
    login: acc.clientLogin,
    type: acc.line === "afs" ? "search_brand" : "search_model",
    title: `${acc.brand} | ${LINE_LABEL[acc.line]} | ${acc.line === "afs" ? "Поиск · бренд" : "Поиск"}`,
    days,
    impressions,
    clicks,
    cost,
    prevImpressions: Math.round(impressions * 0.97),
    prevClicks: Math.round(clicks * 0.98),
    prevCost: Math.round(cost * 0.96),
    totalLeads: Math.round(quality * 1.35),
    prevTotalLeads: Math.round(quality * 1.32),
    quality,
    prevQuality: Math.round(quality * 0.97),
    calls: Math.round(quality * 1.65),
    prevCalls: Math.round(quality * 1.6)
  });
}

function anomalies(days: number): BuiltCampaign[] {
  const tenet = ACCOUNTS.find((a) => a.id === "tandem-nc-tenet");
  const tank = ACCOUNTS.find((a) => a.id === "tandem-nc-tank");
  const chery = ACCOUNTS.find((a) => a.id === "tandem-nc-chery");
  const genesis = ACCOUNTS.find((a) => a.id === "tandem-nc-genesis");
  const haval = ACCOUNTS.find((a) => a.id === "tandem-nc-haval");
  const rows: BuiltCampaign[] = [];
  if (tenet) {
    rows.push(
      campaign({
        id: "tandem-nc-tenet-ctr",
        brand: tenet.brand,
        line: "nc",
        contractor: tenet.contractor,
        login: tenet.clientLogin,
        type: "search_model",
        title: `${tenet.brand} | ${LINE_LABEL.nc} | Поиск`,
        days,
        impressions: 50000,
        clicks: 900,
        cost: 220000,
        prevImpressions: 48000,
        prevClicks: 3600,
        prevCost: 180000,
        totalLeads: 28,
        prevTotalLeads: 32,
        quality: 16,
        prevQuality: 18,
        calls: 40,
        prevCalls: 42
      })
    );
  }
  if (tank) {
    rows.push(
      campaign({
        id: "tandem-nc-tank-cpl",
        brand: tank.brand,
        line: "nc",
        contractor: tank.contractor,
        login: tank.clientLogin,
        type: "search_model",
        title: `${tank.brand} | ${LINE_LABEL.nc} | Поиск`,
        days,
        impressions: 42000,
        clicks: 2100,
        cost: 210000,
        prevImpressions: 40000,
        prevClicks: 2000,
        prevCost: 200000,
        totalLeads: 36,
        prevTotalLeads: 48,
        quality: 12,
        prevQuality: 30,
        calls: 44,
        prevCalls: 70
      })
    );
  }
  if (chery) {
    rows.push(
      campaign({
        id: "tandem-nc-chery-rsya",
        brand: chery.brand,
        line: "nc",
        contractor: chery.contractor,
        login: chery.clientLogin,
        type: "rsya",
        title: `${chery.brand} | ${LINE_LABEL.nc} | РСЯ`,
        days,
        impressions: 280000,
        clicks: 1600,
        cost: 130000,
        prevImpressions: 260000,
        prevClicks: 1500,
        prevCost: 120000,
        totalLeads: 4,
        prevTotalLeads: 6,
        quality: 0,
        prevQuality: 0,
        calls: 18,
        prevCalls: 16
      })
    );
  }
  if (genesis) {
    rows.push(
      campaign({
        id: "tandem-nc-genesis-pace",
        brand: genesis.brand,
        line: "nc",
        contractor: genesis.contractor,
        login: genesis.clientLogin,
        type: "search_brand",
        title: `${genesis.brand} | ${LINE_LABEL.nc} | Поиск · бренд`,
        days,
        impressions: 18000,
        clicks: 1400,
        cost: 160000,
        prevImpressions: 17000,
        prevClicks: 1350,
        prevCost: 150000,
        totalLeads: 22,
        prevTotalLeads: 21,
        quality: 14,
        prevQuality: 13,
        calls: 26,
        prevCalls: 25
      })
    );
  }
  if (haval) {
    rows.push(
      campaign({
        id: "tandem-nc-haval-paused",
        brand: haval.brand,
        line: "nc",
        contractor: haval.contractor,
        login: haval.clientLogin,
        type: "search_model",
        title: `${haval.brand} | ${LINE_LABEL.nc} | Поиск · модели`,
        days,
        impressions: 0,
        clicks: 0,
        cost: 0,
        prevImpressions: 15000,
        prevClicks: 700,
        prevCost: 80000,
        totalLeads: 0,
        prevTotalLeads: 12,
        quality: 0,
        prevQuality: 8,
        calls: 0,
        prevCalls: 14
      })
    );
  }
  return rows;
}

export function buildFixture(range: DateRange, filter: DashboardFilter): {
  campaigns: CampaignRow[];
  currentLeads: LeadRow[];
  previousLeads: LeadRow[];
  behavior: BehaviorSnapshot;
  daily: Array<{ date: string; spend: number; clicks: number; totalLeads: number }>;
  health: HealthStatus[];
} {
  const days = eachDate(range.from, range.to).length || 14;
  const accounts = ACCOUNTS.filter((acc) => !acc.skipDirect && matchAccount(acc, filter));
  const built: BuiltCampaign[] = accounts.map((acc) => healthy(acc, days));
  for (const extra of anomalies(days)) {
    const acc = accounts.find((a) => a.brand === extra.row.brand && a.line === extra.row.line && a.contractor === extra.row.contractor);
    if (acc) built.push(extra);
  }

  const currentLeads = built.flatMap((item) => leadsFor(item, eachDate(range.from, range.to), "current"));
  const previousLeads = built.flatMap((item) => leadsFor(item, eachDate(range.previousFrom, range.previousTo), "previous"));
  const campaigns = built.map((item) => item.row);
  const behavior = buildBehavior(range, campaigns, built);
  const daily = buildDaily(range, campaigns, behavior);
  const health: HealthStatus[] = [
    {
      source: "direct",
      name: "Яндекс Директ",
      ok: true,
      state: "ok",
      message: "Демо-выборка кабинетов Tandem и RTA. Живые отчёты включатся, когда появятся токены в .env.local или data/tokens.json."
    },
    {
      source: "calltouch",
      name: "Calltouch",
      ok: true,
      state: "ok",
      message: "Демо-звонки с парами тегов качества. Форма как у боевой выгрузки, без запроса к API."
    },
    {
      source: "metrika",
      name: "Яндекс Метрика",
      ok: true,
      state: "ok",
      message: "Демо-поведение: отказы, устройства, посадочные и прокси карты скролла. Вебвизор-записи API статистики не отдаёт."
    }
  ];
  return { campaigns, currentLeads, previousLeads, behavior, daily, health };
}

function leadsFor(item: BuiltCampaign, dates: string[], period: "current" | "previous"): LeadRow[] {
  if (!dates.length) return [];
  const quality = period === "current" ? item.quality : item.prevQuality;
  const calls = period === "current" ? item.calls : item.prevCalls;
  const forms = period === "current" ? item.row.formLeads : item.row.previousFormLeads;
  const tags = item.row.line === "afs" ? AFS_QUALITY_TAGS : NC_QUALITY_TAGS;
  const rows: LeadRow[] = [];
  const push = (index: number, kind: "call" | "form", isQuality: boolean) => {
    const date = dates[index % dates.length];
    const short = isQuality && index % 8 === 0;
    rows.push({
      id: `${item.row.id}-${period}-${kind}-${index}`,
      kind,
      site: item.row.brand,
      datetime: `${date}T10:00:00`,
      source: "yandex",
      medium: "cpc",
      campaign: item.row.name,
      campaignId: item.row.directId,
      landing: `/${item.row.brand.toLowerCase()}`,
      durationSec: kind === "form" ? 0 : short ? 8 : isQuality ? 140 : 14,
      unique: true,
      shortCall: short,
      tags: isQuality ? [...tags] : ["Нецелевой"],
      quality: isQuality,
      brand: item.row.brand,
      line: item.row.line,
      contractor: item.row.contractor
    });
  };
  for (let i = 0; i < calls; i += 1) push(i, "call", i < quality);
  for (let i = 0; i < forms; i += 1) push(i + calls, "form", false);
  return rows;
}

function buildBehavior(range: DateRange, campaigns: CampaignRow[], built: BuiltCampaign[]): BehaviorSnapshot {
  const clicks = campaigns.reduce((s, c) => s + c.current.clicks, 0);
  const visits = Math.max(800, Math.round(clicks * 2.2));
  const previousVisits = Math.round(visits * 0.98);
  // Конверсия падает примерно на треть, но цель не обнуляется — иначе это уже другой алерт.
  const goalLeads = Math.max(20, Math.round(visits * 0.008));
  const previousGoalLeads = Math.round(goalLeads * 1.45);
  const tenet = built.find((b) => b.row.id === "tandem-nc-tenet-ctr");
  const pages = campaigns.slice(0, 12).map((c) => {
    const bad = c.id === "tandem-nc-tenet-ctr";
    const engaged = c.brand === "HAVAL" && c.type === "search_model" && c.current.impressions > 0;
    const pageVisits = Math.max(300, Math.round(c.current.clicks * 0.9) || 300);
    return {
      path: bad ? "/tenet" : engaged ? "/haval/jolion" : `/${c.brand.toLowerCase().replace(/\s+/g, "-")}`,
      title: bad ? "Tenet · витрина" : engaged ? "HAVAL Jolion · карточка" : `${c.brand} · ${LINE_LABEL[c.line]}`,
      visits: pageVisits,
      bounceRate: bad ? 68 : engaged ? 27 : 36,
      avgDurationSec: bad ? 16 : engaged ? 210 : 130,
      pageDepth: bad ? 1.1 : engaged ? 3.8 : 2.4,
      calls: bad ? 2 : Math.max(1, Math.round(pageVisits * 0.012)),
      cr: bad ? 0.15 : engaged ? 0.35 : 1.2,
      deviceGap: bad ? 0.72 : 0
    };
  });
  const dedup = new Map<string, (typeof pages)[number]>();
  for (const page of pages) {
    const prev = dedup.get(page.path);
    if (!prev || page.visits > prev.visits) dedup.set(page.path, page);
  }
  const byCampaign = campaigns.slice(0, 8).map((c) => ({
    campaign: c.name,
    visits: Math.max(0, Math.round(c.current.clicks * (c.type === "rsya" ? 0.7 : 0.9))),
    bounceRate: c.type === "rsya" ? 64 : c.id === "tandem-nc-tenet-ctr" ? 61 : 34,
    durationSec: c.type === "rsya" ? 22 : c.id === "tandem-nc-tenet-ctr" ? 18 : 150,
    goalLeads: c.type === "rsya" ? 0 : Math.max(0, Math.round(c.totalLeads * 0.4))
  }));
  const mobileVisits = Math.round(visits * 0.68);
  const desktopVisits = Math.round(visits * 0.27);
  const tabletVisits = Math.max(0, visits - mobileVisits - desktopVisits);
  return {
    visits,
    users: Math.round(visits * 0.82),
    bounceRate: 47,
    avgDurationSec: 118,
    pageDepth: 2.1,
    previousVisits,
    previousBounceRate: 36,
    previousDurationSec: 142,
    previousPageDepth: 2.6,
    goalLeads,
    previousGoalLeads,
    directClicks: clicks,
    metrikaDirectVisits: Math.round(clicks * 0.78),
    funnel: [
      { id: "visit", name: "Визит", value: visits, previous: previousVisits },
      { id: "goal", name: "Лиды Метрики", value: goalLeads, previous: previousGoalLeads },
      { id: "quality", name: "Качественный лид", value: 0, previous: 0 }
    ],
    pages: Array.from(dedup.values()).sort((a, b) => b.visits - a.visits),
    paths: [
      { steps: ["Объявление", "Карточка модели", "Звонок"], sessions: Math.round(visits * 0.08), calls: Math.round(visits * 0.004), cr: 5 },
      { steps: ["РСЯ", "Главная", "Уход"], sessions: Math.round(visits * 0.12), calls: Math.round(visits * 0.0004), cr: 0.3 }
    ],
    sources: [
      { source: "Яндекс.Директ · поиск", visits: Math.round(visits * 0.46), bounceRate: 34, durationSec: 160, calls: Math.round(goalLeads * 0.7), qualityLeads: 0 },
      { source: "Яндекс.Директ · сети", visits: Math.round(visits * 0.28), bounceRate: 66, durationSec: 28, calls: Math.round(goalLeads * 0.08), qualityLeads: 0 },
      { source: "Органика", visits: Math.round(visits * 0.16), bounceRate: 30, durationSec: 170, calls: Math.round(goalLeads * 0.15), qualityLeads: 0 }
    ],
    devices: [
      { device: "mobile", visits: mobileVisits, bounceRate: 52, cr: 0.42, calls: Math.round(mobileVisits * 0.0042) },
      { device: "desktop", visits: desktopVisits, bounceRate: 29, cr: 2.4, calls: Math.round(desktopVisits * 0.024) },
      { device: "tablet", visits: tabletVisits, bounceRate: 38, cr: 1.1, calls: Math.round(tabletVisits * 0.011) }
    ],
    byCampaign,
    dailyVisits: eachDate(range.from, range.to).map((date) => ({ date, visits: Math.round(visits / Math.max(1, eachDate(range.from, range.to).length)) })),
    pageSignals: [
      { path: "/tenet", scroll50Pct: 22, deadClicks: 86, webvisorVisits: tenet ? 420 : 0 }
    ],
    goalHealth: [
      {
        counterId: "105085067",
        name: "Tenet",
        visits: Math.max(300, Math.round(visits * 0.08)),
        goalReaches: 0,
        previousGoalReaches: 40,
        callGoalMissing: true
      }
    ]
  };
}

function buildDaily(
  range: DateRange,
  campaigns: CampaignRow[],
  behavior: BehaviorSnapshot
): Array<{ date: string; spend: number; clicks: number; totalLeads: number }> {
  const dates = eachDate(range.from, range.to);
  const spend = campaigns.reduce((s, c) => s + c.current.cost, 0);
  const clicks = campaigns.reduce((s, c) => s + c.current.clicks, 0);
  const leads = campaigns.reduce((s, c) => s + c.totalLeads, 0);
  const spikeAt = Math.min(dates.length - 1, 3);
  const weights = dates.map((_, i) => (i === spikeAt ? 3.5 : 1));
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  return dates.map((date, i) => ({
    date,
    spend: Math.round((spend * weights[i]) / sum),
    clicks: Math.round((clicks * (i === spikeAt ? 1.15 : 1)) / (dates.length + 0.15)),
    totalLeads: Math.round(leads / dates.length)
  }));
}

export function demoDirectDeep(brand?: string): {
  queries: QueryRow[];
  ads: AdRow[];
  placements: PlacementRow[];
  audience: AudiencePack;
  note: string;
} {
  const b = brand || "HAVAL";
  const queries: QueryRow[] = [
    { query: `${b} купить у дилера`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 8000, clicks: 420, cost: 38000, conversions: 18 },
    { query: `${b} цена москва`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 6000, clicks: 300, cost: 27000, conversions: 11 },
    { query: `${b} вакансия менеджер`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 2200, clicks: 90, cost: 7400, conversions: 0 },
    { query: `${b} запчасти фильтр`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 1800, clicks: 70, cost: 6100, conversions: 0 },
    { query: `${b} своими руками масло`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 900, clicks: 40, cost: 3200, conversions: 0 },
    { query: `${b} отзывы владельцев`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 2400, clicks: 110, cost: 8900, conversions: 0 },
    { query: `${b} характеристики клиренс`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 2100, clicks: 95, cost: 7600, conversions: 0 },
    { query: `что лучше ${b} или tank`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 1600, clicks: 80, cost: 6900, conversions: 0 },
    { query: `${b} сравнение комплектаций`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 1400, clicks: 60, cost: 5400, conversions: 0 },
    { query: `${b} недостатки минусы`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 1100, clicks: 48, cost: 4100, conversions: 0 },
    { query: `работа ${b} салон`, campaign: `${b} | Поиск`, campaignId: "1", impressions: 800, clicks: 36, cost: 2800, conversions: 0 }
  ];
  const ads: AdRow[] = [
    {
      adId: "1",
      campaign: `${b} | Поиск`,
      campaignId: "1",
      impressions: 12000,
      clicks: 900,
      cost: 72000,
      conversions: 24,
      ctr: 7.5,
      title: `${b} в наличии у Борисхоф`,
      title2: "Цена от дилера, тест-драйв сегодня",
      text: "Официальный дилер. Кредит и трейд-ин.",
      sitelinks: 4,
      callouts: 4
    },
    {
      adId: "2",
      campaign: `${b} | Поиск`,
      campaignId: "1",
      impressions: 9000,
      clicks: 180,
      cost: 21000,
      conversions: 1,
      ctr: 2,
      title: "Автомобили",
      title2: "",
      text: "Звоните нам.",
      sitelinks: 0,
      callouts: 0
    }
  ];
  const placements: PlacementRow[] = [
    { placement: "auto.ru", campaign: `${b} | РСЯ`, impressions: 40000, clicks: 300, cost: 18000, conversions: 4 },
    { placement: "com.casual.game", campaign: `${b} | РСЯ`, impressions: 120000, clicks: 800, cost: 24000, conversions: 0 },
    { placement: "dsp.video.network", campaign: `${b} | РСЯ`, impressions: 90000, clicks: 420, cost: 16000, conversions: 0 },
    { placement: "news.example", campaign: `${b} | РСЯ`, impressions: 30000, clicks: 140, cost: 9000, conversions: 0 }
  ];
  const audience: AudiencePack = {
    age: [
      { key: "25-34", label: "25–34", impressions: 20000, clicks: 800, cost: 40000, conversions: 12 },
      { key: "35-44", label: "35–44", impressions: 18000, clicks: 700, cost: 36000, conversions: 14 },
      { key: "0-17", label: "0–17", impressions: 8000, clicks: 200, cost: 12000, conversions: 0 }
    ],
    gender: [
      { key: "m", label: "мужчины", impressions: 30000, clicks: 1000, cost: 50000, conversions: 16 },
      { key: "f", label: "женщины", impressions: 22000, clicks: 700, cost: 30000, conversions: 10 }
    ],
    device: [
      { key: "m", label: "смартфоны", impressions: 40000, clicks: 1400, cost: 52000, conversions: 14 },
      { key: "d", label: "десктоп", impressions: 18000, clicks: 600, cost: 28000, conversions: 12 }
    ],
    geo: [
      { key: "msk", label: "Москва", impressions: 30000, clicks: 1100, cost: 48000, conversions: 20 },
      { key: "far", label: "Дальний регион", impressions: 9000, clicks: 220, cost: 14000, conversions: 0 }
    ]
  };
  return {
    queries,
    ads,
    placements,
    audience,
    note: "Демо-выборка запросов, объявлений и площадок. Живой отчёт Директа появится вместе с токеном кабинета."
  };
}

export function emptySeries(range: DateRange): DailyPoint[] {
  return eachDate(range.from, range.to).map((date) => ({
    date,
    spend: 0,
    clicks: 0,
    totalLeads: 0,
    qualityLeads: 0,
    visits: 0,
    calls: 0
  }));
}
