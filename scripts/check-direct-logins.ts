import { loadSettings } from "../src/lib/config";
import { fetchDirectCampaigns } from "../src/lib/connectors/direct";
import { rangeFor } from "../src/lib/period";

async function main() {
  const settings = loadSettings();
  const range = rangeFor(process.argv[2] === "30d" ? "30d" : "7d");
  const pack = await fetchDirectCampaigns(settings.direct, range);

  const spend = pack.rows.reduce((sum, row) => sum + row.current.cost, 0);

  console.log(`Кабинетов в справочнике: ${settings.direct.length}`);
  console.log(`Кампаний получено: ${pack.rows.length}, расход за ${range.key}: ${Math.round(spend)} ₽`);
  for (const acc of settings.direct) {
    const rows = pack.rows.filter((r) => r.login === acc.clientLogin);
    const cost = rows.reduce((s, r) => s + r.current.cost, 0);
    console.log(
      `  ${acc.clientLogin.padEnd(16)} ${acc.brand} · ${acc.line} · ${acc.contractor} → ${rows.length} кампаний, ${Math.round(cost)} ₽`
    );
  }
  console.log("Ошибки:");
  for (const e of pack.errors) console.log("  •", e);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
