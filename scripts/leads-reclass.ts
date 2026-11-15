import fs from "fs";
import path from "path";
import { CALLTOUCH_CABINETS, cabinetLine, classifyCalltouchTags } from "../src/lib/calltouch-catalog";
import type { LeadRow } from "../src/lib/types";

const DIR = path.join(process.cwd(), "data", "cache", "calltouch");

interface Stat {
  calls: number;
  oldQuality: number;
  newQuality: number;
  oldNc: number;
  newNc: number;
  oldAfs: number;
  newAfs: number;
}

function empty(): Stat {
  return { calls: 0, oldQuality: 0, newQuality: 0, oldNc: 0, newNc: 0, oldAfs: 0, newAfs: 0 };
}

function main() {
  const bySite = new Map<string, Stat>();
  const total = empty();

  for (const file of fs.readdirSync(DIR)) {
    if (file.startsWith("forms-") || file.includes("_forms-")) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as { rows?: LeadRow[] };
    for (const row of raw.rows || []) {
      const cab = CALLTOUCH_CABINETS.find((c) => c.url === row.site || c.name === row.site);
      const accLine = cab ? cabinetLine(cab.url) : undefined;
      const next = classifyCalltouchTags(row.tags || []);
      const newLine = next.line || accLine || null;

      for (const stat of [bySite.get(row.site) || empty(), total]) {
        stat.calls += 1;
        if (row.quality) stat.oldQuality += 1;
        if (next.quality) stat.newQuality += 1;
        if (row.quality && row.line === "nc") stat.oldNc += 1;
        if (next.quality && newLine === "nc") stat.newNc += 1;
        if (row.quality && row.line === "afs") stat.oldAfs += 1;
        if (next.quality && newLine === "afs") stat.newAfs += 1;
        if (!bySite.has(row.site)) bySite.set(row.site, stat);
      }
    }
  }

  const out: string[] = [];
  const head = "кабинет".padEnd(34) + "звонков  целевые старые→новые   NC старые→новые   AFS старые→новые";
  out.push(head);
  const rows = Array.from(bySite.entries()).sort((a, b) => b[1].calls - a[1].calls);
  for (const [site, s] of rows) {
    out.push(
      site.padEnd(34) +
        String(s.calls).padStart(7) +
        `   ${String(s.oldQuality).padStart(5)} → ${String(s.newQuality).padEnd(5)}` +
        `   ${String(s.oldNc).padStart(5)} → ${String(s.newNc).padEnd(5)}` +
        `   ${String(s.oldAfs).padStart(5)} → ${String(s.newAfs).padEnd(5)}`
    );
  }
  out.push("");
  out.push(
    `ИТОГО: звонков ${total.calls}, целевых ${total.oldQuality} → ${total.newQuality}, ` +
      `NC ${total.oldNc} → ${total.newNc}, AFS ${total.oldAfs} → ${total.newAfs}`
  );
  fs.writeFileSync(path.join(process.cwd(), "data", "cache", "leads-reclass.txt"), out.join("\n"), "utf8");
}

main();
