import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateDomainDays,
  fetchMetrikaBehavior,
  metrikaCacheTtlMs,
  moscowToday,
  orderMissedFirst,
  readMissedCounters,
  rowsFromDomainDayTable
} from "../src/lib/connectors/metrika";
import { rangeFor } from "../src/lib/period";
import type { MetrikaAccount } from "../src/lib/types";
import { loadSettings } from "../src/lib/config";

const range = rangeFor("7d", new Date("2026-11-15T00:00:00Z"));

describe("кэш и разбор Метрики", () => {
  it("закрытый день кэшируется на 12 часов, сегодняшний — на 45 минут", () => {
    expect(metrikaCacheTtlMs("2026-11-14", new Date("2026-11-15T12:00:00Z"))).toBe(12 * 60 * 60 * 1000);
    expect(metrikaCacheTtlMs("2026-11-15", new Date("2026-11-15T10:00:00Z"))).toBe(45 * 60 * 1000);
  });

  it("режет один ответ с датой и доменом на текущий и прошлый период", () => {
    const rows = rowsFromDomainDayTable({
      data: [
        { dimensions: [{ name: "2026-11-10" }, { name: "www.sale.toyota-vnukovo.ru" }], metrics: [1500, 10, 20, 30, 2] },
        { dimensions: [{ name: "20261103" }, { name: "sale.toyota-vnukovo.ru" }], metrics: [40, 4, 10, 10, 1] },
        { dimensions: [{ name: "2026-11-10" }, { name: "service-toyota-vnukovo.ru" }], metrics: [700, 7, 50, 15, 1] }
      ]
    });
    const agg = aggregateDomainDays(rows, range);
    expect(agg.byHost.get("sale.toyota-vnukovo.ru")?.current.visits).toBe(1500);
    expect(agg.byHost.get("sale.toyota-vnukovo.ru")?.previous.visits).toBe(40);
    expect(agg.byHost.get("service-toyota-vnukovo.ru")?.current.visits).toBe(700);
    expect(agg.current.visits).toBe(2200);
    expect(agg.previous.visits).toBe(40);
    expect(agg.daily.find((day) => day.date === "2026-11-10")?.visits).toBe(2200);
  });

  it("при 429 показывает прошлый кэш, а не ноль", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-metrika-cache-"));
    process.env.BORISHOF_DATA_DIR = tmp;
    process.env.YANDEX_METRIKA_OAUTH_TOKEN = "test-token";
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const dimensions = new URL(String(input)).searchParams.get("dimensions") || "";
        if (fail) return new Response("quota_requests_by_uid", { status: 429 });
        if (dimensions.includes("startURLDomain")) {
          return new Response(
            JSON.stringify({
              data: [{ dimensions: [{ name: "2026-11-10" }, { name: "haval-borishof.ru" }], metrics: [3200, 1, 1, 1, 1] }]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      })
    );
    const accounts: MetrikaAccount[] = [
      {
        id: "ym-tandem-nc-haval-96291650",
        name: "HAVAL · NC",
        counterId: "96291650",
        token: "",
        brand: "HAVAL",
        contractor: "Tandem",
        line: "nc"
      }
    ];
    try {
      const first = await fetchMetrikaBehavior(accounts, range, 0);
      expect(first.projects.find((row) => row.projectId === "tandem-nc-haval")?.visits).toBe(3200);
      const cacheDir = path.join(tmp, "cache", "metrika");
      for (const file of fs.readdirSync(cacheDir)) {
        if (!file.endsWith(".json") || file.startsWith("quota")) continue;
        const full = path.join(cacheDir, file);
        const raw = JSON.parse(fs.readFileSync(full, "utf8")) as { savedAt: number };
        raw.savedAt = Date.now() - 13 * 60 * 60 * 1000;
        fs.writeFileSync(full, JSON.stringify(raw));
      }
      fail = true;
      const second = await fetchMetrikaBehavior(accounts, range, 0);
      expect(second.projects.find((row) => row.projectId === "tandem-nc-haval")?.visits).toBe(3200);
      expect(second.errors.join(" ")).toMatch(/кэш|Не загрузились|квота/);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.YANDEX_METRIKA_OAUTH_TOKEN;
      delete process.env.BORISHOF_DATA_DIR;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 20000);
});

describe("пропущенные счётчики", () => {
  it("вчерашний пропуск идёт раньше сегодняшнего", () => {
    const ordered = orderMissedFirst(
      [{ counterId: "a" }, { counterId: "b" }, { counterId: "c" }],
      [
        { counterId: "c", name: "C", missedOn: "2026-11-18", reason: "429" },
        { counterId: "a", name: "A", missedOn: "2026-11-19", reason: "403" }
      ],
      "2026-11-19"
    );
    expect(ordered.map((row) => row.counterId)).toEqual(["c", "a", "b"]);
  });

  it("на следующий день сначала запрашивает пропущенный кабинет и снимает его после успеха", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-metrika-priority-"));
    process.env.BORISHOF_DATA_DIR = tmp;
    process.env.YANDEX_METRIKA_OAUTH_TOKEN = "test-token";
    const day = moscowToday();
    const yesterday = new Date(`${day}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const missedOn = yesterday.toISOString().slice(0, 10);
    fs.mkdirSync(path.join(tmp, "cache", "metrika"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "cache", "metrika", "missed-counters.json"),
      JSON.stringify({ counters: [{ counterId: "222", name: "BMW · NC", missedOn, reason: "429" }] })
    );
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const id = new URL(String(input)).searchParams.get("ids") || "";
        if (!seen.includes(id)) seen.push(id);
        return new Response(
          JSON.stringify({
            data: [{ dimensions: [{ name: "2026-11-10" }, { name: "example.ru" }], metrics: [12, 1, 1, 1, 1] }]
          }),
          { status: 200 }
        );
      })
    );
    const accounts: MetrikaAccount[] = [
      { id: "ym-a", name: "HAVAL · NC", counterId: "111", token: "", brand: "HAVAL", contractor: "Tandem", line: "nc" },
      { id: "ym-b", name: "BMW · NC", counterId: "222", token: "", brand: "BMW", contractor: "Tandem", line: "nc" }
    ];
    try {
      await fetchMetrikaBehavior(accounts, range, 0);
      expect(seen[0]).toBe("222");
      expect(readMissedCounters().some((row) => row.counterId === "222")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.YANDEX_METRIKA_OAUTH_TOKEN;
      delete process.env.BORISHOF_DATA_DIR;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 20000);
});

describe("Seres снят", () => {
  it("не попадает в настройки даже из старого файла", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-seres-"));
    process.env.BORISHOF_DATA_DIR = tmp;
    fs.writeFileSync(
      path.join(tmp, "settings.json"),
      JSON.stringify({
        calltouch: [{ id: "ct-seres", name: "borishof-seres.ru", siteId: "66216", token: "", brand: "Seres", qualityTags: [] }],
        metrika: [{ id: "ym-seres", name: "Seres", counterId: "1", token: "", brand: "Seres" }],
        direct: [{ id: "d-seres", name: "Seres", token: "", clientLogin: "seres", contractor: "Tandem", brand: "Seres", line: "nc" }]
      })
    );
    const settings = loadSettings();
    expect(settings.calltouch.some((row) => /seres/i.test(`${row.brand}${row.siteId}${row.name}`))).toBe(false);
    expect(settings.metrika.some((row) => /seres/i.test(`${row.brand}${row.name}`))).toBe(false);
    expect(settings.direct.some((row) => /seres/i.test(`${row.brand}${row.name}${row.clientLogin}`))).toBe(false);
    delete process.env.BORISHOF_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
