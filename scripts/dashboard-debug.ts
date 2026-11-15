import fs from "fs";
import path from "path";
import { loadSettings, resolveCalltouchToken } from "../src/lib/config";
import { fetchCalltouchLeads } from "../src/lib/connectors/calltouch";
import { buildDashboard } from "../src/lib/pipeline";
import { rangeFor } from "../src/lib/period";
import { ROLE_LABEL } from "../src/lib/types";
import type { ExpertRole, LeadRow } from "../src/lib/types";

const OUT = path.join(process.cwd(), "data", "cache", "dashboard-debug.txt");

function lineKey(row: LeadRow): string {
  return row.line || "не определена";
}

async function main() {
  const out: string[] = [];
  const settings = loadSettings();
  const range = rangeFor("7d");
  const accounts = settings.calltouch.filter((a) => a.siteId && resolveCalltouchToken(a));

  const pack = await fetchCalltouchLeads(accounts, range);
  const rows = pack.current;

  const byLine = new Map<string, { total: number; quality: number }>();
  for (const row of rows) {
    const key = lineKey(row);
    const cur = byLine.get(key) || { total: 0, quality: 0 };
    cur.total += 1;
    if (row.quality) cur.quality += 1;
    byLine.set(key, cur);
  }

  out.push(`Calltouch: кабинетов ${accounts.length}, обращений ${rows.length}, ошибок ${pack.errors.length}`);
  for (const [line, v] of byLine) out.push(`   линия ${line.padEnd(14)} всего ${v.total}, целевых ${v.quality}`);
  out.push("");

  // Целевые звонки не той линии, что кабинет: ровно тот случай, когда AFS утекал в NC.
  const mismatched = rows.filter((r) => {
    const acc = accounts.find((a) => (a.url || a.name) === r.site);
    return r.quality && acc?.line && r.line && acc.line !== r.line;
  });
  out.push(`Целевых, где линия по тегам не совпала с линией кабинета: ${mismatched.length}`);
  for (const r of mismatched.slice(0, 5)) {
    out.push(`   ${r.site}: кабинет ${accounts.find((a) => (a.url || a.name) === r.site)?.line} → тег ${r.line}`);
  }

  const data = await buildDashboard("7d", { contractor: "", line: "", brand: "" });
  const byRole = new Map<ExpertRole, number>();
  for (const i of data.insights) byRole.set(i.role, (byRole.get(i.role) || 0) + 1);

  out.push("\n===== дашборд, все бренды =====");
  for (const h of data.health) out.push(`   ${h.name}: ${h.state} — ${h.message}`);
  out.push(
    `Лиды: всего ${data.leads.total}, целевых ${data.leads.quality}, брендов с данными ${data.leads.coveredBrands.length}, partial=${data.leads.partial}`
  );
  out.push(`Визитов ${Math.round(data.behavior.visits)}, кампаний ${data.campaigns.length}`);
  out.push(
    "Роли: " +
      (Object.keys(ROLE_LABEL) as ExpertRole[]).map((r) => `${ROLE_LABEL[r]} ${byRole.get(r) || 0}`).join(" · ")
  );
  for (const i of data.insights) out.push(`   [${i.role}/${i.severity}] ${i.title}`);

  fs.writeFileSync(OUT, out.join("\n"), "utf8");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
