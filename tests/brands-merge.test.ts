import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { ACCOUNTS, BRANDS, parseFilters } from "../src/lib/catalog";
import { CALLTOUCH_CABINETS } from "../src/lib/calltouch-catalog";
import { loadSettings } from "../src/lib/config";
import { factsFromDashboard, joinPlanFact, matrixToPlans, parseClassifiedMatrix } from "../src/lib/plan-model";
import { parseCsv } from "../src/lib/tabular";

describe("Exeed и Esteo — один проект", () => {
  it("в справочнике один бренд, оба сайта Calltouch остаются", () => {
    expect(BRANDS.filter((name) => /exeed|esteo|эксид|эстео/i.test(name))).toEqual(["Exeed + Esteo"]);
    expect(ACCOUNTS.filter((row) => row.brand === "Exeed + Esteo").map((row) => row.id).sort()).toEqual([
      "rta-afs-exeed",
      "rta-nc-exeed"
    ]);
    expect(CALLTOUCH_CABINETS.filter((row) => row.brand === "Exeed + Esteo").map((row) => row.siteId).sort()).toEqual([
      "47648",
      "82756"
    ]);
    expect(parseFilters((key) => (key === "brand" ? "Эстео" : "")).brand).toBe("Exeed + Esteo");
  });

  it("в сводном листе складывает РЛ Exeed и Esteo и взвешивает CPL", () => {
    const plans = matrixToPlans(
      parseCsv(
        "Марка,Агентство,SALES Источник,План РЛ,План CPL ОП\nEXEED,RTA,Яндекс Директ,100,\"4000,00 ₽\"\nЭстео,RTA,Яндекс Директ,50,\"2000,00 ₽\"\n,,AFTERSALES\nМарка,Агентство,Источник,План РЛ,План CPL ОП\nEXEED,RTA,Яндекс Директ,10,\"1000,00 ₽\"\n01.11.2026\n"
      ),
      { onlyRlCpl: true }
    );
    const nc = plans.find((row) => row.brand === "Exeed + Esteo" && row.line === "nc");
    const afs = plans.find((row) => row.brand === "Exeed + Esteo" && row.line === "afs");
    expect(nc).toMatchObject({ month: "2026-11", contractor: "RTA", leads: 150, spend: null });
    expect(nc?.cpl).toBeCloseTo((4000 * 100 + 2000 * 50) / 150);
    expect(afs).toMatchObject({ contractor: "RTA", leads: 10, cpl: 1000, spend: null });
  });

  it("суммирует планы РЛ и усредняет CPL по плану лидов", () => {
    const plans = matrixToPlans(
      parseCsv("month,contractor,brand,line,leads,cpl\n2026-11,RTA,EXEED,nc,100,4000\n2026-11,RTA,Esteo,nc,50,2000\n2026-11,RTA,Эксид,afs,10,1000\n")
    );
    const nc = plans.find((row) => row.brand === "Exeed + Esteo" && row.line === "nc");
    const afs = plans.find((row) => row.brand === "Exeed + Esteo" && row.line === "afs");
    expect(plans.filter((row) => row.brand === "Exeed + Esteo")).toHaveLength(2);
    expect(nc?.leads).toBe(150);
    expect(nc?.cpl).toBeCloseTo((4000 * 100 + 2000 * 50) / 150);
    expect(afs?.leads).toBe(10);
    const facts = factsFromDashboard(
      [
        { contractor: "RTA", brand: "EXEED", line: "nc", current: { cost: 100 }, qualityLeads: 4 },
        { contractor: "RTA", brand: "Esteo", line: "nc", current: { cost: 50 }, qualityLeads: 2 }
      ],
      []
    );
    expect(facts).toEqual([
      expect.objectContaining({ contractor: "RTA", brand: "Exeed + Esteo", line: "nc", spend: 150, leads: 6 })
    ]);
    const joined = joinPlanFact(plans, facts, "2026-11", 10);
    expect(joined.find((row) => row.line === "nc")?.factLeads).toBe(6);
  });

  it("в классифайдах берёт готовую строку Exeed+Esteo и не прибавляет части", () => {
    const withTotal = parseClassifiedMatrix(
      parseCsv(
        "11.2026\n,План-факт,,План расход,Факт расход,План лиды,Факт лиды\n,EXEED,,100,40,10,4\n,Esteo,,50,10,5,1\n,Exeed+Esteo,,999,80,30,9\n,HAVAL,,10,10,1,1\n"
      )
    );
    const combined = withTotal.projects.filter((row) => row.project === "Exeed + Esteo");
    expect(combined).toHaveLength(1);
    expect(combined[0]?.planSpend).toBe(999);
    expect(combined[0]?.factLeads).toBe(9);
    expect(withTotal.projects.some((row) => row.project === "EXEED" || row.project === "Esteo")).toBe(false);
    expect(withTotal.projects.find((row) => row.project === "HAVAL")?.planSpend).toBe(10);

    const parts = parseClassifiedMatrix(
      parseCsv(
        "11.2026\n,План-факт,,План расход,Факт расход,План лиды,Факт лиды,CPL план\n,EXEED,,100,40,10,4,1000\n,Эстео,,50,10,5,1,2000\n"
      )
    );
    expect(parts.projects).toHaveLength(1);
    expect(parts.projects[0]).toMatchObject({ project: "Exeed + Esteo", planSpend: 150, factSpend: 50, planLeads: 15, factLeads: 5 });
    expect(parts.projects[0]?.cplPlan).toBeCloseTo((1000 * 10 + 2000 * 5) / 15);
  });

  it("старый settings.json не оставляет Seres и переименовывает Exeed", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-brands-"));
    process.env.BORISHOF_DATA_DIR = tmp;
    fs.writeFileSync(
      path.join(tmp, "settings.json"),
      JSON.stringify({
        calltouch: [
          { id: "ct-exeed", name: "inchcape-exeed.ru", siteId: "47648", token: "", brand: "EXEED", contractor: "RTA", qualityTags: [] },
          { id: "ct-seres", name: "borishof-seres.ru", siteId: "66216", token: "", brand: "Seres", qualityTags: [] }
        ],
        metrika: [{ id: "ym-rta-nc-exeed-96985437", name: "EXEED", counterId: "96985437", token: "", brand: "EXEED", line: "nc" }],
        direct: [
          {
            id: "rta-nc-exeed",
            name: "EXEED · NC",
            token: "",
            clientLogin: "porg-4uklaahu",
            contractor: "RTA",
            brand: "EXEED",
            line: "nc"
          }
        ]
      })
    );
    const settings = loadSettings();
    expect(settings.calltouch.some((row) => /seres|66216/i.test(`${row.brand} ${row.siteId} ${row.name}`))).toBe(false);
    expect(settings.calltouch.filter((row) => row.brand === "Exeed + Esteo").map((row) => row.siteId).sort()).toEqual(["47648", "82756"]);
    expect(settings.direct.find((row) => row.id === "rta-nc-exeed")?.brand).toBe("Exeed + Esteo");
    expect(settings.metrika.find((row) => row.counterId === "96985437")?.brand).toBe("Exeed + Esteo");
    delete process.env.BORISHOF_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
