import fs from "fs";
import path from "path";
import { eachDate } from "../period";
import { resolveMetrikaToken } from "../config";
import { mapChunk } from "../async";
import { HTTP_TIMEOUT, apiTimeout } from "../http";
import { dataPath } from "../paths";
import { ACCOUNTS } from "../catalog";
import type { BehaviorSnapshot, CampaignBehaviorRow, DateRange, Line, MetrikaAccount, ProjectVisit } from "../types";

const API = "https://api-metrika.yandex.net/stat/v1/data";

function cacheDir(): string {
  return dataPath("cache", "metrika");
}

function quotaFile(): string {
  return dataPath("cache", "metrika", "quota-block.json");
}
/** Период кончается вчера — свежие цифры почти не меняются, кэш бережёт суточную квоту uid. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface MetrikaTable {
  totals?: number[] | number[][];
  data?: Array<{ dimensions: Array<{ name: string }>; metrics: number[] }>;
}

export interface MetrikaMetricTable {
  totals?: number[] | number[][];
  data?: Array<{ dimensions?: Array<{ name?: string } | null>; metrics?: number[] }>;
}

/** Ответ stat/v1/data: плоский totals, строка метрик или единственная строка в data. */
export function metricRow(table: MetrikaMetricTable | null | undefined): number[] {
  if (!table) return [];
  if (table.totals && table.totals.length) {
    const first = table.totals[0];
    if (typeof first === "number") return (table.totals as number[]).map((n) => Number(n) || 0);
    const rows = table.totals as number[][];
    const wide = rows.some((row) => row.length > 1);
    if (!wide) return rows.map((row) => Number(row?.[0] || 0));
    return (rows[0] || []).map((n) => Number(n) || 0);
  }
  const data = table.data || [];
  if (!data.length) return [];
  const named = data.some((row) => (row.dimensions || []).some((d) => d?.name));
  if (!named) return (data[0].metrics || []).map((n) => Number(n) || 0);
  const visits = data.reduce((sum, row) => sum + Number(row.metrics?.[0] || 0), 0);
  return [visits];
}

export function metricTotal(table: MetrikaMetricTable | null | undefined, index = 0): number {
  return Number(metricRow(table)[index] || 0);
}

interface CounterSnap {
  visits: number;
  users: number;
  bounceRate: number;
  avgDurationSec: number;
  pageDepth: number;
  previousVisits: number;
  previousBounceRate: number;
  previousDurationSec: number;
  previousPageDepth: number;
  calls: number;
  previousCalls: number;
  pages: Array<{
    path: string;
    title: string;
    visits: number;
    bounceRate: number;
    avgDurationSec: number;
    pageDepth: number;
    calls: number;
    cr: number;
    deviceGap: number;
  }>;
  sources: Array<{
    source: string;
    visits: number;
    bounceRate: number;
    durationSec: number;
    calls: number;
    qualityLeads: number;
  }>;
  byCampaign: Array<{ campaign: string; visits: number; bounceRate: number; durationSec: number; goalLeads: number }>;
  devices: Array<{ device: "mobile" | "desktop" | "tablet"; visits: number; bounceRate: number; cr: number; calls: number }>;
  bytime: Array<{ date: string; visits: number }>;
  goalError: string;
}

let quotaExceeded = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaError(msg: string): boolean {
  return /429|quota_requests_by_uid|квота uid/i.test(msg);
}

function readQuotaBlock(): boolean {
  try {
    const file = quotaFile();
    if (!fs.existsSync(file)) return false;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { until: number };
    return Date.now() < Number(raw.until || 0);
  } catch {
    return false;
  }
}

function markQuotaExceeded(): void {
  quotaExceeded = true;
  try {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Квота суточная: не дёргаем API до полуночи МСК + небольшой запас.
    const now = new Date();
    const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const nextMidnightMsk = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + 1, 0, 20, 0);
    const until = nextMidnightMsk - 3 * 60 * 60 * 1000;
    fs.writeFileSync(quotaFile(), JSON.stringify({ until }), "utf8");
  } catch {
    /* блок необязателен */
  }
}

function cacheFile(acc: MetrikaAccount, range: DateRange): string {
  return path.join(cacheDir(), `v1_${acc.counterId}_${range.from}_${range.to}_${range.previousFrom}_${range.previousTo}.json`);
}

function readCounterCache(acc: MetrikaAccount, range: DateRange, allowStale: boolean): CounterSnap | null {
  try {
    const file = cacheFile(acc, range);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { savedAt: number; snap: CounterSnap };
    if (!allowStale && Date.now() - raw.savedAt > CACHE_TTL_MS) return null;
    return raw.snap;
  } catch {
    return null;
  }
}

function writeCounterCache(acc: MetrikaAccount, range: DateRange, snap: CounterSnap): void {
  try {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile(acc, range), JSON.stringify({ savedAt: Date.now(), snap }), "utf8");
  } catch {
    /* кэш необязателен */
  }
}

async function metrikaGet(token: string, params: Record<string, string>): Promise<MetrikaTable> {
  if (quotaExceeded || readQuotaBlock()) {
    quotaExceeded = true;
    throw new Error("Метрика 429: квота uid исчерпана, запросы остановлены до сброса");
  }
  const url = new URL(API);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `OAuth ${token}` },
    cache: "no-store",
    signal: apiTimeout(HTTP_TIMEOUT.metrikaMs)
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429 || /quota_requests_by_uid/i.test(text)) markQuotaExceeded();
    throw new Error(`Метрика ${res.status}: ${text.slice(0, 280)}`);
  }
  return (await res.json()) as MetrikaTable;
}

/** Повтор только на сеть/5xx. 429 ретраить нельзя: каждая попытка жрёт ту же суточную квоту. */
async function metrikaGetRetry(token: string, params: Record<string, string>): Promise<MetrikaTable> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await metrikaGet(token, params);
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : "";
      if (isQuotaError(msg)) throw e;
      if (!/timeout|aborted|503|502|504/i.test(msg) || attempt === 1) throw e;
      await sleep(800);
    }
  }
  throw last instanceof Error ? last : new Error("Метрика: повторные ошибки");
}

function total(table: MetrikaTable, index = 0): number {
  return metricTotal(table, index);
}

function metricSum(metrics: number[] | undefined, from: number, count: number): number {
  if (!metrics || count <= 0) return 0;
  let s = 0;
  for (let i = 0; i < count; i += 1) s += Number(metrics[from + i] || 0);
  return s;
}

function goalSuffix(ids: string[]): string {
  return ids.map((id) => `,ym:s:goal${id}reaches`).join("");
}

function groupCounters(accounts: MetrikaAccount[]): Array<MetrikaAccount & { goalCallIds: string[] }> {
  const map = new Map<string, MetrikaAccount & { goalCallIds: string[] }>();
  for (const acc of accounts) {
    const cur = map.get(acc.counterId);
    const extra = acc.goalCallId ? [acc.goalCallId] : [];
    if (!cur) {
      map.set(acc.counterId, { ...acc, goalCallIds: extra });
      continue;
    }
    for (const id of extra) {
      if (!cur.goalCallIds.includes(id)) cur.goalCallIds.push(id);
    }
  }
  return Array.from(map.values());
}

function emptyDevices(): BehaviorSnapshot["devices"] {
  return [
    { device: "desktop", visits: 0, bounceRate: 0, cr: 0, calls: 0 },
    { device: "mobile", visits: 0, bounceRate: 0, cr: 0, calls: 0 },
    { device: "tablet", visits: 0, bounceRate: 0, cr: 0, calls: 0 }
  ];
}

export function emptyBehavior(directClicks = 0): BehaviorSnapshot {
  return {
    visits: 0,
    users: 0,
    bounceRate: 0,
    avgDurationSec: 0,
    pageDepth: 0,
    previousVisits: 0,
    previousBounceRate: 0,
    previousDurationSec: 0,
    previousPageDepth: 0,
    goalLeads: 0,
    previousGoalLeads: 0,
    directClicks,
    metrikaDirectVisits: 0,
    funnel: [
      { id: "visit", name: "Визит", value: 0, previous: 0 },
      { id: "goal", name: "Лиды Метрики", value: 0, previous: 0 },
      { id: "quality", name: "Качественный лид", value: 0, previous: 0 }
    ],
    pages: [],
    paths: [],
    sources: [],
    devices: emptyDevices(),
    byCampaign: [],
    dailyVisits: []
  };
}

async function fetchTable(
  acc: MetrikaAccount,
  params: Record<string, string>,
  withGoals: string
): Promise<MetrikaTable> {
  try {
    return await metrikaGetRetry(acc.token, { ...params, metrics: params.metrics + withGoals });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (!withGoals || isQuotaError(msg)) throw e;
    return metrikaGetRetry(acc.token, params);
  }
}

function deviceName(raw: string): "mobile" | "desktop" | "tablet" {
  const name = raw.toLowerCase();
  if (name.includes("mobile") || name.includes("смарт")) return "mobile";
  if (name.includes("tablet") || name.includes("планш")) return "tablet";
  return "desktop";
}

function emptyTable(): MetrikaTable {
  return { totals: [], data: [] };
}

/**
 * Сводка и цели в одном запросе: было 4 вызова на период (текущий+прошлый × визиты+цели), стало 2.
 */
async function fetchOverviewWithGoals(
  acc: MetrikaAccount & { goalCallIds: string[] },
  dates: { date1: string; date2: string },
  includeUsers: boolean
): Promise<{ table: MetrikaTable; goalError: string }> {
  const core = includeUsers
    ? "ym:s:visits,ym:s:users,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageDepth"
    : "ym:s:visits,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageDepth";
  const goals = acc.goalCallIds.map((id) => `ym:s:goal${id}reaches`).join(",");
  const params = { ids: acc.counterId, ...dates, metrics: goals ? `${core},${goals}` : core };
  try {
    return { table: await metrikaGetRetry(acc.token, params), goalError: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка целей";
    if (isQuotaError(msg)) throw e;
    const table = await metrikaGetRetry(acc.token, { ...params, metrics: core });
    return { table, goalError: msg };
  }
}

async function fetchCounterLive(acc: MetrikaAccount & { goalCallIds: string[] }, range: DateRange): Promise<CounterSnap> {
  const base = { ids: acc.counterId, date1: range.from, date2: range.to };
  const goals = goalSuffix(acc.goalCallIds);
  const nGoals = acc.goalCallIds.length;
  const pageMetrics = "ym:s:visits,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageDepth";
  const deviceMetrics = "ym:s:visits,ym:s:bounceRate";
  const sourceMetrics = "ym:s:visits,ym:s:bounceRate,ym:s:avgVisitDurationSeconds";

  const current = await fetchOverviewWithGoals(acc, { date1: range.from, date2: range.to }, true);
  const previous = quotaExceeded
    ? { table: emptyTable(), goalError: "" }
    : await fetchOverviewWithGoals(acc, { date1: range.previousFrom, date2: range.previousTo }, false);

  const rest = async <T>(job: () => Promise<T>, fallback: T): Promise<T> => {
    if (quotaExceeded) return fallback;
    try {
      return await job();
    } catch (e) {
      if (isQuotaError(e instanceof Error ? e.message : "")) return fallback;
      return fallback;
    }
  };

  const pages = await rest(
    () => fetchTable(acc, { ...base, dimensions: "ym:s:startURLPath", metrics: pageMetrics, limit: "15" }, goals),
    emptyTable()
  );
  const devices = await rest(
    () => fetchTable(acc, { ...base, dimensions: "ym:s:deviceCategory", metrics: deviceMetrics, limit: "10" }, goals),
    emptyTable()
  );
  const sources = await rest(
    () =>
      fetchTable(acc, { ...base, dimensions: "ym:s:lastSignTrafficSource", metrics: sourceMetrics, limit: "12" }, goals),
    emptyTable()
  );
  const bytime = await rest(
    () => metrikaGetRetry(acc.token, { ...base, dimensions: "ym:s:date", metrics: "ym:s:visits" }),
    emptyTable()
  );
  const utm = await rest(
    () => fetchTable(acc, { ...base, dimensions: "ym:s:lastUTMCampaign", metrics: sourceMetrics, limit: "60" }, goals),
    emptyTable()
  );

  const overview = current.table;
  const prevOverview = previous.table;
  const goalOffsetNow = 5;
  const goalOffsetPrev = 4;
  const calls = acc.goalCallIds.reduce((sum, _, i) => sum + total(overview, goalOffsetNow + i), 0);
  const previousCalls = acc.goalCallIds.reduce((sum, _, i) => sum + total(prevOverview, goalOffsetPrev + i), 0);

  return {
    visits: total(overview, 0),
    users: total(overview, 1),
    bounceRate: total(overview, 2),
    avgDurationSec: total(overview, 3),
    pageDepth: total(overview, 4),
    previousVisits: total(prevOverview, 0),
    previousBounceRate: total(prevOverview, 1),
    previousDurationSec: total(prevOverview, 2),
    previousPageDepth: total(prevOverview, 3),
    calls,
    previousCalls,
    pages: (pages.data || []).map((row) => {
      const pageVisits = row.metrics[0] || 0;
      const pageCalls = metricSum(row.metrics, 4, nGoals);
      return {
        path: row.dimensions[0]?.name || "/",
        title: row.dimensions[0]?.name || "/",
        visits: pageVisits,
        bounceRate: row.metrics[1] || 0,
        avgDurationSec: row.metrics[2] || 0,
        pageDepth: row.metrics[3] || 0,
        calls: pageCalls,
        cr: pageVisits ? (pageCalls / pageVisits) * 100 : 0,
        deviceGap: 0
      };
    }),
    sources: (sources.data || []).map((row) => {
      const srcVisits = row.metrics[0] || 0;
      const srcCalls = metricSum(row.metrics, 3, nGoals);
      return {
        source: row.dimensions[0]?.name || "—",
        visits: srcVisits,
        bounceRate: row.metrics[1] || 0,
        durationSec: row.metrics[2] || 0,
        calls: srcCalls,
        qualityLeads: 0
      };
    }),
    byCampaign: (utm.data || [])
      .map((row) => {
        const utmVisits = row.metrics[0] || 0;
        return {
          campaign: row.dimensions[0]?.name || "—",
          visits: utmVisits,
          bounceRate: row.metrics[1] || 0,
          durationSec: row.metrics[2] || 0,
          goalLeads: metricSum(row.metrics, 3, nGoals)
        };
      })
      .filter((row) => row.campaign && row.campaign !== "—"),
    devices: (devices.data || []).map((row) => {
      const deviceVisits = row.metrics[0] || 0;
      const deviceCalls = metricSum(row.metrics, 2, nGoals);
      return {
        device: deviceName(row.dimensions[0]?.name || ""),
        visits: deviceVisits,
        bounceRate: row.metrics[1] || 0,
        cr: deviceVisits ? (deviceCalls / deviceVisits) * 100 : 0,
        calls: deviceCalls
      };
    }),
    bytime: (bytime.data || []).map((row) => ({
      date: row.dimensions[0]?.name || "",
      visits: row.metrics[0] || 0
    })),
    goalError: current.goalError || previous.goalError
  };
}

async function fetchCounterSnapshot(acc: MetrikaAccount & { goalCallIds: string[] }, range: DateRange): Promise<CounterSnap> {
  const fresh = readCounterCache(acc, range, false);
  if (fresh) return fresh;
  if (quotaExceeded || readQuotaBlock()) {
    quotaExceeded = true;
    const stale = readCounterCache(acc, range, true);
    if (stale) return { ...stale, goalError: stale.goalError || "квота Метрики, показан кэш" };
    throw new Error("Метрика 429: квота uid исчерпана, запросы остановлены до сброса");
  }
  try {
    const snap = await fetchCounterLive(acc, range);
    if (snap.visits > 0 || snap.previousVisits > 0 || !quotaExceeded) writeCounterCache(acc, range, snap);
    return snap;
  } catch (e) {
    const stale = readCounterCache(acc, range, true);
    if (stale) {
      const msg = e instanceof Error ? e.message : "ошибка";
      return { ...stale, goalError: stale.goalError || msg };
    }
    throw e;
  }
}

/** utm_campaign у подрядчиков приходит как «имя|ID» — приводим к чистому имени. */
function cleanCampaign(raw: string): string {
  const parts = raw.split("|");
  const tail = parts[parts.length - 1].trim();
  if (parts.length > 1 && /^\d+$/.test(tail)) return parts.slice(0, -1).join("|").trim();
  return raw.trim();
}

function mergeCampaignBehavior(
  snapshots: Array<{ byCampaign: Array<{ campaign: string; visits: number; bounceRate: number; durationSec: number; goalLeads: number }> }>
): CampaignBehaviorRow[] {
  const map = new Map<string, { visits: number; bounce: number; dur: number; goals: number }>();
  for (const s of snapshots) {
    for (const row of s.byCampaign || []) {
      const key = cleanCampaign(row.campaign);
      if (!key) continue;
      const cur = map.get(key) || { visits: 0, bounce: 0, dur: 0, goals: 0 };
      cur.visits += row.visits;
      cur.bounce += row.bounceRate * row.visits;
      cur.dur += row.durationSec * row.visits;
      cur.goals += row.goalLeads;
      map.set(key, cur);
    }
  }
  return Array.from(map.entries())
    .map(([campaign, v]) => ({
      campaign,
      visits: v.visits,
      bounceRate: v.visits ? v.bounce / v.visits : 0,
      durationSec: v.visits ? v.dur / v.visits : 0,
      goalLeads: Math.round(v.goals)
    }))
    .sort((a, b) => b.visits - a.visits);
}

export interface ProjectRef {
  projectId: string;
  brand: string;
  line: Line;
  contractor: string;
  site: string;
  counterIds: string[];
}

export interface OverviewPair {
  current?: MetrikaMetricTable | null;
  previous?: MetrikaMetricTable | null;
}

export function hostOfSite(site: string): string {
  try {
    return new URL(site).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Точное совпадение домена. Подстрока в startURL склеила бы borishof-genesis.ru
 * и service.borishof-genesis.ru в одни визиты.
 */
export function metrikaHostFilter(host: string): string {
  const safe = host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "");
  return `ym:s:startURLDomain=='${safe}' OR ym:s:startURLDomain=='www.${safe}'`;
}

export function projectsFromAccounts(accounts: MetrikaAccount[]): ProjectRef[] {
  const map = new Map<string, ProjectRef>();
  const add = (ref: ProjectRef, counterId: string) => {
    const cur = map.get(ref.projectId) || { ...ref, counterIds: [] };
    if (counterId && !cur.counterIds.includes(counterId)) cur.counterIds.push(counterId);
    map.set(ref.projectId, cur);
  };
  for (const acc of accounts) {
    const unscoped = !acc.brand && !acc.line;
    const matches = ACCOUNTS.filter(
      (item) =>
        item.counterIds.includes(acc.counterId) &&
        (unscoped || !acc.brand || item.brand === acc.brand) &&
        (unscoped || !acc.line || item.line === acc.line) &&
        (!acc.contractor || item.contractor === acc.contractor)
    );
    if (matches.length) {
      for (const item of matches) {
        add(
          {
            projectId: item.id,
            brand: item.brand,
            line: item.line,
            contractor: item.contractor,
            site: item.site,
            counterIds: []
          },
          acc.counterId
        );
      }
      continue;
    }
    add(
      {
        projectId: acc.id,
        brand: acc.brand || "",
        line: acc.line || "nc",
        contractor: acc.contractor || "",
        site: "",
        counterIds: []
      },
      acc.counterId
    );
  }
  return Array.from(map.values());
}

export function filteredOverviewKeys(projects: ProjectRef[]): Array<{ key: string; counterId: string; host: string }> {
  const byCounter = new Map<string, ProjectRef[]>();
  for (const project of projects) {
    for (const counterId of project.counterIds) {
      const list = byCounter.get(counterId) || [];
      list.push(project);
      byCounter.set(counterId, list);
    }
  }
  const keys: Array<{ key: string; counterId: string; host: string }> = [];
  for (const [counterId, peers] of byCounter) {
    const hosts = Array.from(new Set(peers.map((project) => hostOfSite(project.site)).filter(Boolean)));
    if (peers.length > 1 && hosts.length > 1) {
      for (const host of hosts) keys.push({ key: `${counterId}|${host}`, counterId, host });
    }
  }
  return keys;
}

export function attributeProjectVisits(projects: ProjectRef[], tables: Map<string, OverviewPair>): ProjectVisit[] {
  const peersOf = (counterId: string) => projects.filter((project) => project.counterIds.includes(counterId));
  return projects.map((project) => {
    let visits = 0;
    let previousVisits = 0;
    let users = 0;
    let bounceWeighted = 0;
    let goalLeads = 0;
    let sharedCounter = false;
    for (const counterId of project.counterIds) {
      const peers = peersOf(counterId);
      const hosts = new Set(peers.map((peer) => hostOfSite(peer.site)).filter(Boolean));
      const host = hostOfSite(project.site);
      const split = peers.length > 1 && hosts.size > 1 && Boolean(host);
      if (peers.length > 1 && !split) sharedCounter = true;
      const pair = split ? tables.get(`${counterId}|${host}`) : tables.get(counterId);
      const current = metricRow(pair?.current);
      const previous = metricRow(pair?.previous);
      const currentVisits = current[0] || 0;
      visits += currentVisits;
      previousVisits += previous[0] || 0;
      users += current[1] || 0;
      bounceWeighted += (current[2] || 0) * currentVisits;
      if (current.length > 5) goalLeads += current.slice(5).reduce((sum, value) => sum + value, 0);
    }
    return {
      projectId: project.projectId,
      brand: project.brand,
      line: project.line,
      contractor: project.contractor,
      site: project.site,
      counterIds: project.counterIds,
      visits,
      previousVisits,
      users,
      bounceRate: visits ? bounceWeighted / visits : 0,
      goalLeads: Math.round(goalLeads),
      sharedCounter
    };
  });
}

async function fetchVisitsOverview(
  token: string,
  counterId: string,
  dates: { date1: string; date2: string },
  host: string
): Promise<MetrikaTable> {
  const params: Record<string, string> = {
    ids: counterId,
    ...dates,
    metrics: "ym:s:visits,ym:s:users,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageDepth"
  };
  if (host) params.filters = metrikaHostFilter(host);
  return metrikaGetRetry(token, params);
}

async function fetchVisitsPairCached(
  token: string,
  counterId: string,
  range: DateRange,
  host: string
): Promise<OverviewPair> {
  const safeHost = host.replace(/[^a-z0-9.-]/gi, "_");
  const file = path.join(cacheDir(), `ov_${counterId}_${safeHost}_${range.from}_${range.to}.json`);
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { savedAt: number; current: MetrikaTable; previous: MetrikaTable };
      if (Date.now() - Number(raw.savedAt || 0) < CACHE_TTL_MS && raw.current && raw.previous) {
        return { current: raw.current, previous: raw.previous };
      }
    }
  } catch {
    /* кэш необязателен */
  }
  const current = await fetchVisitsOverview(token, counterId, { date1: range.from, date2: range.to }, host);
  const previous = await fetchVisitsOverview(
    token,
    counterId,
    { date1: range.previousFrom, date2: range.previousTo },
    host
  );
  try {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), current, previous }), "utf8");
  } catch {
    /* кэш необязателен */
  }
  return { current, previous };
}

export async function fetchMetrikaBehavior(
  accounts: MetrikaAccount[],
  range: DateRange,
  directClicks: number
): Promise<{ snapshot: BehaviorSnapshot; errors: string[]; projects: ProjectVisit[] }> {
  const hydrated = accounts
    .map((a) => ({ ...a, token: resolveMetrikaToken(a.token) }))
    .filter((a) => a.token && a.counterId);
  const projectRefs = projectsFromAccounts(hydrated);
  const live = groupCounters(hydrated);
  if (!live.length) throw new Error("Нет подключенных счётчиков Метрики");

  if (readQuotaBlock()) quotaExceeded = true;
  else quotaExceeded = false;

  const errors: string[] = [];
  let quotaNoted = false;
  const maybeSnapshots = await mapChunk(live, 1, async (acc) => {
    try {
      const snap = await fetchCounterSnapshot(acc, range);
      if (snap.goalError) {
        if (isQuotaError(snap.goalError)) {
          if (!quotaNoted) {
            errors.push("Метрика: суточная квота uid исчерпана, часть счётчиков из кэша или пропущена");
            quotaNoted = true;
          }
        } else {
          errors.push(`${acc.name} (${acc.counterId}): ${snap.goalError}`);
        }
      }
      return { acc, snap };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ошибка";
      if (isQuotaError(msg)) {
        if (!quotaNoted) {
          errors.push("Метрика: суточная квота uid исчерпана, оставшиеся счётчики не запрашиваются");
          quotaNoted = true;
        }
        return null;
      }
      errors.push(`${acc.name} (${acc.counterId}): ${msg}`);
      return null;
    }
  });
  const paired = maybeSnapshots.filter((s): s is NonNullable<typeof s> => Boolean(s));
  const snapshots = paired.map((item) => item.snap);
  if (!snapshots.length) {
    return { snapshot: emptyBehavior(directClicks), errors, projects: [] };
  }

  const sum = snapshots.reduce(
    (acc, s) => {
      acc.visits += s.visits;
      acc.users += s.users;
      acc.previousVisits += s.previousVisits;
      acc.bounceRate += s.bounceRate * s.visits;
      acc.previousBounceRate += s.previousBounceRate * s.previousVisits;
      acc.avgDurationSec += s.avgDurationSec * s.visits;
      acc.previousDurationSec += s.previousDurationSec * s.previousVisits;
      acc.pageDepth += s.pageDepth * s.visits;
      acc.previousPageDepth += s.previousPageDepth * s.previousVisits;
      acc.calls += s.calls;
      acc.previousCalls += s.previousCalls;
      return acc;
    },
    {
      visits: 0,
      users: 0,
      previousVisits: 0,
      bounceRate: 0,
      previousBounceRate: 0,
      avgDurationSec: 0,
      previousDurationSec: 0,
      pageDepth: 0,
      previousPageDepth: 0,
      calls: 0,
      previousCalls: 0
    }
  );

  const pageMap = new Map<
    string,
    { visits: number; bounce: number; dur: number; depth: number; calls: number }
  >();
  for (const s of snapshots) {
    for (const p of s.pages) {
      const cur = pageMap.get(p.path) || { visits: 0, bounce: 0, dur: 0, depth: 0, calls: 0 };
      cur.visits += p.visits;
      cur.bounce += p.bounceRate * p.visits;
      cur.dur += p.avgDurationSec * p.visits;
      cur.depth += p.pageDepth * p.visits;
      cur.calls += p.calls;
      pageMap.set(p.path, cur);
    }
  }

  const sourceMap = new Map<string, { visits: number; bounce: number; dur: number; calls: number }>();
  for (const s of snapshots) {
    for (const src of s.sources) {
      const cur = sourceMap.get(src.source) || { visits: 0, bounce: 0, dur: 0, calls: 0 };
      cur.visits += src.visits;
      cur.bounce += src.bounceRate * src.visits;
      cur.dur += src.durationSec * src.visits;
      cur.calls += src.calls;
      sourceMap.set(src.source, cur);
    }
  }

  const deviceMap = new Map<string, { visits: number; bounce: number; calls: number }>();
  for (const s of snapshots) {
    for (const d of s.devices) {
      const cur = deviceMap.get(d.device) || { visits: 0, bounce: 0, calls: 0 };
      cur.visits += d.visits;
      cur.bounce += d.bounceRate * d.visits;
      cur.calls += d.calls;
      deviceMap.set(d.device, cur);
    }
  }

  const visits = sum.visits || 1;
  const dailyMap = new Map<string, number>();
  for (const s of snapshots) {
    for (const d of s.bytime) {
      if (!d.date) continue;
      dailyMap.set(d.date, (dailyMap.get(d.date) || 0) + d.visits);
    }
  }
  const snapshot: BehaviorSnapshot = {
    visits: sum.visits,
    users: sum.users,
    bounceRate: sum.bounceRate / visits,
    avgDurationSec: sum.avgDurationSec / visits,
    pageDepth: sum.pageDepth / visits,
    previousVisits: sum.previousVisits,
    previousBounceRate: sum.previousVisits ? sum.previousBounceRate / sum.previousVisits : 0,
    previousDurationSec: sum.previousVisits ? sum.previousDurationSec / sum.previousVisits : 0,
    previousPageDepth: sum.previousVisits ? sum.previousPageDepth / sum.previousVisits : 0,
    goalLeads: Math.round(sum.calls),
    previousGoalLeads: Math.round(sum.previousCalls),
    directClicks,
    metrikaDirectVisits: Math.round(
      Array.from(sourceMap.entries())
        .filter(([name]) => /директ|direct|ad|cpc|paid/i.test(name))
        .reduce((s, [, v]) => s + v.visits, 0)
    ),
    funnel: [
      { id: "visit", name: "Визит", value: sum.visits, previous: sum.previousVisits },
      { id: "goal", name: "Лиды Метрики", value: Math.round(sum.calls), previous: Math.round(sum.previousCalls) },
      { id: "quality", name: "Качественный лид", value: 0, previous: 0 }
    ],
    pages: Array.from(pageMap.entries())
      .map(([path, v]) => ({
        path,
        title: path,
        visits: v.visits,
        bounceRate: v.visits ? v.bounce / v.visits : 0,
        avgDurationSec: v.visits ? v.dur / v.visits : 0,
        pageDepth: v.visits ? v.depth / v.visits : 0,
        calls: Math.round(v.calls),
        cr: v.visits ? (v.calls / v.visits) * 100 : 0,
        deviceGap: 0
      }))
      .sort((a, b) => b.visits - a.visits),
    paths: [],
    sources: Array.from(sourceMap.entries())
      .map(([source, v]) => ({
        source,
        visits: v.visits,
        bounceRate: v.visits ? v.bounce / v.visits : 0,
        durationSec: v.visits ? v.dur / v.visits : 0,
        calls: Math.round(v.calls),
        qualityLeads: 0
      }))
      .sort((a, b) => b.visits - a.visits),
    byCampaign: mergeCampaignBehavior(snapshots),
    devices: ["desktop", "mobile", "tablet"].map((device) => {
      const v = deviceMap.get(device) || { visits: 0, bounce: 0, calls: 0 };
      return {
        device: device as "desktop" | "mobile" | "tablet",
        visits: v.visits,
        bounceRate: v.visits ? v.bounce / v.visits : 0,
        cr: v.visits ? (v.calls / v.visits) * 100 : 0,
        calls: Math.round(v.calls)
      };
    }),
    dailyVisits: Array.from(dailyMap.entries()).map(([date, dayVisits]) => ({ date, visits: dayVisits }))
  };

  const tables = new Map<string, OverviewPair>();
  for (const item of paired) {
    tables.set(item.acc.counterId, {
      current: {
        totals: [
          item.snap.visits,
          item.snap.users,
          item.snap.bounceRate,
          item.snap.avgDurationSec,
          item.snap.pageDepth,
          item.snap.calls
        ]
      },
      previous: {
        totals: [
          item.snap.previousVisits,
          0,
          item.snap.previousBounceRate,
          item.snap.previousDurationSec,
          item.snap.previousPageDepth,
          item.snap.previousCalls
        ]
      }
    });
  }
  if (!quotaExceeded) {
    const byCounter = new Map(live.map((acc) => [acc.counterId, acc]));
    for (const extra of filteredOverviewKeys(projectRefs)) {
      const acc = byCounter.get(extra.counterId);
      if (!acc) continue;
      try {
        const pair = await fetchVisitsPairCached(acc.token, extra.counterId, range, extra.host);
        tables.set(extra.key, pair);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ошибка";
        if (isQuotaError(msg)) {
          quotaExceeded = true;
          if (!errors.some((line) => line.includes("квота"))) {
            errors.push("Метрика: суточная квота uid исчерпана, визиты общих счётчиков не разрезаны по сайтам");
          }
          break;
        }
        errors.push(`${extra.host} (${extra.counterId}): визиты по сайту не отделились — ${msg}`);
      }
    }
  }
  return { snapshot, errors, projects: attributeProjectVisits(projectRefs, tables) };
}

export function emptyByDates(range: DateRange): string[] {
  return eachDate(range.from, range.to);
}
