import fs from "fs";
import path from "path";
import type { AppSettings, CalltouchAccount, DirectAccount, MetrikaAccount } from "./types";
import { DEFAULT_THRESHOLDS } from "./defaults";
import { canonicalBrand, exeedEsteoKind } from "./brand-alias";
import { ACCOUNTS, toDirectAccounts, toMetrikaAccounts } from "./catalog";
import { CALLTOUCH_CABINETS, toCalltouchAccounts } from "./calltouch-catalog";
import { dataPath } from "./paths";

export { DEFAULT_THRESHOLDS, DEFAULT_QUALITY_TAGS } from "./defaults";

function settingsPath(): string {
  return dataPath("settings.json");
}

function tokensPath(): string {
  return dataPath("direct-tokens.json");
}

function calltouchTokensPath(): string {
  return dataPath("calltouch-tokens.json");
}

/** JSON-объект из переменной окружения. Битый JSON не роняет дашборд. */
export function parseJsonEnv(raw: string | undefined): Record<string, string> {
  const text = (raw || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function pickToken(map: Record<string, string>, name: string): string {
  if (!name) return "";
  if ((map[name] || "").trim()) return map[name].trim();
  const found = Object.entries(map).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return (found?.[1] || "").trim();
}

/** Единый OAuth Яндекс.Метрики на все счётчики холдинга. */
export function sharedMetrikaToken(): string {
  return (process.env.YANDEX_METRIKA_OAUTH_TOKEN || "").trim();
}

/** Переменная окружения важнее токена, записанного в карточке счётчика. */
export function resolveMetrikaToken(accountToken?: string): string {
  const fromEnv = sharedMetrikaToken();
  if (fromEnv) return fromEnv;
  return (accountToken || "").trim();
}

/** OAuth Яндекс.Директа подрядчика RTA: один токен представителя на все кабинеты. */
export function sharedRtaDirectToken(): string {
  return (process.env.YANDEX_DIRECT_RTA_OAUTH_TOKEN || "").trim();
}

export function sharedTandemDirectToken(): string {
  return (process.env.YANDEX_DIRECT_TANDEM_OAUTH_TOKEN || "").trim();
}

/** Именные переменные перекрывают JSON YANDEX_DIRECT_TOKENS. */
export function directTokensFromEnv(): Record<string, string> {
  const map = { ...parseJsonEnv(process.env.YANDEX_DIRECT_TOKENS) };
  const rta = sharedRtaDirectToken();
  const tandem = sharedTandemDirectToken();
  if (rta) map.RTA = rta;
  if (tandem) map.Tandem = tandem;
  return map;
}

export function loadDirectTokens(): Record<string, string> {
  try {
    const file = tokensPath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * 1. Переменная окружения (именная или YANDEX_DIRECT_TOKENS).
 * 2. data/direct-tokens.json.
 * 3. Поле кабинета в настройках, если это не маска.
 */
export function resolveDirectToken(account: Pick<DirectAccount, "token" | "contractor">): string {
  const fromEnv = pickToken(directTokensFromEnv(), account.contractor);
  if (fromEnv) return fromEnv;
  const fromFile = pickToken(loadDirectTokens(), account.contractor);
  if (fromFile) return fromFile;
  const own = (account.token || "").trim();
  if (own && !isMasked(own)) return own;
  return "";
}

export function loadCalltouchTokens(): Record<string, string> {
  try {
    const file = calltouchTokensPath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** CALLTOUCH_TOKENS перекрывает файл по тем же siteId. */
export function calltouchVault(): Record<string, string> {
  return { ...loadCalltouchTokens(), ...parseJsonEnv(process.env.CALLTOUCH_TOKENS) };
}

function isMasked(value: string): boolean {
  return !value || value.includes("••••");
}

export function resolveCalltouchToken(account: Pick<CalltouchAccount, "siteId" | "token">): string {
  const vault = calltouchVault();
  const bySite = (vault[account.siteId] || "").trim();
  if (bySite) return bySite;
  const cab = CALLTOUCH_CABINETS.find((item) => item.siteId === account.siteId);
  if (cab?.accountId) {
    for (const other of CALLTOUCH_CABINETS) {
      if (other.accountId !== cab.accountId || other.siteId === cab.siteId) continue;
      const shared = (vault[other.siteId] || "").trim();
      if (shared) return shared;
    }
  }
  const own = (account.token || "").trim();
  if (own && !isMasked(own)) return own;
  return "";
}

export function persistCalltouchTokens(accounts: CalltouchAccount[]): void {
  const vault = loadCalltouchTokens();
  let changed = false;
  for (const acc of accounts) {
    const token = (acc.token || "").trim();
    if (!acc.siteId || isMasked(token)) continue;
    if (vault[acc.siteId] === token) continue;
    vault[acc.siteId] = token;
    changed = true;
  }
  if (!changed) return;
  const file = calltouchTokensPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(vault, null, 2), "utf8");
}

export function seedFromCatalog(base: AppSettings): AppSettings {
  const tokens = loadDirectTokens();
  const direct = base.direct.length ? base.direct : toDirectAccounts(tokens);
  const catalogDirect = toDirectAccounts(tokens);
  const filledDirect = direct.map((row) => {
    const match =
      catalogDirect.find((item) => item.id === row.id) ||
      catalogDirect.find(
        (item) =>
          item.clientLogin.toLowerCase() === (row.clientLogin || "").toLowerCase() &&
          canonicalBrand(item.brand) === canonicalBrand(row.brand || "") &&
          item.line === row.line
      );
    const brand = canonicalBrand(match?.brand || row.brand || "");
    const renamed = Boolean(match && row.brand && row.brand !== brand);
    return {
      ...row,
      brand,
      name: renamed ? match?.name || row.name : row.name,
      line: row.line || match?.line || "nc",
      token: row.token || tokens[row.contractor] || "",
      goalCallId: match?.goalCallId || row.goalCallId
    };
  }).filter((row) => {
    const cat = ACCOUNTS.find((a) => a.id === row.id || a.clientLogin === row.clientLogin);
    return !cat?.skipDirect;
  });
  const metrikaSource = base.metrika.length ? base.metrika : toMetrikaAccounts("");
  const metrika = expandMetrika(metrikaSource);
  const catalogCalltouch = toCalltouchAccounts();
  const calltouchSource = base.calltouch.length ? base.calltouch : catalogCalltouch;
  const calltouch: CalltouchAccount[] = calltouchSource.map((row) => {
    const match =
      catalogCalltouch.find((item) => item.id === row.id) ||
      catalogCalltouch.find((item) => item.siteId === row.siteId);
    const brand = canonicalBrand(match?.brand || row.brand || "");
    const renamed = Boolean(match && row.brand && row.brand !== brand);
    return {
      ...row,
      name: renamed ? match?.name || row.name : row.name || match?.name || "",
      brand,
      contractor: row.contractor || match?.contractor || "",
      url: row.url || match?.url || "",
      qualityTags: row.qualityTags?.length ? row.qualityTags : match?.qualityTags || [],
      token: ""
    };
  });
  for (const item of catalogCalltouch) {
    const blob = `${item.id} ${item.brand} ${item.name} ${item.url}`;
    if (exeedEsteoKind(blob) === "other") continue;
    if (calltouch.some((row) => row.id === item.id || row.siteId === item.siteId)) continue;
    calltouch.push({ ...item, token: "" });
  }
  persistCalltouchTokens(calltouchSource.filter((row) => !isRemovedBrand(row)));
  return {
    ...base,
    direct: filledDirect.filter((row) => !isRemovedBrand(row)),
    metrika: metrika.filter((row) => !isRemovedBrand(row)),
    calltouch: calltouch.filter((row) => !isRemovedBrand(row))
  };
}

/** Seres снят с дашборда: ни справочник, ни старый settings.json не должны его запрашивать. */
function isRemovedBrand(row: { id?: string; brand?: string; name?: string; url?: string; siteId?: string; clientLogin?: string }): boolean {
  const blob = `${row.id || ""} ${row.brand || ""} ${row.name || ""} ${row.url || ""} ${row.siteId || ""} ${row.clientLogin || ""}`.toLowerCase();
  return blob.includes("seres") || blob.includes("borishof-seres") || blob.includes("66216");
}

function expandMetrika(source: MetrikaAccount[]): MetrikaAccount[] {
  const catalog = toMetrikaAccounts("");
  if (!source.length) return catalog;
  const out: MetrikaAccount[] = [];
  const seen = new Set<string>();
  const push = (row: MetrikaAccount) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
  };
  for (const row of source) {
    if (!row.brand && !row.line && row.counterId) {
      const matches = catalog.filter((item) => item.counterId === row.counterId);
      if (matches.length) {
        for (const match of matches) push({ ...match, token: row.token || "", goalCallId: row.goalCallId || match.goalCallId });
        continue;
      }
    }
    const match =
      catalog.find((item) => item.id === row.id) ||
      catalog.find(
        (item) =>
          item.counterId === row.counterId &&
          item.line === row.line &&
          canonicalBrand(item.brand || "") === canonicalBrand(row.brand || "")
      );
    const brand = canonicalBrand(match?.brand || row.brand || "");
    const renamed = Boolean(match && row.brand && row.brand !== brand);
    push({
      ...row,
      name: renamed ? match?.name || row.name : row.name || match?.name || "",
      brand,
      contractor: row.contractor || match?.contractor,
      line: row.line || match?.line,
      goalCallId: match?.goalCallId || row.goalCallId
    });
  }
  return out;
}

function baseSettings(): AppSettings {
  return {
    metrika: [],
    direct: [],
    calltouch: [],
    telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN || "").trim(),
    telegramChatId: (process.env.TELEGRAM_CHAT_ID || "").trim(),
    thresholds: { ...DEFAULT_THRESHOLDS },
    useLiveDirect: true,
    useLiveCalltouch: true
  };
}

export function emptySettings(): AppSettings {
  return seedFromCatalog(baseSettings());
}

export function loadSettings(): AppSettings {
  try {
    const file = settingsPath();
    if (!fs.existsSync(file)) return emptySettings();
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const merged = seedFromCatalog({
      ...baseSettings(),
      ...parsed,
      thresholds: { ...DEFAULT_THRESHOLDS, ...(parsed.thresholds || {}) }
    });
    const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim() || merged.telegramBotToken;
    const telegramChatId = (process.env.TELEGRAM_CHAT_ID || "").trim() || merged.telegramChatId;
    return { ...merged, telegramBotToken, telegramChatId };
  } catch {
    return emptySettings();
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  persistCalltouchTokens(next.calltouch);
  const file = settingsPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sanitized: AppSettings = {
    ...baseSettings(),
    ...next,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(next.thresholds || {}) },
    calltouch: next.calltouch.map((row) => ({ ...row, token: "" }))
  };
  fs.writeFileSync(file, JSON.stringify(sanitized, null, 2), "utf8");
  return sanitized;
}

export function hasLiveSources(settings: AppSettings): boolean {
  return (
    settings.metrika.some((x) => x.counterId && resolveMetrikaToken(x.token)) ||
    (settings.useLiveDirect && settings.direct.some((x) => resolveDirectToken(x))) ||
    (settings.useLiveCalltouch && settings.calltouch.some((x) => x.siteId && resolveCalltouchToken(x)))
  );
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function publicSettings(settings: AppSettings) {
  const calltouchResolved = settings.calltouch.map((x) => resolveCalltouchToken(x));
  return {
    ...settings,
    telegramBotToken: maskSecret(settings.telegramBotToken),
    metrika: settings.metrika.map((x) => ({ ...x, token: maskSecret(x.token) })),
    direct: settings.direct.map((x) => ({ ...x, token: maskSecret(x.token) })),
    calltouch: settings.calltouch.map((x) => ({ ...x, token: "" })),
    metrikaTokenFromEnv: Boolean(sharedMetrikaToken()),
    rtaDirectTokenFromEnv: Boolean(sharedRtaDirectToken() || pickToken(parseJsonEnv(process.env.YANDEX_DIRECT_TOKENS), "RTA")),
    tandemDirectTokenFromEnv: Boolean(sharedTandemDirectToken() || pickToken(parseJsonEnv(process.env.YANDEX_DIRECT_TOKENS), "Tandem")),
    calltouchTokenFromVault: Object.keys(calltouchVault()).length > 0,
    calltouchFromEnv: Object.keys(parseJsonEnv(process.env.CALLTOUCH_TOKENS)).length > 0,
    hasSecrets: {
      telegram: Boolean(settings.telegramBotToken),
      metrikaFromEnv: Boolean(sharedMetrikaToken()),
      rtaDirectFromEnv: Boolean(sharedRtaDirectToken()),
      metrika: settings.metrika.map((x) => Boolean(resolveMetrikaToken(x.token))),
      direct: settings.direct.map((x) => Boolean(resolveDirectToken(x))),
      calltouch: calltouchResolved.map(Boolean),
      calltouchFromVault: Object.keys(loadCalltouchTokens()).length
    }
  };
}
