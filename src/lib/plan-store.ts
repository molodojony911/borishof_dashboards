import fs from "fs";
import path from "path";
import { dataPath } from "./paths";
import type { ClassifiedSheet, PlanRow } from "./plan-model";

export interface StoredPlans {
  updatedAt: string;
  source: "" | "upload" | "sheet";
  rows: PlanRow[];
}

export interface StoredClassifieds extends ClassifiedSheet {
  updatedAt: string;
  source: "" | "upload" | "sheet";
}

function readJson<T>(file: string, empty: T): T {
  try {
    if (!fs.existsSync(file)) return empty;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return empty;
  }
}

function writeJson(file: string, value: unknown): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function loadPlans(): StoredPlans {
  const stored = readJson<Partial<StoredPlans>>(dataPath("plans.json"), {});
  return {
    updatedAt: stored.updatedAt || "",
    source: stored.source === "upload" || stored.source === "sheet" ? stored.source : "",
    rows: Array.isArray(stored.rows) ? stored.rows : []
  };
}

export function savePlans(rows: PlanRow[], source: "upload" | "sheet"): StoredPlans {
  const stored: StoredPlans = { updatedAt: new Date().toISOString(), source, rows };
  writeJson(dataPath("plans.json"), stored);
  return stored;
}

export function loadClassifieds(): StoredClassifieds {
  const stored = readJson<Partial<StoredClassifieds>>(dataPath("classifieds.json"), {});
  return {
    updatedAt: stored.updatedAt || "",
    source: stored.source === "upload" || stored.source === "sheet" ? stored.source : "",
    month: stored.month || "",
    projects: Array.isArray(stored.projects) ? stored.projects : [],
    platformForecast: Array.isArray(stored.platformForecast) ? stored.platformForecast : [],
    wallets: Array.isArray(stored.wallets) ? stored.wallets : [],
    rows: Array.isArray(stored.rows) ? stored.rows : []
  };
}

export function saveClassifieds(sheet: ClassifiedSheet, source: "upload" | "sheet"): StoredClassifieds {
  const stored: StoredClassifieds = {
    updatedAt: new Date().toISOString(),
    source,
    month: sheet.month,
    projects: sheet.projects,
    platformForecast: sheet.platformForecast,
    wallets: sheet.wallets,
    rows: sheet.rows
  };
  writeJson(dataPath("classifieds.json"), stored);
  return stored;
}
