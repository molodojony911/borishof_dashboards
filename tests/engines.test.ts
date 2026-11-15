import { describe, expect, it } from "vitest";
import fs from "fs";
import { buildAlerts, computeCampaign } from "../src/lib/engines/alerts";
import { buildHypotheses } from "../src/lib/engines/hypotheses";
import { DEFAULT_THRESHOLDS } from "../src/lib/defaults";
import { median, robustZ } from "../src/lib/stats";
import { eachDate, rangeFor } from "../src/lib/period";
import { scaleCampaigns } from "../src/lib/mock";
import { pairCampaignReports } from "../src/lib/connectors/direct";
import { parseMetrikaGoals } from "../src/lib/goals-file";
import { selectTelegramAlerts } from "../src/lib/connectors/telegram";
import type { AlertThresholds, BehaviorSnapshot, CampaignRow, DailyPoint, LeadSummary } from "../src/lib/types";

function behavior(patch: Partial<BehaviorSnapshot> = {}): BehaviorSnapshot {
  return {
    visits: 0,
    users: 0,
    bounceRate: 0,
    avgDurationSec: 0,
    pageDepth: 0,
    previousVisits: 0,
    previousBounceRate: 0,
    previousDurationSec: 0,
    previousPageDepth: 0,
    goalLeads: 0,
    previousGoalLeads: 0,
    directClicks: 0,
    metrikaDirectVisits: 0,
    funnel: [],
    pages: [],
    paths: [],
    sources: [],
    devices: [],
    byCampaign: [],
    ...patch
  };
}

function campaign(patch: Partial<CampaignRow>): CampaignRow {
  return {
    id: "c1",
    directId: "1",
    name: "HAVAL | Поиск",
    contractor: "Tandem",
    brand: "HAVAL",
    line: "nc",
    type: "search_model",
    login: "porg-test",
    current: { impressions: 20000, clicks: 1000, cost: 100000 },
    previous: { impressions: 20000, clicks: 1000, cost: 100000 },
    totalLeads: 20,
    previousTotalLeads: 20,
    qualityLeads: 10,
    previousQualityLeads: 10,
    calls: 20,
    previousCalls: 20,
    formLeads: 0,
    previousFormLeads: 0,
    ...patch
  };
}

const thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS };

describe("статистика и период", () => {
  it("медиана и робастный z не шумят на ровном ряде и ловят выброс", () => {
    expect(median([4, 1, 9])).toBe(4);
    expect(robustZ(10, [10, 10, 10, 10, 10])).toBe(0);
    expect(robustZ(10, [1, 2])).toBeNull();
    const z = robustZ(400, [100, 100, 100, 100, 100, 400]);
    expect(z).not.toBeNull();
    expect(z as number).toBeGreaterThan(3);
  });

  it("период 7 дней и предыдущее окно той же длины", () => {
    const range = rangeFor("7d", new Date("2026-10-26T12:00:00Z"));
    expect(eachDate(range.from, range.to)).toHaveLength(7);
    expect(eachDate(range.previousFrom, range.previousTo)).toHaveLength(7);
    expect(range.to < range.from).toBe(false);
    expect(range.previousTo < range.from).toBe(true);
  });
});

describe("алерты", () => {
  it("не ставит CTR на кампанию без объёма и ставит, когда объём есть", () => {
    const noisy = computeCampaign(
      campaign({
        current: { impressions: 200, clicks: 20, cost: 2000 },
        previous: { impressions: 200, clicks: 80, cost: 2000 }
      })
    );
    const real = computeCampaign(
      campaign({
        id: "ctr",
        name: "Tenet | Поиск",
        current: { impressions: 50000, clicks: 900, cost: 220000 },
        previous: { impressions: 48000, clicks: 3600, cost: 180000 }
      })
    );
    const alerts = buildAlerts([noisy, real], behavior(), 0, 0, 0, 0, thresholds);
    expect(alerts.some((a) => a.id === "ctr-c1")).toBe(false);
    const hit = alerts.find((a) => a.id === "ctr-ctr");
    expect(hit?.severity).toBe("critical");
    expect(hit?.explanation).toMatch(/порога/i);
    expect(hit?.ruleId).toBeTruthy();
    expect(hit?.recommendation.length).toBeGreaterThan(40);
  });

  it("ловит ноль показов, расход без лидов и не орёт на новую кампанию", () => {
    const paused = computeCampaign(
      campaign({
        id: "paused",
        name: "HAVAL | пауза",
        current: { impressions: 0, clicks: 0, cost: 0 },
        previous: { impressions: 15000, clicks: 700, cost: 80000 }
      })
    );
    const fresh = computeCampaign(
      campaign({
        id: "fresh",
        name: "Новая",
        current: { impressions: 100, clicks: 10, cost: 5000 },
        previous: { impressions: 0, clicks: 0, cost: 0 }
      })
    );
    const empty = computeCampaign(
      campaign({
        id: "rsya",
        name: "CHERY | РСЯ",
        type: "rsya",
        current: { impressions: 200000, clicks: 1500, cost: 130000 },
        previous: { impressions: 180000, clicks: 1400, cost: 120000 },
        qualityLeads: 0,
        previousQualityLeads: 0,
        calls: 18,
        previousCalls: 16
      })
    );
    const alerts = buildAlerts([paused, fresh, empty], behavior(), 0, 0, 0, 0, thresholds);
    expect(alerts.some((a) => a.metric === "impressions" && a.entity.includes("пауза"))).toBe(true);
    expect(alerts.some((a) => a.id.startsWith("zero-impr-fresh"))).toBe(false);
    expect(alerts.some((a) => a.id === "zero-rsya")).toBe(true);
    expect(alerts.some((a) => a.id === "ctr-fresh")).toBe(false);
  });

  it("падение звонков требует базы, скачок расхода — медианы и z-score", () => {
    const none = buildAlerts([], behavior(), 10, 12, 30, 32, thresholds);
    expect(none.some((a) => a.metric === "calls")).toBe(false);
    const dropped = buildAlerts([], behavior(), 10, 40, 20, 50, thresholds);
    expect(dropped.some((a) => a.id === "calls")).toBe(true);

    const series: DailyPoint[] = [100000, 100000, 100000, 100000, 100000, 350000].map((spend, i) => ({
      date: `2026-10-0${i + 1}`,
      spend,
      clicks: 10,
      totalLeads: 1,
      qualityLeads: 1,
      visits: 20,
      calls: 2
    }));
    const spike = buildAlerts([], behavior(), 0, 0, 0, 0, thresholds, { series, periodDays: 6 });
    expect(spike.some((a) => a.id.startsWith("spend-spike"))).toBe(true);
    const flat = buildAlerts(
      [],
      behavior(),
      0,
      0,
      0,
      0,
      { ...thresholds, anomalyZ: 0 },
      { series, periodDays: 6 }
    );
    expect(flat.some((a) => a.id.startsWith("spend-spike"))).toBe(false);
  });

  it("темп бюджета сравнивает расход с месячным планом кабинета", () => {
    const row = computeCampaign(
      campaign({
        id: "genesis",
        name: "Genesis | Поиск",
        brand: "Genesis",
        current: { impressions: 18000, clicks: 1400, cost: 160000 },
        previous: { impressions: 17000, clicks: 1300, cost: 150000 }
      })
    );
    const alerts = buildAlerts([], behavior(), 0, 0, 0, 0, thresholds, {
      periodDays: 14,
      budgets: [{ brand: "Genesis", line: "nc", contractor: "Tandem", monthlyBudget: 200000 }]
    });
    expect(alerts.some((a) => a.metric === "budget")).toBe(false);
    const paced = buildAlerts([row], behavior(), 0, 0, 0, 0, thresholds, {
      periodDays: 14,
      budgets: [{ brand: "Genesis", line: "nc", contractor: "Tandem", monthlyBudget: 200000 }]
    });
    expect(paced.some((a) => a.id.includes("budget-over"))).toBe(true);
  });
});

describe("гипотезы", () => {
  it("из отказа и короткой сессии собирает A/B с ICE и метрикой", () => {
    const items = buildHypotheses(
      behavior({
        visits: 5000,
        previousVisits: 4800,
        bounceRate: 40,
        goalLeads: 40,
        previousGoalLeads: 50,
        pages: [
          {
            path: "/tenet",
            title: "Tenet",
            visits: 1800,
            bounceRate: 70,
            avgDurationSec: 14,
            pageDepth: 1.1,
            calls: 2,
            cr: 0.11,
            deviceGap: 0.7
          }
        ],
        devices: [
          { device: "mobile", visits: 3400, bounceRate: 55, cr: 0.4, calls: 14 },
          { device: "desktop", visits: 1400, bounceRate: 28, cr: 2.5, calls: 35 },
          { device: "tablet", visits: 200, bounceRate: 30, cr: 1, calls: 2 }
        ],
        funnel: [
          { id: "visit", name: "Визит", value: 5000, previous: 4800 },
          { id: "goal", name: "Лиды Метрики", value: 40, previous: 50 },
          { id: "quality", name: "Качественный лид", value: 20, previous: 24 }
        ],
        pageSignals: [{ path: "/tenet", scroll50Pct: 18, deadClicks: 40, webvisorVisits: 200 }]
      }),
      { quality: 20, total: 40 } as Pick<LeadSummary, "quality" | "total"> as LeadSummary
    );
    expect(items.length).toBeGreaterThan(0);
    const page = items.find((item) => item.entity === "/tenet" || item.id.includes("tenet") || item.id.includes("signal"));
    expect(page).toBeTruthy();
    expect(page?.test.method).toBe("A/B");
    expect(page?.test.primaryMetric.length).toBeGreaterThan(5);
    expect(page?.ice.score).toBeGreaterThan(0);
    expect(page?.pie.score).toBeGreaterThan(0);
    expect(page?.ruleId).toBeTruthy();
    expect(items.some((item) => item.id === "hyp-mobile")).toBe(true);
  });

  it("на тихом сайте не плодит гипотезы", () => {
    const items = buildHypotheses(
      behavior({
        visits: 2000,
        previousVisits: 2000,
        bounceRate: 30,
        goalLeads: 40,
        previousGoalLeads: 40,
        pages: [
          {
            path: "/",
            title: "Главная",
            visits: 800,
            bounceRate: 31,
            avgDurationSec: 90,
            pageDepth: 2,
            calls: 12,
            cr: 1.5,
            deviceGap: 0
          }
        ],
        devices: [
          { device: "mobile", visits: 1000, bounceRate: 32, cr: 1.4, calls: 14 },
          { device: "desktop", visits: 1000, bounceRate: 28, cr: 1.6, calls: 16 },
          { device: "tablet", visits: 0, bounceRate: 0, cr: 0, calls: 0 }
        ],
        sources: [{ source: "Поиск", visits: 1500, bounceRate: 30, durationSec: 100, calls: 20, qualityLeads: 10 }]
      }),
      { quality: 30, total: 40 } as LeadSummary
    );
    expect(items.find((item) => item.id.startsWith("hyp-bounce"))).toBeUndefined();
    expect(items.find((item) => item.id === "hyp-mobile")).toBeUndefined();
  });
});

describe("формы файлов и склейка отчёта", () => {
  it("масштабирует звонки вместе с расходом", () => {
    const [row] = scaleCampaigns(
      [campaign({ calls: 10, previousCalls: 8, formLeads: 4, previousFormLeads: 2 })],
      "7d"
    );
    expect(row.calls).toBe(5);
    expect(row.previousCalls).toBe(4);
    expect(row.formLeads).toBe(2);
  });

  it("возвращает кампанию, которая есть только в прошлом периоде", () => {
    const pairs = pairCampaignReports(
      [{ CampaignId: "1", CampaignName: "Живая", Impressions: "10" }],
      [
        { CampaignId: "1", CampaignName: "Живая", Impressions: "10" },
        { CampaignId: "2", CampaignName: "Остановлена", Impressions: "5000", Cost: "80000" }
      ]
    );
    const stopped = pairs.find((pair) => pair.current.CampaignId === "2");
    expect(stopped?.current.Impressions).toBe("0");
    expect(stopped?.previous?.Impressions).toBe("5000");
  });

  it("читает образец целей и кэша в форме, которую ждёт код", () => {
    const goals = parseMetrikaGoals(JSON.parse(fs.readFileSync("data/samples/metrika-goals.json", "utf8")));
    expect(goals.some((row) => row.counterId === "105085067" && row.calls.length === 0)).toBe(true);
    const tokens = JSON.parse(fs.readFileSync("data/samples/direct-tokens.json", "utf8")) as Record<string, string>;
    expect(typeof tokens.Tandem).toBe("string");
    const cache = JSON.parse(fs.readFileSync("data/samples/dashboard-v10-7d_all_all_all.json", "utf8")) as {
      savedAt: number;
      payload: { series: unknown[]; leads: { total: number }; behavior: { visits: number } };
    };
    expect(cache.savedAt).toBeGreaterThan(0);
    expect(Array.isArray(cache.payload.series)).toBe(true);
    expect(cache.payload.behavior.visits).toBe(0);
  });

  it("в Telegram уходит только выбранная важность", () => {
    const alerts = buildAlerts(
      [
        computeCampaign(
          campaign({
            id: "ctr",
            current: { impressions: 50000, clicks: 900, cost: 220000 },
            previous: { impressions: 48000, clicks: 3600, cost: 180000 }
          })
        )
      ],
      behavior(),
      0,
      0,
      0,
      0,
      thresholds
    );
    process.env.TELEGRAM_MIN_SEVERITY = "critical";
    expect(selectTelegramAlerts(alerts).every((a) => a.severity === "critical")).toBe(true);
    delete process.env.TELEGRAM_MIN_SEVERITY;
    expect(selectTelegramAlerts(alerts).length).toBe(alerts.length);
  });
});
