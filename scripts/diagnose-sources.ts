import fs from "fs";
import path from "path";
import { loadSettings, resolveCalltouchToken } from "../src/lib/config";
import { ACCOUNTS } from "../src/lib/catalog";
import { CALLTOUCH_CABINETS } from "../src/lib/calltouch-catalog";
import { fetchDirectCampaigns } from "../src/lib/connectors/direct";
import { rangeFor } from "../src/lib/period";

function classifyDirectError(message: string): string {
  if (message.includes("8800") || message.includes("Client-Login")) return "no_access";
  if (message.includes("abort") || message.includes("timeout") || message.includes("Timeout")) return "timeout";
  if (message.includes("401") || message.includes("403")) return "auth";
  return "other";
}

async function probeCalltouch(siteId: string, token: string): Promise<{ ok: boolean; status: string }> {
  const url = new URL(`https://api.calltouch.ru/calls-service/RestAPI/${siteId}/calls-diary/calls`);
  url.searchParams.set("clientApiId", token);
  url.searchParams.set("dateFrom", "01/09/2026");
  url.searchParams.set("dateTo", "07/09/2026");
  url.searchParams.set("withCallTags", "true");
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "1");
  try {
    const res = await fetch(url, {
      headers: { "Access-Token": token, SiteId: siteId },
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) return { ok: true, status: String(res.status) };
    const text = await res.text();
    return { ok: false, status: `${res.status} ${text.slice(0, 120).replace(/\s+/g, " ")}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return { ok: false, status: msg.includes("abort") || msg.includes("Timeout") ? "timeout" : msg.slice(0, 160) };
  }
}

async function main() {
  const settings = loadSettings();
  const range = rangeFor("7d");
  const primaryAccounts = settings.direct;

  const primaryPack = await fetchDirectCampaigns(primaryAccounts, range);
  const failedPrimary = primaryPack.errors.map((raw) => {
    const login = raw.split(":")[0];
    const acc = primaryAccounts.find((a) => a.clientLogin === login);
    return {
      login,
      brand: acc?.brand || "",
      line: acc?.line || "",
      contractor: acc?.contractor || "",
      kind: classifyDirectError(raw)
    };
  });

  const calltouch: Array<{
    name: string;
    url: string;
    siteId: string;
    brand: string;
    contractor: string;
    ok: boolean;
    status: string;
  }> = [];
  for (let i = 0; i < CALLTOUCH_CABINETS.length; i += 4) {
    const chunk = CALLTOUCH_CABINETS.slice(i, i + 4);
    const part = await Promise.all(
      chunk.map(async (cab) => {
        const token = resolveCalltouchToken({ siteId: cab.siteId, token: "" });
        if (!token) {
          return { name: cab.name, url: cab.url, siteId: cab.siteId, brand: cab.brand, contractor: cab.contractor, ok: false, status: "no_token" };
        }
        const probe = await probeCalltouch(cab.siteId, token);
        return {
          name: cab.name,
          url: cab.url,
          siteId: cab.siteId,
          brand: cab.brand,
          contractor: cab.contractor,
          ok: probe.ok,
          status: probe.status
        };
      })
    );
    calltouch.push(...part);
  }

  const out = {
    primaryFailed: failedPrimary,
    calltouchFailed: calltouch.filter((c) => !c.ok),
    calltouchOk: calltouch.filter((c) => c.ok).map((c) => ({ name: c.name, siteId: c.siteId, brand: c.brand }))
  };
  const file = path.join(process.cwd(), "data", "cache", "diagnose.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        primaryFailed: failedPrimary.length,
        calltouchFailed: out.calltouchFailed.length,
        calltouchOk: out.calltouchOk.length
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
