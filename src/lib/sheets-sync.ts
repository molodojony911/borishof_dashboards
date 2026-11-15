import crypto from "crypto";
import fs from "fs";
import path from "path";
import { dataPath } from "./paths";
import { classifiedCount, matrixToPlans, parseClassifiedMatrix } from "./plan-model";
import { loadClassifieds, loadPlans, saveClassifieds, savePlans } from "./plan-store";
import { parseCsv } from "./tabular";
import { apiTimeout } from "./http";

export interface SheetsSyncStatus {
  configured: boolean;
  intervalHours: number;
  lastAttemptAt: string;
  lastSuccessAt: string;
  lastError: string;
  source: "" | "csv" | "service-account" | "api-key";
  plansRows: number;
  classifiedsRows: number;
  plansUpdatedAt: string;
  classifiedsUpdatedAt: string;
  plansSource: "" | "upload" | "sheet";
  classifiedsSource: "" | "upload" | "sheet";
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function emptyStatus(): SheetsSyncStatus {
  const plans = loadPlans();
  const classifieds = loadClassifieds();
  return {
    configured: Boolean(sheetsTargets().id),
    intervalHours: syncIntervalHours(),
    lastAttemptAt: "",
    lastSuccessAt: "",
    lastError: "",
    source: "",
    plansRows: plans.rows.length,
    classifiedsRows: classifiedCount(classifieds),
    plansUpdatedAt: plans.updatedAt,
    classifiedsUpdatedAt: classifieds.updatedAt,
    plansSource: plans.source,
    classifiedsSource: classifieds.source
  };
}

function statusPath(): string {
  return dataPath("sheets-sync.json");
}

export function syncIntervalHours(): number {
  const raw = Number(process.env.GOOGLE_SHEETS_SYNC_HOURS ?? "3");
  if (!Number.isFinite(raw) || raw <= 0) return 3;
  return raw;
}

export function readSheetsStatus(): SheetsSyncStatus {
  const base = emptyStatus();
  try {
    if (!fs.existsSync(statusPath())) return base;
    const raw = JSON.parse(fs.readFileSync(statusPath(), "utf8")) as Partial<SheetsSyncStatus>;
    return {
      ...base,
      ...raw,
      configured: base.configured,
      intervalHours: base.intervalHours,
      plansRows: base.plansRows,
      classifiedsRows: base.classifiedsRows,
      plansUpdatedAt: base.plansUpdatedAt,
      classifiedsUpdatedAt: base.classifiedsUpdatedAt,
      plansSource: base.plansSource,
      classifiedsSource: base.classifiedsSource
    };
  } catch {
    return base;
  }
}

function writeStatus(patch: Partial<SheetsSyncStatus>): SheetsSyncStatus {
  const next = { ...readSheetsStatus(), ...patch, configured: Boolean(sheetsTargets().id), intervalHours: syncIntervalHours() };
  const dir = path.dirname(statusPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statusPath(), JSON.stringify(next, null, 2), "utf8");
  return readSheetsStatus();
}

/** Публичный id листа классифайдов. Это не секрет: таблица открыта по ссылке. */
export const DEFAULT_CLASSIFIEDS_SHEET_ID = "1mieIw-b8wnJVvRJrbr9onoLMItHWHwESYEf5QIqqC8I";

export function sheetsTargets(): {
  id: string;
  usingDefaultId: boolean;
  plansEnabled: boolean;
  plansTab: string;
  classifiedsTab: string;
  plansGid: string;
  classifiedsGid: string;
} {
  const fromEnv = (process.env.GOOGLE_SHEETS_ID || "").trim();
  const plansTab = (process.env.GOOGLE_SHEETS_PLANS_TAB || "").trim();
  const plansGid = (process.env.GOOGLE_SHEETS_PLANS_GID || "").trim();
  const classifiedsGid = (process.env.GOOGLE_SHEETS_CLASSIFIEDS_GID ?? "0").trim();
  return {
    id: fromEnv || DEFAULT_CLASSIFIEDS_SHEET_ID,
    usingDefaultId: !fromEnv,
    plansEnabled: Boolean(plansTab || plansGid),
    plansTab: plansTab || "plans",
    classifiedsTab: (process.env.GOOGLE_SHEETS_CLASSIFIEDS_TAB || "").trim(),
    plansGid,
    classifiedsGid: classifiedsGid || "0"
  };
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
      if (parsed.client_email && parsed.private_key) {
        return { client_email: parsed.client_email, private_key: parsed.private_key };
      }
    } catch {
      return null;
    }
  }
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (email && key) return { client_email: email, private_key: key };
  return null;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function serviceAccountToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  sign.end();
  const signature = sign.sign(account.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`
    }),
    signal: apiTimeout(20_000)
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Google OAuth ${res.status}: ${json.error || "нет access_token"}`);
  }
  return json.access_token;
}

function tabRange(tab: string): string {
  if (/^[A-Za-z0-9_]+$/.test(tab)) return tab;
  return `'${tab.replace(/'/g, "''")}'`;
}

async function fetchValues(id: string, tab: string, accessToken: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(tabRange(tab))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: apiTimeout(20_000)
  });
  const json = (await res.json().catch(() => ({}))) as { values?: unknown[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message || `Sheets API ${res.status}`);
  return (json.values || []).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []));
}

async function fetchPublicCsv(id: string, tab: string, gid: string): Promise<string> {
  const url = gid
    ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(gid)}`
    : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url, { redirect: "follow", signal: apiTimeout(20_000) });
  const text = await res.text();
  if (!res.ok || /^\s*</.test(text) || text.includes("accounts.google.com")) {
    throw new Error(
      `Таблица не отдаёт CSV (${res.status}). Откройте доступ «всем, у кого есть ссылка» или задайте сервисный аккаунт.`
    );
  }
  return text;
}

async function pullMatrix(
  id: string,
  tab: string,
  gid: string
): Promise<{ matrix: string[][]; source: SheetsSyncStatus["source"] }> {
  const account = loadServiceAccount();
  const apiKey = (process.env.GOOGLE_SHEETS_API_KEY || "").trim();
  const errors: string[] = [];
  if (account) {
    try {
      const token = await serviceAccountToken(account);
      return { matrix: await fetchValues(id, tab, token), source: "service-account" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "сервисный аккаунт");
    }
  } else if (apiKey) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(tabRange(tab))}?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: apiTimeout(20_000) });
      const json = (await res.json().catch(() => ({}))) as { values?: unknown[][]; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message || `Sheets API ${res.status}`);
      const matrix = (json.values || []).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []));
      return { matrix, source: "api-key" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "api key");
    }
  }
  try {
    const csv = await fetchPublicCsv(id, tab, gid);
    return { matrix: parseCsv(csv), source: "csv" };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "csv");
    throw new Error(errors.join("; "));
  }
}

let inflight: Promise<SheetsSyncStatus> | null = null;

export async function syncNow(): Promise<SheetsSyncStatus> {
  if (inflight) return inflight;
  inflight = runSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSync(): Promise<SheetsSyncStatus> {
  const target = sheetsTargets();
  if (!target.id) {
    return writeStatus({ lastError: "Не задан GOOGLE_SHEETS_ID. Загрузка файла по-прежнему работает." });
  }
  writeStatus({ lastAttemptAt: new Date().toISOString(), lastError: "" });
  const problems: string[] = [];
  let source: SheetsSyncStatus["source"] = "";
  if (target.plansEnabled) {
    try {
      const plans = await pullMatrix(target.id, target.plansTab, target.plansGid);
      const rows = matrixToPlans(plans.matrix);
      if (!rows.length) problems.push(`Лист планов «${target.plansTab || target.plansGid}»: нет строк. Нужны колонки month, contractor, brand, line, spend, leads, visits.`);
      else savePlans(rows, "sheet");
      source = plans.source;
    } catch (e) {
      problems.push(`Планы: ${e instanceof Error ? e.message : "ошибка"}`);
    }
  }
  try {
    const classifieds = await pullMatrix(target.id, target.classifiedsTab, target.classifiedsGid);
    const sheet = parseClassifiedMatrix(classifieds.matrix);
    if (!classifiedCount(sheet)) {
      problems.push("Лист классифайдов пуст или заголовки не узнаны. Нужны «План расход» и «Факт расход», либо плоский CSV с колонками platform, plan, fact.");
    } else saveClassifieds(sheet, "sheet");
    source = classifieds.source || source;
  } catch (e) {
    problems.push(`Классифайды: ${e instanceof Error ? e.message : "ошибка"}`);
  }
  const plans = loadPlans();
  const classifieds = loadClassifieds();
  const classifiedsFailed = problems.some((item) => item.startsWith("Классифайды") || item.startsWith("Лист классифайдов"));
  return writeStatus({
    lastSuccessAt: classifiedsFailed ? readSheetsStatus().lastSuccessAt : new Date().toISOString(),
    lastError: problems.join(" "),
    source,
    plansRows: plans.rows.length,
    classifiedsRows: classifiedCount(classifieds),
    plansUpdatedAt: plans.updatedAt,
    classifiedsUpdatedAt: classifieds.updatedAt,
    plansSource: plans.source,
    classifiedsSource: classifieds.source
  });
}

export async function syncIfDue(): Promise<SheetsSyncStatus> {
  const status = readSheetsStatus();
  if (!status.configured) return status;
  const last = Date.parse(status.lastAttemptAt || "");
  const interval = syncIntervalHours() * 60 * 60 * 1000;
  if (Number.isFinite(last) && Date.now() - last < interval) return status;
  return syncNow();
}

export function startSheetsSync(): void {
  const g = globalThis as typeof globalThis & { __borishofSheets?: boolean };
  if (g.__borishofSheets) return;
  g.__borishofSheets = true;
  const tick = () => {
    syncIfDue().catch(() => undefined);
  };
  tick();
  const timer = setInterval(tick, Math.min(syncIntervalHours(), 1) * 60 * 60 * 1000);
  timer.unref?.();
}

export function noteUpload(kind: "plans" | "classifieds", rows: number): SheetsSyncStatus {
  const plans = loadPlans();
  const classifieds = loadClassifieds();
  return writeStatus({
    lastError: "",
    plansRows: kind === "plans" ? rows : plans.rows.length,
    classifiedsRows: kind === "classifieds" ? rows : classifiedCount(classifieds),
    plansUpdatedAt: plans.updatedAt,
    classifiedsUpdatedAt: classifieds.updatedAt,
    plansSource: plans.source,
    classifiedsSource: classifieds.source
  });
}
