import { eachDate } from "./period";
import { safeDiv } from "./format";
import { AFS_QUALITY_TAGS, NC_QUALITY_TAGS } from "./calltouch-catalog";
import { ACCOUNTS, LINE_LABEL } from "./catalog";
import type {
  BehaviorSnapshot,
  CampaignRow,
  CampaignType,
  DailyPoint,
  DateRange,
  LeadRow
} from "./types";

export const DEMO_QUALITY_TAGS = [...NC_QUALITY_TAGS, ...AFS_QUALITY_TAGS];

export const DEMO_NON_QUALITY = ["Нецелевой", "Спам", "Дубль", "Сервис статус", "Ошибка номера"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function campaignFor(
  acc: (typeof ACCOUNTS)[number],
  suffix: string,
  type: CampaignType,
  costFactor: number
): CampaignRow {
  const h = hash(acc.id + suffix);
  const monthly = acc.monthlyBudget || (acc.line === "nc" ? 700000 : 140000);
  const cost = Math.round(((monthly * 14) / 30) * costFactor);
  const prevCost = Math.round(cost * (0.86 + (h % 18) / 100));
  const cpc = acc.line === "nc" ? 48 + (h % 90) : 32 + (h % 40);
  const ctrBase = type === "rsya" ? 0.55 : acc.line === "nc" ? 5.2 : 4.1;
  const ctrNow = type === "search_competitor" ? ctrBase * 0.62 : ctrBase + (h % 20) / 10;
  const clicks = Math.max(40, Math.round(cost / cpc));
  const impressions = Math.round(clicks / (ctrNow / 100));
  const cplTarget = acc.line === "nc" ? 4200 + (h % 1800) : 2600 + (h % 900);
  let qualityLeads = Math.max(2, Math.round(cost / cplTarget));
  let previousQualityLeads = Math.round(qualityLeads * (0.92 + (h % 22) / 100));
  if (type === "rsya") {
    qualityLeads = Math.max(1, Math.round(qualityLeads * 0.12));
    previousQualityLeads = Math.round(qualityLeads * 1.8);
  }
  if (type === "search_competitor") {
    qualityLeads = Math.max(2, Math.round(qualityLeads * 0.35));
    previousQualityLeads = Math.round(qualityLeads * 1.45);
  }
  return {
    id: `${acc.id}-${suffix}`,
    directId: `${hash(`${acc.id}-${suffix}`) % 900000000}`,
    name: `${acc.brand} | ${LINE_LABEL[acc.line]} | ${
      type === "rsya" ? "РСЯ" : type === "search_competitor" ? "Конкуренты" : "Поиск"
    }`,
    contractor: acc.contractor,
    brand: acc.brand,
    line: acc.line,
    type,
    login: acc.clientLogin,
    current: {
      impressions,
      clicks,
      cost,
      conversions: qualityLeads
    },
    previous: {
      impressions: Math.round(impressions * 0.94),
      clicks: Math.round(clicks * (type === "search_competitor" ? 1.28 : 0.97)),
      cost: prevCost,
      conversions: previousQualityLeads
    },
    totalLeads: qualityLeads,
    previousTotalLeads: previousQualityLeads,
    qualityLeads,
    previousQualityLeads,
    calls: Math.round(qualityLeads * 1.8),
    previousCalls: Math.round(previousQualityLeads * 1.8),
    formLeads: Math.round(qualityLeads * 0.4),
    previousFormLeads: Math.round(previousQualityLeads * 0.4)
  };
}

export const campaigns: CampaignRow[] = ACCOUNTS.flatMap((acc) => {
  const rows = [campaignFor(acc, "search", acc.line === "afs" ? "search_brand" : "search_model", 1)];
  if (acc.id === "rta-nc-geely" || acc.id === "tandem-nc-chery") {
    rows.push(campaignFor(acc, "rsya", "rsya", 0.42));
  }
  if (acc.id === "rta-nc-bmw" || acc.id === "tandem-nc-tank") {
    rows.push(campaignFor(acc, "comp", "search_competitor", 0.28));
  }
  return rows;
});

export function demoLeads(range: DateRange): LeadRow[] {
  const dates = eachDate(range.from, range.to);
  const rows: LeadRow[] = [];
  dates.forEach((date) => {
    const dayCount = 70 + (hash(date) % 24);
    for (let i = 0; i < dayCount; i += 1) {
      const seed = hash(`${date}-${i}`);
      const acc = pick(ACCOUNTS, seed);
      const camp = campaigns.find((c) => c.login === acc.clientLogin) || campaigns[seed % campaigns.length];
      const qualityShare = camp.type === "rsya" ? 18 : acc.line === "afs" ? 64 : 52;
      const isQuality = seed % 100 < qualityShare;
      const tags = isQuality
        ? [pick(acc.line === "afs" ? AFS_QUALITY_TAGS : NC_QUALITY_TAGS, seed)]
        : [pick(DEMO_NON_QUALITY, seed + 3)];
      rows.push({
        id: `${date}-${i}`,
        kind: seed % 7 === 0 ? "form" : "call",
        site: acc.site,
        datetime: `${date}T${String(9 + (seed % 12)).padStart(2, "0")}:${String(seed % 60).padStart(2, "0")}:00`,
        source: seed % 11 === 0 ? "google" : "yandex",
        medium: seed % 11 === 0 ? "organic" : "cpc",
        campaign: camp.name,
        campaignId: camp.directId,
        landing: acc.site.replace(/^https?:\/\//, "/"),
        durationSec: isQuality ? 80 + (seed % 200) : 10 + (seed % 22),
        unique: seed % 9 !== 0,
        shortCall: !isQuality && seed % 5 === 0,
        tags: Array.from(new Set(tags)),
        quality: isQuality,
        brand: acc.brand,
        line: acc.line,
        contractor: acc.contractor
      });
    }
  });
  return rows;
}

export function demoPreviousLeads(range: DateRange): LeadRow[] {
  return demoLeads({
    ...range,
    from: range.previousFrom,
    to: range.previousTo
  });
}

export function demoBehavior(range: DateRange, campaignClicks: number): BehaviorSnapshot {
  const visits = 186400;
  const prevVisits = 179200;
  const calls = 1480;
  const pages = ACCOUNTS.slice(0, 10).map((acc, i) => {
    const h = hash(acc.id);
    const pageVisits = 4000 + (h % 18000);
    const bounce = acc.line === "nc" ? 28 + (h % 18) : 26 + (h % 14);
    return {
      path: new URL(acc.site).pathname || "/",
      title: `${acc.brand} · ${LINE_LABEL[acc.line]}`,
      visits: pageVisits,
      bounceRate: acc.brand === "Tenet" ? 61.4 : bounce,
      avgDurationSec: 70 + (h % 140),
      pageDepth: 1.6 + (h % 25) / 10,
      calls: Math.round(pageVisits * (acc.line === "afs" ? 0.018 : 0.01)),
      cr: acc.line === "afs" ? 1.6 : 0.9 + (i % 5) / 10,
      deviceGap: 0.2 + (h % 40) / 100
    };
  });
  return {
    visits,
    users: 142800,
    bounceRate: 38.4,
    avgDurationSec: 146,
    pageDepth: 3.1,
    previousVisits: prevVisits,
    previousBounceRate: 34.9,
    previousDurationSec: 158,
    previousPageDepth: 3.4,
    goalLeads: calls,
    previousGoalLeads: 1710,
    directClicks: campaignClicks,
    metrikaDirectVisits: Math.round(campaignClicks * 0.74),
    funnel: [
      { id: "visit", name: "Визит", value: visits, previous: prevVisits },
      { id: "goal", name: "Лиды Метрики", value: calls, previous: 1710 },
      { id: "quality", name: "Качественный лид", value: 1420, previous: 1551 }
    ],
    pages,
    paths: [
      { steps: ["Объявление", "Посадка бренда", "Звонок"], sessions: 6100, calls: 280, cr: 4.6 },
      { steps: ["РСЯ", "Главная", "Уход"], sessions: 7400, calls: 18, cr: 0.24 },
      { steps: ["Сервис", "Онлайн-запись", "Звонок"], sessions: 1800, calls: 210, cr: 11.7 },
      { steps: ["Модель", "Кредит / тест-драйв", "Форма брошена"], sessions: 2100, calls: 44, cr: 2.1 }
    ],
    byCampaign: campaigns.slice(0, 6).map((c, i) => ({
      campaign: c.name,
      visits: Math.round(c.current.clicks * 0.82),
      bounceRate: c.type === "rsya" ? 58.2 : 34.6 + i,
      durationSec: c.type === "rsya" ? 41 : 150 + i * 6,
      goalLeads: c.type === "rsya" ? 1 : c.totalLeads
    })),
    sources: [
      { source: "Яндекс.Директ", visits: Math.round(campaignClicks * 0.74), bounceRate: 36.8, durationSec: 151, calls: 1180, qualityLeads: 980 },
      { source: "Органика Яндекс", visits: 21400, bounceRate: 32.1, durationSec: 168, calls: 140, qualityLeads: 118 },
      { source: "Прямые заходы", visits: 16200, bounceRate: 28.4, durationSec: 182, calls: 96, qualityLeads: 88 }
    ],
    devices: [
      { device: "mobile", visits: 121100, bounceRate: 43.6, cr: 0.82, calls: 990 },
      { device: "desktop", visits: 54200, bounceRate: 27.1, cr: 2.74, calls: 1480 },
      { device: "tablet", visits: 11100, bounceRate: 34.8, cr: 1.41, calls: 156 }
    ]
  };
}

export function demoSeries(range: DateRange, campaignsRows: CampaignRow[], leads: LeadRow[]): DailyPoint[] {
  const dates = eachDate(range.from, range.to);
  const spend = campaignsRows.reduce((s, c) => s + c.current.cost, 0);
  const clicks = campaignsRows.reduce((s, c) => s + c.current.clicks, 0);
  return dates.map((date, i) => {
    const wave = 0.82 + (i % 7 === 0 || i % 7 === 6 ? 0.08 : 0.18) + (hash(date) % 20) / 100;
    const dayLeads = leads.filter((l) => l.datetime.startsWith(date));
    return {
      date,
      spend: Math.round((spend / dates.length) * wave),
      clicks: Math.round((clicks / dates.length) * wave),
      qualityLeads: dayLeads.filter((l) => l.quality).length,
      totalLeads: Math.round((campaignsRows.reduce((s, c) => s + c.totalLeads, 0) / dates.length) * wave),
      visits: Math.round((186400 / dates.length) * wave),
      calls: dayLeads.length
    };
  });
}

export function scaleCampaigns(rows: CampaignRow[], key: DateRange["key"]): CampaignRow[] {
  const factor = key === "7d" ? 0.5 : key === "30d" ? 2.05 : 1;
  return rows.map((row) => ({
    ...row,
    current: {
      impressions: Math.round(row.current.impressions * factor),
      clicks: Math.round(row.current.clicks * factor),
      cost: Math.round(row.current.cost * factor),
      conversions: Math.round((row.current.conversions || row.totalLeads) * factor)
    },
    previous: {
      impressions: Math.round(row.previous.impressions * factor),
      clicks: Math.round(row.previous.clicks * factor),
      cost: Math.round(row.previous.cost * factor),
      conversions: Math.round((row.previous.conversions || row.previousTotalLeads) * factor)
    },
    totalLeads: Math.round(row.totalLeads * factor),
    previousTotalLeads: Math.round(row.previousTotalLeads * factor),
    qualityLeads: Math.round(row.qualityLeads * factor),
    previousQualityLeads: Math.round(row.previousQualityLeads * factor),
    calls: Math.round(row.calls * factor),
    previousCalls: Math.round(row.previousCalls * factor),
    formLeads: Math.round(row.formLeads * factor),
    previousFormLeads: Math.round(row.previousFormLeads * factor)
  }));
}

export function ctr(m: { impressions: number; clicks: number }): number {
  return safeDiv(m.clicks, m.impressions) * 100;
}

export function cpc(m: { clicks: number; cost: number }): number {
  return safeDiv(m.cost, m.clicks);
}

export function scaleBehavior(behavior: BehaviorSnapshot, share: number): BehaviorSnapshot {
  const s = Math.min(1, Math.max(share, 0.05));
  if (s > 0.97) return behavior;
  const mul = (n: number) => Math.round(n * s);
  return {
    ...behavior,
    visits: mul(behavior.visits),
    users: mul(behavior.users),
    previousVisits: mul(behavior.previousVisits),
    goalLeads: mul(behavior.goalLeads),
    previousGoalLeads: mul(behavior.previousGoalLeads),
    directClicks: mul(behavior.directClicks),
    metrikaDirectVisits: mul(behavior.metrikaDirectVisits),
    funnel: behavior.funnel.map((step) => ({
      ...step,
      value: mul(step.value),
      previous: mul(step.previous)
    })),
    pages: behavior.pages.map((page) => ({ ...page, visits: mul(page.visits), calls: mul(page.calls) })),
    paths: behavior.paths.map((path) => ({ ...path, sessions: mul(path.sessions), calls: mul(path.calls) })),
    sources: behavior.sources.map((src) => ({
      ...src,
      visits: mul(src.visits),
      calls: mul(src.calls),
      qualityLeads: mul(src.qualityLeads)
    })),
    devices: behavior.devices.map((d) => ({ ...d, visits: mul(d.visits), calls: mul(d.calls) }))
  };
}
