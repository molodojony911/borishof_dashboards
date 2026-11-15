import fs from "fs";
import path from "path";
import { buildInsights } from "../src/lib/engines/insights";
import { ROLE_LABEL } from "../src/lib/types";
import type { DashboardPayload, ExpertRole } from "../src/lib/types";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");

function main() {
  const file = process.argv[2] || "dashboard-v10-7d_all_all_all.json";
  const raw = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), "utf8")) as {
    payload: DashboardPayload;
  };
  const { campaigns, behavior } = raw.payload;
  const leads = { ...raw.payload.leads, partial: process.argv[3] === "full" ? false : raw.payload.leads.partial };
  const items = buildInsights(campaigns, behavior, leads);

  const out: string[] = [];
  out.push(`Кампаний ${campaigns.length}, визитов ${Math.round(behavior.visits)}`);
  out.push(
    `Лиды: всего ${leads.total}, целевых ${leads.quality}, partial=${leads.partial}, брендов с данными ${leads.coveredBrands?.length ?? 0}`
  );
  out.push(`Источников в bySource: ${leads.bySource.length}, устройств: ${behavior.devices.length}`);
  out.push("");
  const byRole = new Map<ExpertRole, number>();
  for (const i of items) byRole.set(i.role, (byRole.get(i.role) || 0) + 1);
  for (const role of Object.keys(ROLE_LABEL) as ExpertRole[]) {
    out.push(`${ROLE_LABEL[role].padEnd(14)} ${byRole.get(role) || 0}`);
  }
  out.push("");
  for (const i of items) out.push(`  [${i.role}/${i.severity}] ${i.id} — ${i.title}`);

  fs.writeFileSync(path.join(CACHE_DIR, "insights-debug.txt"), out.join("\n"), "utf8");
}

main();
