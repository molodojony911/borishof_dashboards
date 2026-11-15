import type { AdRow } from "../connectors/direct-deep";
import { median } from "../stats";
import type { LeadRow } from "../types";

/** Ниже этого объёма пометки «слабое» и «сильное» не ставим: медиана ещё шум. */
export const AD_VOLUME = {
  minImpressions: 800,
  minClicks: 30,
  minLeads: 4,
  minSpendNoLead: 3000
} as const;

export type AdVerdict = "weak" | "strong" | "insufficient";

export interface AdScore {
  adId: string;
  groupId: string;
  groupName: string;
  campaign: string;
  campaignId: string;
  brand: string;
  line: string;
  contractor: string;
  title: string;
  title2: string;
  text: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  cpc: number;
  conversions: number;
  qualityLeads: number;
  cpl: number | null;
  verdict: AdVerdict;
  reasons: string[];
  baseline: string;
}

export interface GroupScore {
  groupId: string;
  groupName: string;
  campaign: string;
  campaignId: string;
  brand: string;
  line: string;
  contractor: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  cpc: number;
  conversions: number;
  qualityLeads: number;
  cpl: number | null;
  ads: number;
  verdict: AdVerdict;
  reasons: string[];
  baseline: string;
}

export interface AdReview {
  ads: AdScore[];
  weak: AdScore[];
  strong: AdScore[];
  groups: GroupScore[];
}

function cplOf(cost: number, qualityLeads: number, conversions: number): number | null {
  const leads = qualityLeads > 0 ? qualityLeads : conversions;
  if (leads <= 0) return null;
  return cost / leads;
}

function groupKey(row: AdRow): string {
  return row.adGroupId || `campaign:${row.campaignId}`;
}

/**
 * Calltouch знает кампанию, не объявление. Лиды кампании делим между объявлениями
 * по конверсиям Директа, а если их нет — по кликам.
 */
export function allocateQualityLeads(rows: AdRow[], leads: Array<Pick<LeadRow, "campaign" | "campaignId" | "quality" | "kind">>): AdRow[] {
  const quality = leads.filter((lead) => lead.kind === "call" && lead.quality);
  const byCampaign = new Map<string, number>();
  for (const lead of quality) {
    const key = lead.campaignId || lead.campaign.trim().toLowerCase();
    if (!key) continue;
    byCampaign.set(key, (byCampaign.get(key) || 0) + 1);
  }
  const groups = new Map<string, AdRow[]>();
  for (const row of rows) {
    const key = row.campaignId || row.campaign.trim().toLowerCase();
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  const assigned = new Map<string, number>();
  for (const [key, ads] of groups) {
    const total = byCampaign.get(key) || 0;
    if (!total || !ads.length) continue;
    const weight = (ad: AdRow) => (ads.some((item) => item.conversions > 0) ? ad.conversions : ad.clicks);
    const sum = ads.reduce((s, ad) => s + weight(ad), 0);
    if (sum <= 0) {
      assigned.set(ads[0].adId, (assigned.get(ads[0].adId) || 0) + total);
      continue;
    }
    const parts = ads.map((ad) => {
      const exact = (total * weight(ad)) / sum;
      return { id: ad.adId, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
    });
    let left = total - parts.reduce((s, part) => s + part.floor, 0);
    parts.sort((a, b) => b.rest - a.rest);
    for (const part of parts) {
      if (left <= 0) break;
      part.floor += 1;
      left -= 1;
    }
    for (const part of parts) assigned.set(part.id, (assigned.get(part.id) || 0) + part.floor);
  }
  return rows.map((row) => ({ ...row, qualityLeads: assigned.get(row.adId) || 0 }));
}

function scoreAgainst(
  ctr: number,
  cpc: number,
  cpl: number | null,
  impressions: number,
  clicks: number,
  leads: number,
  cost: number,
  baselineCtr: number[],
  baselineCpc: number[],
  baselineCpl: number[]
): { verdict: AdVerdict; reasons: string[]; baseline: string } {
  const enough = impressions >= AD_VOLUME.minImpressions || clicks >= AD_VOLUME.minClicks;
  if (!enough) {
    return {
      verdict: "insufficient",
      reasons: [`Мало данных: ${impressions} показов и ${clicks} кликов. Нужно от ${AD_VOLUME.minImpressions} показов или ${AD_VOLUME.minClicks} кликов.`],
      baseline: "Медиану не считаем"
    };
  }
  const reasons: string[] = [];
  const medCtr = baselineCtr.length >= 3 ? median(baselineCtr) : 0;
  const medCpc = baselineCpc.length >= 3 ? median(baselineCpc) : 0;
  const medCpl = baselineCpl.length >= 3 ? median(baselineCpl) : 0;
  if (medCtr > 0 && impressions >= AD_VOLUME.minImpressions && ctr < medCtr * 0.7) {
    reasons.push(`CTR ${ctr.toFixed(2)}% ниже медианы ${medCtr.toFixed(2)}% больше чем на 30%.`);
  }
  if (medCpc > 0 && clicks >= AD_VOLUME.minClicks && cpc > medCpc * 1.35) {
    reasons.push(`CPC ${Math.round(cpc)} ₽ выше медианы ${Math.round(medCpc)} ₽ больше чем на 35%.`);
  }
  if (medCpl > 0 && leads >= AD_VOLUME.minLeads && cpl != null && cpl > medCpl * 1.4) {
    reasons.push(`CPL ${Math.round(cpl)} ₽ выше медианы ${Math.round(medCpl)} ₽ больше чем на 40%.`);
  }
  if (cost >= AD_VOLUME.minSpendNoLead && clicks >= AD_VOLUME.minClicks && leads === 0) {
    reasons.push(`Расход ${Math.round(cost)} ₽ и ни одной конверсии или качественного лида.`);
  }
  const baseline = [
    medCtr ? `CTR ${medCtr.toFixed(2)}%` : "",
    medCpc ? `CPC ${Math.round(medCpc)} ₽` : "",
    medCpl ? `CPL ${Math.round(medCpl)} ₽` : ""
  ]
    .filter(Boolean)
    .join(", ");
  if (reasons.length) return { verdict: "weak", reasons, baseline: baseline || "Медиана соседей" };
  const strongCtr = medCtr > 0 && ctr >= medCtr * 1.15;
  const strongCpl = medCpl > 0 && cpl != null && leads >= AD_VOLUME.minLeads && cpl <= medCpl * 0.85;
  if (strongCtr || strongCpl) {
    return {
      verdict: "strong",
      reasons: [
        strongCtr ? `CTR ${ctr.toFixed(2)}% выше медианы ${medCtr.toFixed(2)}%.` : "",
        strongCpl ? `CPL ${Math.round(cpl || 0)} ₽ ниже медианы ${Math.round(medCpl)} ₽.` : ""
      ].filter(Boolean),
      baseline: baseline || "Медиана соседей"
    };
  }
  return { verdict: "insufficient", reasons: ["Объём есть, но отрыв от медианы меньше порога."], baseline: baseline || "Медиана соседей" };
}

export function analyzeAdPerformance(rows: AdRow[]): AdReview {
  const prepared = rows.filter((row) => row.adId);
  const byGroup = new Map<string, AdRow[]>();
  const byCampaign = new Map<string, AdRow[]>();
  for (const row of prepared) {
    const group = groupKey(row);
    byGroup.set(group, [...(byGroup.get(group) || []), row]);
    byCampaign.set(row.campaignId || row.campaign, [...(byCampaign.get(row.campaignId || row.campaign) || []), row]);
  }

  const metric = (list: AdRow[], pick: (row: AdRow) => number | null, min: (row: AdRow) => boolean) =>
    list.filter(min).map(pick).filter((value): value is number => value != null && value > 0);

  const ads: AdScore[] = prepared.map((row) => {
    const group = byGroup.get(groupKey(row)) || [];
    const campaign = byCampaign.get(row.campaignId || row.campaign) || [];
    const peers = group.filter((item) => item.adId !== row.adId);
    const pool = peers.length >= 3 ? peers : campaign.filter((item) => item.adId !== row.adId);
    const leads = (row.qualityLeads || 0) > 0 ? row.qualityLeads || 0 : row.conversions;
    const cpc = row.clicks ? row.cost / row.clicks : 0;
    const cpl = cplOf(row.cost, row.qualityLeads || 0, row.conversions);
    const judged = scoreAgainst(
      row.ctr,
      cpc,
      cpl,
      row.impressions,
      row.clicks,
      leads,
      row.cost,
      metric(pool, (item) => item.ctr, (item) => item.impressions >= AD_VOLUME.minImpressions),
      metric(pool, (item) => (item.clicks ? item.cost / item.clicks : null), (item) => item.clicks >= AD_VOLUME.minClicks),
      metric(
        pool,
        (item) => cplOf(item.cost, item.qualityLeads || 0, item.conversions),
        (item) => (item.qualityLeads || 0) + item.conversions >= AD_VOLUME.minLeads
      )
    );
    return {
      adId: row.adId,
      groupId: row.adGroupId || "",
      groupName: row.adGroupName || row.campaign,
      campaign: row.campaign,
      campaignId: row.campaignId,
      brand: row.brand || "",
      line: row.line || "",
      contractor: row.contractor || "",
      title: row.title,
      title2: row.title2,
      text: row.text,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      cost: row.cost,
      cpc,
      conversions: row.conversions,
      qualityLeads: row.qualityLeads || 0,
      cpl,
      verdict: judged.verdict,
      reasons: judged.reasons,
      baseline: peers.length >= 3 ? `Медиана группы. ${judged.baseline}` : `Медиана кампании. ${judged.baseline}`
    };
  });

  const groups: GroupScore[] = Array.from(byGroup.entries()).map(([key, list]) => {
    const impressions = list.reduce((s, row) => s + row.impressions, 0);
    const clicks = list.reduce((s, row) => s + row.clicks, 0);
    const cost = list.reduce((s, row) => s + row.cost, 0);
    const conversions = list.reduce((s, row) => s + row.conversions, 0);
    const qualityLeads = list.reduce((s, row) => s + (row.qualityLeads || 0), 0);
    const campaignId = list[0]?.campaignId || "";
    const siblings = prepared.filter((row) => (row.campaignId || "") === campaignId && groupKey(row) !== key);
    const siblingGroups = new Map<string, AdRow[]>();
    for (const row of siblings) {
      const id = groupKey(row);
      siblingGroups.set(id, [...(siblingGroups.get(id) || []), row]);
    }
    const packs = Array.from(siblingGroups.values());
    const ctr = impressions ? (clicks / impressions) * 100 : 0;
    const cpc = clicks ? cost / clicks : 0;
    const cpl = cplOf(cost, qualityLeads, conversions);
    const leads = qualityLeads > 0 ? qualityLeads : conversions;
    const judged = scoreAgainst(
      ctr,
      cpc,
      cpl,
      impressions,
      clicks,
      leads,
      cost,
      packs.map((pack) => {
        const imp = pack.reduce((s, row) => s + row.impressions, 0);
        const clk = pack.reduce((s, row) => s + row.clicks, 0);
        return imp ? (clk / imp) * 100 : 0;
      }).filter((value) => value > 0),
      packs.map((pack) => {
        const clk = pack.reduce((s, row) => s + row.clicks, 0);
        const spend = pack.reduce((s, row) => s + row.cost, 0);
        return clk ? spend / clk : 0;
      }).filter((value) => value > 0),
      packs
        .map((pack) => cplOf(
          pack.reduce((s, row) => s + row.cost, 0),
          pack.reduce((s, row) => s + (row.qualityLeads || 0), 0),
          pack.reduce((s, row) => s + row.conversions, 0)
        ))
        .filter((value): value is number => value != null && value > 0)
    );
    const head = list[0];
    return {
      groupId: head?.adGroupId || "",
      groupName: head?.adGroupName || head?.campaign || key,
      campaign: head?.campaign || "",
      campaignId,
      brand: head?.brand || "",
      line: head?.line || "",
      contractor: head?.contractor || "",
      impressions,
      clicks,
      ctr,
      cost,
      cpc,
      conversions,
      qualityLeads,
      cpl,
      ads: list.length,
      verdict: judged.verdict,
      reasons: judged.reasons,
      baseline: `Медиана групп кампании. ${judged.baseline}`
    };
  });

  const byCost = (a: { cost: number }, b: { cost: number }) => b.cost - a.cost;
  return {
    ads,
    weak: ads.filter((row) => row.verdict === "weak").sort(byCost),
    strong: ads.filter((row) => row.verdict === "strong").sort(byCost),
    groups: groups.sort(byCost)
  };
}
