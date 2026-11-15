import type { AlertThresholds } from "./types";
import { AFS_QUALITY_TAGS, NC_QUALITY_TAGS } from "./calltouch-catalog";

/**
 * Пороги подобраны так, чтобы не шуметь на коротких кампаниях.
 * Процент сам по себе не срабатывает: рядом обязательны объём и абсолютный рубль или штуки.
 */
export const DEFAULT_THRESHOLDS: AlertThresholds = {
  ctrDropPct: 20,
  cpcRisePct: 25,
  cplRisePct: 30,
  cpaRisePct: 30,
  qualityShareDropPp: 12,
  bounceRisePp: 8,
  zeroLeadSpend: 40000,
  callsDropPct: 20,
  leadsDropPct: 20,
  conversionDropPct: 25,
  spendSpikePct: 80,
  spendSpikeMinRub: 15000,
  trackingLossPct: 18,
  budgetPaceOverPct: 35,
  budgetPaceUnderPct: 40,
  goalBreakDropPct: 50,
  anomalyZ: 3.5,
  minCallsBaseline: 25,
  zeroImpressionMinPrev: 800,
  planRlUnderPct: 20,
  planRlCriticalPct: 35,
  planCplOverPct: 25,
  planCplCriticalPct: 45,
  planRunRateMinDays: 7,
  planRunRateMinLeads: 8
};

export const DEFAULT_QUALITY_TAGS = [...NC_QUALITY_TAGS, ...AFS_QUALITY_TAGS];
