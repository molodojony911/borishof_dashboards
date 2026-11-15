import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncIntervalHours, syncNow } from "../src/lib/sheets-sync";
import { loadClassifieds, loadPlans } from "../src/lib/plan-store";

const sample = fs.readFileSync(path.join(process.cwd(), "data/samples/classifieds.csv"), "utf8");
const plansSample = fs.readFileSync(path.join(process.cwd(), "data/samples/plans.csv"), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BORISHOF_DATA_DIR;
  delete process.env.GOOGLE_SHEETS_ID;
  delete process.env.GOOGLE_SHEETS_CLASSIFIEDS_GID;
  delete process.env.GOOGLE_SHEETS_PLANS_TAB;
  delete process.env.GOOGLE_SHEETS_PLANS_ID;
  delete process.env.GOOGLE_SHEETS_PLANS_GID;
  delete process.env.GOOGLE_SHEETS_SYNC_HOURS;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

describe("синхронизация Google Таблицы", () => {
  it("по умолчанию раз в 3 часа и только читает классифайды", async () => {
    expect(syncIntervalHours()).toBe(3);
    process.env.GOOGLE_SHEETS_SYNC_HOURS = "6";
    expect(syncIntervalHours()).toBe(6);
    delete process.env.GOOGLE_SHEETS_SYNC_HOURS;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-sheets-"));
    process.env.BORISHOF_DATA_DIR = dir;
    delete process.env.GOOGLE_SHEETS_ID;
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        calls.push({ url, method });
        if (method !== "GET" || /:batchUpdate|spreadsheets\/.*:/.test(url)) {
          return new Response("write refused", { status: 500 });
        }
        if (url.includes("export?format=csv") && url.includes("gid=0") && url.includes("1mieIw-b8wnJVvRJrbr9onoLMItHWHwESYEf5QIqqC8I")) {
          return new Response(sample, { status: 200, headers: { "Content-Type": "text/csv" } });
        }
        if (url.includes("gid=373339308") && url.includes("14K-fcAEl-oP2-SSfbFyrD1I9lCQm5FVyTyRHHHGXZTU")) {
          return new Response(plansSample, { status: 200, headers: { "Content-Type": "text/csv" } });
        }
        return new Response("missing", { status: 404 });
      })
    );
    const status = await syncNow();
    expect(status.lastError).toBe("");
    expect(status.classifiedsRows).toBeGreaterThan(0);
    const haval = loadPlans().rows.find((row) => row.month === "2026-11" && row.brand === "HAVAL" && row.line === "nc");
    expect(haval?.leads).toBe(300);
    expect(haval?.cpl).toBe(4500);
    expect(haval?.spend).toBeNull();
    expect(calls.some((call) => call.url.includes("gid=373339308"))).toBe(true);
    expect(loadClassifieds().projects.find((row) => row.project === "Демо Север")?.factLeads).toBe(8);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.some((call) => call.url.includes("gid=0"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("если export закрыт, читает тот же лист через gviz", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-gviz-"));
    process.env.BORISHOF_DATA_DIR = dir;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("export?format=csv") && url.includes("gid=373339308")) {
          return new Response("<html>Sign in</html>", { status: 401 });
        }
        if (url.includes("gviz/tq") && url.includes("gid=373339308")) {
          return new Response(plansSample, { status: 200, headers: { "Content-Type": "text/csv" } });
        }
        if (url.includes("gid=0")) {
          return new Response(sample, { status: 200, headers: { "Content-Type": "text/csv" } });
        }
        return new Response("missing", { status: 404 });
      })
    );
    const status = await syncNow();
    expect(status.lastError).toBe("");
    expect(loadPlans().rows.length).toBeGreaterThan(0);
    expect(calls.some((url) => url.includes("gviz/tq") && url.includes("gid=373339308"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
