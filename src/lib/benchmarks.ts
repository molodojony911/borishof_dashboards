import type { CampaignType } from "./types";

/** Ориентиры для автодилерского digital в РФ. Не KPI-план, а санитарные коридоры. */
export const BENCHMARKS: Record<
  CampaignType,
  { ctr: number; cpc: number; cpl: number; label: string }
> = {
  search_brand: { ctr: 10, cpc: 55, cpl: 1800, label: "Бренд, поиск" },
  search_model: { ctr: 5.5, cpc: 160, cpl: 4200, label: "Модели, поиск" },
  search_competitor: { ctr: 3.2, cpc: 240, cpl: 6500, label: "Конкуренты" },
  rsya: { ctr: 0.7, cpc: 45, cpl: 5200, label: "РСЯ" },
  retargeting: { ctr: 1.4, cpc: 35, cpl: 2800, label: "Ретаргетинг" }
};

export const SITE_CR_TARGET = 2.2;
/** Разговор короче — почти всегда не лид: сброс, гудки, ошиблись номером. */
export const SHORT_CALL_MAX_SEC = 20;
export const MOBILE_CR_MIN_SHARE_OF_DESKTOP = 0.55;
export const BOUNCE_MAX = 42;
export const TRACKING_LOSS_MAX = 0.18;

/**
 * Минимальные объёмы, ниже которых отклонение — шум, а не вывод.
 * Без них в топ отчёта попадают кампании с десятком кликов.
 */
export const MIN_IMPRESSIONS = 800;
export const MIN_CLICKS = 80;
export const MIN_SPEND = 25000;
export const MIN_CALLS_FOR_SHARE = 8;
export const MIN_VISITS_FOR_PAGE = 250;
export const MIN_CLICKS_FOR_TRACKING = 400;
/** Доля расхода, закрытая выгрузкой Calltouch, ниже которой выводы по холдингу не делаем. */
export const LEAD_COVERAGE_MIN = 0.7;
