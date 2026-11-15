import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { factsFromDashboard, joinPlanFact, matrixToPlans, parseClassifiedMatrix } from "../src/lib/plan-model";
import { parseCsv, parseNumberCell } from "../src/lib/tabular";

describe("планы и классифайды", () => {
  it("понимает деньги с неразрывным пробелом и процент", () => {
    expect(parseNumberCell("144\u00a0000₽")).toBe(144000);
    expect(parseNumberCell("40,00%")).toBe(40);
    expect(parseNumberCell("—")).toBeNull();
  });

  it("читает образец плана и сравнивает его с фактом периода", () => {
    const matrix = parseCsv(fs.readFileSync(path.join(process.cwd(), "data/samples/plans.csv"), "utf8"));
    const plans = matrixToPlans(matrix);
    expect(plans.find((row) => row.brand === "HAVAL" && row.line === "nc")?.spend).toBe(1500000);
    const joined = joinPlanFact(
      plans,
      factsFromDashboard(
        [{ contractor: "Tandem", brand: "HAVAL", line: "nc", current: { cost: 500000 }, qualityLeads: 100 }],
        [{ contractor: "Tandem", brand: "HAVAL", line: "nc", visits: 10000, sharedCounter: false, counterIds: ["1"] }]
      ),
      "2026-11",
      15
    );
    const haval = joined.find((row) => row.brand === "HAVAL" && row.line === "nc");
    expect(haval?.factSpend).toBe(500000);
    expect(haval?.factVisits).toBe(10000);
    expect(haval?.periodSpend).toBeCloseTo(1500000 * (15 / 30), 5);
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
