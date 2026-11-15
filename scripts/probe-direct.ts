import fs from "fs";
import path from "path";
import { ACCOUNTS } from "../src/lib/catalog";

const TOKENS_PATH = path.join(process.cwd(), "data", "direct-tokens.json");
const OUT = path.join(process.cwd(), "data", "cache", "direct-probe.json");

type Tokens = Record<string, string>;

async function directJson(token: string, url: string, body: object, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000)
  });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 500), json: safeJson(text) };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorCode(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const err = (payload as { error?: { error_code?: string; error_string?: string; error_detail?: string } }).error;
  if (!err) return "";
  return [err.error_code, err.error_string, err.error_detail].filter(Boolean).join(" | ");
}

async function listAgencyClients(token: string): Promise<{ ok: boolean; logins: string[]; note: string }> {
  const logins: string[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const res = await directJson(token, "https://api.direct.yandex.com/json/v5/agencyclients", {
      method: "get",
      params: {
        SelectionCriteria: {},
        FieldNames: ["Login", "ClientId"],
        Page: { Limit: 100, Offset: offset }
      }
    });
    if (res.status !== 200) {
      return { ok: false, logins, note: `agencyclients ${res.status} ${errorCode(res.json) || res.text.slice(0, 180)}` };
    }
    const result = (res.json as { result?: { Clients?: Array<{ Login?: string }>; LimitedBy?: number } })?.result;
    const chunk = (result?.Clients || []).map((c) => c.Login || "").filter(Boolean);
    logins.push(...chunk);
    if (!result?.LimitedBy) break;
    offset = result.LimitedBy;
  }
  return { ok: true, logins, note: `${logins.length} клиентов агентства` };
}

async function reportProbe(token: string, clientLogin?: string) {
  const headers: Record<string, string> = {
    processingMode: "online",
    returnMoneyInMicros: "false",
    skipReportHeader: "true",
    skipReportSummary: "true"
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;
  const res = await fetch("https://api.direct.yandex.com/json/v5/reports", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    },
    body: JSON.stringify({
      params: {
        SelectionCriteria: { DateFrom: "2026-09-01", DateTo: "2026-09-07" },
        FieldNames: ["CampaignId", "CampaignName", "Impressions", "Clicks", "Cost"],
        ReportName: `probe-${clientLogin || "no-login"}-${Date.now()}`,
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
        IncludeDiscount: "NO"
      }
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  return {
    status: res.status,
    campaigns: res.status === 200 ? Math.max(0, lines.length - 1) : 0,
    error: res.status === 200 ? "" : errorCode(safeJson(text)) || text.slice(0, 180)
  };
}

async function main() {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8")) as Tokens;
  const catalogLogins = ACCOUNTS.map((a) => ({
    login: a.clientLogin,
    brand: a.brand,
    line: a.line,
    contractor: a.contractor,
    kind: "primary" as const
  }));

  const report: unknown[] = [];
  for (const [contractor, token] of Object.entries(tokens)) {
    if (!token) continue;
    const agency = await listAgencyClients(token);
    const withoutLogin = await reportProbe(token);
    const samplePrimary = catalogLogins.find((x) => x.contractor === contractor);
    const withPrimary = samplePrimary ? await reportProbe(token, samplePrimary.login) : null;
    const agencySet = new Set(agency.logins.map((x) => x.toLowerCase()));
    const ours = catalogLogins.filter((x) => x.contractor === contractor);
    report.push({
      contractor,
      tokenPresent: true,
      agencyClients: {
        ok: agency.ok,
        note: agency.note,
        count: agency.logins.length
      },
      catalogVsAgency: ours.map((x) => ({
        ...x,
        inAgencyList: agencySet.has(x.login.toLowerCase())
      })),
      reportWithoutClientLogin: withoutLogin,
      reportWithPrimaryLogin: withPrimary ? { login: samplePrimary?.login, ...withPrimary } : null
    });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify(
      report.map((row) => {
        const r = row as {
          contractor: string;
          agencyClients: { ok: boolean; note: string; count: number };
          catalogVsAgency: Array<{ login: string; kind: string; inAgencyList: boolean }>;
          reportWithoutClientLogin: { status: number; campaigns: number; error: string };
        };
        return {
          contractor: r.contractor,
          agency: r.agencyClients,
          inList: r.catalogVsAgency.filter((x) => x.inAgencyList).length,
          missing: r.catalogVsAgency.filter((x) => !x.inAgencyList).map((x) => `${x.kind}:${x.login}`),
          noLogin: r.reportWithoutClientLogin
        };
      }),
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
