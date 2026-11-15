import { mapChunk } from "../async";
import { resolveDirectToken } from "../config";
import { HTTP_TIMEOUT, apiTimeout } from "../http";
import type { CampaignRow, DateRange, DirectAccount } from "../types";

function withDirectToken(account: DirectAccount): DirectAccount {
  return { ...account, token: resolveDirectToken(account) };
}

const REPORTS = "https://api.direct.yandex.com/json/v5/reports";

export interface DirectDailyRow {
  date: string;
  spend: number;
  clicks: number;
  totalLeads: number;
}

export function parseNum(value: string | undefined): number {
  if (value == null || value === "" || value === "--" || value === "-") return 0;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Кампания, которая была в прошлом периоде и исчезла из текущего отчёта,
 * всё равно нужна: иначе «ноль показов» не отличить от «отчёт её не вернул».
 */
export function pairCampaignReports(
  current: Array<Record<string, string>>,
  previous: Array<Record<string, string>>
): Array<{ current: Record<string, string>; previous?: Record<string, string> }> {
  const prevMap = new Map(previous.filter((row) => row.CampaignId).map((row) => [row.CampaignId, row]));
  const seen = new Set<string>();
  const pairs = current.map((row) => {
    if (row.CampaignId) seen.add(row.CampaignId);
    return { current: row, previous: row.CampaignId ? prevMap.get(row.CampaignId) : undefined };
  });
  for (const prev of previous) {
    if (!prev.CampaignId || seen.has(prev.CampaignId)) continue;
    pairs.push({
      current: {
        CampaignId: prev.CampaignId,
        CampaignName: prev.CampaignName || "",
        Impressions: "0",
        Clicks: "0",
        Cost: "0"
      },
      previous: prev
    });
  }
  return pairs;
}

export function parseTsv(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("Total") && !l.startsWith("Итого"));
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

/** Директ отдаёт ошибки JSON-ом и в теле отчёта, и в теле обычного ответа. */
export function describeDirectError(account: DirectAccount, status: number, body: string): string {
  let code = 0;
  let title = "";
  let detail = "";
  try {
    const err = (JSON.parse(body) as { error?: { error_code?: number; error_string?: string; error_detail?: string } }).error;
    code = Number(err?.error_code) || 0;
    title = err?.error_string || "";
    detail = err?.error_detail || "";
  } catch {
    detail = body.replace(/\s+/g, " ").slice(0, 160);
  }

  // Проблема уровня токена: одинакова для всех кабинетов подрядчика, логин в тексте не нужен.
  if (code === 3228) {
    return `${account.clientLogin} (${account.brand}): метод недоступен без режима «Директ Про»`;
  }
  if (code === 58) {
    return `${account.contractor}: токен принят, но у приложения OAuth не подтверждён доступ к API Директа — в кабинете Директа нужно заполнить заявку и дождаться одобрения`;
  }
  if (code === 53 || status === 401) {
    return `${account.contractor}: токен недействителен или отозван`;
  }
  if (code === 8800) {
    return `${account.clientLogin} (${account.brand}): логин не найден под токеном ${account.contractor}`;
  }
  if (code === 54) {
    return `${account.clientLogin} (${account.brand}): нет прав на кабинет под токеном ${account.contractor}`;
  }
  if (code === 152) return `${account.clientLogin} (${account.brand}): на кабинете нет средств`;
  const tail = [title, detail].filter(Boolean).join(" — ") || `HTTP ${status}`;
  return `${account.clientLogin} (${account.brand}): ${tail}`;
}

function reportDate(value: string | undefined): string {
  const raw = (value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dotted = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  return raw.slice(0, 10);
}

export function uniqueCallConversions(row: Record<string, string>, goalId?: string): number {
  if (!goalId) return 0;
  const prefix = `Conversions_${goalId}`;
  const keyed = Object.entries(row).filter(([key]) => key === prefix || key.startsWith(`${prefix}_`));
  if (keyed.length) {
    return keyed.reduce((sum, [, value]) => sum + parseNum(value), 0);
  }
  return parseNum(row.Conversions);
}

async function postReport(account: DirectAccount, params: Record<string, unknown>): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.token}`,
    "Accept-Language": "ru",
    processingMode: "online",
    returnMoneyInMicros: "false",
    skipReportHeader: "true",
    skipReportSummary: "true",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (account.clientLogin) headers["Client-Login"] = account.clientLogin;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(REPORTS, {
      method: "POST",
      headers,
      body: JSON.stringify({ params }),
      cache: "no-store",
      signal: apiTimeout(HTTP_TIMEOUT.directReportMs)
    });
    if (res.status === 200) return res.text();
    if (res.status === 201 || res.status === 202) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    throw new Error(describeDirectError(account, res.status, await res.text()));
  }
  throw new Error(`Директ ${account.name}: отчёт не готов`);
}

async function fetchCampaignReport(account: DirectAccount, from: string, to: string, name: string): Promise<string> {
  const fieldNames = ["CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "Ctr", "AvgCpc"];
  if (account.goalCallId) fieldNames.push("Conversions");
  const params: Record<string, unknown> = {
    SelectionCriteria: { DateFrom: from, DateTo: to },
    FieldNames: fieldNames,
    ReportName: name,
    ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
    DateRangeType: "CUSTOM_DATE",
    Format: "TSV",
    IncludeVAT: "YES",
    IncludeDiscount: "NO"
  };
  if (account.goalCallId) {
    params.Goals = [account.goalCallId];
    params.AttributionModels = ["LC"];
  }
  return postReport(account, params);
}

function rowsToDaily(rows: Array<Record<string, string>>, goalId?: string): DirectDailyRow[] {
  const byDate = new Map<string, DirectDailyRow>();
  for (const row of rows) {
    const date = reportDate(row.Date);
    if (!date) continue;
    const cur = byDate.get(date) || { date, spend: 0, clicks: 0, totalLeads: 0 };
    cur.spend += parseNum(row.Cost);
    cur.clicks += parseNum(row.Clicks);
    cur.totalLeads += uniqueCallConversions(row, goalId);
    byDate.set(date, cur);
  }
  return Array.from(byDate.values());
}

async function fetchDailyRaw(
  account: DirectAccount,
  from: string,
  to: string,
  reportType: "ACCOUNT_PERFORMANCE_REPORT" | "CAMPAIGN_PERFORMANCE_REPORT",
  withGoals: boolean
): Promise<string> {
  const fieldNames = reportType === "CAMPAIGN_PERFORMANCE_REPORT" ? ["Date", "CampaignId", "Cost", "Clicks"] : ["Date", "Cost", "Clicks"];
  if (withGoals && account.goalCallId) fieldNames.push("Conversions");
  const params: Record<string, unknown> = {
    SelectionCriteria: { DateFrom: from, DateTo: to },
    FieldNames: fieldNames,
    ReportName: `bh-day-${reportType === "CAMPAIGN_PERFORMANCE_REPORT" ? "c" : "a"}-${account.id}-${from}-${to}`,
    ReportType: reportType,
    DateRangeType: "CUSTOM_DATE",
    Format: "TSV",
    IncludeVAT: "YES",
    IncludeDiscount: "NO"
  };
  if (withGoals && account.goalCallId) {
    params.Goals = [account.goalCallId];
    params.AttributionModels = ["LC"];
  }
  return postReport(account, params);
}

async function fetchDailyReport(account: DirectAccount, from: string, to: string): Promise<DirectDailyRow[]> {
  const withGoal = Boolean(account.goalCallId);
  try {
    return rowsToDaily(parseTsv(await fetchDailyRaw(account, from, to, "ACCOUNT_PERFORMANCE_REPORT", withGoal)), account.goalCallId);
  } catch {
    try {
      if (withGoal) {
        return rowsToDaily(parseTsv(await fetchDailyRaw(account, from, to, "ACCOUNT_PERFORMANCE_REPORT", false)));
      }
    } catch {
      /* campaign-level fallback below */
    }
    try {
      return rowsToDaily(
        parseTsv(await fetchDailyRaw(account, from, to, "CAMPAIGN_PERFORMANCE_REPORT", withGoal)),
        account.goalCallId
      );
    } catch {
      if (!withGoal) return [];
      return rowsToDaily(parseTsv(await fetchDailyRaw(account, from, to, "CAMPAIGN_PERFORMANCE_REPORT", false)));
    }
  }
}

function guessType(name: string): CampaignRow["type"] {
  const n = name.toLowerCase();
  if (/рся|rsy|networks|смарт-баннер|смарт баннер/.test(n)) return "rsya";
  if (/ретарг|remarket|retarget/.test(n)) return "retargeting";
  if (/конкурент|compet/.test(n)) return "search_competitor";
  if (/бренд|brand/.test(n)) return "search_brand";
  return "search_model";
}

export async function fetchDirectCampaigns(
  accounts: DirectAccount[],
  range: DateRange
): Promise<{ rows: CampaignRow[]; daily: DirectDailyRow[]; errors: string[] }> {
  const live = accounts.map(withDirectToken).filter((a) => a.token);
  if (!live.length) throw new Error("Нет токенов Директа");

  const errors: string[] = [];
  const blockers = await directTokenBlockers(live);
  for (const message of blockers.values()) errors.push(message);

  const usable = live.filter((a) => !blockers.has(a.contractor));
  const parts = await mapChunk(usable, 5, async (acc) => {
    try {
      return await fetchAccountBundle(acc, range);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `${acc.clientLogin}: ошибка`);
      return { rows: [] as CampaignRow[], daily: [] as DirectDailyRow[] };
    }
  });
  return {
    rows: parts.flatMap((p) => p.rows),
    daily: parts.flatMap((p) => p.daily),
    errors: Array.from(new Set(errors))
  };
}

/**
 * Один запрос на подрядчика: 53/58/401 закрывают все кабинеты.
 * 3228 на clients.get без Client-Login — это не Директ Про у самого представителя,
 * отчёты по porg-* при этом часто работают, поэтому подрядчика не блокируем.
 */
export async function directTokenBlockers(accounts: DirectAccount[]): Promise<Map<string, string>> {
  const samples = new Map<string, DirectAccount>();
  for (const acc of accounts) {
    const hydrated = withDirectToken(acc);
    if (!samples.has(hydrated.contractor)) samples.set(hydrated.contractor, hydrated);
  }

  const blockers = new Map<string, string>();
  await Promise.all(
    Array.from(samples.entries()).map(async ([contractor, acc]) => {
      const problem = await tokenProblem(acc);
      if (problem) blockers.set(contractor, problem);
    })
  );
  return blockers;
}

const TOKEN_FATAL_CODES = new Set([53, 58]);

async function tokenProblem(account: DirectAccount): Promise<string> {
  try {
    const res = await fetch("https://api.direct.yandex.com/json/v5/clients", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.token}`,
        "Accept-Language": "ru",
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ method: "get", params: { FieldNames: ["Login"] } }),
      cache: "no-store",
      signal: apiTimeout(HTTP_TIMEOUT.directClientsMs)
    });
    const text = await res.text();
    const code = Number(
      (JSON.parse(text) as { error?: { error_code?: number } }).error?.error_code
    );
    if (res.status === 401 || TOKEN_FATAL_CODES.has(code)) return describeDirectError(account, res.status, text);
    return "";
  } catch {
    // Сеть моргнула или ответ не JSON — пусть решают обычные запросы за кабинетами.
    return "";
  }
}

async function fetchAccountBundle(acc: DirectAccount, range: DateRange) {
  try {
    return await fetchAccountBundleOnce(acc, range);
  } catch (e) {
    if (!acc.goalCallId) throw e;
    return fetchAccountBundleOnce({ ...acc, goalCallId: undefined }, range);
  }
}

async function fetchAccountBundleOnce(acc: DirectAccount, range: DateRange) {
  const [currentRaw, previousRaw, daily] = await Promise.all([
    fetchCampaignReport(acc, range.from, range.to, `bh-cur-${acc.id}-${range.from}`),
    fetchCampaignReport(acc, range.previousFrom, range.previousTo, `bh-prev-${acc.id}-${range.from}`),
    fetchDailyReport(acc, range.from, range.to)
  ]);
  const current = parseTsv(currentRaw);
  const previous = parseTsv(previousRaw);
  const pairs = pairCampaignReports(current, previous);
  const rows = pairs.map(({ current: r, previous: prev }) => {
    const totalLeads = uniqueCallConversions(r, acc.goalCallId);
    const previousTotalLeads = uniqueCallConversions(prev || {}, acc.goalCallId);
    return {
      id: `${acc.id}-${r.CampaignId}`,
      directId: String(r.CampaignId || ""),
      name: r.CampaignName || `Кампания ${r.CampaignId}`,
      contractor: acc.contractor || acc.name,
      brand: acc.brand || acc.name,
      line: acc.line || "nc",
      type: guessType(r.CampaignName || ""),
      login: acc.clientLogin || acc.name,
      current: {
        impressions: parseNum(r.Impressions),
        clicks: parseNum(r.Clicks),
        cost: parseNum(r.Cost),
        conversions: totalLeads
      },
      previous: {
        impressions: parseNum(prev?.Impressions),
        clicks: parseNum(prev?.Clicks),
        cost: parseNum(prev?.Cost),
        conversions: previousTotalLeads
      },
      totalLeads,
      previousTotalLeads,
      qualityLeads: 0,
      previousQualityLeads: 0,
      calls: 0,
      previousCalls: 0,
      formLeads: 0,
      previousFormLeads: 0
    } satisfies CampaignRow;
  });
  return { rows, daily };
}
