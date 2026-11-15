const fs = require("fs");

const env = fs.readFileSync(".env", "utf8");
const token = (env.match(/YANDEX_METRIKA_OAUTH_TOKEN=(.*)/) || [])[1].trim();
const src = fs.readFileSync("src/lib/catalog.ts", "utf8");
const ids = [...new Set([...src.matchAll(/counterIds: \[([^\]]+)\]/g)].flatMap((m) => m[1].match(/\d+/g) || []))];

function pick(goals, re) {
  return goals.filter((g) => re.test(g.name));
}

(async () => {
  const out = [];
  for (const id of ids) {
    const res = await fetch(`https://api-metrika.yandex.net/management/v1/counter/${id}/goals`, {
      headers: { Authorization: `OAuth ${token}` }
    });
    const json = await res.json();
    const goals = (json.goals || []).map((g) => ({
      id: String(g.id),
      name: g.name,
      type: g.type
    }));
    out.push({
      counterId: id,
      http: res.status,
      error: json.errors || json.message || null,
      op: pick(goals, /звонок\s*оп/i),
      os: pick(goals, /звонок\s*ос/i),
      calls: pick(goals, /звон/i)
    });
    await new Promise((r) => setTimeout(r, 60));
  }
  fs.writeFileSync("data/metrika-goals.json", JSON.stringify(out, null, 2));
  console.log(`counters=${out.length} withOp=${out.filter((x) => x.op.length).length} withOs=${out.filter((x) => x.os.length).length} errors=${out.filter((x) => x.http !== 200).length}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
