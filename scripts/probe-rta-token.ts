import fs from "fs";
import path from "path";
import { ACCOUNTS } from "../src/lib/catalog";

function loadEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function mask(token: string): string {
  if (!token) return "(пусто)";
  if (token.length <= 10) return "••••";
  return `${token.slice(0, 6)}…${token.slice(-4)} (длина ${token.length})`;
}

function errOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const err = (payload as { error?: { error_code?: number; error_string?: string; error_detail?: string } }).error;
  if (!err) return "";
  return [err.error_code, err.error_string, err.error_detail].filter(Boolean).join(" | ");
}

async function api(token: string, service: string, body: object, clientLogin?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;
  const res = await fetch(`https://api.direct.yandex.com/json/v5/${service}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(25000)
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text: text.slice(0, 240) };
}

async function listAgency(token: string): Promise<{ ok: boolean; logins: string[]; note: string }> {
  const logins: string[] = [];
  let offset = 0;
  for (let page = 0; page < 30; page += 1) {
    const res = await api(token, "agencyclients", {
      method: "get",
      params: {
        SelectionCriteria: {},
        FieldNames: ["Login", "ClientId"],
        Page: { Limit: 100, Offset: offset }
      }
    });
    if (res.status !== 200 || errOf(res.json)) {
      return { ok: false, logins, note: errOf(res.json) || `HTTP ${res.status} ${res.text}` };
    }
    const result = (res.json as { result?: { Clients?: Array<{ Login?: string }>; LimitedBy?: number } })?.result;
    const chunk = (result?.Clients || []).map((c) => c.Login || "").filter(Boolean);
    logins.push(...chunk);
    if (!result?.LimitedBy) break;
    offset = result.LimitedBy;
  }
  return { ok: true, logins, note: `${logins.length} клиентов агентства` };
}

async function reportProbe(token: string, clientLogin: string) {
  const res = await fetch("https://api.direct.yandex.com/json/v5/reports", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      "Client-Login": clientLogin,
      processingMode: "online",
      returnMoneyInMicros: "false",
      skipReportHeader: "true",
      skipReportSummary: "true"
    },
    body: JSON.stringify({
      params: {
        SelectionCriteria: { DateFrom: "2026-09-02", DateTo: "2026-09-08" },
        FieldNames: ["CampaignId", "CampaignName", "Impressions", "Clicks", "Cost"],
        ReportName: `rta-probe-${clientLogin}-${Date.now()}`,
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
        IncludeDiscount: "NO"
      }
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000)
  });
  const text = await res.text();
  if (res.status === 200) {
    const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    return { status: 200, campaigns: Math.max(0, lines.length - 1), error: "" };
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, campaigns: 0, error: errOf(json) || text.slice(0, 180) };
}

async function tokenWho(token: string) {
  const res = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const json = (await res.json()) as { login?: string; client_id?: string; error?: string };
  return { status: res.status, login: json.login || "", clientId: json.client_id || "", error: json.error || "" };
}

async function main() {
  loadEnv();
  const token = (process.env.YANDEX_DIRECT_RTA_OAUTH_TOKEN || "").trim();
  const out: string[] = [];
  out.push(`Токен из .env: ${mask(token)}`);
  if (!token) {
    out.push("Переменная YANDEX_DIRECT_RTA_OAUTH_TOKEN пустая.");
    fs.writeFileSync(path.join(process.cwd(), "data", "cache", "rta-token-probe.txt"), out.join("\n"), "utf8");
    return;
  }

  const who = await tokenWho(token);
  out.push(`Яндекс ID: HTTP ${who.status}, login=${who.login || "—"}, client_id=${who.clientId || "—"} ${who.error}`);

  const vault = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "direct-tokens.json"), "utf8")) as Record<
    string,
    string
  >;
  if (vault.Tandem) {
    const tandem = await tokenWho(vault.Tandem);
    out.push(`Tandem для сравнения: login=${tandem.login || "—"}, client_id=${tandem.clientId || "—"}`);
  }

  const clients = await api(token, "clients", {
    method: "get",
    params: { FieldNames: ["Login", "ClientId", "Type"] }
  });
  out.push(`clients.get HTTP ${clients.status}: ${errOf(clients.json) || JSON.stringify(clients.json).slice(0, 400)}`);

  const agency = await listAgency(token);
  out.push(`agencyclients: ${agency.ok ? agency.note : agency.note}`);

  const catalog = ACCOUNTS.filter((a) => a.contractor === "RTA");
  const agencySet = new Set(agency.logins.map((x) => x.toLowerCase()));
  const missing = catalog.filter((a) => !agencySet.has(a.clientLogin.toLowerCase()));
  const found = catalog.filter((a) => agencySet.has(a.clientLogin.toLowerCase()));
  out.push(`Справочник RTA: ${catalog.length} кабинетов, в агентстве ${found.length}, нет в списке ${missing.length}`);
  if (missing.length) {
    out.push("Нет в агентстве:");
    for (const a of missing) out.push(`  ${a.clientLogin} — ${a.brand} · ${a.line}`);
  }

  out.push("Отчёты по кабинетам:");
  for (const acc of catalog) {
    const probe = await reportProbe(token, acc.clientLogin);
    out.push(
      `  ${acc.clientLogin.padEnd(16)} ${acc.brand} · ${acc.line} → HTTP ${probe.status}, кампаний ${probe.campaigns}${probe.error ? ` | ${probe.error}` : ""}`
    );
  }

  const file = path.join(process.cwd(), "data", "cache", "rta-token-probe.txt");
  fs.writeFileSync(file, out.join("\n"), "utf8");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
