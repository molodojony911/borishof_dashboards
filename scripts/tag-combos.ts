import fs from "fs";
import path from "path";
import { CALLTOUCH_CABINETS, cabinetLine } from "../src/lib/calltouch-catalog";
import type { LeadRow } from "../src/lib/types";

const DIR = path.join(process.cwd(), "data", "cache", "calltouch");

function main() {
  const bySite = new Map<string, Map<string, number>>();
  for (const file of fs.readdirSync(DIR)) {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as { rows?: LeadRow[] };
    for (const row of raw.rows || []) {
      const combo = (row.tags || []).slice().sort().join(" + ") || "(без тегов)";
      const map = bySite.get(row.site) || new Map<string, number>();
      map.set(combo, (map.get(combo) || 0) + 1);
      bySite.set(row.site, map);
    }
  }

  const out: string[] = [];
  for (const [site, combos] of bySite) {
    const cab = CALLTOUCH_CABINETS.find((c) => c.url === site || c.name === site);
    const total = Array.from(combos.values()).reduce((a, b) => a + b, 0);
    out.push(
      `\n### ${cab?.brand || "?"} — ${site} (линия ${cabinetLine(site) || "не определена"}), звонков ${total}`
    );
    Array.from(combos.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([combo, n]) => out.push(`   ${String(n).padStart(5)}  ${combo}`));
  }
  fs.writeFileSync(path.join(process.cwd(), "data", "cache", "tag-combos.txt"), out.join("\n"), "utf8");
}

main();
