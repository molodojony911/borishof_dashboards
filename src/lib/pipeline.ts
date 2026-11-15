import fs from "fs";
import { dataPath } from "./paths";
import { loadSettings, hasLiveSources, resolveCalltouchToken, resolveDirectToken, resolveMetrikaToken } from "./config";
import { DEFAULT_QUALITY_TAGS } from "./defaults";
import { eachDate, parsePeriod, rangeFor } from "./period";
import { deltaPct, safeDiv } from "./format";
import { buildAlerts, buildPlanRunRateAlerts, computeCampaign } from "./engines/alerts";
import { buildInsights } from "./engines/insights";
import { buildHypotheses } from "./engines/hypotheses";
import { loadMetrikaGoals } from "./goals-file";
import { factsFromDashboard } from "./plan-model";
import { loadPlans } from "./plan-store";
import { fetchDirectCampaigns } from "./connectors/direct";
import { fetchCalltouchLeads } from "./connectors/calltouch";
import { emptyBehavior, fetchMetrikaBehavior } from "./connectors/metrika";
import { ACCOUNTS, emptyFilter, matchAccount, type DashboardFilter } from "./catalog";
import { classifyCalltouchTags } from "./calltouch-catalog";
import type {
  BrandSummary,
  CampaignRow,
  ContractorSummary,
  DashboardPayload,
  DateRange,
  HealthStatus,
  KpiValue,
  LeadRow,
  LeadSummary,
  Line,
  LineSummary,
  DailyPoint,
  AppSettings,
  ProjectVisit
} from "./types";

function classifyTag(tag: string): boolean {
  return classifyCalltouchTags([tag]).quality;
}

function matchRow(
  row: { contractor: string; brand: string; line?: Line | null },
  f: DashboardFilter
): boolean {
  if (f.contractor && row.contractor !== f.contractor) return false;
  if (f.line && row.line !== f.line) return false;
  if (f.brand && row.brand !== f.brand) return false;
  return true;
}

function campaignKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Звонки Calltouch приходят с utm_campaign вида «имя|ID». Клеим их к кампаниям Директа
 * сначала по ID, потом по имени — иначе CPL по качественным лидам посчитать не из чего.
 */
function attachLeadsToCampaigns(rows: CampaignRow[], current: LeadRow[], previous: LeadRow[]): void {
  const byId = new Map<string, CampaignRow>();
  const byName = new Map<string, CampaignRow>();
  for (const row of rows) {
    row.qualityLeads = 0;
    row.previousQualityLeads = 0;
    row.calls = 0;
    row.previousCalls = 0;
    row.formLeads = 0;
    row.previousFormLeads = 0;
    if (row.directId) byId.set(row.directId, row);
    byName.set(campaignKey(row.name), row);
  }

  const apply = (leads: LeadRow[], period: "current" | "previous") => {
    for (const lead of leads) {
      const row = (lead.campaignId && byId.get(lead.campaignId)) || byName.get(campaignKey(lead.campaign));
      if (!row) continue;
      if (lead.kind === "form") {
        if (period === "current") row.formLeads += 1;
        else row.previousFormLeads += 1;
        continue;
      }
      if (period === "current") {
        row.calls += 1;
        if (lead.quality) row.qualityLeads += 1;
      } else {
        row.previousCalls += 1;
        if (lead.quality) row.previousQualityLeads += 1;
      }
    }
  };
  apply(current, "current");
  apply(previous, "previous");
}

function summarizeLeads(
  currentAll: LeadRow[],
  previousAll: LeadRow[],
  spendBySource: Map<string, number>
): LeadSummary {
  // Звонки и заявки считаются отдельно: CPL по тегам качества остаётся звонковым.
  const current = currentAll.filter((l) => l.kind === "call");
  const previous = previousAll.filter((l) => l.kind === "call");
  const currentForms = currentAll.filter((l) => l.kind === "form");
  const tagSet = new Map<string, { count: number; previous: number; quality: boolean }>();
  const mark = (rows: LeadRow[], field: "count" | "previous") => {
    for (const row of rows) {
      for (const tag of row.tags) {
        const cur = tagSet.get(tag) || { count: 0, previous: 0, quality: classifyTag(tag) };
        cur[field] += 1;
        tagSet.set(tag, cur);
      }
    }
  };
  mark(current, "count");
  mark(previous, "previous");

  const sourceMap = new Map<string, { total: number; quality: number; forms: number }>();
  const sourceKey = (row: LeadRow) => row.campaign || `${row.source}/${row.medium}`;
  for (const row of current) {
    const key = sourceKey(row);
    const cur = sourceMap.get(key) || { total: 0, quality: 0, forms: 0 };
    cur.total += 1;
    if (row.quality) cur.quality += 1;
    sourceMap.set(key, cur);
  }
  for (const row of currentForms) {
    const key = sourceKey(row);
    const cur = sourceMap.get(key) || { total: 0, quality: 0, forms: 0 };
    cur.forms += 1;
    sourceMap.set(key, cur);
  }

  return {
    total: current.length,
    previousTotal: previous.length,
    unique: current.filter((l) => l.unique).length,
    quality: current.filter((l) => l.quality).length,
    previousQuality: previous.filter((l) => l.quality).length,
    shortQuality: current.filter((l) => l.quality && l.shortCall).length,
    previousShortQuality: previous.filter((l) => l.quality && l.shortCall).length,
    forms: currentForms.length,
    previousForms: previousAll.filter((l) => l.kind === "form").length,
    coveredBrands: Array.from(new Set(currentAll.map((l) => l.brand).filter(Boolean))),
    partial: false,
    byTag: Array.from(tagSet.entries())
      .map(([tag, v]) => ({ tag, ...v }))
      .sort((a, b) => b.count - a.count),
    bySource: Array.from(sourceMap.entries())
      .map(([source, v]) => {
        const spend = spendBySource.get(campaignKey(source)) || 0;
        return {
          source,
          total: v.total,
          quality: v.quality,
          forms: v.forms,
          spend,
          paid: spend > 0,
          cpl: safeDiv(spend, v.quality)
        };
      })
      .sort((a, b) => b.quality - a.quality),
    sample: current.slice(-12).reverse()
  };
}

function contractors(rows: Array<ReturnType<typeof computeCampaign>>): ContractorSummary[] {
  const map = new Map<string, ContractorSummary>();
  for (const c of rows) {
    const cur = map.get(c.contractor) || {
      name: c.contractor,
      spend: 0,
      prevSpend: 0,
      clicks: 0,
      totalLeads: 0,
      prevTotalLeads: 0,
      qualityLeads: 0,
      prevQualityLeads: 0,
      ctr: 0,
      cpc: 0,
      cpl: 0,
      prevCpl: 0
    };
    cur.spend += c.current.cost;
    cur.prevSpend += c.previous.cost;
    cur.clicks += c.current.clicks;
    qualityAdd(cur, c);
    map.set(c.contractor, cur);
  }
  return Array.from(map.values()).map((c) => ({
    ...c,
    ctr: 0,
    cpc: safeDiv(c.spend, c.clicks),
    cpl: safeDiv(c.spend, c.totalLeads),
    prevCpl: safeDiv(c.prevSpend, c.prevTotalLeads)
  }));
}

function qualityAdd(cur: ContractorSummary, c: ReturnType<typeof computeCampaign>) {
  cur.totalLeads += c.totalLeads;
  cur.prevTotalLeads += c.previousTotalLeads;
  cur.qualityLeads += c.qualityLeads;
  cur.prevQualityLeads += c.previousQualityLeads;
}

function brandSummaries(rows: Array<ReturnType<typeof computeCampaign>>): BrandSummary[] {
  const map = new Map<string, BrandSummary>();
  for (const c of rows) {
    const cur = map.get(c.brand) || {
      name: c.brand,
      contractor: c.contractor,
      ncSpend: 0,
      afsSpend: 0,
      spend: 0,
      prevSpend: 0,
      totalLeads: 0,
      prevTotalLeads: 0,
      qualityLeads: 0,
      prevQualityLeads: 0,
      cpl: 0,
      prevCpl: 0,
      visits: 0,
      previousVisits: 0
    };
    if (!cur.contractor.includes(c.contractor)) cur.contractor = `${cur.contractor}, ${c.contractor}`;
    cur.spend += c.current.cost;
    cur.prevSpend += c.previous.cost;
    cur.totalLeads += c.totalLeads;
    cur.prevTotalLeads += c.previousTotalLeads;
    cur.qualityLeads += c.qualityLeads;
    cur.prevQualityLeads += c.previousQualityLeads;
    if (c.line === "nc") cur.ncSpend += c.current.cost;
    else cur.afsSpend += c.current.cost;
    map.set(c.brand, cur);
  }
  return Array.from(map.values())
    .map((b) => ({
      ...b,
      cpl: safeDiv(b.spend, b.totalLeads),
      prevCpl: safeDiv(b.prevSpend, b.prevTotalLeads)
    }))
    .sort((a, b) => b.spend - a.spend);
}

function lineSummaries(rows: Array<ReturnType<typeof computeCampaign>>): LineSummary[] {
  const map = new Map<Line, LineSummary>();
  for (const line of ["nc", "afs"] as Line[]) {
    map.set(line, {
      line,
      spend: 0,
      prevSpend: 0,
      totalLeads: 0,
      prevTotalLeads: 0,
      qualityLeads: 0,
      prevQualityLeads: 0,
      cpl: 0,
      prevCpl: 0,
      clicks: 0
    });
  }
  for (const c of rows) {
    const cur = map.get(c.line)!;
    cur.spend += c.current.cost;
    cur.prevSpend += c.previous.cost;
    cur.totalLeads += c.totalLeads;
    cur.prevTotalLeads += c.previousTotalLeads;
    cur.qualityLeads += c.qualityLeads;
    cur.prevQualityLeads += c.previousQualityLeads;
    cur.clicks += c.current.clicks;
  }
  return Array.from(map.values()).map((l) => ({
    ...l,
    cpl: safeDiv(l.spend, l.totalLeads),
    prevCpl: safeDiv(l.prevSpend, l.prevTotalLeads)
  }));
}

function buildKpis(
  spend: number,
  prevSpend: number,
  clicks: number,
  prevClicks: number,
  impressions: number,
  prevImpressions: number,
  quality: number,
  prevQuality: number,
  totalLeads: number,
  prevTotalLeads: number,
  visits: number,
  prevVisits: number,
  bounce: number,
  prevBounce: number
): KpiValue[] {
  return [
    {
      key: "spend",
      label: "Расход Директ",
      value: spend,
      previous: prevSpend,
      format: "rub",
      hint: "Сумма по кабинетам подрядчиков"
    },
    {
      key: "quality",
      label: "Качественные лиды",
      value: quality,
      previous: prevQuality,
      format: "number",
      hint: "Calltouch: теги «Новый» / «Новый А/м» / «Новый звонок» / «Сервис»"
    },
    {
      key: "leads",
      label: "Уникальные звонки",
      value: totalLeads,
      previous: prevTotalLeads,
      format: "number",
      hint: "Директ: только цель-звонок Метрики, не все конверсии кабинета"
    },
    {
      key: "cpl",
      label: "CPL целевой",
      value: safeDiv(spend, quality),
      previous: safeDiv(prevSpend, prevQuality),
      format: "rub",
      hint: "Расход / качественные лиды Calltouch",
      invert: true
    },
    {
      key: "ctr",
      label: "CTR",
      value: safeDiv(clicks, impressions) * 100,
      previous: safeDiv(prevClicks, prevImpressions) * 100,
      format: "percent",
      hint: "Клики / показы"
    },
    {
      key: "cpc",
      label: "CPC",
      value: safeDiv(spend, clicks),
      previous: safeDiv(prevSpend, prevClicks),
      format: "rub",
      hint: "Средняя цена клика",
      invert: true
    },
    {
      key: "cr",
      label: "CR визит → целевой",
      value: safeDiv(quality, visits) * 100,
      previous: safeDiv(prevQuality, prevVisits) * 100,
      format: "percent",
      hint: "Качественные лиды / визиты Метрики"
    },
    {
      key: "visits",
      label: "Визиты",
      value: visits,
      previous: prevVisits,
      format: "number",
      hint: "Яндекс Метрика, все счётчики"
    },
    {
      key: "bounce",
      label: "Отказы",
      value: bounce,
      previous: prevBounce,
      format: "percent",
      hint: "Поведенческий риск посадочных",
      invert: true
    }
  ];
}

function leadDay(datetime: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(datetime)) return datetime.slice(0, 10);
  const m = datetime.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return datetime.slice(0, 10);
}

function liveSeries(
  range: DateRange,
  dailyDirect: Array<{ date: string; spend: number; clicks: number; totalLeads: number }>,
  leads: LeadRow[],
  visitsByDate: Map<string, number>
): DailyPoint[] {
  const dates = eachDate(range.from, range.to);
  const byDate = new Map<string, { spend: number; clicks: number; totalLeads: number }>();
  for (const row of dailyDirect) {
    const cur = byDate.get(row.date) || { spend: 0, clicks: 0, totalLeads: 0 };
    cur.spend += row.spend;
    cur.clicks += row.clicks;
    cur.totalLeads += row.totalLeads;
    byDate.set(row.date, cur);
  }
  return dates.map((date) => {
    const day = byDate.get(date) || { spend: 0, clicks: 0, totalLeads: 0 };
    const dayLeads = leads.filter((l) => leadDay(l.datetime) === date);
    return {
      date,
      spend: day.spend,
      clicks: day.clicks,
      qualityLeads: dayLeads.filter((l) => l.quality).length,
      totalLeads: day.totalLeads,
      visits: visitsByDate.get(date) || 0,
      calls: dayLeads.length
    };
  });
}

function healthState(rows: number, errors: number): "ok" | "partial" | "down" {
  if (!errors) return "ok";
  return rows > 0 ? "partial" : "down";
}

function shortErrors(errors: string[], limit = 3): string {
  if (!errors.length) return "";
  const shown = errors.slice(0, limit).join("; ");
  const more = errors.length > limit ? ` (+ ещё ${errors.length - limit})` : "";
  return ` Ошибки: ${shown}${more}`;
}

const CACHE_TTL_MS = 15 * 60 * 1000;

function cacheDir(): string {
  return dataPath("cache");
}

function cacheFile(range: DateRange, filter: DashboardFilter): string {
  const key = [range.key, filter.contractor || "all", filter.line || "all", filter.brand || "all"].join("_");
  return dataPath("cache", `dashboard-v14-${key}.json`);
}

/** Визиты общего счётчика считаем один раз, иначе бренд удваивает трафик. */
export function applyProjectVisits(brands: BrandSummary[], projects: ProjectVisit[]): BrandSummary[] {
  const map = new Map(brands.map((brand) => [brand.name, { ...brand, visits: 0, previousVisits: 0 }]));
  const seenShared = new Set<string>();
  for (const project of projects) {
    if (!project.brand) continue;
    let cur = map.get(project.brand);
    if (!cur) {
      cur = {
        name: project.brand,
        contractor: project.contractor,
        ncSpend: 0,
        afsSpend: 0,
        spend: 0,
        prevSpend: 0,
        totalLeads: 0,
        prevTotalLeads: 0,
        qualityLeads: 0,
        prevQualityLeads: 0,
        cpl: 0,
        prevCpl: 0,
        visits: 0,
        previousVisits: 0
      };
      map.set(project.brand, cur);
    } else if (project.contractor && cur.contractor && !cur.contractor.split(", ").includes(project.contractor)) {
      cur.contractor = `${cur.contractor}, ${project.contractor}`;
    } else if (!cur.contractor) {
      cur.contractor = project.contractor;
    }
    const shareKey = project.counterIds.slice().sort().join(",");
    if (project.sharedCounter) {
      const once = `${project.brand}|${shareKey}`;
      if (seenShared.has(once)) continue;
      seenShared.add(once);
    }
    cur.visits += project.visits;
    cur.previousVisits += project.previousVisits;
  }
  return Array.from(map.values()).sort((a, b) => b.spend - a.spend || b.visits - a.visits);
}

function readDashboardCache(
  range: DateRange,
  filter: DashboardFilter
): { payload: DashboardPayload; stale: boolean } | null {
  try {
    const file = cacheFile(range, filter);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { savedAt: number; payload: DashboardPayload };
    if (!raw?.payload?.campaigns) return null;
    if (raw.payload.mode === "demo") return null;
    return { payload: raw.payload, stale: Date.now() - Number(raw.savedAt || 0) > CACHE_TTL_MS };
  } catch {
    return null;
  }
}

function writeDashboardCache(range: DateRange, filter: DashboardFilter, payload: DashboardPayload): void {
  try {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile(range, filter), JSON.stringify({ savedAt: Date.now(), payload }), "utf8");
  } catch {
    /* cache is optional */
  }
}

export async function buildDashboard(
  periodParam?: string | null,
  filter: DashboardFilter = emptyFilter()
): Promise<DashboardPayload> {
  const settings = loadSettings();
  const range: DateRange = rangeFor(parsePeriod(periodParam));
  const liveConfigured = hasLiveSources(settings);
  const cached = liveConfigured ? readDashboardCache(range, filter) : null;
  // Свежий кэш отдаём сразу, но алерты и гипотезы считаем заново: правила меняются чаще выгрузок.
  if (cached && !cached.stale) return finalize(cached.payload, settings, range, filter);

  const health: HealthStatus[] = [];
  let mode: DashboardPayload["mode"] = "mixed";
  let campaignRows: CampaignRow[] = [];
  let dailyDirect: Array<{ date: string; spend: number; clicks: number; totalLeads: number }> = [];
  let currentLeads: LeadRow[] = [];
  let previousLeads: LeadRow[] = [];
  let behavior = emptyBehavior(0);
  let projects: ProjectVisit[] = [];

  const directAccounts = settings.direct.filter((acc) =>
    matchRow({ contractor: acc.contractor, brand: acc.brand, line: acc.line || "nc" }, filter)
  );
  const metrikaAccounts = settings.metrika.filter((acc) =>
    matchRow(
      { contractor: acc.contractor || "", brand: acc.brand || "", line: acc.line || "nc" },
      {
        contractor: filter.contractor,
        line: filter.line,
        brand: filter.brand
      }
    ) || (!acc.brand && !filter.brand && !filter.contractor && !filter.line)
  );

  const liveBits = { direct: false, calltouch: false, metrika: false };
  const calltouchAccounts = settings.calltouch.filter((acc) => {
    if (!acc.siteId || !resolveCalltouchToken(acc)) return false;
    if (filter.brand && acc.brand !== filter.brand) return false;
    if (filter.contractor && acc.contractor && acc.contractor !== filter.contractor) return false;
    return true;
  });

  const [directResult, calltouchResult, metrikaResult] = await Promise.all([
    settings.useLiveDirect && directAccounts.some((x) => resolveDirectToken(x))
      ? fetchDirectCampaigns(directAccounts, range)
          .then((pack) => ({ ok: true as const, pack, error: "" }))
          .catch((e) => ({
            ok: false as const,
            pack: { rows: [] as CampaignRow[], daily: [], errors: [] as string[] },
            error: e instanceof Error ? e.message : "Ошибка Директа"
          }))
      : Promise.resolve({
          ok: false as const,
          pack: { rows: [] as CampaignRow[], daily: [], errors: [] as string[] },
          error: "Нет токена или live выключен"
        }),
    settings.useLiveCalltouch && calltouchAccounts.length
      ? fetchCalltouchLeads(calltouchAccounts, range)
          .then((pack) => ({ ok: true as const, pack, error: "" }))
          .catch((e) => ({
            ok: false as const,
            pack: { current: [] as LeadRow[], previous: [] as LeadRow[], errors: [] as string[] },
            error: e instanceof Error ? e.message : "Ошибка Calltouch"
          }))
      : Promise.resolve({
          ok: false as const,
          pack: { current: [] as LeadRow[], previous: [] as LeadRow[], errors: [] as string[] },
          error: "Нет кабинетов с токеном или live выключен"
        }),
    metrikaAccounts.some((x) => x.counterId && resolveMetrikaToken(x.token))
      ? fetchMetrikaBehavior(metrikaAccounts, range, 0)
          .then((pack) => ({ ok: true as const, pack, error: "" }))
          .catch((e) => ({
            ok: false as const,
            pack: { snapshot: emptyBehavior(0), errors: [] as string[] },
            error: e instanceof Error ? e.message : "Ошибка Метрики"
          }))
      : Promise.resolve({
          ok: false as const,
          pack: { snapshot: emptyBehavior(0), errors: [] as string[] },
          error: "Нет OAuth или ID счётчиков"
        })
  ]);

  if (directResult.ok) {
    campaignRows = directResult.pack.rows;
    dailyDirect = directResult.pack.daily;
    liveBits.direct = true;
    health.push({
      source: "direct",
      name: "Яндекс Директ",
      ok: directResult.pack.errors.length === 0,
      state: healthState(directResult.pack.rows.length, directResult.pack.errors.length),
      message: `${directResult.pack.rows.length} кампаний из ${directAccounts.length} кабинетов.${shortErrors(directResult.pack.errors)}`
    });
  } else {
    health.push({ source: "direct", name: "Яндекс Директ", ok: false, message: directResult.error });
  }

  if (calltouchResult.ok) {
    currentLeads = calltouchResult.pack.current.filter((row) => matchRow(row, filter));
    previousLeads = calltouchResult.pack.previous.filter((row) => matchRow(row, filter));
    liveBits.calltouch = true;
    health.push({
      source: "calltouch",
      name: "Calltouch",
      ok: calltouchResult.pack.errors.length === 0,
      state: healthState(calltouchResult.pack.current.length, calltouchResult.pack.errors.length),
      message: `${calltouchResult.pack.current.length} звонков, ${currentLeads.filter((l) => l.quality).length} качественных.${shortErrors(calltouchResult.pack.errors)}`
    });
  } else {
    health.push({ source: "calltouch", name: "Calltouch", ok: false, message: calltouchResult.error });
  }

  if (metrikaResult.ok) {
    behavior = {
      ...metrikaResult.pack.snapshot,
      directClicks: campaignRows.reduce((s, c) => s + c.current.clicks, 0)
    };
    projects = metrikaResult.pack.projects || [];
    liveBits.metrika = metrikaResult.pack.snapshot.visits > 0 || projects.some((project) => project.visits > 0);
    health.push({
      source: "metrika",
      name: "Яндекс Метрика",
      ok: liveBits.metrika && metrikaResult.pack.errors.length === 0,
      state: healthState(metrikaResult.pack.snapshot.visits, metrikaResult.pack.errors.length),
      message: `${metrikaAccounts.length} счётчиков, визитов ${Math.round(metrikaResult.pack.snapshot.visits)}, лидов ${Math.round(metrikaResult.pack.snapshot.goalLeads)}.${shortErrors(metrikaResult.pack.errors)}`
    });
  } else {
    health.push({ source: "metrika", name: "Яндекс Метрика", ok: false, message: metrikaResult.error });
  }

  if (liveBits.direct && liveBits.calltouch && liveBits.metrika) mode = "live";
  else mode = "mixed";

  attachLeadsToCampaigns(campaignRows, currentLeads, previousLeads);
  const computed = campaignRows.map(computeCampaign);
  const spendMap = new Map(computed.map((c) => [campaignKey(c.name), c.current.cost]));
  const calltouchErrors = calltouchResult.ok ? calltouchResult.pack.errors.length : 1;
  const leads = { ...summarizeLeads(currentLeads, previousLeads, spendMap), partial: calltouchErrors > 0 };

  behavior = {
    ...behavior,
    funnel: behavior.funnel.map((step) =>
      step.id === "quality" ? { ...step, value: leads.quality, previous: leads.previousQuality } : step
    )
  };

  const spend = computed.reduce((s, c) => s + c.current.cost, 0);
  const prevSpend = computed.reduce((s, c) => s + c.previous.cost, 0);
  const clicks = computed.reduce((s, c) => s + c.current.clicks, 0);
  const prevClicks = computed.reduce((s, c) => s + c.previous.clicks, 0);
  const impressions = computed.reduce((s, c) => s + c.current.impressions, 0);
  const prevImpressions = computed.reduce((s, c) => s + c.previous.impressions, 0);
  const totalLeads = computed.reduce((s, c) => s + c.totalLeads, 0);
  const prevTotalLeads = computed.reduce((s, c) => s + c.previousTotalLeads, 0);

  const kpis = buildKpis(
    spend,
    prevSpend,
    clicks,
    prevClicks,
    impressions,
    prevImpressions,
    leads.quality,
    leads.previousQuality,
    totalLeads,
    prevTotalLeads,
    behavior.visits,
    behavior.previousVisits,
    behavior.bounceRate,
    behavior.previousBounceRate
  );

  const insights = buildInsights(computed, behavior, leads);
  const visitsByDate = new Map((behavior.dailyVisits || []).map((d) => [d.date, d.visits]));
  const series = liveSeries(range, dailyDirect, currentLeads, visitsByDate);
  const qualityTags = DEFAULT_QUALITY_TAGS;

  const payload: DashboardPayload = {
    mode,
    generatedAt: new Date().toISOString(),
    range,
    kpis,
    series,
    campaigns: computed,
    contractors: contractors(computed).map((c) => {
      const group = computed.filter((x) => x.contractor === c.name);
      const imps = group.reduce((s, x) => s + x.current.impressions, 0);
      const clk = group.reduce((s, x) => s + x.current.clicks, 0);
      return { ...c, ctr: safeDiv(clk, imps) * 100 };
    }),
    brands: applyProjectVisits(brandSummaries(computed), projects),
    projects,
    lines: lineSummaries(computed),
    filter,
    leads,
    behavior,
    alerts: [],
    insights,
    hypotheses: [],
    health,
    qualityTags
  };
  const emptyLive =
    liveConfigured && payload.campaigns.length === 0 && payload.behavior.visits === 0 && payload.leads.total === 0;
  if (emptyLive && cached) return finalize(markStale(cached.payload), settings, range, filter);
  if (liveBits.direct || liveBits.calltouch || liveBits.metrika) {
    writeDashboardCache(range, filter, payload);
  }
  return finalize(payload, settings, range, filter);
}

function markStale(payload: DashboardPayload): DashboardPayload {
  return {
    ...payload,
    health: payload.health.map((row) => ({
      ...row,
      message: `${row.message} Показан сохранённый срез: свежий запрос к API не удался.`
    }))
  };
}

function finalize(
  payload: DashboardPayload,
  settings: AppSettings,
  range: DateRange,
  filter: DashboardFilter
): DashboardPayload {
  const days = eachDate(range.from, range.to).length || 14;
  const budgets = ACCOUNTS.filter((acc) => acc.monthlyBudget && matchAccount(acc, filter)).map((acc) => ({
    brand: acc.brand,
    line: acc.line,
    contractor: acc.contractor,
    monthlyBudget: acc.monthlyBudget || 0
  }));
  const behavior = {
    ...payload.behavior,
    pages: payload.behavior?.pages || [],
    sources: payload.behavior?.sources || [],
    devices: payload.behavior?.devices || [],
    paths: payload.behavior?.paths || [],
    funnel: payload.behavior?.funnel || [],
    byCampaign: payload.behavior?.byCampaign || []
  };
  const leads = payload.leads;
  const month = range.to.slice(0, 7);
  const planRows = loadPlans().rows.filter((plan) => {
    if (plan.month !== month) return false;
    if (filter.contractor && plan.contractor !== filter.contractor) return false;
    if (filter.brand && plan.brand !== filter.brand) return false;
    if (filter.line && plan.line && plan.line !== filter.line) return false;
    return true;
  });
  const alerts = [
    ...buildAlerts(
      payload.campaigns || [],
      behavior,
      leads?.quality || 0,
      leads?.previousQuality || 0,
      leads?.total || 0,
      leads?.previousTotal || 0,
      settings.thresholds,
      {
        series: payload.series || [],
        totalLeadsNow: (payload.campaigns || []).reduce((s, c) => s + c.totalLeads, 0),
        totalLeadsPrev: (payload.campaigns || []).reduce((s, c) => s + c.previousTotalLeads, 0),
        goals: loadMetrikaGoals({ sample: false }),
        budgets,
        periodDays: days
      }
    ),
    ...buildPlanRunRateAlerts(
      planRows,
      factsFromDashboard(payload.campaigns || [], []),
      month,
      days,
      settings.thresholds
    )
  ];
  return {
    ...payload,
    behavior,
    brands: (payload.brands || []).map((brand) => ({
      ...brand,
      visits: brand.visits || 0,
      previousVisits: brand.previousVisits || 0
    })),
    projects: payload.projects || [],
    alerts,
    insights: buildInsights(payload.campaigns || [], behavior, leads),
    hypotheses: buildHypotheses(behavior, leads)
  };
}

export function kpiDeltaHint(current: number, previous: number, invert?: boolean): "up" | "down" | "flat" {
  const d = deltaPct(current, previous);
  if (Math.abs(d) < 1.5) return "flat";
  const up = d > 0;
  if (invert) return up ? "down" : "up";
  return up ? "up" : "down";
}
