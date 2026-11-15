import type { Line } from "./types";
import { parseNumberCell } from "./tabular";

export interface PlanRow {
  month: string;
  contractor: string;
  brand: string;
  line: Line | "";
  spend: number | null;
  leads: number | null;
  visits: number | null;
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
  visits: "visits",
  визиты: "visits"
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

export function matrixToPlans(matrix: string[][]): PlanRow[] {
  if (matrix.length < 2) return [];
  const index = headerIndex(matrix[0], PLAN_FIELDS);
  if (index.month === undefined || index.brand === undefined) return [];
  const rows: PlanRow[] = [];
  for (const line of matrix.slice(1)) {
    const month = normalizeMonth(cell(line, index, "month"));
    const brand = cell(line, index, "brand").trim();
    const contractor = cell(line, index, "contractor").trim();
    if (!month || !brand) continue;
    rows.push({
      month,
      contractor,
      brand,
      line: normalizeLine(cell(line, index, "line")),
      spend: parseNumberCell(cell(line, index, "spend")),
      leads: parseNumberCell(cell(line, index, "leads")),
      visits: parseNumberCell(cell(line, index, "visits"))
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
  if (isBorishofClassifiedSheet(matrix)) return parseBorishofClassifieds(matrix);
  const rows = parseFlatClassifieds(matrix);
  return {
    month: rows[0]?.month || "",
    projects: [],
    platformForecast: [],
    wallets: [],
    rows
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
  const keyOf = (contractor: string, brand: string, line: string) => `${contractor}|${brand}|${line}`;
  for (const campaign of campaigns) {
    const key = keyOf(campaign.contractor, campaign.brand, campaign.line);
    const cur = map.get(key) || {
      contractor: campaign.contractor,
      brand: campaign.brand,
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
    const key = keyOf(project.contractor, project.brand, project.line);
    const cur = map.get(key) || {
      contractor: project.contractor,
      brand: project.brand,
      line: project.line,
      spend: 0,
      leads: 0,
      visits: 0
    };
    const share = `${project.brand}|${project.line}|${project.counterIds.slice().sort().join(",")}`;
    if (!(project.sharedCounter && seen.has(share))) {
      cur.visits += project.visits;
      if (project.sharedCounter) seen.add(share);
    }
    map.set(key, cur);
  }
  return Array.from(map.values());
}

export function joinPlanFact(plans: PlanRow[], facts: FactSlice[], month: string, periodDays: number): PlanFact[] {
  const monthDays = daysInMonth(month);
  return plans
    .filter((plan) => plan.month === month)
    .map((plan) => {
      const matched = facts.filter(
        (fact) =>
          fact.contractor === plan.contractor &&
          fact.brand === plan.brand &&
          (plan.line === "" || fact.line === plan.line)
      );
      return {
        ...plan,
        periodSpend: prorate(plan.spend, periodDays, monthDays),
        periodLeads: prorate(plan.leads, periodDays, monthDays),
        periodVisits: prorate(plan.visits, periodDays, monthDays),
        factSpend: matched.reduce((sum, fact) => sum + fact.spend, 0),
        factLeads: matched.reduce((sum, fact) => sum + fact.leads, 0),
        factVisits: matched.reduce((sum, fact) => sum + fact.visits, 0)
      };
    });
}
