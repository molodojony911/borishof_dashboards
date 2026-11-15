export type PeriodKey = "7d" | "14d" | "30d";
export type DataMode = "demo" | "live" | "mixed";
export type ExpertRole = "analyst" | "contextologist" | "developer" | "marketer";
export type Severity = "critical" | "warning" | "opportunity";
export type CampaignType = "search_brand" | "search_model" | "search_competitor" | "rsya" | "retargeting";
export type Line = "nc" | "afs";

export interface DateRange {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  key: PeriodKey;
}

export interface MetricPoint {
  impressions: number;
  clicks: number;
  cost: number;
  conversions?: number;
}

export interface CampaignRow {
  id: string;
  /** ID кампании в кабинете Директа — по нему клеим звонки Calltouch из utm_campaign. */
  directId: string;
  name: string;
  contractor: string;
  brand: string;
  line: Line;
  type: CampaignType;
  login: string;
  current: MetricPoint;
  previous: MetricPoint;
  /** Уникальные звонки Директа по цели Метрики, не все конверсии кабинета. */
  totalLeads: number;
  previousTotalLeads: number;
  /** Качественные лиды Calltouch, приклеенные к кампании по utm_campaign. */
  qualityLeads: number;
  previousQualityLeads: number;
  /** Все звонки Calltouch этой кампании, включая нецелевые. */
  calls: number;
  previousCalls: number;
  /** Заявки с форм сайта, привязанные к кампании. */
  formLeads: number;
  previousFormLeads: number;
}

export interface LeadRow {
  id: string;
  /** Звонок или заявка с формы: считаются по-разному, но приходят из одного Calltouch. */
  kind: "call" | "form";
  site: string;
  datetime: string;
  source: string;
  medium: string;
  campaign: string;
  /** ID кампании Директа из utm_campaign вида «имя|12345», если он там был. */
  campaignId: string;
  landing: string;
  durationSec: number;
  unique: boolean;
  /** Разговор короче порога — тег стоит, но лидом это почти никогда не является. */
  shortCall: boolean;
  tags: string[];
  quality: boolean;
  brand: string;
  line: Line | null;
  contractor: string;
}

export interface DailyPoint {
  date: string;
  spend: number;
  clicks: number;
  totalLeads: number;
  qualityLeads: number;
  visits: number;
  calls: number;
}

export interface FunnelStep {
  id: string;
  name: string;
  value: number;
  previous: number;
}

export interface PageRow {
  path: string;
  title: string;
  visits: number;
  bounceRate: number;
  avgDurationSec: number;
  pageDepth: number;
  calls: number;
  cr: number;
  /**
   * Насколько мобильная конверсия страницы отстаёт от десктопа: 0 — разрыва нет
   * или разрез по устройствам для URL не снят, 1 — мобильной конверсии нет.
   */
  deviceGap: number;
}

/** Прокси карт кликов и Вебвизора. В Reporting API записей сессий нет — поля опциональны. */
export interface PageSignal {
  path: string;
  /** Доля визитов, доскролливших хотя бы до середины страницы. */
  scroll50Pct?: number;
  /** Клики по некликабельным зонам, если выгрузка карты кликов или Вебвизора их содержит. */
  deadClicks?: number;
  webvisorVisits?: number;
}

export interface GoalHealthRow {
  counterId: string;
  name: string;
  visits: number;
  goalReaches: number;
  previousGoalReaches: number;
  callGoalMissing?: boolean;
}

export interface PathRow {
  steps: string[];
  sessions: number;
  calls: number;
  cr: number;
}

export interface SourceRow {
  source: string;
  visits: number;
  bounceRate: number;
  durationSec: number;
  calls: number;
  qualityLeads: number;
}

export interface DeviceSplit {
  device: "desktop" | "mobile" | "tablet";
  visits: number;
  bounceRate: number;
  cr: number;
  calls: number;
}

export interface CampaignBehaviorRow {
  campaign: string;
  visits: number;
  bounceRate: number;
  durationSec: number;
  goalLeads: number;
}

export interface BehaviorSnapshot {
  visits: number;
  users: number;
  bounceRate: number;
  avgDurationSec: number;
  pageDepth: number;
  previousVisits: number;
  previousBounceRate: number;
  previousDurationSec: number;
  previousPageDepth: number;
  /** Достижения целей Метрики (звонок ОП / сервис), без Calltouch. */
  goalLeads: number;
  previousGoalLeads: number;
  directClicks: number;
  metrikaDirectVisits: number;
  funnel: FunnelStep[];
  pages: PageRow[];
  paths: PathRow[];
  sources: SourceRow[];
  devices: DeviceSplit[];
  /** Поведение на сайте в разрезе utm_campaign — связывает Директ с тем, что было после клика. */
  byCampaign: CampaignBehaviorRow[];
  dailyVisits?: Array<{ date: string; visits: number }>;
  /** Есть только если источник отдал карту скролла / кликов или мы собрали прокси. */
  pageSignals?: PageSignal[];
  /** Цели «звонок» по счётчикам: чтобы отличить сломанную цель от просадки спроса. */
  goalHealth?: GoalHealthRow[];
}

export interface KpiValue {
  key: string;
  label: string;
  value: number;
  previous: number;
  format: "rub" | "number" | "percent" | "seconds";
  hint: string;
  invert?: boolean;
}

export type AlertMetric =
  | "ctr"
  | "cpc"
  | "cpl"
  | "cpa"
  | "quality_share"
  | "spend"
  | "calls"
  | "leads"
  | "conversion"
  | "bounce"
  | "tracking"
  | "goals"
  | "impressions"
  | "budget";

export interface AlertItem {
  id: string;
  metric: AlertMetric;
  entity: string;
  current: number;
  previous: number;
  changePct: number;
  thresholdPct: number;
  direction: "up" | "down";
  severity: Exclude<Severity, "opportunity">;
  message: string;
  /** Почему сработка не похожа на шум: объём, базовый уровень, порог. */
  explanation: string;
  recommendation: string;
  role: ExpertRole;
  /** Кратко, с чем сравнивали: прошлая период, медиана дней, бюджет месяца. */
  baseline?: string;
  ruleId?: string;
  ruleSource?: string;
  /** Деньги, которые алерт ставит на кон. Нужны сортировке, не показу ради показа. */
  moneyAtStake?: number;
}

export interface InsightItem {
  id: string;
  role: ExpertRole;
  severity: Severity;
  title: string;
  finding: string;
  hypothesis: string;
  action: string;
  impact: string;
  evidence: string[];
  entity?: string;
  /** Деньги на кону: переплата или недобор за период. По ней сортируем список. */
  moneyAtStake?: number;
  /** Идентификатор правила из базы знаний, по которому собрана рекомендация. */
  ruleId?: string;
  ruleSource?: string;
}

export interface HypothesisTest {
  method: "A/B";
  variantA: string;
  variantB: string;
  audience: string;
  duration: string;
  primaryMetric: string;
  guardrail: string;
}

export interface IceScore {
  impact: number;
  confidence: number;
  ease: number;
  /** (impact × confidence × ease) / 100. При оценках 1–10 попадает в диапазон 0–10. */
  score: number;
}

export interface PieScore {
  potential: number;
  importance: number;
  ease: number;
  score: number;
}

export interface HypothesisItem {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  observation: string;
  hypothesis: string;
  expectedImpact: string;
  ice: IceScore;
  pie: PieScore;
  test: HypothesisTest;
  evidence: string[];
  ruleId: string;
  ruleSource: string;
  entity?: string;
}

export interface HealthStatus {
  source: "metrika" | "direct" | "calltouch";
  name: string;
  ok: boolean;
  /** «partial» — данные пришли, но часть кабинетов отвалилась. Старые кэши поля не знают. */
  state?: "ok" | "partial" | "down";
  message: string;
}

export interface DashboardPayload {
  mode: DataMode;
  generatedAt: string;
  range: DateRange;
  kpis: KpiValue[];
  series: DailyPoint[];
  campaigns: Array<CampaignRow & CampaignComputed>;
  contractors: ContractorSummary[];
  brands: BrandSummary[];
  /** Визиты Метрики в разрезе проекта справочника, а не одной суммой по холдингу. */
  projects: ProjectVisit[];
  lines: LineSummary[];
  filter: { contractor: string; line: string; brand: string };
  leads: LeadSummary;
  behavior: BehaviorSnapshot;
  alerts: AlertItem[];
  insights: InsightItem[];
  hypotheses: HypothesisItem[];
  health: HealthStatus[];
  qualityTags: string[];
}

export interface CampaignComputed {
  ctr: number;
  prevCtr: number;
  ctrDelta: number;
  cpc: number;
  prevCpc: number;
  cpcDelta: number;
  cpl: number;
  prevCpl: number;
  cplDelta: number;
  /** CPL по качественным лидам Calltouch, а не по конверсиям кабинета. */
  cplQuality: number;
  prevCplQuality: number;
  cplQualityDelta: number;
  qualityShare: number;
}

export interface ContractorSummary {
  name: string;
  spend: number;
  prevSpend: number;
  clicks: number;
  totalLeads: number;
  prevTotalLeads: number;
  qualityLeads: number;
  prevQualityLeads: number;
  ctr: number;
  cpc: number;
  cpl: number;
  prevCpl: number;
}

export interface BrandSummary {
  name: string;
  contractor: string;
  ncSpend: number;
  afsSpend: number;
  spend: number;
  prevSpend: number;
  totalLeads: number;
  prevTotalLeads: number;
  qualityLeads: number;
  prevQualityLeads: number;
  cpl: number;
  prevCpl: number;
  /** Визиты Метрики по проектам этого бренда за выбранный период. */
  visits: number;
  previousVisits: number;
}

/** Визиты одного проекта (бренд + линия + сайт) из счётчика Метрики. */
export interface ProjectVisit {
  projectId: string;
  brand: string;
  line: Line;
  contractor: string;
  site: string;
  counterIds: string[];
  visits: number;
  previousVisits: number;
  users: number;
  bounceRate: number;
  goalLeads: number;
  /** Общий счётчик, домен сайта не отделил трафик. Цифра одна на все такие проекты. */
  sharedCounter: boolean;
}

export interface LineSummary {
  line: Line;
  spend: number;
  prevSpend: number;
  totalLeads: number;
  prevTotalLeads: number;
  qualityLeads: number;
  prevQualityLeads: number;
  cpl: number;
  prevCpl: number;
  clicks: number;
}

export interface LeadSummary {
  total: number;
  previousTotal: number;
  unique: number;
  quality: number;
  previousQuality: number;
  /** Качественные по тегу, но с разговором короче порога. */
  shortQuality: number;
  previousShortQuality: number;
  /** Заявки с форм сайта — отдельный поток, в CPL по звонкам не входит. */
  forms: number;
  previousForms: number;
  /** Бренды, по которым Calltouch реально отдал данные: без этого ноль лидов не отличить от недогруза. */
  coveredBrands: string[];
  /** Часть кабинетов не ответила — выводы по холдингу в целом делать нельзя. */
  partial: boolean;
  byTag: Array<{ tag: string; count: number; previous: number; quality: boolean }>;
  bySource: Array<{
    source: string;
    total: number;
    quality: number;
    forms: number;
    spend: number;
    cpl: number;
    paid: boolean;
  }>;
  sample: LeadRow[];
}

export interface MetrikaAccount {
  id: string;
  name: string;
  counterId: string;
  token: string;
  goalCallId?: string;
  brand?: string;
  contractor?: string;
  line?: Line;
}

export interface DirectAccount {
  id: string;
  name: string;
  token: string;
  clientLogin: string;
  contractor: string;
  brand: string;
  line: Line;
  /** ID цели Метрики «звонок» — в отчёте Директа только она, не все конверсии. */
  goalCallId?: string;
}

export interface CalltouchAccount {
  id: string;
  name: string;
  siteId: string;
  token: string;
  brand: string;
  contractor?: string;
  url?: string;
  line?: Line;
  qualityTags: string[];
}

export interface AlertThresholds {
  ctrDropPct: number;
  cpcRisePct: number;
  cplRisePct: number;
  /** CPA = расход / уникальные звонки цели Директа, не качественные Calltouch. */
  cpaRisePct: number;
  qualityShareDropPp: number;
  bounceRisePp: number;
  zeroLeadSpend: number;
  /** Падение звонков и целевых лидов к прошлому периоду и к медиане дней. */
  callsDropPct: number;
  leadsDropPct: number;
  conversionDropPct: number;
  /** Дневной расход выше медианы периода, в процентах. */
  spendSpikePct: number;
  spendSpikeMinRub: number;
  trackingLossPct: number;
  budgetPaceOverPct: number;
  budgetPaceUnderPct: number;
  /** Достижения цели упали при почти тех же визитах. */
  goalBreakDropPct: number;
  /** Робастный z-score. 0 отключает статистический фильтр и оставляет только проценты. */
  anomalyZ: number;
  /** Минимум звонков в каждом периоде, иначе доля и падение — шум. */
  minCallsBaseline: number;
  /** Минимум показов в прошлом периоде, чтобы ноль показов сейчас был алертом. */
  zeroImpressionMinPrev: number;
}

export interface AppSettings {
  metrika: MetrikaAccount[];
  direct: DirectAccount[];
  calltouch: CalltouchAccount[];
  telegramBotToken: string;
  telegramChatId: string;
  thresholds: AlertThresholds;
  useLiveDirect: boolean;
  useLiveCalltouch: boolean;
}

export const ROLE_LABEL: Record<ExpertRole, string> = {
  analyst: "Аналитик",
  contextologist: "Контекстолог",
  developer: "Разработчик",
  marketer: "Маркетолог"
};

export const CAMPAIGN_TYPE_LABEL: Record<CampaignType, string> = {
  search_brand: "Поиск · бренд",
  search_model: "Поиск · модели",
  search_competitor: "Поиск · конкуренты",
  rsya: "РСЯ",
  retargeting: "Ретаргет"
};
