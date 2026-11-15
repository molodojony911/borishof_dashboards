import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attributeProjectVisits,
  fetchMetrikaBehavior,
  metricTotal,
  type ProjectRef
} from "../src/lib/connectors/metrika";
import { applyProjectVisits } from "../src/lib/pipeline";
import type { MetrikaAccount } from "../src/lib/types";
import { rangeFor } from "../src/lib/period";

const projects: ProjectRef[] = [
  {
    projectId: "tandem-nc-toyota",
    brand: "TOYOTA",
    line: "nc",
    contractor: "Tandem",
    site: "https://sale.toyota-vnukovo.ru/",
    counterIds: ["92549388"]
  },
  {
    projectId: "tandem-afs-toyota",
    brand: "TOYOTA",
    line: "afs",
    contractor: "Tandem",
    site: "https://service-toyota-vnukovo.ru/",
    counterIds: ["92549388"]
  },
  {
    projectId: "tandem-nc-haval",
    brand: "HAVAL",
    line: "nc",
    contractor: "Tandem",
    site: "https://haval-borishof.ru/",
    counterIds: ["96291650"]
  },
  {
    projectId: "rta-nc-belgee",
    brand: "BELGEE",
    line: "nc",
    contractor: "RTA",
    site: "https://sales.belgee-borishof.ru/",
    counterIds: ["97940886", "101605233"]
  }
];

describe("визиты Метрики по проектам", () => {
  it("читает totals и строку data и раскладывает визиты по сайтам", () => {
    expect(metricTotal({ totals: [1500, 800] }, 0)).toBe(1500);
    expect(metricTotal({ totals: [[3200, 2000, 33]] }, 0)).toBe(3200);
    expect(metricTotal({ totals: [[420], [200]] }, 1)).toBe(200);
    expect(metricTotal({ data: [{ dimensions: [], metrics: [700, 300] }] }, 0)).toBe(700);

    const tables = new Map([
      ["92549388", { current: { totals: [9999] }, previous: { totals: [1000] } }],
      ["92549388|sale.toyota-vnukovo.ru", { current: { totals: [1500, 800, 40] }, previous: { totals: [[400]] } }],
      [
        "92549388|service-toyota-vnukovo.ru",
        { current: { data: [{ metrics: [700, 300] }] }, previous: { totals: [200] } }
      ],
      ["96291650", { current: { totals: [[3200, 2000, 33]] }, previous: { totals: [2100] } }],
      ["97940886", { current: { totals: [100] }, previous: { totals: [80] } }],
      ["101605233", { current: { totals: [50] }, previous: { totals: [40] } }]
    ]);
    const rows = attributeProjectVisits(projects, tables);
    expect(rows.find((row) => row.projectId === "tandem-nc-toyota")?.visits).toBe(1500);
    expect(rows.find((row) => row.projectId === "tandem-afs-toyota")?.visits).toBe(700);
    expect(rows.find((row) => row.projectId === "tandem-nc-haval")?.visits).toBe(3200);
    expect(rows.find((row) => row.projectId === "rta-nc-belgee")?.visits).toBe(150);
    const brands = applyProjectVisits([], rows);
    expect(brands.find((row) => row.name === "TOYOTA")?.visits).toBe(2200);
    expect(brands.find((row) => row.name === "BELGEE")?.visits).toBe(150);
  });

  it("запрос общего счётчика режется доменом сайта", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-metrika-"));
    process.env.BORISHOF_DATA_DIR = tmp;
    process.env.YANDEX_METRIKA_OAUTH_TOKEN = "test-token";
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        urls.push(url);
        const parsed = new URL(url);
        const ids = parsed.searchParams.get("ids");
        const dimensions = parsed.searchParams.get("dimensions") || "";
        if (dimensions.includes("startURLDomain")) {
          const toyota = [
            { dimensions: [{ name: "2026-11-10" }, { name: "sale.toyota-vnukovo.ru" }], metrics: [1500, 10, 20, 30, 2] },
            { dimensions: [{ name: "2026-11-10" }, { name: "service-toyota-vnukovo.ru" }], metrics: [700, 8, 40, 20, 1] }
          ];
          const haval = [
            { dimensions: [{ name: "2026-11-10" }, { name: "haval-borishof.ru" }], metrics: [3200, 20, 30, 40, 2] }
          ];
          const data = ids === "92549388" ? toyota : haval;
          return new Response(JSON.stringify({ totals: [], data }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ totals: [0], data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      })
    );
    const accounts: MetrikaAccount[] = [
      {
        id: "ym-tandem-nc-toyota-92549388",
        name: "TOYOTA NC",
        counterId: "92549388",
        token: "",
        brand: "TOYOTA",
        contractor: "Tandem",
        line: "nc"
      },
      {
        id: "ym-tandem-afs-toyota-92549388",
        name: "TOYOTA AFS",
        counterId: "92549388",
        token: "",
        brand: "TOYOTA",
        contractor: "Tandem",
        line: "afs"
      },
      {
        id: "ym-tandem-nc-haval-96291650",
        name: "HAVAL",
        counterId: "96291650",
        token: "",
        brand: "HAVAL",
        contractor: "Tandem",
        line: "nc"
      }
    ];
    try {
      const pack = await fetchMetrikaBehavior(accounts, rangeFor("7d", new Date("2026-11-15T00:00:00Z")), 0);
      const north = pack.projects.find((row) => row.projectId === "tandem-nc-toyota");
      const south = pack.projects.find((row) => row.projectId === "tandem-afs-toyota");
      const haval = pack.projects.find((row) => row.projectId === "tandem-nc-haval");
      expect(north?.visits).toBe(1500);
      expect(north?.name).toContain("TOYOTA");
      expect(south?.visits).toBe(700);
      expect(haval?.visits).toBe(3200);
      const queries = urls.map((url) => new URL(url).searchParams);
      const domainQueries = queries.filter((params) => (params.get("dimensions") || "").includes("startURLDomain"));
      expect(domainQueries.every((params) => !params.get("filters"))).toBe(true);
      expect(domainQueries.filter((params) => params.get("ids") === "92549388")).toHaveLength(1);
      expect(domainQueries[0]?.get("date1")).toBeTruthy();
      expect(domainQueries[0]?.get("dimensions")).toContain("ym:s:date");
      const again = urls.length;
      await fetchMetrikaBehavior(accounts, rangeFor("7d", new Date("2026-11-15T00:00:00Z")), 0);
      expect(urls.length).toBe(again);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.YANDEX_METRIKA_OAUTH_TOKEN;
      delete process.env.BORISHOF_DATA_DIR;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
