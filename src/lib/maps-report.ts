import fs from "fs";
import { dataPath } from "./paths";

export interface MapsCardRow {
  id: string;
  name: string;
  address: string;
  site: string;
  online: boolean;
  promotion: "active" | "finished" | "none";
  activeCampaigns: number;
  finishedCampaigns: number;
  searchVisits: number;
  linkVisits: number;
  actionVisits: number;
  lastProcessed: string | null;
  queries: Array<{ query: string; visits: number; actions: number }>;
}

export interface MapsCampaignRow {
  id: number;
  type: string;
  status: string;
  remainingDays: number | null;
  cards: number;
}

export interface MapsQueryRow {
  query: string;
  visits: number;
  cards: number;
  actions: number;
}

export interface MapsReport {
  collectedAt: string | null;
  empty: boolean;
  note: string;
  cards: MapsCardRow[];
  campaigns: MapsCampaignRow[];
  queries: MapsQueryRow[];
}

interface RawSession {
  type?: string;
  query?: string;
  actions?: string[];
}

interface RawCampaign {
  id?: number;
  status?: string;
  type?: string;
  remainingDays?: number | null;
}

interface RawCard {
  id?: string | number;
  name?: string;
  address?: string;
  site?: string;
  online?: boolean;
  status?: string;
  promotion?: { campaigns?: RawCampaign[] };
  discovery?: { lastProcessedDate?: string | null; sessions?: RawSession[] };
}

const SEARCH = new Set(["text_search_on_map", "suggest_search_on_map"]);

function isSeres(name: string, site: string): boolean {
  const blob = `${name} ${site}`.toLowerCase();
  return blob.includes("seres") || blob.includes("borishof-seres");
}

function shortAddress(address: string): string {
  return address.replace(/^[^,]+федеральный округ,\s*/i, "").trim();
}

export function buildMapsReport(raw: unknown): MapsReport {
  const body = raw && typeof raw === "object" ? (raw as { savedAt?: string; cards?: Record<string, RawCard> }) : {};
  const cardsIn = body.cards && typeof body.cards === "object" ? Object.values(body.cards) : [];
  const queryMap = new Map<string, { visits: number; cards: Set<string>; actions: number }>();
  const campaignMap = new Map<number, MapsCampaignRow>();
  const cards: MapsCardRow[] = [];

  for (const card of cardsIn) {
    const name = card.name || "";
    const site = card.site || "";
    if (card.status && card.status !== "publish") continue;
    if (isSeres(name, site)) continue;
    const id = String(card.id || name);
    const campaigns = card.promotion?.campaigns || [];
    const active = campaigns.filter((item) => item.status === "RUNNING");
    const finished = campaigns.filter((item) => item.status === "FINISHED");
    const sessions = card.discovery?.sessions || [];
    const perQuery = new Map<string, { visits: number; actions: number }>();
    let searchVisits = 0;
    let linkVisits = 0;
    let actionVisits = 0;
    for (const session of sessions) {
      const actions = Array.isArray(session.actions) ? session.actions.length : 0;
      if (actions) actionVisits += 1;
      if (session.type === "external_open") {
        linkVisits += 1;
        continue;
      }
      if (!SEARCH.has(session.type || "")) continue;
      const query = (session.query || "").trim();
      if (!query) continue;
      searchVisits += 1;
      const local = perQuery.get(query) || { visits: 0, actions: 0 };
      local.visits += 1;
      if (actions) local.actions += 1;
      perQuery.set(query, local);
      const global = queryMap.get(query) || { visits: 0, cards: new Set<string>(), actions: 0 };
      global.visits += 1;
      global.cards.add(id);
      if (actions) global.actions += 1;
      queryMap.set(query, global);
    }
    for (const item of active) {
      if (item.id == null) continue;
      const cur = campaignMap.get(item.id) || {
        id: item.id,
        type: item.type || "",
        status: item.status || "",
        remainingDays: item.remainingDays ?? null,
        cards: 0
      };
      cur.cards += 1;
      campaignMap.set(item.id, cur);
    }
    cards.push({
      id,
      name: name || id,
      address: shortAddress(card.address || ""),
      site,
      online: Boolean(card.online),
      promotion: active.length ? "active" : finished.length ? "finished" : "none",
      activeCampaigns: active.length,
      finishedCampaigns: finished.length,
      searchVisits,
      linkVisits,
      actionVisits,
      lastProcessed: card.discovery?.lastProcessedDate || null,
      queries: Array.from(perQuery.entries())
        .map(([query, stat]) => ({ query, visits: stat.visits, actions: stat.actions }))
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 5)
    });
  }

  cards.sort((a, b) => b.searchVisits - a.searchVisits || a.name.localeCompare(b.name, "ru"));
  const queries = Array.from(queryMap.entries())
    .map(([query, stat]) => ({ query, visits: stat.visits, cards: stat.cards.size, actions: stat.actions }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 25);
  const campaigns = Array.from(campaignMap.values()).sort((a, b) => b.cards - a.cards);

  return {
    collectedAt: body.savedAt || null,
    empty: cards.length === 0,
    note: cards.length
      ? "Только карточки со статусом «Работает». Сетевые кампании повторяются на филиалах, в списке кампаний они сгруппированы."
      : "Среза кабинета ещё нет. Он появится в data/yandex-maps/collected.json после прохода по работающим карточкам.",
    cards,
    campaigns,
    queries
  };
}

export function loadMapsReport(): MapsReport {
  const file = dataPath("yandex-maps", "collected.json");
  try {
    if (!fs.existsSync(file)) return buildMapsReport(null);
    return buildMapsReport(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    const empty = buildMapsReport(null);
    empty.note = "Файл среза кабинета не читается.";
    return empty;
  }
}
