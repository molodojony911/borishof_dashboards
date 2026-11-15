import fs from "node:fs";
import { dataPath } from "./paths";

import { emptyFilter } from "./catalog";
import { loadSettings, resolveDirectToken } from "./config";
import {
  fetchAds,
  fetchAudienceSlices,
  fetchPlacements,
  fetchSearchQueries,
  type AudiencePack
} from "./connectors/direct-deep";
import { directTokenBlockers } from "./connectors/direct";
import {
  buildAdsSection,
  buildDeepInsights,
  buildPlacementsSection,
  buildQueriesSection,
  type AdsSection,
  type PlacementsSection,
  type QueriesSection
} from "./engines/direct-deep";
import { parsePeriod, rangeFor } from "./period";
import type { DashboardFilter } from "./catalog";
import type { DateRange, InsightItem } from "./types";

export interface DirectDeepPayload {
  generatedAt: string;
  range: DateRange;
  accounts: number;
  queries: QueriesSection;
  ads: AdsSection;
  placements: PlacementsSection;
  audience: AudiencePack;
  insights: InsightItem[];
  errors: string[];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("cache");
}

function cacheFile(range: DateRange, filter: DashboardFilter): string {
  const key = [range.key, filter.contractor || "all", filter.line || "all", filter.brand || "all"].join("_");
  return dataPath("cache", `direct-deep-v2-${key}.json`);
}

function readCache(range: DateRange, filter: DashboardFilter): DirectDeepPayload | null {
  try {
    const file = cacheFile(range, filter);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { savedAt: number; payload: DirectDeepPayload };
    if (Date.now() - raw.savedAt > CACHE_TTL_MS) return null;
    return raw.payload;
  } catch {
    return null;
  }
}

function writeCache(range: DateRange, filter: DashboardFilter, payload: DirectDeepPayload): void {
  try {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile(range, filter), JSON.stringify({ savedAt: Date.now(), payload }), "utf8");
  } catch {
    /* кэш необязателен */
  }
}

function matches(acc: { contractor: string; brand: string; line?: string | null }, f: DashboardFilter): boolean {
  if (f.contractor && acc.contractor !== f.contractor) return false;
  if (f.line && (acc.line || "nc") !== f.line) return false;
  if (f.brand && acc.brand !== f.brand) return false;
  return true;
}

const EMPTY_AUDIENCE: AudiencePack = { age: [], gender: [], device: [], geo: [] };

export async function buildDirectDeep(
  periodParam?: string | null,
  filter: DashboardFilter = emptyFilter()
): Promise<DirectDeepPayload> {
  const range = rangeFor(parsePeriod(periodParam));
  const cached = readCache(range, filter);
  const settings = loadSettings();
  const withToken = settings.direct
    .filter((acc) => matches(acc, filter))
    .map((acc) => ({ ...acc, token: resolveDirectToken(acc) }))
    .filter((acc) => acc.token);

  if (cached) {
    // Выгрузки тяжёлые, поэтому кэшируем их надолго, а выводы пересобираем каждый раз.
    return {
      ...cached,
      insights: buildDeepInsights(cached.queries, cached.ads, cached.placements, cached.audience)
    };
  }

  const blockers = withToken.length ? await directTokenBlockers(withToken) : new Map<string, string>();
  const accounts = withToken.filter((acc) => !blockers.has(acc.contractor));
  const blocked = Array.from(blockers.values());

  if (!accounts.length) {
    return {
      generatedAt: new Date().toISOString(),
      range,
      accounts: 0,
      queries: buildQueriesSection([], []),
      ads: buildAdsSection([]),
      placements: buildPlacementsSection([]),
      audience: EMPTY_AUDIENCE,
      insights: [],
      errors: blocked.length ? blocked : ["Нет кабинетов Директа с токеном под текущий фильтр"]
    };
  }

  const brandWords = Array.from(
    new Set(
      accounts.flatMap((acc) =>
        acc.brand
          .toLowerCase()
          .split(/[\s/-]+/)
          .filter(Boolean)
      )
    )
  );

  const [queries, ads, placements, audience] = await Promise.all([
    fetchSearchQueries(accounts, range),
    fetchAds(accounts, range),
    fetchPlacements(accounts, range),
    fetchAudienceSlices(accounts, range)
  ]);

  const queriesSection = buildQueriesSection(queries.rows, brandWords);
  const adsSection = buildAdsSection(ads.rows);
  const placementsSection = buildPlacementsSection(placements.rows);

  const payload: DirectDeepPayload = {
    generatedAt: new Date().toISOString(),
    range,
    accounts: accounts.length,
    queries: queriesSection,
    ads: adsSection,
    placements: placementsSection,
    audience: audience.pack,
    insights: buildDeepInsights(queriesSection, adsSection, placementsSection, audience.pack),
    errors: Array.from(
      new Set([...blocked, ...queries.errors, ...ads.errors, ...placements.errors, ...audience.errors])
    ).slice(0, 8)
  };

  writeCache(range, filter, payload);
  return payload;
}
