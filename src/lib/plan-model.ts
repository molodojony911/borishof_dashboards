import { COMBINED_BRAND, canonicalBrand, exeedEsteoKind, sameBrand } from "./brand-alias";
import { ACCOUNTS } from "./catalog";
import type { Line } from "./types";
import { parseNumberCell } from "./tabular";

export interface PlanRow {
  month: string;
  contractor: string;
  brand: string;
  line: Line | "";
  /** План расхода. Сводный лист подрядчиков его не импортирует. */
  spend: number | null;
  /**
   * План результативных лидов (РЛ): штуки качественных лидов на месяц.
   * В файле колонка может называться «лиды» или «план РЛ».
   */
  leads: number | null;
  visits: number | null;
  /** План CPL, рубли за один результативный лид. Не пропорционален дням. */
  cpl: number | null;
}

export interface ClassifiedRow {
  month: string;
  contractor: string;
  brand: string;
  platform: string;
  metric: string;
  plan: number | null;
  fact: number | null;
}

/** Строка листа «Текущий месяц»: план и факт подрядчика по проекту, не по Директу. */
export interface ClassifiedProject {
  month: string;
  externalId: string;
  project: string;
  sheetUrl: string;
  planSpend: number | null;
  factSpend: number | null;
  forecastSpend: number | null;
  planLeads: number | null;
  factLeads: number | null;
  forecastLeads: number | null;
  /** Доля выполнения, как в колонке Run-rate листа: уже в процентах. */
  runRate: number | null;
  cplPlan: number | null;
  cplFact: number | null;
  kind: "project" | "total";
}

export interface PlatformForecast {
  project: string;
  platform: string;
  forecastSpend: number | null;
}

export interface WalletTopup {
  project: string;
  withVatAuto: number | null;
  withVatAvito: number | null;
  withVatAdvance: number | null;
  noVatAuto: number | null;
  noVatAvito: number | null;
  noVatAdvance: number | null;
  refillAuto: number | null;
  refillAvito: number | null;
}

export interface ClassifiedSheet {
  month: string;
  projects: ClassifiedProject[];
  platformForecast: PlatformForecast[];
  wallets: WalletTopup[];
  rows: ClassifiedRow[];
}

export interface PlanFact extends PlanRow {
  periodSpend: number | null;
  periodLeads: number | null;
  periodVisits: number | null;
  factSpend: number;
  factLeads: number;
  factVisits: number;
  /** CPL выбранного окна: расход / результативные лиды. Темп месяца его не меняет. */
  factCpl: number | null;
  /** Прогноз РЛ на полный месяц, если текущий темп сохранится. */
  forecastLeads: number | null;
}

export interface FactSlice {
  contractor: string;
  brand: string;
  line: Line;
  spend: number;
  leads: number;
  visits: number;
}

const PLAN_FIELDS = {
  month: "month",
  месяц: "month",
  contractor: "contractor",
  подрядчик: "contractor",
  brand: "brand",
  бренд: "brand",
  line: "line",
  линия: "line",
  направление: "line",
  spend: "spend",
  расход: "spend",
  бюджет: "spend",
  leads: "leads",
  лиды: "leads",
  "план рл": "rl",
  "рл план": "rl",
  рл: "rl",
  visits: "visits",
  визиты: "visits",
  cpl: "cpl",
  цпл: "cpl",
  "план cpl": "cpl",
  "cpl план": "cpl"
} as const;

const CLASSIFIED_FIELDS = {
  month: "month",
  месяц: "month",
  contractor: "contractor",
  подрядчик: "contractor",
  brand: "brand",
  бренд: "brand",
  platform: "platform",
  площадка: "platform",
  metric: "metric",
  метрика: "metric",
  plan: "plan",
  план: "plan",
  fact: "fact",
  факт: "fact"
} as const;

export function normalizeMonth(raw: string): string {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dotted = text.match(/^(\d{1,2})\.(\d{4})$/);
  if (dotted) return `${dotted[2]}-${dotted[1].padStart(2, "0")}`;
  const full = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (full) return `${full[3]}-${full[2]}`;
  return "";
}

export function normalizeLine(raw: string): Line | "" {
  const text = raw.trim().toLowerCase();
  if (!text) return "";
  if (text === "nc" || text.startsWith("nc") || text === "нц" || text.includes("продаж")) return "nc";
  if (text === "afs" || text.startsWith("afs") || text.includes("сервис")) return "afs";
  return "";
}

export function daysInMonth(month: string): number {
  const [year, monthNum] = month.split("-").map(Number);
  if (!year || !monthNum) return 30;
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

export function prorate(value: number | null, periodDays: number, monthDays: number): number | null {
  if (value == null) return null;
  if (!monthDays) return value;
  return (value * periodDays) / monthDays;
}

export function fulfillment(fact: number, plan: number | null): number | null {
  if (plan == null || plan === 0) return null;
  return (fact / plan) * 100;
}

function headerIndex(headers: string[], dict: Record<string, string>): Record<string, number> {
  const index: Record<string, number> = {};
  headers.forEach((header, i) => {
    const key = dict[header.trim().toLowerCase()];
    if (key && index[key] === undefined) index[key] = i;
  });
  return index;
}

function cell(row: string[], index: Record<string, number>, key: string): string {
  const at = index[key];
  if (at === undefined) return "";
  return row[at] || "";
}

const MONTH_NAMES: Array<[number, string[]]> = [
  [1, ["январ", "янв"]],
  [2, ["феврал", "фев"]],
  [3, ["март", "мар"]],
  [4, ["апрел", "апр"]],
  [5, ["май", "мая"]],
  [6, ["июн"]],
  [7, ["июл"]],
  [8, ["август", "авг"]],
  [9, ["сентябр", "сен"]],
  [10, ["октябр", "окт"]],
  [11, ["ноябр", "ноя"]],
  [12, ["декабр", "дек"]]
];

/** Заголовок колонки месяца: 2026-11, 11.2026, «ноя 2026». «мар» не путаем с «маркетинг». */
export function monthFromHeader(raw: string): string {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text || text.length > 24) return "";
  const iso = normalizeMonth(raw.trim());
  if (iso && !/[a-zа-я]/i.test(raw)) return iso;
  const dated = text.match(/(20\d{2})-(\d{2})-\d{2}/);
  if (dated) return `${dated[1]}-${dated[2]}`;
  const slash = text.match(/^(\d{1,2})\/(20\d{2})$/);
  if (slash) return `${slash[2]}-${slash[1].padStart(2, "0")}`;
  const year = text.match(/20\d{2}/);
  if (!year) return "";
  if (/маркет/.test(text)) return "";
  for (const [month, names] of MONTH_NAMES) {
    if (names.some((name) => text.includes(name))) return `${year[0]}-${String(month).padStart(2, "0")}`;
  }
  return "";
}

/**
 * РЛ в сводке подрядчиков — результативные лиды, штуки на месяц.
 * CPL — цена одного такого лида. «Расход/лиды» — это уже CPL, поэтому колонку расхода не берём.
 * Строки и колонки со словом «факт» пропускаем: из листа нужен только план.
 */
export function classifyPlanMetric(raw: string): "rl" | "cpl" | "skip" {
  const text = normHeader(raw);
  if (!text || text.includes("факт")) return "skip";
  const cpl = /\bcpl\b|цпл|стоимость лида|цена лида|цена рл|стоимость рл/.test(text);
  const rl = /(^|[^а-яё])рл([^а-яё]|$)|результативн/.test(text);
  if (cpl && !rl) return "cpl";
  if (rl && !cpl) return "rl";
  return "skip";
}

function isWidePlanSheet(matrix: string[][]): boolean {
  return matrix.slice(0, 15).some((row) => row.filter((item) => monthFromHeader(item)).length >= 2);
}

function blankPlan(month: string, contractor: string, brand: string, line: Line | ""): PlanRow {
  return { month, contractor, brand, line, spend: null, leads: null, visits: null, cpl: null };
}

function parseWidePlans(matrix: string[][]): PlanRow[] {
  let headerAt = -1;
  let monthCount = 0;
  matrix.slice(0, 15).forEach((row, index) => {
    const count = row.filter((item) => monthFromHeader(item)).length;
    if (count > monthCount) {
      monthCount = count;
      headerAt = index;
    }
  });
  if (headerAt < 0) return [];
  const header = matrix[headerAt];
  const months = header
    .map((item, index) => ({ index, month: monthFromHeader(item) }))
    .filter((item) => item.month);
  const firstMonth = months[0].index;
  const named = (names: string[]) => header.findIndex((item) => names.includes(normHeader(item)));
  const metricCol = named(["показатель", "метрика", "план"]);
  const metricAt = metricCol >= 0 ? metricCol : firstMonth - 1;
  const contractorAt = named(["подрядчик", "contractor"]);
  const brandAt = named(["бренд", "brand", "проект"]);
  const lineAt = named(["линия", "направление", "line"]);
  const map = new Map<string, PlanRow>();
  for (const row of matrix.slice(headerAt + 1)) {
    const metric = classifyPlanMetric(atCell(row, metricAt));
    if (metric === "skip") continue;
    const contractor = contractorAt >= 0 ? atCell(row, contractorAt).trim() : "";
    const brand = brandAt >= 0 ? atCell(row, brandAt).trim() : atCell(row, 1).trim();
    if (!brand) continue;
    const line = lineAt >= 0 ? normalizeLine(atCell(row, lineAt)) : "";
    for (const col of months) {
      const value = parseNumberCell(atCell(row, col.index));
      if (value == null) continue;
      const key = `${col.month}|${contractor}|${brand}|${line}`;
      const plan = map.get(key) || blankPlan(col.month, contractor, brand, line);
      if (metric === "rl") plan.leads = value;
      else plan.cpl = value;
      map.set(key, plan);
    }
  }
  return Array.from(map.values());
}

function atCell(row: string[], index: number): string {
  if (index < 0) return "";
  return row[index] || "";
}

export function matrixToPlans(matrix: string[][], opts?: { onlyRlCpl?: boolean }): PlanRow[] {
  const summary = parseSummaryPlans(matrix);
  const rows = summary ?? (isWidePlanSheet(matrix) ? parseWidePlans(matrix) : parseLongPlans(matrix));
  const cleaned = opts?.onlyRlCpl ? rows.map((row) => ({ ...row, spend: null, visits: null })) : rows;
  return foldPlanRows(cleaned);
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a || 0) + (b || 0);
}

function weightedRate(a: number | null, aWeight: number | null, b: number | null, bWeight: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  const wa = aWeight ?? 0;
  const wb = bWeight ?? 0;
  if (wa + wb > 0) return (a * wa + b * wb) / (wa + wb);
  return (a + b) / 2;
}

function mergePlan(a: PlanRow, b: PlanRow): PlanRow {
  return {
    month: a.month || b.month,
    contractor: a.contractor || b.contractor,
    brand: a.brand || b.brand,
    line: a.line || b.line,
    spend: addNullable(a.spend, b.spend),
    leads: addNullable(a.leads, b.leads),
    visits: addNullable(a.visits, b.visits),
    cpl: weightedRate(a.cpl, a.leads, b.cpl, b.leads)
  };
}

function mergeAllPlans(rows: PlanRow[]): PlanRow {
  return rows.slice(1).reduce((acc, row) => mergePlan(acc, row), rows[0]);
}

/** EXEED и Esteo схлопываются в один план: РЛ суммируется, CPL — среднее по плану РЛ. */
export function foldPlanRows(rows: PlanRow[]): PlanRow[] {
  const normalized = rows.map((row) => ({ ...row, brand: canonicalBrand(row.brand) }));
  const rest = normalized.filter((row) => row.brand !== COMBINED_BRAND);
  const family = normalized.filter((row) => row.brand === COMBINED_BRAND);
  const byMonthLine = new Map<string, PlanRow[]>();
  for (const row of family) {
    const key = `${row.month}|${row.line}`;
    const list = byMonthLine.get(key) || [];
    list.push(row);
    byMonthLine.set(key, list);
  }
  const folded: PlanRow[] = [];
  for (const list of byMonthLine.values()) {
    const named = Array.from(new Set(list.map((row) => row.contractor).filter(Boolean)));
    if (named.length > 1) {
      const byContractor = new Map<string, PlanRow[]>();
      for (const row of list) {
        const key = row.contractor || "";
        const bucket = byContractor.get(key) || [];
        bucket.push(row);
        byContractor.set(key, bucket);
      }
      const empty = byContractor.get("") || [];
      const names = Array.from(byContractor.keys()).filter(Boolean);
      if (empty.length && names.length === 1) {
        const name = names[0];
        folded.push(mergeAllPlans([...(byContractor.get(name) || []), ...empty].map((row) => ({ ...row, contractor: name }))));
      } else {
        for (const [name, bucket] of byContractor) {
          if (!name) continue;
          folded.push(mergeAllPlans(bucket));
        }
      }
      continue;
    }
    const contractor = named[0] || "";
    folded.push(mergeAllPlans(list.map((row) => ({ ...row, contractor: contractor || row.contractor }))));
  }
  const drop = new Set<PlanRow>();
  const extra: PlanRow[] = [];
  const byMonthContractor = new Map<string, PlanRow[]>();
  for (const row of folded) {
    const key = `${row.month}|${row.contractor}`;
    const list = byMonthContractor.get(key) || [];
    list.push(row);
    byMonthContractor.set(key, list);
  }
  for (const list of byMonthContractor.values()) {
    const blank = list.filter((row) => !row.line);
    const specific = list.filter((row) => row.line);
    if (blank.length && specific.length === 1) {
      for (const row of blank) drop.add(row);
      drop.add(specific[0]);
      extra.push(blank.reduce((acc, row) => mergePlan(acc, { ...row, line: specific[0].line }), specific[0]));
    }
  }
  return [...rest, ...folded.filter((row) => !drop.has(row)), ...extra];
}

/**
 * Сводка «Сводный отчет контекст»: одна вкладка = один месяц.
 * SALES — линия NC, AFTERSALES — AFS. План РЛ — штуки, «План CPL ОП» — рубли.
 */
function parseSummaryPlans(matrix: string[][]): PlanRow[] | null {
  const header = findSummaryHeader(matrix);
  if (!header) return null;
  const month = monthFromSummary(matrix);
  if (!month) return null;
  let line: Line = "nc";
  const map = new Map<string, PlanRow>();
  for (const row of matrix.slice(header.at + 1)) {
    const label = row.map((item) => normHeader(item)).join(" ");
    if (/\baftersales\b|афтерсейл|after sales/.test(label)) {
      line = "afs";
      continue;
    }
    if (/^sales$/.test(normHeader(atCell(row, header.source))) || label.trim() === "sales") {
      line = "nc";
      continue;
    }
    if (normHeader(atCell(row, header.brand)) === "марка") continue;
    const brand = canonBrand(atCell(row, header.brand));
    if (!brand || brand === "Итого" || /^\d{2}\.\d{2}\.20\d{2}$/.test(brand)) continue;
    if (/данн|проверен|не заверш/.test(normHeader(brand))) continue;
    const leads = parseNumberCell(atCell(row, header.rl));
    const cpl = parseNumberCell(atCell(row, header.cpl));
    if (leads == null && cpl == null) continue;
    const contractor = canonContractor(atCell(row, header.contractor));
    const key = `${month}|${contractor}|${brand}|${line}`;
    const plan = map.get(key) || blankPlan(month, contractor, brand, line);
    if (leads != null) plan.leads = leads;
    if (cpl != null) plan.cpl = cpl;
    map.set(key, plan);
  }
  return Array.from(map.values());
}

function findSummaryHeader(matrix: string[][]): {
  at: number;
  brand: number;
  contractor: number;
  source: number;
  rl: number;
  cpl: number;
} | null {
  for (let at = 0; at < Math.min(matrix.length, 40); at += 1) {
    const row = matrix[at];
    if (row.some((item) => monthFromHeader(item))) continue;
    const rl = row.findIndex((item) => normHeader(item).startsWith("план") && classifyPlanMetric(item) === "rl");
    const cpl = row.findIndex((item) => normHeader(item).startsWith("план") && classifyPlanMetric(item) === "cpl");
    const brand = row.findIndex((item) => ["марка", "бренд", "brand"].includes(normHeader(item)));
    const contractor = row.findIndex((item) => ["агентство", "подрядчик", "contractor"].includes(normHeader(item)));
    const source = row.findIndex((item) => normHeader(item).includes("источник"));
    if (rl >= 0 && cpl >= 0 && brand >= 0 && contractor >= 0) return { at, brand, contractor, source, rl, cpl };
  }
  return null;
}

function monthFromSummary(matrix: string[][]): string {
  for (const row of matrix) {
    for (const item of row) {
      const exact = item.trim().match(/^(\d{2})\.(\d{2})\.(20\d{2})$/);
      if (exact) return `${exact[3]}-${exact[2]}`;
    }
  }
  for (const row of matrix) {
    for (const item of row) {
      const found = item.match(/(\d{2})\.(\d{2})\.(20\d{2})/);
      if (found) return `${found[3]}-${found[2]}`;
    }
  }
  return "";
}

function canonContractor(raw: string): string {
  const text = raw.trim().toLowerCase();
  if (text === "тандем" || text === "tandem") return "Tandem";
  if (text === "rta") return "RTA";
  return raw.trim();
}

function canonBrand(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const key = text.toLowerCase();
  if (key === "танк" || key === "tank") return "TANK";
  if (key === "haval pro") return "HAVAL PRO";
  if (key === "volt spb") return "Volt SPB";
  const found = ACCOUNTS.find((item) => item.brand.toLowerCase() === key);
  return found ? found.brand : text;
}

function parseLongPlans(matrix: string[][]): PlanRow[] {
  if (matrix.length < 2) return [];
  const headerAt = matrix.findIndex((row) => row.some((item) => PLAN_FIELDS[normHeader(item) as keyof typeof PLAN_FIELDS]));
  if (headerAt < 0) return [];
  const index = headerIndex(matrix[headerAt], PLAN_FIELDS);
  if (index.brand === undefined) return [];
  const rows: PlanRow[] = [];
  for (const line of matrix.slice(headerAt + 1)) {
    const month = normalizeMonth(cell(line, index, "month")) || monthFromHeader(cell(line, index, "month"));
    const brand = cell(line, index, "brand").trim();
    const contractor = cell(line, index, "contractor").trim();
    if (!month || !brand) continue;
    const rl = parseNumberCell(cell(line, index, "rl"));
    const leads = parseNumberCell(cell(line, index, "leads"));
    rows.push({
      month,
      contractor,
      brand,
      line: normalizeLine(cell(line, index, "line")),
      spend: parseNumberCell(cell(line, index, "spend")),
      leads: rl ?? leads,
      visits: parseNumberCell(cell(line, index, "visits")),
      cpl: parseNumberCell(cell(line, index, "cpl"))
    });
  }
  return rows;
}

function normHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function columnOf(row: string[], name: string): number {
  return row.findIndex((item) => normHeader(item) === name);
}

function at(row: string[], index: number): string {
  if (index < 0) return "";
  return row[index] || "";
}

function monthFromSheet(matrix: string[][]): string {
  for (const row of matrix.slice(0, 8)) {
    for (const item of row) {
      const month = normalizeMonth(item.trim());
      if (month && item.trim().length <= 10) return month;
    }
  }
  return "";
}

function emptyProject(month: string, project: string, kind: ClassifiedProject["kind"]): ClassifiedProject {
  return {
    month,
    externalId: "",
    project,
    sheetUrl: "",
    planSpend: null,
    factSpend: null,
    forecastSpend: null,
    planLeads: null,
    factLeads: null,
    forecastLeads: null,
    runRate: null,
    cplPlan: null,
    cplFact: null,
    kind
  };
}

/** Широкий лист «Текущий месяц»: заголовки ищутся по тексту, не по номеру колонки. */
export function parseBorishofClassifieds(matrix: string[][]): ClassifiedSheet {
  const month = monthFromSheet(matrix);
  const headerRows = matrix
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.some((item) => normHeader(item) === "план расход"))
    .map(({ index }) => index);
  const projects: ClassifiedProject[] = [];
  headerRows.forEach((headerAt, order) => {
    const header = matrix[headerAt] || [];
    const end = headerRows[order + 1] ?? matrix.length;
    const brandCol = columnOf(header, "план-факт");
    const spendPlan = columnOf(header, "план расход");
    const spendFact = columnOf(header, "факт расход");
    const spendForecast = columnOf(header, "прогноз расход");
    const leadsPlan = columnOf(header, "план лиды");
    const leadsFact = columnOf(header, "факт лиды");
    const leadsForecast = columnOf(header, "прогноз по лидам");
    const runRate = columnOf(header, "run-rate");
    const cplPlan = columnOf(header, "cpl план");
    const cplFact = columnOf(header, "cpl факт");
    for (const row of matrix.slice(headerAt + 1, end)) {
      if (row.some((item) => /кошельки|суммы для пополнения/i.test(item))) break;
      const brand = brandCol >= 0 ? at(row, brandCol).trim() : "";
      const totalLabel = (row.find((item) => normHeader(item).startsWith("итого")) || "").trim();
      const project = brand || totalLabel;
      if (!project || normHeader(project) === "план-факт") continue;
      const parsed = emptyProject(month, project, totalLabel && !brand ? "total" : normHeader(project).startsWith("итого") ? "total" : "project");
      parsed.planSpend = parseNumberCell(at(row, spendPlan));
      parsed.factSpend = parseNumberCell(at(row, spendFact));
      parsed.forecastSpend = parseNumberCell(at(row, spendForecast));
      parsed.planLeads = parseNumberCell(at(row, leadsPlan));
      parsed.factLeads = parseNumberCell(at(row, leadsFact));
      parsed.forecastLeads = parseNumberCell(at(row, leadsForecast));
      parsed.runRate = parseNumberCell(at(row, runRate));
      parsed.cplPlan = parseNumberCell(at(row, cplPlan));
      parsed.cplFact = parseNumberCell(at(row, cplFact));
      const filled = [parsed.planSpend, parsed.factSpend, parsed.planLeads, parsed.factLeads, parsed.forecastSpend].some((value) => value != null);
      if (!filled) continue;
      if (brandCol > 0) parsed.externalId = at(row, brandCol - 1).trim();
      const link = at(row, brandCol + 1).trim();
      if (link.startsWith("http")) parsed.sheetUrl = link;
      projects.push(parsed);
    }
  });
  return { month, projects, platformForecast: parsePlatformForecast(matrix), wallets: parseWallets(matrix), rows: [] };
}

function parsePlatformForecast(matrix: string[][]): PlatformForecast[] {
  const headerAt = matrix.findIndex(
    (row, index) => index > 0 && row.some((item) => normHeader(item) === "auto.ru") && row.some((item) => normHeader(item) === "avito")
  );
  if (headerAt < 0) return [];
  const header = matrix[headerAt];
  const auto = header.findIndex((item) => normHeader(item) === "auto.ru");
  const avito = header.findIndex((item) => normHeader(item) === "avito");
  if (auto < 1) return [];
  const out: PlatformForecast[] = [];
  for (const row of matrix.slice(headerAt + 1)) {
    if (row.some((item) => /кошельки|суммы для пополнения/i.test(item))) break;
    const project = at(row, auto - 1).trim();
    if (!project || normHeader(project) === "auto.ru") continue;
    if (/^[\d\s\u00a0]+$/.test(project)) break;
    const autoSpend = parseNumberCell(at(row, auto));
    const avitoSpend = parseNumberCell(at(row, avito));
    if (autoSpend == null && avitoSpend == null) continue;
    if (autoSpend != null) out.push({ project, platform: "auto.ru", forecastSpend: autoSpend });
    if (avitoSpend != null) out.push({ project, platform: "avito", forecastSpend: avitoSpend });
  }
  return out;
}

function parseWallets(matrix: string[][]): WalletTopup[] {
  const headerAt = matrix.findIndex((row) => row.some((item) => normHeader(item) === "кошельки"));
  if (headerAt < 0) return [];
  const header = matrix[headerAt];
  const nameCol = header.findIndex((item) => normHeader(item) === "кошельки");
  const autos = header.map((item, index) => (normHeader(item) === "auto.ru" ? index : -1)).filter((index) => index >= 0);
  const avitos = header.map((item, index) => (normHeader(item) === "avito" ? index : -1)).filter((index) => index >= 0);
  const advances = header.map((item, index) => (normHeader(item) === "аванс" ? index : -1)).filter((index) => index >= 0);
  // Порядок в листе: с НДС, без НДС, пополнение (с НДС). Четвёртая пара — тот же блок правее, её не дублируем.
  const out: WalletTopup[] = [];
  for (const row of matrix.slice(headerAt + 1)) {
    const project = at(row, nameCol).trim();
    if (!project) break;
    if (/кошельки|с ндс|без ндс/i.test(project)) continue;
    out.push({
      project,
      withVatAuto: parseNumberCell(at(row, autos[0] ?? -1)),
      withVatAvito: parseNumberCell(at(row, avitos[0] ?? -1)),
      withVatAdvance: parseNumberCell(at(row, advances[0] ?? -1)),
      noVatAuto: parseNumberCell(at(row, autos[1] ?? -1)),
      noVatAvito: parseNumberCell(at(row, avitos[1] ?? -1)),
      noVatAdvance: parseNumberCell(at(row, advances[1] ?? -1)),
      refillAuto: parseNumberCell(at(row, autos[2] ?? -1)),
      refillAvito: parseNumberCell(at(row, avitos[2] ?? -1))
    });
  }
  return out.filter((row) =>
    [row.withVatAuto, row.withVatAvito, row.noVatAuto, row.noVatAvito, row.refillAuto, row.refillAvito].some((value) => value != null)
  );
}

function parseFlatClassifieds(matrix: string[][]): ClassifiedRow[] {
  if (!matrix.length) return [];
  const headerAt = matrix.findIndex((row) => row.some((item) => CLASSIFIED_FIELDS[normHeader(item) as keyof typeof CLASSIFIED_FIELDS]));
  if (headerAt < 0) return [];
  const index = headerIndex(matrix[headerAt], CLASSIFIED_FIELDS);
  if (index.platform === undefined || (index.plan === undefined && index.fact === undefined)) return [];
  const rows: ClassifiedRow[] = [];
  for (const line of matrix.slice(headerAt + 1)) {
    const month = normalizeMonth(cell(line, index, "month"));
    const platform = cell(line, index, "platform").trim();
    if (!month || !platform) continue;
    const plan = parseNumberCell(cell(line, index, "plan"));
    const fact = parseNumberCell(cell(line, index, "fact"));
    if (plan == null && fact == null) continue;
    rows.push({
      month,
      contractor: cell(line, index, "contractor").trim(),
      brand: cell(line, index, "brand").trim(),
      platform,
      metric: cell(line, index, "metric").trim() || "лиды",
      plan,
      fact
    });
  }
  return rows;
}

export function isBorishofClassifiedSheet(matrix: string[][]): boolean {
  return matrix.some((row) => row.some((item) => normHeader(item) === "план расход"));
}

export function parseClassifiedMatrix(matrix: string[][]): ClassifiedSheet {
  const sheet = isBorishofClassifiedSheet(matrix)
    ? parseBorishofClassifieds(matrix)
    : {
        month: "",
        projects: [],
        platformForecast: [],
        wallets: [],
        rows: parseFlatClassifieds(matrix)
      };
  if (!sheet.month) sheet.month = sheet.rows[0]?.month || "";
  return foldClassifiedSheet(sheet);
}

function mergeProjects(rows: ClassifiedProject[]): ClassifiedProject {
  const first = rows[0];
  return rows.slice(1).reduce((acc, row) => {
    const planLeads = acc.planLeads;
    const factLeads = acc.factLeads;
    return {
      ...acc,
      externalId: acc.externalId || row.externalId,
      sheetUrl: acc.sheetUrl || row.sheetUrl,
      planSpend: addNullable(acc.planSpend, row.planSpend),
      factSpend: addNullable(acc.factSpend, row.factSpend),
      forecastSpend: addNullable(acc.forecastSpend, row.forecastSpend),
      planLeads: addNullable(acc.planLeads, row.planLeads),
      factLeads: addNullable(acc.factLeads, row.factLeads),
      forecastLeads: addNullable(acc.forecastLeads, row.forecastLeads),
      cplPlan: weightedRate(acc.cplPlan, planLeads, row.cplPlan, row.planLeads),
      cplFact: weightedRate(acc.cplFact, factLeads, row.cplFact, row.factLeads),
      runRate: null
    };
  }, { ...first, project: COMBINED_BRAND, kind: "project" as const });
}

function foldProjects(projects: ClassifiedProject[]): ClassifiedProject[] {
  const rest: ClassifiedProject[] = [];
  const family: ClassifiedProject[] = [];
  for (const row of projects) {
    if (exeedEsteoKind(row.project) === "other") rest.push(row);
    else family.push(row);
  }
  const byMonth = new Map<string, ClassifiedProject[]>();
  for (const row of family) {
    const list = byMonth.get(row.month) || [];
    list.push(row);
    byMonth.set(row.month, list);
  }
  const folded: ClassifiedProject[] = [];
  for (const list of byMonth.values()) {
    const combined = list.filter((row) => exeedEsteoKind(row.project) === "combined");
    const source = combined.length ? combined : list;
    const merged = mergeProjects(source);
    if (source.length > 1 && merged.planSpend) {
      merged.runRate = merged.factSpend == null ? null : (merged.factSpend / merged.planSpend) * 100;
    }
    folded.push(merged);
  }
  return [...rest, ...folded];
}

function foldForecast(rows: PlatformForecast[]): PlatformForecast[] {
  const rest: PlatformForecast[] = [];
  const family: PlatformForecast[] = [];
  for (const row of rows) {
    if (exeedEsteoKind(row.project) === "other") rest.push(row);
    else family.push(row);
  }
  const byPlatform = new Map<string, PlatformForecast[]>();
  for (const row of family) {
    const list = byPlatform.get(row.platform) || [];
    list.push(row);
    byPlatform.set(row.platform, list);
  }
  const folded: PlatformForecast[] = [];
  for (const [platform, list] of byPlatform) {
    const combined = list.filter((row) => exeedEsteoKind(row.project) === "combined");
    const source = combined.length ? combined : list;
    folded.push({
      project: COMBINED_BRAND,
      platform,
      forecastSpend: source.reduce<number | null>((sum, row) => addNullable(sum, row.forecastSpend), null)
    });
  }
  return [...rest, ...folded];
}

function foldWallets(rows: WalletTopup[]): WalletTopup[] {
  const rest: WalletTopup[] = [];
  const family: WalletTopup[] = [];
  for (const row of rows) {
    if (exeedEsteoKind(row.project) === "other") rest.push(row);
    else family.push(row);
  }
  if (!family.length) return rows;
  const combined = family.filter((row) => exeedEsteoKind(row.project) === "combined");
  const source = combined.length ? combined : family;
  const sum = (pick: (row: WalletTopup) => number | null) => source.reduce<number | null>((acc, row) => addNullable(acc, pick(row)), null);
  return [
    ...rest,
    {
      project: COMBINED_BRAND,
      withVatAuto: sum((row) => row.withVatAuto),
      withVatAvito: sum((row) => row.withVatAvito),
      withVatAdvance: sum((row) => row.withVatAdvance),
      noVatAuto: sum((row) => row.noVatAuto),
      noVatAvito: sum((row) => row.noVatAvito),
      noVatAdvance: sum((row) => row.noVatAdvance),
      refillAuto: sum((row) => row.refillAuto),
      refillAvito: sum((row) => row.refillAvito)
    }
  ];
}

function averageNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
}

function collapseFlat(rows: ClassifiedRow[]): ClassifiedRow {
  const cpl = /cpl|цпл/i.test(rows[0]?.metric || "");
  const named = Array.from(new Set(rows.map((row) => row.contractor).filter(Boolean)));
  return rows.slice(1).reduce(
    (acc, row) => ({
      ...acc,
      contractor: acc.contractor || row.contractor,
      plan: cpl ? averageNullable(acc.plan, row.plan) : addNullable(acc.plan, row.plan),
      fact: cpl ? averageNullable(acc.fact, row.fact) : addNullable(acc.fact, row.fact)
    }),
    { ...rows[0], brand: COMBINED_BRAND, contractor: named.length === 1 ? named[0] : rows[0].contractor }
  );
}

function foldFlat(rows: ClassifiedRow[]): ClassifiedRow[] {
  const rest: ClassifiedRow[] = [];
  const groups = new Map<string, ClassifiedRow[]>();
  for (const row of rows) {
    if (exeedEsteoKind(row.brand) === "other") {
      rest.push(row);
      continue;
    }
    const key = `${row.month}|${row.platform}|${row.metric}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  const folded: ClassifiedRow[] = [];
  for (const list of groups.values()) {
    const combined = list.filter((row) => exeedEsteoKind(row.brand) === "combined");
    folded.push(collapseFlat(combined.length ? combined : list));
  }
  return [...rest, ...folded];
}

export function foldClassifiedSheet(sheet: ClassifiedSheet): ClassifiedSheet {
  return {
    ...sheet,
    projects: foldProjects(sheet.projects),
    platformForecast: foldForecast(sheet.platformForecast),
    wallets: foldWallets(sheet.wallets),
    rows: foldFlat(sheet.rows)
  };
}

export function matrixToClassifieds(matrix: string[][]): ClassifiedRow[] {
  return parseClassifiedMatrix(matrix).rows;
}

export function classifiedCount(sheet: Pick<ClassifiedSheet, "projects" | "rows">): number {
  return sheet.projects.length + sheet.rows.length;
}

export function factsFromDashboard(
  campaigns: Array<{ contractor: string; brand: string; line: Line; current: { cost: number }; qualityLeads: number }>,
  projects: Array<{ contractor: string; brand: string; line: Line; visits: number; sharedCounter: boolean; counterIds: string[] }>
): FactSlice[] {
  const map = new Map<string, FactSlice>();
  const keyOf = (contractor: string, brand: string, line: string) => `${contractor}|${canonicalBrand(brand)}|${line}`;
  for (const campaign of campaigns) {
    const brand = canonicalBrand(campaign.brand);
    const key = keyOf(campaign.contractor, brand, campaign.line);
    const cur = map.get(key) || {
      contractor: campaign.contractor,
      brand,
      line: campaign.line,
      spend: 0,
      leads: 0,
      visits: 0
    };
    cur.spend += campaign.current.cost;
    cur.leads += campaign.qualityLeads;
    map.set(key, cur);
  }
  const seen = new Set<string>();
  for (const project of projects) {
    const brand = canonicalBrand(project.brand);
    const key = keyOf(project.contractor, brand, project.line);
    const cur = map.get(key) || {
      contractor: project.contractor,
      brand,
      line: project.line,
      spend: 0,
      leads: 0,
      visits: 0
    };
    const share = `${brand}|${project.line}|${project.counterIds.slice().sort().join(",")}`;
    if (!(project.sharedCounter && seen.has(share))) {
      cur.visits += project.visits;
      if (project.sharedCounter) seen.add(share);
    }
    map.set(key, cur);
  }
  return collapseCombinedFacts(Array.from(map.values()));
}

function addFact(a: FactSlice, b: FactSlice, contractor: string): FactSlice {
  return {
    contractor,
    brand: COMBINED_BRAND,
    line: a.line || b.line,
    spend: a.spend + b.spend,
    leads: a.leads + b.leads,
    visits: a.visits + b.visits
  };
}

function collapseCombinedFacts(rows: FactSlice[]): FactSlice[] {
  const rest = rows.filter((row) => row.brand !== COMBINED_BRAND);
  const family = rows.filter((row) => row.brand === COMBINED_BRAND);
  const byLine = new Map<Line, FactSlice[]>();
  for (const row of family) {
    const list = byLine.get(row.line) || [];
    list.push(row);
    byLine.set(row.line, list);
  }
  const folded: FactSlice[] = [];
  for (const list of byLine.values()) {
    const named = Array.from(new Set(list.map((row) => row.contractor).filter(Boolean)));
    if (named.length <= 1) {
      const contractor = named[0] || "";
      folded.push(
        list.reduce((acc, row) => addFact(acc, row, contractor), {
          ...list[0],
          contractor,
          spend: 0,
          leads: 0,
          visits: 0
        })
      );
      continue;
    }
    const byContractor = new Map<string, FactSlice>();
    for (const row of list) {
      const key = row.contractor || "";
      const prev = byContractor.get(key);
      byContractor.set(key, prev ? addFact(prev, row, key) : { ...row });
    }
    for (const [name, row] of byContractor) {
      folded.push({ ...row, contractor: name, brand: COMBINED_BRAND });
    }
  }
  return [...rest, ...folded];
}

export function joinPlanFact(plans: PlanRow[], facts: FactSlice[], month: string, periodDays: number): PlanFact[] {
  const monthDays = daysInMonth(month);
  return plans
    .filter((plan) => plan.month === month)
    .map((plan) => {
      const matched = facts.filter(
        (fact) =>
          fact.contractor === plan.contractor &&
          sameBrand(fact.brand, plan.brand) &&
          (plan.line === "" || fact.line === plan.line)
      );
      const factSpend = matched.reduce((sum, fact) => sum + fact.spend, 0);
      const factLeads = matched.reduce((sum, fact) => sum + fact.leads, 0);
      const factVisits = matched.reduce((sum, fact) => sum + fact.visits, 0);
      return {
        ...plan,
        periodSpend: prorate(plan.spend, periodDays, monthDays),
        periodLeads: prorate(plan.leads, periodDays, monthDays),
        periodVisits: prorate(plan.visits, periodDays, monthDays),
        factSpend,
        factLeads,
        factVisits,
        factCpl: factLeads > 0 ? factSpend / factLeads : null,
        forecastLeads: periodDays > 0 ? (factLeads / periodDays) * monthDays : null
      };
    });
}
