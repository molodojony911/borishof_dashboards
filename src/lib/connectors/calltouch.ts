import dns from "dns";
import fs from "fs";
import path from "path";
import { classifyCalltouchTags } from "../calltouch-catalog";
import { SHORT_CALL_MAX_SEC } from "../benchmarks";
import { resolveCalltouchToken } from "../config";
import { mapChunk } from "../async";
import { eachDate } from "../period";
import { HTTP_TIMEOUT, apiTimeout } from "../http";
import { dataPath } from "../paths";
import type { CalltouchAccount, DateRange, LeadRow } from "../types";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* Node < 17 */
}

const PAGE_SIZE = 200;
const MAX_PAGES = 30;
const ATTEMPTS = 3;
/**
 * Общий бюджет на все кабинеты. Без него один неотвечающий сайт с ретраями и
 * поденным фолбэком держит весь запрос холдинга в подвешенном состоянии.
 */
const STAGE_BUDGET_MS = 270_000;

function cacheDir(): string {
  return dataPath("cache", "calltouch");
}
/**
 * Периоды заканчиваются вчерашним днём, журнал звонков за них уже не меняется.
 * Держим кэш долго: за один заход в бюджет влезает не весь холдинг, и короткий TTL
 * стирал покрытие раньше, чем оно успевало набраться за несколько открытий дашборда.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function toCalltouchDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CalltouchCall {
  callId?: string | number;
  date?: string;
  duration?: number;
  uniqueCall?: boolean;
  uniqTargetCall?: boolean;
  source?: string;
  medium?: string;
  utmCampaign?: string;
  url?: string;
  tags?: string[] | Array<{ tag?: string; name?: string }>;
  callTags?: Array<{ category?: string; names?: string[] | string; name?: string; tag?: string }>;
  additionalTags?: string[] | Array<{ name?: string; tag?: string }>;
}

interface PagedCalls {
  page?: number;
  pageTotal?: number;
  pageSize?: number;
  recordsTotal?: number;
  records?: CalltouchCall[];
  data?: CalltouchCall[];
}

function normalizeTags(call: CalltouchCall): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => out.push(t));
  };
  const fromRaw = (raw: unknown) => {
    if (!raw) return;
    if (typeof raw === "string") {
      push(raw);
      return;
    }
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") push(item);
        else if (item && typeof item === "object") {
          const rec = item as { tag?: string; name?: string; names?: string[] | string; category?: string };
          if (Array.isArray(rec.names)) rec.names.forEach((n) => push(String(n)));
          else if (typeof rec.names === "string") push(rec.names);
          if (rec.tag) push(rec.tag);
          if (rec.name) push(rec.name);
        }
      }
    }
  };
  fromRaw(call.tags);
  fromRaw(call.callTags);
  fromRaw(call.additionalTags);
  return Array.from(new Set(out));
}

function parsePage(json: unknown): { records: CalltouchCall[]; pageTotal: number } {
  if (Array.isArray(json)) return { records: json as CalltouchCall[], pageTotal: 1 };
  if (json && typeof json === "object") {
    const obj = json as PagedCalls;
    const records = obj.records || obj.data || [];
    const pageTotal = Number(obj.pageTotal || 1);
    return { records, pageTotal: Number.isFinite(pageTotal) && pageTotal > 0 ? pageTotal : 1 };
  }
  return { records: [], pageTotal: 1 };
}

function isRetryable(message: string): boolean {
  return /timeout|aborted|429|502|503|504|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(message);
}

function buildUrl(siteId: string, token: string, from: string, to: string, page: number): URL {
  const url = new URL(`https://api.calltouch.ru/calls-service/RestAPI/${siteId}/calls-diary/calls`);
  url.searchParams.set("clientApiId", token);
  url.searchParams.set("dateFrom", toCalltouchDate(from));
  url.searchParams.set("dateTo", toCalltouchDate(to));
  url.searchParams.set("withCallTags", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  return url;
}

async function calltouchGet(url: URL): Promise<unknown> {
  let last: Error = new Error("Calltouch");
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: apiTimeout(HTTP_TIMEOUT.calltouchMs)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${text.slice(0, 280)}`);
      }
      return await res.json();
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
      if (!isRetryable(last.message) || attempt === ATTEMPTS - 1) throw last;
      await sleep(400 * (attempt + 1));
    }
  }
  throw last;
}

/** utm_campaign у подрядчиков приходит как «имя_кампании|12345» либо просто именем. */
function splitCampaign(raw: string): { name: string; id: string } {
  const value = (raw || "").trim();
  if (!value) return { name: "", id: "" };
  const parts = value.split("|");
  const tail = parts[parts.length - 1].trim();
  if (parts.length > 1 && /^\d+$/.test(tail)) {
    return { name: parts.slice(0, -1).join("|").trim(), id: tail };
  }
  if (/^\d+$/.test(value)) return { name: "", id: value };
  return { name: value, id: "" };
}

function toLeadRows(acc: CalltouchAccount, from: string, calls: CalltouchCall[]): LeadRow[] {
  return calls.map((c, i) => {
    const tags = normalizeTags(c);
    const classified = classifyCalltouchTags(tags);
    const campaign = splitCampaign(c.utmCampaign || "");
    const durationSec = Number(c.duration || 0);
    return {
      id: String(c.callId ?? `${acc.siteId}-${from}-${i}`),
      kind: "call" as const,
      site: acc.url || acc.name,
      datetime: c.date || `${from}T12:00:00`,
      source: c.source || "",
      medium: c.medium || "",
      campaign: campaign.name,
      campaignId: campaign.id,
      landing: c.url || "",
      durationSec,
      unique: Boolean(c.uniqueCall),
      shortCall: durationSec > 0 && durationSec < SHORT_CALL_MAX_SEC,
      tags,
      quality: classified.quality,
      brand: acc.brand || acc.name,
      // Теги точнее адреса кабинета: на sales-домене живут и сервисные звонки тоже.
      line: classified.line || acc.line || null,
      contractor: acc.contractor || ""
    };
  });
}

async function fetchRangePaged(acc: CalltouchAccount, token: string, from: string, to: string): Promise<CalltouchCall[]> {
  const all: CalltouchCall[] = [];
  let pageTotal = 1;
  for (let page = 1; page <= Math.min(pageTotal, MAX_PAGES); page += 1) {
    const parsed = parsePage(await calltouchGet(buildUrl(acc.siteId, token, from, to, page)));
    all.push(...parsed.records);
    pageTotal = Math.max(parsed.pageTotal, page);
    if (parsed.records.length < PAGE_SIZE) break;
  }
  return all;
}

interface CalltouchOrder {
  id?: string | number;
  requestNumber?: string | number;
  date?: string;
  source?: string;
  medium?: string;
  utmCampaign?: string;
  url?: string;
  unique?: boolean;
  subject?: string;
  tags?: string[] | Array<{ tag?: string; name?: string }>;
  orderTags?: Array<{ names?: string[] | string; name?: string; tag?: string }>;
}

/** Заявки с форм живут в отдельном журнале Calltouch и в лидах раньше не учитывались. */
function buildOrdersUrl(siteId: string, token: string, from: string, to: string, page: number): URL {
  const url = new URL(`https://api.calltouch.ru/calls-service/RestAPI/${siteId}/orders-diary/orders`);
  url.searchParams.set("clientApiId", token);
  url.searchParams.set("dateFrom", toCalltouchDate(from));
  url.searchParams.set("dateTo", toCalltouchDate(to));
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  return url;
}

function ordersToLeadRows(acc: CalltouchAccount, from: string, orders: CalltouchOrder[]): LeadRow[] {
  return orders.map((o, i) => {
    const tags = normalizeTags({ tags: o.tags, callTags: o.orderTags });
    const classified = classifyCalltouchTags(tags);
    const campaign = splitCampaign(o.utmCampaign || "");
    return {
      id: String(o.id ?? o.requestNumber ?? `${acc.siteId}-form-${from}-${i}`),
      kind: "form" as const,
      site: acc.url || acc.name,
      datetime: o.date || `${from}T12:00:00`,
      source: o.source || "",
      medium: o.medium || "",
      campaign: campaign.name,
      campaignId: campaign.id,
      landing: o.url || "",
      durationSec: 0,
      unique: o.unique !== false,
      shortCall: false,
      tags,
      // Заявку оставил человек с телефоном, поэтому тег качества здесь не обязателен.
      quality: tags.length ? classified.quality : true,
      brand: acc.brand || acc.name,
      line: classified.line || acc.line || null,
      contractor: acc.contractor || ""
    };
  });
}

/** Правила качества меняются чаще, чем выгрузки, поэтому кэш переклассифицируем при чтении. */
function reclassify(acc: CalltouchAccount, row: LeadRow): LeadRow {
  const tags = row.tags || [];
  const classified = classifyCalltouchTags(tags);
  return {
    ...row,
    quality: row.kind === "form" && !tags.length ? true : classified.quality,
    line: classified.line || acc.line || null,
    brand: acc.brand || row.brand,
    contractor: acc.contractor || row.contractor
  };
}

async function fetchSiteForms(acc: CalltouchAccount, from: string, to: string): Promise<LeadRow[]> {
  const cached = readCallsCache(`forms-${acc.siteId}`, from, to);
  if (cached) return cached.map((row) => reclassify(acc, row));
  const token = resolveCalltouchToken(acc);
  if (!token) return [];
  const all: CalltouchOrder[] = [];
  let pageTotal = 1;
  for (let page = 1; page <= Math.min(pageTotal, MAX_PAGES); page += 1) {
    const parsed = parsePage(await calltouchGet(buildOrdersUrl(acc.siteId, token, from, to, page)));
    all.push(...(parsed.records as CalltouchOrder[]));
    pageTotal = Math.max(parsed.pageTotal, page);
    if (parsed.records.length < PAGE_SIZE) break;
  }
  const rows = ordersToLeadRows(acc, from, all);
  writeCallsCache(`forms-${acc.siteId}`, from, to, rows);
  return rows;
}

async function fetchRangeByDay(acc: CalltouchAccount, token: string, from: string, to: string): Promise<CalltouchCall[]> {
  const days = eachDate(from, to);
  const parts = await mapChunk(days, 3, (day) => fetchRangePaged(acc, token, day, day));
  return parts.flat();
}

function cacheFile(siteId: string, from: string, to: string): string {
  return path.join(cacheDir(), `v2_${siteId}_${from}_${to}.json`);
}

function readCallsCache(siteId: string, from: string, to: string): LeadRow[] | null {
  try {
    const file = cacheFile(siteId, from, to);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { savedAt: number; rows: LeadRow[] };
    if (Date.now() - raw.savedAt > CACHE_TTL_MS) return null;
    return raw.rows;
  } catch {
    return null;
  }
}

function writeCallsCache(siteId: string, from: string, to: string, rows: LeadRow[]): void {
  try {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile(siteId, from, to), JSON.stringify({ savedAt: Date.now(), rows }), "utf8");
  } catch {
    /* optional */
  }
}

async function fetchSiteCalls(acc: CalltouchAccount, from: string, to: string): Promise<LeadRow[]> {
  const cached = readCallsCache(acc.siteId, from, to);
  if (cached) return cached.map((row) => reclassify(acc, row));
  const token = resolveCalltouchToken(acc);
  if (!token) return [];
  try {
    const rows = toLeadRows(acc, from, await fetchRangePaged(acc, token, from, to));
    writeCallsCache(acc.siteId, from, to, rows);
    return rows;
  } catch (e) {
    try {
      const rows = toLeadRows(acc, from, await fetchRangeByDay(acc, token, from, to));
      writeCallsCache(acc.siteId, from, to, rows);
      return rows;
    } catch {
      throw e;
    }
  }
}

function withDeadline<T>(job: Promise<T>, ms: number, name: string): Promise<T> {
  return Promise.race([
    job,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${name}: не ответил за ${Math.round(ms / 1000)} с`)), ms)
    )
  ]);
}

export async function fetchCalltouchLeads(
  accounts: CalltouchAccount[],
  range: DateRange
): Promise<{ current: LeadRow[]; previous: LeadRow[]; errors: string[] }> {
  const live = accounts.filter((a) => a.siteId && resolveCalltouchToken(a));
  if (!live.length) throw new Error("Нет кабинетов Calltouch с токеном");

  const errors: string[] = [];
  const deadline = Date.now() + STAGE_BUDGET_MS;
  const packs = await mapChunk(live, 2, async (acc) => {
    const left = deadline - Date.now();
    if (left <= 0) {
      errors.push(`${acc.name}: пропущен, кончился бюджет времени`);
      return { current: [] as LeadRow[], previous: [] as LeadRow[] };
    }
    try {
      // Заявки идут в том же заходе, что и звонки, и не должны их ронять:
      // журнал форм подключён не у всех кабинетов.
      const [current, previous, formsNow, formsPrev] = await withDeadline(
        Promise.all([
          fetchSiteCalls(acc, range.from, range.to),
          fetchSiteCalls(acc, range.previousFrom, range.previousTo),
          fetchSiteForms(acc, range.from, range.to).catch((e) => {
            errors.push(`${acc.name}, заявки: ${e instanceof Error ? e.message : "ошибка"}`);
            return [] as LeadRow[];
          }),
          fetchSiteForms(acc, range.previousFrom, range.previousTo).catch(() => [] as LeadRow[])
        ]),
        left,
        acc.name
      );
      return { current: [...current, ...formsNow], previous: [...previous, ...formsPrev] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ошибка";
      errors.push(`${acc.name}: ${msg}`);
      return { current: [] as LeadRow[], previous: [] as LeadRow[] };
    }
  });

  return {
    current: packs.flatMap((p) => p.current),
    previous: packs.flatMap((p) => p.previous),
    errors
  };
}
