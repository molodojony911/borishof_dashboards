import fs from "fs";
import path from "path";

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
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

async function tokenInfo(token: string) {
  const res = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text();
  let json: { login?: string; id?: string; client_id?: string; error?: string; error_description?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    json = { error: text.slice(0, 180) };
  }
  return { status: res.status, json };
}

async function main() {
  loadEnv();
  const vault = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "direct-tokens.json"), "utf8")) as Record<
    string,
    string
  >;
  const rows: Array<[string, string]> = [
    ["Tandem (файл токенов)", vault.Tandem || ""],
    ["RTA env (новое приложение)", process.env.YANDEX_DIRECT_RTA_OAUTH_TOKEN || ""],
    ["RTA файл (старый)", vault.RTA || ""]
  ];
  const out: string[] = [];
  for (const [label, token] of rows) {
    if (!token) {
      out.push(`${label}: нет токена`);
      continue;
    }
    const info = await tokenInfo(token);
    out.push(
      `${label}: ${mask(token)} → HTTP ${info.status}, login=${info.json.login || "—"}, client_id=${info.json.client_id || "—"}, err=${info.json.error || info.json.error_description || "нет"}`
    );
  }
  fs.writeFileSync(path.join(process.cwd(), "data", "cache", "oauth-apps.txt"), out.join("\n"), "utf8");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
