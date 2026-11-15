import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCalltouchTokens, loadDirectTokens, sharedMetrikaToken, sharedRtaDirectToken } from "../src/lib/config";
import { buildDirectDeep } from "../src/lib/deep";
import { buildDashboard } from "../src/lib/pipeline";

const TOKEN_ENV = [
  "YANDEX_METRIKA_OAUTH_TOKEN",
  "YANDEX_DIRECT_RTA_OAUTH_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_MIN_SEVERITY",
  "TELEGRAM_DRY_RUN",
  "BORISHOF_DATA_DIR"
] as const;

let savedEnv: Partial<Record<(typeof TOKEN_ENV)[number], string | undefined>> = {};
let tmp = "";

function clearTokenEnv(): void {
  for (const key of TOKEN_ENV) delete process.env[key];
}

beforeEach(() => {
  savedEnv = {};
  for (const key of TOKEN_ENV) savedEnv[key] = process.env[key];
  // Даже если Vitest или оболочка уже подставили боевые токены, тест их не видит.
  process.env.YANDEX_METRIKA_OAUTH_TOKEN = "must-not-leak";
  process.env.YANDEX_DIRECT_RTA_OAUTH_TOKEN = "must-not-leak";
  process.env.TELEGRAM_BOT_TOKEN = "must-not-leak";
  process.env.TELEGRAM_CHAT_ID = "must-not-leak";
  clearTokenEnv();

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-test-"));
  const withTokens = path.join(tmp, "with-tokens");
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(withTokens);
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(withTokens, "direct-tokens.json"), JSON.stringify({ Tandem: "not-a-secret" }));
  fs.writeFileSync(path.join(withTokens, "calltouch-tokens.json"), JSON.stringify({ "47639": "not-a-secret" }));
  process.env.BORISHOF_DATA_DIR = withTokens;
  expect(loadDirectTokens().Tandem).toBe("not-a-secret");
  expect(loadCalltouchTokens()["47639"]).toBe("not-a-secret");
  process.env.BORISHOF_DATA_DIR = empty;
  expect(loadDirectTokens()).toEqual({});
  expect(loadCalltouchTokens()).toEqual({});
  expect(sharedMetrikaToken()).toBe("");
  expect(sharedRtaDirectToken()).toBe("");

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Тест не должен ходить в сеть");
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of TOKEN_ENV) {
    const previous = savedEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("дашборд без токенов", () => {
  it("не подставляет фикстуры и не ходит в сеть", async () => {
    const data = await buildDashboard("14d");
    expect(data.mode).not.toBe("demo");
    expect(data.campaigns).toEqual([]);
    expect(data.leads.total).toBe(0);
    expect(data.behavior.visits).toBe(0);
    expect(data.health.length).toBeGreaterThan(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const tenet = await buildDashboard("7d", { contractor: "Tandem", line: "nc", brand: "Tenet" });
    expect(tenet.range.key).toBe("7d");
    expect(tenet.campaigns).toEqual([]);
    expect(tenet.series).toHaveLength(7);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("разбор Директа без токена не показывает демо запросов", async () => {
    const deep = await buildDirectDeep("14d", { contractor: "", line: "", brand: "" });
    expect(deep.queries.junk).toEqual([]);
    expect(deep.placements.waste).toEqual([]);
    expect(deep.insights).toEqual([]);
    expect(deep.errors.length).toBeGreaterThan(0);
    expect(deep.errors.join(" ")).not.toMatch(/Демо/);
    expect(deep.adCopyEnabled).toBe(false);
    expect(deep.ads.review.weak).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
