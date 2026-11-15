import { deltaPct, num, safeDiv } from "../format";
import type {
  AlertItem,
  AlertThresholds,
  BehaviorSnapshot,
  CampaignComputed,
  CampaignRow,
  DailyPoint,
  Line
} from "../types";
import { BENCHMARKS, MIN_CLICKS, MIN_CLICKS_FOR_TRACKING, MIN_IMPRESSIONS, MIN_SPEND } from "../benchmarks";
import { DEFAULT_THRESHOLDS } from "../defaults";
import { cpc, ctr } from "../mock";
import { ruleRef } from "../knowledge/rules";
import { median, robustZ } from "../stats";
import type { MetrikaGoalCounter } from "../goals-file";
import { ACCOUNTS } from "../catalog";
import type { FactSlice, PlanRow } from "../plan-model";
import { daysInMonth } from "../plan-model";

export interface AlertBudget {
  brand: string;
  line: Line;
  contractor: string;
  monthlyBudget: number;
}

export interface AlertContext {
  series?: DailyPoint[];
  totalLeadsNow?: number;
  totalLeadsPrev?: number;
  goals?: MetrikaGoalCounter[];
  budgets?: AlertBudget[];
  periodDays?: number;
}

export function computeCampaign(row: CampaignRow): CampaignRow & CampaignComputed {
  const ctrNow = ctr(row.current);
  const ctrPrev = ctr(row.previous);
  const cpcNow = cpc(row.current);
  const cpcPrev = cpc(row.previous);
  const cplNow = safeDiv(row.current.cost, row.totalLeads);
  const cplPrev = safeDiv(row.previous.cost, row.previousTotalLeads);
  const cplQualityNow = safeDiv(row.current.cost, row.qualityLeads);
  const cplQualityPrev = safeDiv(row.previous.cost, row.previousQualityLeads);
  return {
    ...row,
    ctr: ctrNow,
    prevCtr: ctrPrev,
    ctrDelta: deltaPct(ctrNow, ctrPrev),
    cpc: cpcNow,
    prevCpc: cpcPrev,
    cpcDelta: deltaPct(cpcNow, cpcPrev),
    cpl: cplNow,
    prevCpl: cplPrev,
    cplDelta: deltaPct(cplNow, cplPrev),
    cplQuality: cplQualityNow,
    prevCplQuality: cplQualityPrev,
    cplQualityDelta: deltaPct(cplQualityNow, cplQualityPrev),
    qualityShare: safeDiv(row.qualityLeads, row.calls) * 100
  };
}

function fillThresholds(input: AlertThresholds): AlertThresholds {
  return { ...DEFAULT_THRESHOLDS, ...input };
}

function withRule(id: string, recommendationFacts: string): Pick<AlertItem, "recommendation" | "ruleId" | "ruleSource"> {
  const ref = ruleRef(id);
  return {
    ruleId: ref.ruleId,
    ruleSource: ref.ruleSource,
    recommendation: `${ref.action} ${recommendationFacts}`.trim()
  };
}

function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

type Campaign = CampaignRow & CampaignComputed;

function significant(c: Campaign): boolean {
  return (
    c.current.impressions >= MIN_IMPRESSIONS &&
    c.current.clicks >= MIN_CLICKS &&
    c.previous.clicks >= MIN_CLICKS &&
    c.previous.impressions >= MIN_IMPRESSIONS
  );
}

function capMetric(alerts: AlertItem[], metric: AlertItem["metric"], limit: number): AlertItem[] {
  const ranked = alerts
    .filter((a) => a.metric === metric)
    .sort((a, b) => (b.moneyAtStake || 0) - (a.moneyAtStake || 0) || Math.abs(b.changePct) - Math.abs(a.changePct));
  const keep = new Set(ranked.slice(0, limit).map((a) => a.id));
  return alerts.filter((a) => a.metric !== metric || keep.has(a.id));
}

export function buildAlerts(
  campaigns: Campaign[],
  behavior: BehaviorSnapshot,
  qualityNow: number,
  qualityPrev: number,
  callsNow: number,
  callsPrev: number,
  rawThresholds: AlertThresholds,
  ctx: AlertContext = {}
): AlertItem[] {
  const thresholds = fillThresholds(rawThresholds);
  const alerts: AlertItem[] = [];
  const days = Math.max(1, ctx.periodDays || ctx.series?.length || 14);

  for (const c of campaigns) {
    if (c.current.impressions < 10 && c.previous.impressions >= thresholds.zeroImpressionMinPrev && c.previous.cost >= 5000) {
      alerts.push({
        id: `zero-impr-${c.id}`,
        metric: "impressions",
        entity: c.name,
        current: c.current.impressions,
        previous: c.previous.impressions,
        changePct: -100,
        thresholdPct: thresholds.zeroImpressionMinPrev,
        direction: "down",
        severity: "critical",
        message: `Показов ${num(c.current.impressions)} при ${num(c.previous.impressions)} в прошлом периоде (${rub(c.previous.cost)} расхода тогда).`,
        explanation: `Шум отсечён: в прошлом периоде не меньше ${num(thresholds.zeroImpressionMinPrev)} показов и 5 000 ₽. Новая кампания без истории сюда не попадает.`,
        baseline: `Прошлый период: ${num(c.previous.impressions)} показов`,
        moneyAtStake: c.previous.cost,
        role: "contextologist",
        ...withRule(
          "yd.zero-impressions",
          `Кампания «${c.name}», логин ${c.login}.`
        )
      });
    }

    if (significant(c) && c.ctrDelta <= -thresholds.ctrDropPct && c.prevCtr >= 0.4) {
      const lostClicks = Math.max(0, Math.round((c.current.impressions * (c.prevCtr - c.ctr)) / 100));
      alerts.push({
        id: `ctr-${c.id}`,
        metric: "ctr",
        entity: c.name,
        current: c.ctr,
        previous: c.prevCtr,
        changePct: c.ctrDelta,
        thresholdPct: thresholds.ctrDropPct,
        direction: "down",
        severity: c.ctrDelta <= -35 ? "critical" : "warning",
        message: `CTR ${c.ctr.toFixed(2)}% против ${c.prevCtr.toFixed(2)}% (${c.ctrDelta.toFixed(0)}%). Для типа «${BENCHMARKS[c.type].label}» ориентир около ${BENCHMARKS[c.type].ctr}%.`,
        explanation: `Оба периода крупнее порога шума: ${num(MIN_IMPRESSIONS)} показов и ${num(MIN_CLICKS)} кликов. Падение сильнее порога ${thresholds.ctrDropPct}%.`,
        baseline: `CTR прошлого периода ${c.prevCtr.toFixed(2)}%`,
        moneyAtStake: lostClicks * c.cpc,
        role: "contextologist",
        ...withRule(
          c.type === "rsya" ? "yd.rsya.placements" : "yd.copy.message-match",
          `На текущих показах это около ${num(lostClicks)} недополученных кликов.`
        )
      });
    }

    if (significant(c) && c.cpcDelta >= thresholds.cpcRisePct && c.current.cost >= MIN_SPEND / 2) {
      const extra = Math.max(0, (c.cpc - c.prevCpc) * c.current.clicks);
      alerts.push({
        id: `cpc-${c.id}`,
        metric: "cpc",
        entity: c.name,
        current: c.cpc,
        previous: c.prevCpc,
        changePct: c.cpcDelta,
        thresholdPct: thresholds.cpcRisePct,
        direction: "up",
        severity: c.cpcDelta >= 40 ? "critical" : "warning",
        message: `CPC ${rub(c.cpc)} против ${rub(c.prevCpc)} (${c.cpcDelta.toFixed(0)}%). Ориентир типа «${BENCHMARKS[c.type].label}» — ${rub(BENCHMARKS[c.type].cpc)}.`,
        explanation: `Есть объём в обоих периодах и расход от ${rub(MIN_SPEND / 2)}. Рост сильнее порога ${thresholds.cpcRisePct}%.`,
        baseline: `CPC прошлого периода ${rub(c.prevCpc)}`,
        moneyAtStake: extra,
        role: "contextologist",
        ...withRule(
          Math.abs(c.ctrDelta) < 8 ? "yd.strategy.learning" : "yd.search.negatives",
          `Переплата за те же клики около ${rub(extra)}.`
        )
      });
    }

    if (
      c.qualityLeads >= 4 &&
      c.previousQualityLeads >= 4 &&
      c.current.cost >= MIN_SPEND / 2 &&
      c.cplQualityDelta >= thresholds.cplRisePct
    ) {
      const extra = Math.max(0, (c.cplQuality - c.prevCplQuality) * c.qualityLeads);
      alerts.push({
        id: `cpl-${c.id}`,
        metric: "cpl",
        entity: c.name,
        current: c.cplQuality,
        previous: c.prevCplQuality,
        changePct: c.cplQualityDelta,
        thresholdPct: thresholds.cplRisePct,
        direction: "up",
        severity: c.cplQualityDelta >= 50 ? "critical" : "warning",
        message: `CPL по целевым звонкам ${rub(c.cplQuality)} против ${rub(c.prevCplQuality)} (+${c.cplQualityDelta.toFixed(0)}%) при ${num(c.qualityLeads)} целевых.`,
        explanation: `В обоих периодах не меньше 4 целевых звонков: скачок с 1 до 2 лидов алертом не считается. Порог роста ${thresholds.cplRisePct}%.`,
        baseline: `CPL прошлого периода ${rub(c.prevCplQuality)}, целевых было ${num(c.previousQualityLeads)}`,
        moneyAtStake: extra,
        role: "analyst",
        ...withRule(
          c.type === "rsya" ? "yd.rsya.placements" : "yd.offline.quality",
          `Лишние ${rub(extra)} относительно прошлого CPL на том же числе лидов.`
        )
      });
    }

    if (c.current.cost >= thresholds.zeroLeadSpend && c.qualityLeads === 0 && c.current.clicks >= MIN_CLICKS) {
      alerts.push({
        id: `zero-${c.id}`,
        metric: "spend",
        entity: c.name,
        current: c.qualityLeads,
        previous: c.previousQualityLeads,
        changePct: deltaPct(c.qualityLeads, c.previousQualityLeads),
        thresholdPct: thresholds.zeroLeadSpend,
        direction: "down",
        severity: "critical",
        message: `Расход ${rub(c.current.cost)} и ${num(c.calls)} звонков с меткой кампании, целевых тегов ноль.`,
        explanation: `Порог расхода без целевых — ${rub(thresholds.zeroLeadSpend)}, и кликов не меньше ${num(MIN_CLICKS)}. Мелкая кампания без статистики не орёт.`,
        baseline: c.previousQualityLeads ? `В прошлом периоде целевых было ${num(c.previousQualityLeads)}` : "В прошлом периоде целевых тоже не было",
        moneyAtStake: c.current.cost,
        role: "contextologist",
        ...withRule(
          c.calls === 0 ? "ym.attribution" : c.type === "rsya" ? "yd.rsya.placements" : "yd.search.negatives",
          c.calls === 0
            ? "Звонков с меткой нет: сначала трекинг, потом минус-слова."
            : "Звонки есть, тег качества не ставится: слушать записи, не резать ставку вслепую."
        )
      });
    }
  }

  const shareNow = safeDiv(qualityNow, callsNow) * 100;
  const sharePrev = safeDiv(qualityPrev, callsPrev) * 100;
  if (
    callsNow >= thresholds.minCallsBaseline &&
    callsPrev >= thresholds.minCallsBaseline &&
    sharePrev - shareNow >= thresholds.qualityShareDropPp
  ) {
    alerts.push({
      id: "quality-share",
      metric: "quality_share",
      entity: "Calltouch · срез",
      current: shareNow,
      previous: sharePrev,
      changePct: shareNow - sharePrev,
      thresholdPct: thresholds.qualityShareDropPp,
      direction: "down",
      severity: sharePrev - shareNow >= 18 ? "critical" : "warning",
      message: `Доля целевых ${shareNow.toFixed(1)}% против ${sharePrev.toFixed(1)}% (${num(qualityNow)} из ${num(callsNow)} звонков).`,
      explanation: `В обоих периодах не меньше ${num(thresholds.minCallsBaseline)} звонков, падение доли не меньше ${thresholds.qualityShareDropPp} п.п.`,
      baseline: `Прошлая доля ${sharePrev.toFixed(1)}%`,
      role: "analyst",
      ...withRule("ct.quality-share", "")
    });
  }

  if (
    behavior.visits >= 500 &&
    behavior.previousVisits >= 500 &&
    behavior.bounceRate - behavior.previousBounceRate >= thresholds.bounceRisePp
  ) {
    const rise = behavior.bounceRate - behavior.previousBounceRate;
    alerts.push({
      id: "bounce",
      metric: "bounce",
      entity: "Яндекс Метрика · срез",
      current: behavior.bounceRate,
      previous: behavior.previousBounceRate,
      changePct: rise,
      thresholdPct: thresholds.bounceRisePp,
      direction: "up",
      severity: rise >= 15 ? "critical" : "warning",
      message: `Отказы ${behavior.bounceRate.toFixed(1)}% (+${rise.toFixed(1)} п.п. к ${behavior.previousBounceRate.toFixed(1)}%).`,
      explanation: `Визитов не меньше 500 в каждом периоде, рост не меньше ${thresholds.bounceRisePp} п.п. Одна шумная страница холдинг не красит.`,
      baseline: `Отказ прошлого периода ${behavior.previousBounceRate.toFixed(1)}%`,
      role: "developer",
      ...withRule("ym.behavior.bounce", `Визитов сейчас ${num(behavior.visits)}.`)
    });
  }

  const loss = behavior.directClicks > 0 ? 1 - safeDiv(behavior.metrikaDirectVisits, behavior.directClicks) : 0;
  if (behavior.directClicks >= MIN_CLICKS_FOR_TRACKING && loss * 100 >= thresholds.trackingLossPct) {
    const lost = Math.round(behavior.directClicks * loss);
    const holdingCpc = safeDiv(
      campaigns.reduce((s, c) => s + c.current.cost, 0),
      campaigns.reduce((s, c) => s + c.current.clicks, 0)
    );
    alerts.push({
      id: "tracking",
      metric: "tracking",
      entity: "Директ vs Метрика",
      current: behavior.metrikaDirectVisits,
      previous: behavior.directClicks,
      changePct: -loss * 100,
      thresholdPct: thresholds.trackingLossPct,
      direction: "down",
      severity: "critical",
      message: `До визита не доходит около ${Math.round(loss * 100)}% кликов: Директ ${num(behavior.directClicks)}, Метрика ${num(behavior.metrikaDirectVisits)}.`,
      explanation: `Кликов больше ${num(MIN_CLICKS_FOR_TRACKING)}, разрыв не меньше ${thresholds.trackingLossPct}%. Меньший разрыв бывает из-за отказов до счётчика и в алерт не идёт.`,
      baseline: "Ожидание: визиты с Директа близки к кликам",
      moneyAtStake: lost * holdingCpc,
      role: "developer",
      ...withRule("ym.attribution", `Это около ${num(lost)} кликов.`)
    });
  }

  const callsDropped =
    callsPrev >= thresholds.minCallsBaseline &&
    callsNow <= callsPrev * (1 - thresholds.callsDropPct / 100) &&
    callsPrev - callsNow >= 8;
  if (callsDropped) {
    alerts.push({
      id: "calls",
      metric: "calls",
      entity: "Calltouch · звонки",
      current: callsNow,
      previous: callsPrev,
      changePct: deltaPct(callsNow, callsPrev),
      thresholdPct: thresholds.callsDropPct,
      direction: "down",
      severity: deltaPct(callsNow, callsPrev) <= -35 ? "critical" : "warning",
      message: `Звонков ${num(callsNow)} против ${num(callsPrev)} (${deltaPct(callsNow, callsPrev).toFixed(0)}%).`,
      explanation: `База прошлого периода не меньше ${num(thresholds.minCallsBaseline)} звонков, падение не меньше ${thresholds.callsDropPct}% и не меньше 8 штук.`,
      baseline: `Прошлый период: ${num(callsPrev)} звонков`,
      role: "analyst",
      ...withRule("stats.baseline-drop", "Сначала развилка: пропали показы или пропала цель.")
    });
  }

  const callsDropRate = callsPrev > 0 ? (callsPrev - callsNow) / callsPrev : 0;
  const qualityDropRate = qualityPrev > 0 ? (qualityPrev - qualityNow) / qualityPrev : 0;
  if (
    qualityPrev >= thresholds.minCallsBaseline &&
    qualityDropRate * 100 >= thresholds.leadsDropPct &&
    qualityPrev - qualityNow >= 8 &&
    callsDropRate < qualityDropRate - 0.1
  ) {
    alerts.push({
      id: "leads",
      metric: "leads",
      entity: "Calltouch · целевые",
      current: qualityNow,
      previous: qualityPrev,
      changePct: -qualityDropRate * 100,
      thresholdPct: thresholds.leadsDropPct,
      direction: "down",
      severity: qualityDropRate >= 0.4 ? "critical" : "warning",
      message: `Целевых ${num(qualityNow)} против ${num(qualityPrev)} (${Math.round(-qualityDropRate * 100)}%), хотя все звонки просели слабее.`,
      explanation:
        "Алерт ставится, только если целевые падают заметно сильнее всех звонков. Общий провал объёма уже покрыт алертом по звонкам и здесь не дублируется.",
      baseline: `Прошлый период: ${num(qualityPrev)} целевых`,
      role: "analyst",
      ...withRule("ct.quality-share", "")
    });
  }

  const tail = callsTailAlert(ctx.series, thresholds, callsDropped);
  if (tail) alerts.push(tail);

  const spend = campaigns.reduce((s, c) => s + c.current.cost, 0);
  const prevSpend = campaigns.reduce((s, c) => s + c.previous.cost, 0);
  const leadsNow = ctx.totalLeadsNow ?? campaigns.reduce((s, c) => s + c.totalLeads, 0);
  const leadsPrev = ctx.totalLeadsPrev ?? campaigns.reduce((s, c) => s + c.previousTotalLeads, 0);
  if (leadsNow >= 8 && leadsPrev >= 8 && spend > 0 && prevSpend > 0) {
    const cpa = safeDiv(spend, leadsNow);
    const prevCpa = safeDiv(prevSpend, leadsPrev);
    const rise = deltaPct(cpa, prevCpa);
    if (rise >= thresholds.cpaRisePct && cpa - prevCpa >= 400) {
      alerts.push({
        id: "cpa",
        metric: "cpa",
        entity: "Директ · уникальные звонки",
        current: cpa,
        previous: prevCpa,
        changePct: rise,
        thresholdPct: thresholds.cpaRisePct,
        direction: "up",
        severity: rise >= 50 ? "critical" : "warning",
        message: `CPA по цели Директа ${rub(cpa)} против ${rub(prevCpa)} (+${rise.toFixed(0)}%) на ${num(leadsNow)} уникальных звонках.`,
        explanation: `Не меньше 8 звонков цели в каждом периоде, рост не меньше ${thresholds.cpaRisePct}% и не меньше 400 ₽. Это не CPL Calltouch: цель Директа шире тега качества.`,
        baseline: `CPA прошлого периода ${rub(prevCpa)}`,
        moneyAtStake: Math.max(0, (cpa - prevCpa) * leadsNow),
        role: "analyst",
        ...withRule("yd.strategy.fit", "")
      });
    }
  }

  const goalBroken = siteGoalBroken(behavior, thresholds);
  if (goalBroken) alerts.push(goalBroken);
  else {
    const perCounter = counterGoalAlert(behavior);
    if (perCounter) alerts.push(perCounter);
  }

  const crNow = safeDiv(behavior.goalLeads, behavior.visits) * 100;
  const crPrev = safeDiv(behavior.previousGoalLeads, behavior.previousVisits) * 100;
  if (
    !goalBroken &&
    behavior.visits >= 800 &&
    behavior.previousVisits >= 800 &&
    crPrev >= 0.15 &&
    deltaPct(crNow, crPrev) <= -thresholds.conversionDropPct
  ) {
    alerts.push({
      id: "conversion",
      metric: "conversion",
      entity: "Метрика · визит в цель",
      current: crNow,
      previous: crPrev,
      changePct: deltaPct(crNow, crPrev),
      thresholdPct: thresholds.conversionDropPct,
      direction: "down",
      severity: deltaPct(crNow, crPrev) <= -40 ? "critical" : "warning",
      message: `Конверсия визита в цель ${crNow.toFixed(2)}% против ${crPrev.toFixed(2)}% (${deltaPct(crNow, crPrev).toFixed(0)}%).`,
      explanation: `Визитов не меньше 800 в каждом периоде, прошлая конверсия не нулевая, падение не меньше ${thresholds.conversionDropPct}%. Если цель умерла совсем, вместо этого срабатывает алерт цели.`,
      baseline: `Прошлая конверсия ${crPrev.toFixed(2)}%`,
      role: "marketer",
      ...withRule("lp.offer", `Целей сейчас ${num(behavior.goalLeads)}, было ${num(behavior.previousGoalLeads)}.`)
    });
  }

  const spike = spendSpikeAlert(ctx.series, thresholds);
  if (spike) alerts.push(spike);
  alerts.push(...budgetAlerts(campaigns, thresholds, ctx.budgets || [], days));
  alerts.push(...missingGoalConfig(ctx.goals || []));

  let trimmed = capMetric(alerts, "ctr", 5);
  trimmed = capMetric(trimmed, "cpc", 5);
  trimmed = capMetric(trimmed, "cpl", 5);
  trimmed = capMetric(trimmed, "spend", 5);
  trimmed = capMetric(trimmed, "impressions", 5);
  trimmed = capMetric(trimmed, "budget", 6);

  const rank = { critical: 0, warning: 1 };
  return trimmed.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (b.moneyAtStake || 0) - (a.moneyAtStake || 0) || a.changePct - b.changePct
  );
}

function siteGoalBroken(behavior: BehaviorSnapshot, thresholds: AlertThresholds): AlertItem | null {
  if (behavior.visits < 400 || behavior.previousGoalLeads < 15) return null;
  const visitsHold = behavior.visits >= behavior.previousVisits * 0.75;
  const drop = 1 - safeDiv(behavior.goalLeads, behavior.previousGoalLeads);
  if (!visitsHold || drop * 100 < thresholds.goalBreakDropPct) return null;
  return {
    id: "goals-site",
    metric: "goals",
    entity: "Метрика · цель звонка",
    current: behavior.goalLeads,
    previous: behavior.previousGoalLeads,
    changePct: -drop * 100,
    thresholdPct: thresholds.goalBreakDropPct,
    direction: "down",
    severity: "critical",
    message: `Целей ${num(behavior.goalLeads)} против ${num(behavior.previousGoalLeads)}, визиты при этом ${num(behavior.visits)} (были ${num(behavior.previousVisits)}).`,
    explanation: `Визиты держатся (не просели больше чем на 25%), а достижения цели упали не меньше чем на ${thresholds.goalBreakDropPct}% и раньше их было от 15. Это похоже на сломанную цель, а не на уход спроса.`,
    baseline: `Прошлый период: ${num(behavior.previousGoalLeads)} достижений`,
    role: "developer",
    ...withRule("ym.goals.health", "")
  };
}

function counterGoalAlert(behavior: BehaviorSnapshot): AlertItem | null {
  const dead = (behavior.goalHealth || []).filter(
    (row) => row.visits >= 300 && row.previousGoalReaches >= 10 && row.goalReaches === 0
  );
  if (!dead.length) return null;
  const names = dead
    .slice(0, 4)
    .map((row) => `${row.name} (${row.counterId})`)
    .join(", ");
  return {
    id: "goals-counter",
    metric: "goals",
    entity: dead.length === 1 ? names : `Цели звонка · ${dead.length} счётчиков`,
    current: 0,
    previous: dead.reduce((s, row) => s + row.previousGoalReaches, 0),
    changePct: -100,
    thresholdPct: 100,
    direction: "down",
    severity: "critical",
    message: `На ${dead.length === 1 ? "счётчике" : "счётчиках"} ${names} визиты есть, достижений цели ноль. В прошлом периоде они были.`,
    explanation: "Порог: от 300 визитов и от 10 достижений цели в прошлом периоде. Остальные счётчики при этом могут быть живы, поэтому общий CR ещё не обнулён.",
    baseline: "Прошлые достижения цели по этим счётчикам больше нуля",
    role: "developer",
    ...withRule("ym.goals.health", "")
  };
}

function missingGoalConfig(goals: MetrikaGoalCounter[]): AlertItem[] {
  const known = new Set(ACCOUNTS.flatMap((acc) => acc.counterIds));
  const broken = goals.filter((row) => row.http === 200 && known.has(row.counterId) && row.calls.length === 0);
  if (!broken.length) return [];
  const listed = broken
    .slice(0, 5)
    .map((row) => row.counterId)
    .join(", ");
  return [
    {
      id: "goals-config",
      metric: "goals",
      entity: "Справочник целей Метрики",
      current: broken.length,
      previous: goals.length,
      changePct: 0,
      thresholdPct: 0,
      direction: "down",
      severity: "warning",
      message: `В выгрузке целей у ${num(broken.length)} счётчиков нет ни одной цели со словом «звонок»: ${listed}.`,
      explanation:
        "Берём только ответ 200 и счётчики из справочника холдинга. Ошибка доступа к счётчику сюда не входит. Это предупреждение о настройке, не о дневном спросе.",
      baseline: "Ожидание: у дилерского счётчика есть цель звонка",
      role: "developer",
      ...withRule("ym.goals.health", "Сверьте id цели со справочником кабинета в разделе «Подключение».")
    }
  ];
}

function spendSpikeAlert(series: DailyPoint[] | undefined, thresholds: AlertThresholds): AlertItem | null {
  if (!series || series.length < 5 || thresholds.anomalyZ <= 0) return null;
  const spends = series.map((d) => d.spend);
  const med = median(spends);
  if (med <= 0) return null;
  const worst = series.reduce((best, day) => (day.spend > best.spend ? day : best), series[0]);
  const z = robustZ(worst.spend, spends);
  const risePct = ((worst.spend - med) / med) * 100;
  if (z == null || z < thresholds.anomalyZ) return null;
  if (risePct < thresholds.spendSpikePct) return null;
  if (worst.spend - med < thresholds.spendSpikeMinRub) return null;
  return {
    id: `spend-spike-${worst.date}`,
    metric: "spend",
    entity: `Расход за ${worst.date}`,
    current: worst.spend,
    previous: med,
    changePct: risePct,
    thresholdPct: thresholds.spendSpikePct,
    direction: "up",
    severity: risePct >= 150 ? "critical" : "warning",
    message: `${worst.date}: расход ${rub(worst.spend)} при медиане дней ${rub(med)} (+${risePct.toFixed(0)}%, z=${z.toFixed(1)}).`,
    explanation: `Нужны сразу три условия: не меньше 5 дней, робастный z не ниже ${thresholds.anomalyZ}, день выше медианы на ${thresholds.spendSpikePct}% и не меньше чем на ${rub(thresholds.spendSpikeMinRub)}. Один дорогой клик на малой кампании не проходит.`,
    baseline: `Медиана дневного расхода периода ${rub(med)}`,
    moneyAtStake: worst.spend - med,
    role: "analyst",
    ...withRule("stats.spend-spike", "")
  };
}

function callsTailAlert(
  series: DailyPoint[] | undefined,
  thresholds: AlertThresholds,
  periodAlready: boolean
): AlertItem | null {
  if (periodAlready || !series || series.length < 6 || thresholds.anomalyZ <= 0) return null;
  const calls = series.map((d) => d.calls);
  const med = median(calls);
  if (med < 3) return null;
  const tail = series.slice(-3);
  const tailAvg = tail.reduce((s, d) => s + d.calls, 0) / 3;
  const dropPct = ((med - tailAvg) / med) * 100;
  const z = robustZ(tailAvg, calls);
  if (z == null || z > -thresholds.anomalyZ) return null;
  if (dropPct < thresholds.callsDropPct) return null;
  return {
    id: "calls-tail",
    metric: "calls",
    entity: "Calltouch · последние 3 дня",
    current: tailAvg,
    previous: med,
    changePct: -dropPct,
    thresholdPct: thresholds.callsDropPct,
    direction: "down",
    severity: "warning",
    message: `Последние 3 дня в среднем ${tailAvg.toFixed(0)} звонков в день против медианы периода ${med.toFixed(0)} (−${dropPct.toFixed(0)}%, z=${z.toFixed(1)}).`,
    explanation:
      "Период целиком ещё может выглядеть нормально. Алерт ставится, если хвост ряда ниже медианы и по проценту, и по z-score, а дневная медиана не меньше 3 звонков.",
    baseline: `Медиана дней периода: ${med.toFixed(0)} звонков`,
    role: "analyst",
    ...withRule("stats.baseline-drop", "")
  };
}

function budgetAlerts(
  campaigns: Campaign[],
  thresholds: AlertThresholds,
  budgets: AlertBudget[],
  days: number
): AlertItem[] {
  if (!budgets.length) return [];
  const budgetByKey = new Map<string, number>();
  for (const row of budgets) {
    const key = `${row.brand}|${row.line}|${row.contractor}`;
    budgetByKey.set(key, (budgetByKey.get(key) || 0) + row.monthlyBudget);
  }
  const spendByKey = new Map<string, { spend: number; prev: number; label: string }>();
  for (const c of campaigns) {
    const key = `${c.brand}|${c.line}|${c.contractor}`;
    const cur = spendByKey.get(key) || { spend: 0, prev: 0, label: `${c.brand} · ${c.line.toUpperCase()} · ${c.contractor}` };
    cur.spend += c.current.cost;
    cur.prev += c.previous.cost;
    spendByKey.set(key, cur);
  }
  const out: AlertItem[] = [];
  for (const [key, monthly] of budgetByKey) {
    if (monthly < 30000) continue;
    const fact = spendByKey.get(key);
    if (!fact) continue;
    const expected = monthly * (days / 30);
    if (expected < 10000) continue;
    const pace = fact.spend / expected;
    if (pace >= 1 + thresholds.budgetPaceOverPct / 100 && fact.spend - expected >= 20000) {
      out.push({
        id: `budget-over-${key}`,
        metric: "budget",
        entity: fact.label,
        current: fact.spend,
        previous: expected,
        changePct: (pace - 1) * 100,
        thresholdPct: thresholds.budgetPaceOverPct,
        direction: "up",
        severity: pace >= 1.6 ? "critical" : "warning",
        message: `За ${days} дн. потрачено ${rub(fact.spend)} при темпе бюджета ${rub(expected)} (месяц ${rub(monthly)}).`,
        explanation: `Перерасход не меньше ${thresholds.budgetPaceOverPct}% и не меньше 20 000 ₽. Кабинеты без месячного бюджета в справочнике не проверяются.`,
        baseline: `Ожидаемый расход за ${days} дн.: ${rub(expected)}`,
        moneyAtStake: fact.spend - expected,
        role: "analyst",
        ...withRule("yd.budget.pacing", "Режьте недельный бюджет стратегии, не ставки всех фраз сразу.")
      });
    } else if (
      pace <= 1 - thresholds.budgetPaceUnderPct / 100 &&
      expected - fact.spend >= 20000 &&
      fact.spend >= 8000 &&
      fact.prev >= fact.spend * 0.4
    ) {
      out.push({
        id: `budget-under-${key}`,
        metric: "budget",
        entity: fact.label,
        current: fact.spend,
        previous: expected,
        changePct: (pace - 1) * 100,
        thresholdPct: thresholds.budgetPaceUnderPct,
        direction: "down",
        severity: "warning",
        message: `За ${days} дн. потрачено ${rub(fact.spend)} — это ${Math.round(pace * 100)}% темпа бюджета ${rub(monthly)}/мес.`,
        explanation: `Недорасход не меньше ${thresholds.budgetPaceUnderPct}% и 20 000 ₽. Кабинет, который и в прошлом периоде почти не тратил, не считаем внезапной остановкой.`,
        baseline: `Ожидаемый расход за ${days} дн.: ${rub(expected)}`,
        role: "analyst",
        ...withRule("yd.budget.pacing", "Проверьте статус, модерацию и не занижена ли целевая CPA.")
      });
    }
  }
  return out;
}

/** Прогноз на конец месяца при текущем темпе окна. Для CPL темп числителя и знаменателя сокращается. */
export function runRateLeads(fact: number, periodDays: number, monthDays: number): number {
  if (periodDays <= 0) return 0;
  return (fact / periodDays) * monthDays;
}

export function buildPlanRunRateAlerts(
  plans: PlanRow[],
  facts: FactSlice[],
  month: string,
  periodDays: number,
  rawThresholds: AlertThresholds
): AlertItem[] {
  const thresholds = fillThresholds(rawThresholds);
  if (periodDays < thresholds.planRunRateMinDays) return [];
  const monthDays = daysInMonth(month);
  const alerts: AlertItem[] = [];
  for (const plan of plans) {
    if (plan.month !== month) continue;
    const matched = facts.filter(
      (fact) =>
        fact.contractor === plan.contractor &&
        fact.brand === plan.brand &&
        (plan.line === "" || fact.line === plan.line)
    );
    const factLeads = matched.reduce((sum, fact) => sum + fact.leads, 0);
    const factSpend = matched.reduce((sum, fact) => sum + fact.spend, 0);
    const label = [plan.brand, plan.line ? plan.line.toUpperCase() : "", plan.contractor].filter(Boolean).join(" · ");
    const idBase = `${plan.contractor}|${plan.brand}|${plan.line || "all"}`;
    if (thresholds.planRlUnderPct > 0 && plan.leads != null && plan.leads >= 10) {
      const forecast = runRateLeads(factLeads, periodDays, monthDays);
      const gap = plan.leads - forecast;
      const underPct = (gap / plan.leads) * 100;
      if (underPct >= thresholds.planRlUnderPct && gap >= thresholds.planRunRateMinLeads) {
        const critical = underPct >= thresholds.planRlCriticalPct && gap >= thresholds.planRunRateMinLeads * 2;
        alerts.push({
          id: `plan-rl-${idBase}`,
          metric: "plan",
          entity: `${label} · РЛ`,
          current: forecast,
          previous: plan.leads,
          changePct: -underPct,
          thresholdPct: critical ? thresholds.planRlCriticalPct : thresholds.planRlUnderPct,
          direction: "down",
          severity: critical ? "critical" : "warning",
          message: `Темп даёт к концу месяца ${Math.round(forecast)} результативных лидов при плане ${Math.round(plan.leads)} (−${underPct.toFixed(0)}%). За ${periodDays} дн. факт ${Math.round(factLeads)}.`,
          explanation: `РЛ — план результативных лидов на месяц. Прогноз = факт окна × дни месяца / дни окна. Алерт с ${thresholds.planRlUnderPct}%, critical с ${thresholds.planRlCriticalPct}%, и только если не хватает хотя бы ${thresholds.planRunRateMinLeads} лидов. Окно короче ${thresholds.planRunRateMinDays} дней не экстраполируем.`,
          baseline: `План РЛ ${Math.round(plan.leads)} на ${month}, темп с ${periodDays} дн.`,
          moneyAtStake: plan.cpl != null ? gap * plan.cpl : undefined,
          role: "analyst",
          ...withRule("plan.run-rate", "Сверьте показы и долю целевых тегов, прежде чем поднимать ставку.")
        });
      }
    }
    if (thresholds.planCplOverPct > 0 && plan.cpl != null && plan.cpl > 0 && factLeads >= thresholds.planRunRateMinLeads) {
      const factCpl = factSpend / factLeads;
      const overPct = ((factCpl - plan.cpl) / plan.cpl) * 100;
      const extra = (factCpl - plan.cpl) * factLeads;
      if (overPct >= thresholds.planCplOverPct && extra >= 8000) {
        const critical = overPct >= thresholds.planCplCriticalPct && extra >= 20000;
        alerts.push({
          id: `plan-cpl-${idBase}`,
          metric: "plan",
          entity: `${label} · CPL`,
          current: factCpl,
          previous: plan.cpl,
          changePct: overPct,
          thresholdPct: critical ? thresholds.planCplCriticalPct : thresholds.planCplOverPct,
          direction: "up",
          severity: critical ? "critical" : "warning",
          message: `CPL ${rub(factCpl)} против плана ${rub(plan.cpl)} (+${overPct.toFixed(0)}%). На темпе месяца цена лида не снизится сама: расход и РЛ растут вместе.`,
          explanation: `План CPL сравнивается с расходом Директа на результативный лид Calltouch за выбранное окно. Алерт с +${thresholds.planCplOverPct}% и переплатой от 8 000 ₽, critical с +${thresholds.planCplCriticalPct}% и 20 000 ₽. Меньше ${thresholds.planRunRateMinLeads} лидов — шум.`,
          baseline: `План CPL ${rub(plan.cpl)} на ${month}`,
          moneyAtStake: extra,
          role: "analyst",
          ...withRule("plan.run-rate", "Сузьте нецелевые запросы и площадки, цель стратегии не сбрасывайте пачкой.")
        });
      }
    }
  }
  return alerts
    .sort((a, b) => (b.moneyAtStake || 0) - (a.moneyAtStake || 0) || Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 8);
}
