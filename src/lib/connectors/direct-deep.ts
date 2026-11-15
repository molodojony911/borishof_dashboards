import { mapChunk } from "../async";
import { resolveDirectToken } from "../config";
import { HTTP_TIMEOUT, apiTimeout } from "../http";
import type { DateRange, DirectAccount } from "../types";
import { describeDirectError, parseNum, parseTsv, uniqueCallConversions } from "./direct";

function liveAccounts(accounts: DirectAccount[]): DirectAccount[] {
  return accounts.map((acc) => ({ ...acc, token: resolveDirectToken(acc) })).filter((acc) => acc.token);
}

const REPORTS = "https://api.direct.yandex.com/json/v5/reports";
const API = "https://api.direct.yandex.com/json/v5";

export interface QueryRow {
  query: string;
  campaign: string;
  campaignId: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

export interface PlacementRow {
  placement: string;
  campaign: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

export interface SliceRow {
  key: string;
  label: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

export interface AdRow {
  adId: string;
  campaign: string;
  campaignId: string;
  /** Нет в старых кэшах: тогда объявление сравнивается с кампанией, не с группой. */
  adGroupId?: string;
  adGroupName?: string;
  brand?: string;
  line?: string;
  contractor?: string;
  /** Качественные лиды Calltouch кампании, разложенные по объявлениям. */
  qualityLeads?: number;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  title: string;
  title2: string;
  text: string;
  sitelinks: number;
  callouts: number;
}

/**
 * Тяжёлые отчёты берём в режиме auto: Директ может поставить их в очередь,
 * тогда 201/202 приходит вместо данных и запрос нужно повторить.
 */
async function postReport(account: DirectAccount, params: Record<string, unknown>): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.token}`,
    "Accept-Language": "ru",
    processingMode: "auto",
    returnMoneyInMicros: "false",
    skipReportHeader: "true",
    skipReportSummary: "true",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (account.clientLogin) headers["Client-Login"] = account.clientLogin;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(REPORTS, {
      method: "POST",
      headers,
      body: JSON.stringify({ params }),
      cache: "no-store",
      signal: apiTimeout(HTTP_TIMEOUT.directDeepReportMs)
    });
    if (res.status === 200) return res.text();
    if (res.status === 201 || res.status === 202) {
      const wait = Number(res.headers.get("retryIn") || 3) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 2000), 12000)));
      continue;
    }
    throw new Error(describeDirectError(account, res.status, await res.text()));
  }
  throw new Error(`${account.clientLogin} (${account.brand}): отчёт не готов`);
}

async function apiPost<T>(account: DirectAccount, service: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.token}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (account.clientLogin) headers["Client-Login"] = account.clientLogin;
  const res = await fetch(`${API}/${service}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: apiTimeout(HTTP_TIMEOUT.directDeepApiMs)
  });
  const text = await res.text();
  const json = JSON.parse(text) as { result?: T; error?: unknown };
  if (json.error) throw new Error(describeDirectError(account, res.status, text));
  return (json.result || {}) as T;
}

function reportParams(
  account: DirectAccount,
  range: DateRange,
  reportType: string,
  fieldNames: string[],
  name: string,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const fields = [...fieldNames];
  if (account.goalCallId) fields.push("Conversions");
  const params: Record<string, unknown> = {
    SelectionCriteria: {
      DateFrom: range.from,
      DateTo: range.to,
      Filter: [{ Field: "Impressions", Operator: "GREATER_THAN", Values: ["0"] }]
    },
    FieldNames: fields,
    ReportName: `${name}-${account.id}-${range.from}-${range.to}`,
    ReportType: reportType,
    DateRangeType: "CUSTOM_DATE",
    Format: "TSV",
    IncludeVAT: "YES",
    IncludeDiscount: "NO",
    ...extra
  };
  if (account.goalCallId) {
    params.Goals = [account.goalCallId];
    params.AttributionModels = ["LC"];
  }
  return params;
}

/** Отчёт может упасть из-за цели: если так, повторяем без Goals, чтобы не потерять весь срез. */
async function reportWithGoalFallback(
  account: DirectAccount,
  range: DateRange,
  reportType: string,
  fieldNames: string[],
  name: string,
  extra?: Record<string, unknown>
): Promise<Array<Record<string, string>>> {
  try {
    return parseTsv(await postReport(account, reportParams(account, range, reportType, fieldNames, name, extra)));
  } catch (e) {
    if (!account.goalCallId) throw e;
    const bare = { ...account, goalCallId: undefined };
    return parseTsv(await postReport(bare, reportParams(bare, range, reportType, fieldNames, name, extra)));
  }
}

export async function fetchSearchQueries(
  accounts: DirectAccount[],
  range: DateRange
): Promise<{ rows: QueryRow[]; errors: string[] }> {
  const errors: string[] = [];
  const parts = await mapChunk(liveAccounts(accounts), 3, async (acc) => {
    try {
      const raw = await reportWithGoalFallback(
        acc,
        range,
        "SEARCH_QUERY_PERFORMANCE_REPORT",
        ["Query", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost"],
        "bh-queries"
      );
      return raw.map((r) => ({
        query: (r.Query || "").trim(),
        campaign: r.CampaignName || "",
        campaignId: String(r.CampaignId || ""),
        impressions: parseNum(r.Impressions),
        clicks: parseNum(r.Clicks),
        cost: parseNum(r.Cost),
        conversions: uniqueCallConversions(r, acc.goalCallId)
      }));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "ошибка запросов");
      return [] as QueryRow[];
    }
  });
  return { rows: parts.flat().filter((r) => r.query), errors };
}

export async function fetchPlacements(
  accounts: DirectAccount[],
  range: DateRange
): Promise<{ rows: PlacementRow[]; errors: string[] }> {
  const errors: string[] = [];
  const parts = await mapChunk(liveAccounts(accounts), 3, async (acc) => {
    try {
      const raw = await reportWithGoalFallback(
        acc,
        range,
        "CUSTOM_REPORT",
        ["Placement", "CampaignName", "Impressions", "Clicks", "Cost"],
        "bh-placements",
        {
          SelectionCriteria: {
            DateFrom: range.from,
            DateTo: range.to,
            Filter: [
              { Field: "AdNetworkType", Operator: "EQUALS", Values: ["AD_NETWORK"] },
              { Field: "Impressions", Operator: "GREATER_THAN", Values: ["0"] }
            ]
          }
        }
      );
      return raw.map((r) => ({
        placement: (r.Placement || "").trim(),
        campaign: r.CampaignName || "",
        impressions: parseNum(r.Impressions),
        clicks: parseNum(r.Clicks),
        cost: parseNum(r.Cost),
        conversions: uniqueCallConversions(r, acc.goalCallId)
      }));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "ошибка площадок");
      return [] as PlacementRow[];
    }
  });
  return { rows: parts.flat().filter((r) => r.placement), errors };
}

const AGE_LABEL: Record<string, string> = {
  AGE_0_17: "0–17",
  AGE_18_24: "18–24",
  AGE_25_34: "25–34",
  AGE_35_44: "35–44",
  AGE_45_54: "45–54",
  AGE_55: "55+",
  UNKNOWN: "не определён"
};

const GENDER_LABEL: Record<string, string> = {
  GENDER_MALE: "мужчины",
  GENDER_FEMALE: "женщины",
  UNKNOWN: "не определён"
};

const DEVICE_LABEL: Record<string, string> = {
  DESKTOP: "десктоп",
  MOBILE: "смартфоны",
  TABLET: "планшеты"
};

export interface AudiencePack {
  age: SliceRow[];
  gender: SliceRow[];
  device: SliceRow[];
  geo: SliceRow[];
}

export async function fetchAudienceSlices(
  accounts: DirectAccount[],
  range: DateRange
): Promise<{ pack: AudiencePack; errors: string[] }> {
  const errors: string[] = [];
  const empty: AudiencePack = { age: [], gender: [], device: [], geo: [] };

  const slice = async (
    acc: DirectAccount,
    field: string,
    name: string,
    labels?: Record<string, string>
  ): Promise<SliceRow[]> => {
    const raw = await reportWithGoalFallback(
      acc,
      range,
      "CUSTOM_REPORT",
      [field, "Impressions", "Clicks", "Cost"],
      name
    );
    return raw.map((r) => {
      const key = (r[field] || "UNKNOWN").trim();
      return {
        key,
        label: labels?.[key] || key,
        impressions: parseNum(r.Impressions),
        clicks: parseNum(r.Clicks),
        cost: parseNum(r.Cost),
        conversions: uniqueCallConversions(r, acc.goalCallId)
      };
    });
  };

  const parts = await mapChunk(liveAccounts(accounts), 2, async (acc) => {
    const pack: AudiencePack = { age: [], gender: [], device: [], geo: [] };
    const jobs: Array<Promise<void>> = [
      slice(acc, "Age", "bh-age", AGE_LABEL).then((r) => void (pack.age = r)),
      slice(acc, "Gender", "bh-gender", GENDER_LABEL).then((r) => void (pack.gender = r)),
      slice(acc, "Device", "bh-device", DEVICE_LABEL).then((r) => void (pack.device = r)),
      slice(acc, "LocationOfPresenceName", "bh-geo").then((r) => void (pack.geo = r))
    ];
    const settled = await Promise.allSettled(jobs);
    for (const s of settled) {
      if (s.status === "rejected") errors.push(s.reason instanceof Error ? s.reason.message : "ошибка среза");
    }
    return pack;
  });

  const merge = (key: keyof AudiencePack): SliceRow[] => {
    const map = new Map<string, SliceRow>();
    for (const part of parts) {
      for (const row of part[key]) {
        const cur = map.get(row.key) || { ...row, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
        cur.impressions += row.impressions;
        cur.clicks += row.clicks;
        cur.cost += row.cost;
        cur.conversions += row.conversions;
        map.set(row.key, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  };

  if (!parts.length) return { pack: empty, errors };
  return { pack: { age: merge("age"), gender: merge("gender"), device: merge("device"), geo: merge("geo") }, errors };
}

interface DirectAd {
  Id: number;
  CampaignId: number;
  AdGroupId?: number;
  TextAd?: {
    Title?: string;
    Title2?: string;
    Text?: string;
    SitelinkSetId?: number;
    AdExtensions?: Array<{ AdExtensionId: number; Type: string }>;
  };
  ResponsiveAd?: {
    Titles?: string[];
    Texts?: string[];
  };
}

interface AdsGetResult {
  Ads?: DirectAd[];
}

/** Тексты живут не в отчётах, а в сервисе ads — иначе не с чем сравнивать CTR. */
async function fetchAdTexts(acc: DirectAccount, campaignIds: string[]): Promise<Map<string, DirectAd>> {
  const map = new Map<string, DirectAd>();
  if (!campaignIds.length) return map;
  for (let start = 0; start < campaignIds.length; start += 10) {
    const chunk = campaignIds.slice(start, start + 10).map(Number);
    let offset = 0;
    for (let page = 0; page < 10; page += 1) {
      const result = await apiPost<AdsGetResult>(acc, "ads", {
        method: "get",
        params: {
          SelectionCriteria: { CampaignIds: chunk, States: ["ON", "SUSPENDED"] },
          FieldNames: ["Id", "CampaignId", "AdGroupId"],
          TextAdFieldNames: ["Title", "Title2", "Text", "SitelinkSetId", "AdExtensions"],
          ResponsiveAdFieldNames: ["Titles", "Texts"],
          Page: { Limit: 1000, Offset: offset }
        }
      });
      const ads = result.Ads || [];
      for (const ad of ads) map.set(String(ad.Id), ad);
      if (ads.length < 1000) break;
      offset += ads.length;
    }
  }
  return map;
}

export async function fetchAds(
  accounts: DirectAccount[],
  range: DateRange
): Promise<{ rows: AdRow[]; errors: string[] }> {
  const errors: string[] = [];
  const parts = await mapChunk(liveAccounts(accounts), 2, async (acc) => {
    try {
      const raw = await reportWithGoalFallback(
        acc,
        range,
        "AD_PERFORMANCE_REPORT",
        ["AdId", "AdGroupId", "AdGroupName", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost"],
        "bh-ads"
      );
      const campaignIds = Array.from(new Set(raw.map((r) => String(r.CampaignId || "")).filter(Boolean)));
      let texts = new Map<string, DirectAd>();
      try {
        texts = await fetchAdTexts(acc, campaignIds);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "тексты объявлений недоступны");
      }
      return raw.map((r) => {
        const impressions = parseNum(r.Impressions);
        const clicks = parseNum(r.Clicks);
        const ad = texts.get(String(r.AdId || ""));
        const responsiveTitle = ad?.ResponsiveAd?.Titles?.find((item) => item.trim()) || "";
        const responsiveText = ad?.ResponsiveAd?.Texts?.find((item) => item.trim()) || "";
        return {
          adId: String(r.AdId || ""),
          campaign: r.CampaignName || "",
          campaignId: String(r.CampaignId || ""),
          adGroupId: String(r.AdGroupId || ad?.AdGroupId || ""),
          adGroupName: r.AdGroupName || "",
          brand: acc.brand,
          line: acc.line,
          contractor: acc.contractor,
          qualityLeads: 0,
          impressions,
          clicks,
          cost: parseNum(r.Cost),
          conversions: uniqueCallConversions(r, acc.goalCallId),
          ctr: impressions ? (clicks / impressions) * 100 : 0,
          title: ad?.TextAd?.Title || responsiveTitle,
          title2: ad?.TextAd?.Title2 || "",
          text: ad?.TextAd?.Text || responsiveText,
          sitelinks: ad?.TextAd?.SitelinkSetId ? 1 : 0,
          callouts: (ad?.TextAd?.AdExtensions || []).filter((x) => x.Type === "CALLOUT").length
        };
      });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "ошибка объявлений");
      return [] as AdRow[];
    }
  });
  return { rows: parts.flat(), errors };
}
