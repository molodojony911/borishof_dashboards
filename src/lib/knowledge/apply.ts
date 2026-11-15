import { money, num, pct, safeDiv } from "../format";
import { MIN_SPEND } from "../benchmarks";
import { ruleRef } from "./rules";
import type { CampaignComputed, CampaignRow, InsightItem, LeadSummary } from "../types";

type Campaign = CampaignRow & CampaignComputed;

function tag(partial: Omit<InsightItem, "ruleId" | "ruleSource">, ruleId: string): InsightItem {
  const ref = ruleRef(ruleId);
  return {
    ...partial,
    ruleId: ref.ruleId,
    ruleSource: ref.ruleSource,
    evidence: [...partial.evidence, `Правило ${ref.ruleId}: ${ref.ruleSource}`]
  };
}

/**
 * Рекомендации, которых нет в разборе одной кампании:
 * доля сетей, разрыв «звонок Директа vs тег Calltouch», рост CPC при ровном CTR.
 */
export function knowledgeInsights(campaigns: Campaign[], leads: LeadSummary): InsightItem[] {
  const items: InsightItem[] = [];
  const spend = campaigns.reduce((s, c) => s + c.current.cost, 0);
  if (spend < MIN_SPEND) return items;

  const rsya = campaigns.filter((c) => c.type === "rsya");
  const search = campaigns.filter((c) => c.type.startsWith("search"));
  const rsyaSpend = rsya.reduce((s, c) => s + c.current.cost, 0);
  const rsyaQuality = rsya.reduce((s, c) => s + c.qualityLeads, 0);
  const searchSpend = search.reduce((s, c) => s + c.current.cost, 0);
  const searchQuality = search.reduce((s, c) => s + c.qualityLeads, 0);
  const rsyaCpl = safeDiv(rsyaSpend, rsyaQuality);
  const searchCpl = safeDiv(searchSpend, searchQuality);
  if (
    rsyaSpend >= spend * 0.35 &&
    rsyaSpend >= MIN_SPEND &&
    searchQuality >= 5 &&
    rsyaCpl >= searchCpl * 1.5
  ) {
    items.push(
      tag(
        {
          id: "rule-rsya-share",
          role: "contextologist",
          severity: rsyaSpend >= spend * 0.5 ? "critical" : "warning",
          title: `Сети забирают ${pct((rsyaSpend / spend) * 100, 0)} расхода и лид дороже поиска`,
          finding: `РСЯ: ${money(rsyaSpend)} и ${num(rsyaQuality)} целевых, CPL ${rsyaQuality ? money(rsyaCpl) : "не считается"}. Поиск: ${money(searchSpend)}, CPL ${money(searchCpl)}.`,
          hypothesis:
            "Общая стратегия покупает дешёвый клик сети, потому что он проще клика с поиска. Для дилера этот клик редко становится целевым звонком.",
          action:
            "Вынесите сети в отдельные кампании и урежьте им недельный бюджет. В поиске оставьте «Максимум конверсий» по цели звонка. Площадки с нулём целевых запрещайте точечно, не списком.",
          impact: `Если бы доля сетей осталась, но CPL сравнялся с поиском, переплата за текущие целевые сети — около ${money(Math.max(0, rsyaSpend - rsyaQuality * searchCpl))}.`,
          evidence: [`Доля сетей ${pct((rsyaSpend / spend) * 100, 0)}`, `CPL поиска ${money(searchCpl)}`],
          moneyAtStake: Math.max(0, rsyaSpend - rsyaQuality * searchCpl)
        },
        "yd.rsya.share"
      )
    );
  }

  const directLeads = campaigns.reduce((s, c) => s + c.totalLeads, 0);
  if (directLeads >= 30 && leads.quality >= 10 && directLeads >= leads.quality * 2.2) {
    const gap = directLeads - leads.quality;
    items.push(
      tag(
        {
          id: "rule-offline-quality",
          role: "analyst",
          severity: "warning",
          title: `Директ видит ${num(directLeads)} звонков цели, целевых тегов ${num(leads.quality)}`,
          finding: `Разрыв ${num(gap)} обращений: стратегия учится на цели Метрики, а холдинг платит за пару тегов Calltouch.`,
          hypothesis:
            "Пока цель оптимизации шире тега качества, Директ будет покупать звонки, которые отдел продаж не считает лидом.",
          action:
            "Передайте в Метрику офлайн-конверсии только по звонкам с парой тегов и Yclid. В стратегии оставьте эту цель. В отчёте «Офлайн-конверсии» проверьте, что строки привязались к визитам, иначе Директ их проигнорирует.",
          impact: `Сужение цели убирает из обучения ${num(gap)} нецелевых сигналов за период.`,
          evidence: [`Уникальные звонки Директа ${num(directLeads)}`, `Целевые Calltouch ${num(leads.quality)}`],
          moneyAtStake: safeDiv(spend, leads.quality) * Math.min(gap, leads.quality)
        },
        "yd.offline.quality"
      )
    );
  }

  const clicks = campaigns.reduce((s, c) => s + c.current.clicks, 0);
  const prevClicks = campaigns.reduce((s, c) => s + c.previous.clicks, 0);
  const imps = campaigns.reduce((s, c) => s + c.current.impressions, 0);
  const prevImps = campaigns.reduce((s, c) => s + c.previous.impressions, 0);
  const ctrNow = safeDiv(clicks, imps) * 100;
  const ctrPrev = safeDiv(prevClicks, prevImps) * 100;
  const cpcNow = safeDiv(spend, clicks);
  const cpcPrev = safeDiv(
    campaigns.reduce((s, c) => s + c.previous.cost, 0),
    prevClicks
  );
  const quality = leads.quality;
  const prevQuality = leads.previousQuality;
  const cplNow = safeDiv(spend, quality);
  const cplPrev = safeDiv(
    campaigns.reduce((s, c) => s + c.previous.cost, 0),
    prevQuality
  );
  const ctrFlat = ctrPrev > 0 && Math.abs((ctrNow - ctrPrev) / ctrPrev) < 0.08;
  const cpcUp = cpcPrev > 0 && (cpcNow - cpcPrev) / cpcPrev >= 0.2;
  const cplUp = prevQuality >= 10 && quality >= 5 && cplPrev > 0 && (cplNow - cplPrev) / cplPrev >= 0.2;
  if (clicks >= 200 && ctrFlat && cpcUp && cplUp) {
    items.push(
      tag(
        {
          id: "rule-cpc-flat-ctr",
          role: "contextologist",
          severity: "warning",
          title: "Клик подорожал, хотя объявления кликают как раньше",
          finding: `CTR ${ctrNow.toFixed(2)}% против ${ctrPrev.toFixed(2)}%, CPC ${money(cpcNow)} против ${money(cpcPrev)}, CPL целевой ${money(cplNow)} против ${money(cplPrev)}.`,
          hypothesis: "Тексты не выгорели. Дороже стал аукцион или стратегия платит за более широкий спрос при той же кликабельности.",
          action:
            "Не переписывайте объявления пачкой. Сверьте целевую CPA, недельный бюджет и долю автотаргетинга. Ставки трогайте после этого, не раньше.",
          impact: `Переплата на текущих кликах около ${money(Math.max(0, (cpcNow - cpcPrev) * clicks))}.`,
          evidence: [`Клики ${num(clicks)}`, `CTR почти тот же`, `CPC +${Math.round(((cpcNow - cpcPrev) / cpcPrev) * 100)}%`],
          moneyAtStake: Math.max(0, (cpcNow - cpcPrev) * clicks)
        },
        "yd.strategy.learning"
      )
    );
  }

  return items;
}
