import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { factsFromDashboard, joinPlanFact, matrixToPlans, parseClassifiedMatrix } from "../src/lib/plan-model";
import { parseCsv, parseNumberCell } from "../src/lib/tabular";
import { buildPlanRunRateAlerts } from "../src/lib/engines/alerts";
import { DEFAULT_THRESHOLDS } from "../src/lib/defaults";

describe("планы и классифайды", () => {
  it("понимает деньги с неразрывным пробелом и процент", () => {
    expect(parseNumberCell("144\u00a0000₽")).toBe(144000);
    expect(parseNumberCell("500 000,00 ₽")).toBe(500000);
    expect(parseNumberCell("36,4%")).toBe(36.4);
    expect(parseNumberCell("40,00%")).toBe(40);
    expect(parseNumberCell("—")).toBeNull();
  });

  it("читает сводку Борисхоф: SALES это NC, AFTERSALES это AFS, только план", () => {
    const matrix = parseCsv(fs.readFileSync(path.join(process.cwd(), "data/samples/plans-summary.csv"), "utf8"));
    const plans = matrixToPlans(matrix, { onlyRlCpl: true });
    expect(plans).toHaveLength(3);
    const north = plans.find((row) => row.brand === "Демо Север");
    expect(north).toMatchObject({ month: "2026-11", contractor: "Tandem", line: "nc", leads: 300, cpl: 4500, spend: null });
    expect(plans.find((row) => row.brand === "TANK")).toMatchObject({ contractor: "Tandem", line: "nc", leads: 80 });
    expect(plans.find((row) => row.brand === "Демо Юг")).toMatchObject({ contractor: "RTA", line: "afs", leads: 40, cpl: 2700 });
    expect(plans.some((row) => row.leads === 999 || row.cpl === 9999)).toBe(false);
  });

  it("из сводки берёт только план РЛ и CPL, без факта и расхода", () => {
    const matrix = parseCsv(fs.readFileSync(path.join(process.cwd(), "data/samples/plans.csv"), "utf8"));
    const plans = matrixToPlans(matrix, { onlyRlCpl: true });
    const haval = plans.find((row) => row.month === "2026-11" && row.brand === "HAVAL" && row.line === "nc");
    expect(haval?.leads).toBe(300);
    expect(haval?.cpl).toBe(4500);
    expect(haval?.spend).toBeNull();
    expect(haval?.visits).toBeNull();
    expect(plans.some((row) => row.leads === 120)).toBe(false);
    expect(plans.some((row) => row.spend != null)).toBe(false);
    const joined = joinPlanFact(
      plans,
      factsFromDashboard(
        [{ contractor: "Tandem", brand: "HAVAL", line: "nc", current: { cost: 500000 }, qualityLeads: 100 }],
        []
      ),
      "2026-11",
      15
    );
    const fact = joined.find((row) => row.brand === "HAVAL" && row.line === "nc");
    expect(fact?.factLeads).toBe(100);
    expect(fact?.forecastLeads).toBeCloseTo(100 * (30 / 15), 5);
    expect(fact?.factCpl).toBe(5000);
  });

  it("алерт run-rate ловит недобор РЛ и дорогой CPL и молчит, когда темп в плане", () => {
    const plan = {
      month: "2026-11",
      contractor: "Tandem",
      brand: "HAVAL",
      line: "nc" as const,
      spend: null,
      leads: 300,
      visits: null,
      cpl: 4000
    };
    const behind = buildPlanRunRateAlerts(
      [plan],
      [{ contractor: "Tandem", brand: "HAVAL", line: "nc", spend: 800000, leads: 40, visits: 0 }],
      "2026-11",
      15,
      DEFAULT_THRESHOLDS
    );
    expect(behind.map((item) => item.id).sort()).toEqual(["plan-cpl-Tandem|HAVAL|nc", "plan-rl-Tandem|HAVAL|nc"]);
    expect(behind.find((item) => item.id.startsWith("plan-rl"))?.severity).toBe("critical");
    const onTrack = buildPlanRunRateAlerts(
      [plan],
      [{ contractor: "Tandem", brand: "HAVAL", line: "nc", spend: 200000, leads: 150, visits: 0 }],
      "2026-11",
      15,
      DEFAULT_THRESHOLDS
    );
    expect(onTrack).toEqual([]);
    const tooShort = buildPlanRunRateAlerts(
      [plan],
      [{ contractor: "Tandem", brand: "HAVAL", line: "nc", spend: 800000, leads: 40, visits: 0 }],
      "2026-11",
      3,
      DEFAULT_THRESHOLDS
    );
    expect(tooShort).toEqual([]);
  });

  it("разбирает лист классифайдов по названиям колонок, а не по их номеру", () => {
    const matrix = parseCsv(fs.readFileSync(path.join(process.cwd(), "data/samples/classifieds.csv"), "utf8"));
    const sheet = parseClassifiedMatrix(matrix);
    expect(sheet.month).toBe("2026-11");
    const north = sheet.projects.find((row) => row.project === "Демо Север");
    expect(north?.planSpend).toBe(100000);
    expect(north?.factSpend).toBe(40000);
    expect(north?.planLeads).toBe(20);
    expect(north?.factLeads).toBe(8);
    expect(north?.runRate).toBe(40);
    expect(north?.cplPlan).toBe(5000);
    const total = sheet.projects.find((row) => row.kind === "total");
    expect(total?.factSpend).toBe(110000);
    expect(sheet.platformForecast).toEqual(
      expect.arrayContaining([
        { project: "Демо Север", platform: "auto.ru", forecastSpend: 50000 },
        { project: "Демо Юг", platform: "avito", forecastSpend: 35000 }
      ])
    );
    expect(sheet.wallets[0]).toMatchObject({ project: "Демо Север", withVatAuto: 10000, refillAvito: 1000 });
    expect(JSON.stringify(sheet)).not.toMatch(/Avatr|Belgee|144\u00a0000/);
  });

  it("принимает плоский csv классифайдов", () => {
    const sheet = parseClassifiedMatrix(
      parseCsv("month;contractor;brand;platform;metric;plan;fact\n2026-11;Tandem;HAVAL;Авто.ру;лиды;100;80\n")
    );
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0].fact).toBe(80);
  });
});
