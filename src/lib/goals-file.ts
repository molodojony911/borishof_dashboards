import fs from "fs";
import path from "path";
import { dataPath } from "./paths";

/** Форма data/metrika-goals.json, которую пишет scripts/fetch-metrika-goals.js. */
export interface MetrikaGoalRef {
  id: string;
  name: string;
  type?: string;
}

export interface MetrikaGoalCounter {
  counterId: string;
  http: number;
  error: unknown;
  op: MetrikaGoalRef[];
  os: MetrikaGoalRef[];
  calls: MetrikaGoalRef[];
}

export function parseMetrikaGoals(raw: unknown): MetrikaGoalCounter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = row as Partial<MetrikaGoalCounter>;
      return {
        counterId: String(item.counterId || ""),
        http: Number(item.http) || 0,
        error: item.error ?? null,
        op: Array.isArray(item.op) ? item.op : [],
        os: Array.isArray(item.os) ? item.os : [],
        calls: Array.isArray(item.calls) ? item.calls : []
      };
    })
    .filter((row) => row.counterId);
}

function livePath(): string {
  return dataPath("metrika-goals.json");
}

/** Образец лежит в репозитории и не переезжает вместе с BORISHOF_DATA_DIR. */
function samplePath(): string {
  return path.join(process.cwd(), "data", "samples", "metrika-goals.json");
}

/**
 * Живой файл на машине Максима важнее образца.
 * Образец подключаем только в демо, иначе пустая выгрузка в репозитории выглядела бы как авария целей.
 */
export function loadMetrikaGoals(opts: { sample: boolean }): MetrikaGoalCounter[] {
  const live = livePath();
  const sample = samplePath();
  const file = fs.existsSync(live) ? live : opts.sample && fs.existsSync(sample) ? sample : "";
  if (!file) return [];
  try {
    return parseMetrikaGoals(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return [];
  }
}
