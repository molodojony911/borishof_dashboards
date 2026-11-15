import { money, num, pct, safeDiv } from "../format";
import {
  BENCHMARKS,
  BOUNCE_MAX,
  LEAD_COVERAGE_MIN,
  MIN_CALLS_FOR_SHARE,
  MIN_CLICKS,
  MIN_CLICKS_FOR_TRACKING,
  MIN_IMPRESSIONS,
  MIN_SPEND,
  MIN_VISITS_FOR_PAGE,
  MOBILE_CR_MIN_SHARE_OF_DESKTOP,
  SHORT_CALL_MAX_SEC,
  SITE_CR_TARGET,
  TRACKING_LOSS_MAX
} from "../benchmarks";
import { knowledgeInsights } from "../knowledge/apply";
import { ruleRef } from "../knowledge/rules";
import type {
  BehaviorSnapshot,
  CampaignComputed,
  CampaignRow,
  InsightItem,
  LeadSummary
} from "../types";

type Campaign = CampaignRow & CampaignComputed;

function median(values: number[]): number {
  const list = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/**
 * Ориентир CPL берём по своим же кампаниям того же типа, а константу из справочника
 * используем только когда сравнивать не с чем. «Дорого» должно означать дорого для холдинга.
 */
function peerCpl(campaigns: Campaign[], target: Campaign): { value: number; source: string } {
  const sameType = campaigns.filter((c) => c.type === target.type && c.id !== target.id && c.qualityLeads > 0);
  if (sameType.length >= 3) {
    return { value: median(sameType.map((c) => c.cplQuality)), source: `медиана по «${BENCHMARKS[target.type].label}»` };
  }
  const anyPaid = campaigns.filter((c) => c.id !== target.id && c.qualityLeads > 0);
  if (anyPaid.length >= 3) {
    return { value: median(anyPaid.map((c) => c.cplQuality)), source: "медиана по кампаниям в срезе" };
  }
  return { value: BENCHMARKS[target.type].cpl, source: "справочный коридор" };
}

/** Кампания достаточно крупная, чтобы её отклонения что-то значили. */
function significant(c: Campaign): boolean {
  return c.current.impressions >= MIN_IMPRESSIONS && c.current.clicks >= MIN_CLICKS;
}

export function buildInsights(
  campaigns: Campaign[],
  behavior: BehaviorSnapshot,
  leads: LeadSummary
): InsightItem[] {
  const items: InsightItem[] = [];
  const spend = campaigns.reduce((s, c) => s + c.current.cost, 0);
  const holdingCpl = safeDiv(spend, leads.quality);
  const holdingCpc = safeDiv(spend, campaigns.reduce((s, c) => s + c.current.clicks, 0));
  const holdingQualityShare = safeDiv(leads.quality, leads.total) * 100;

  // По брендам без данных Calltouch «ноль целевых» означает недогруз, а не провал кампании.
  const covered = new Set(leads.coveredBrands || []);
  const withLeadData = covered.size ? campaigns.filter((c) => covered.has(c.brand)) : campaigns;

  // Выводы по холдингу в целом имеют смысл, пока выгрузка закрывает основную часть расхода.
  const coverage = !leads.partial
    ? 1
    : covered.size
      ? safeDiv(withLeadData.reduce((s, c) => s + c.current.cost, 0), spend)
      : 0;
  const leadsRepresentative = coverage >= LEAD_COVERAGE_MIN;
  const coverageNote =
    coverage < 1 ? `Calltouch отдал данные по ${pct(coverage * 100, 0)} расхода: часть кабинетов не ответила.` : "";

  items.push(...spendWithoutLeads(withLeadData, behavior));
  items.push(...cplOutliers(withLeadData));
  items.push(...weakQualityShare(withLeadData, holdingQualityShare));
  items.push(...ctrDrop(campaigns));
  items.push(...trackingLoss(behavior, holdingCpc));
  items.push(...worstPage(behavior, holdingCpc));
  items.push(...campaignOnSite(behavior, campaigns));

  // Выводы про воронку и качество звонков считаем по всей выгрузке, поэтому им нужен объём.
  if (leadsRepresentative) {
    items.push(...unpaidSources(leads, holdingQualityShare));
    items.push(...shortCalls(leads, holdingCpl));
    items.push(...mobileGap(behavior, holdingCpl, spend));
    items.push(...funnelLeak(behavior, leads, holdingCpl, spend));
  }
  items.push(...contractorGap(withLeadData));
  items.push(...knowledgeInsights(withLeadData, leads));

  if (coverageNote) {
    for (const item of items) item.evidence = [...item.evidence, coverageNote];
  }

  // По одной кампании не нужны две карточки: разбор расхода уже включает поведение на сайте.
  const alreadyShown = new Set(
    items.filter((i) => i.id.startsWith("spend-zero-")).map((i) => i.entity || "")
  );
  const deduped = items.filter(
    (i) => !(i.id.startsWith("site-campaign-") && alreadyShown.has(i.entity || ""))
  );

  const order: Record<InsightItem["severity"], number> = { critical: 0, warning: 1, opportunity: 2 };
  return deduped
    .map(attachRule)
    .sort((a, b) => order[a.severity] - order[b.severity] || (b.moneyAtStake || 0) - (a.moneyAtStake || 0));
}

function attachRule(item: InsightItem): InsightItem {
  if (item.ruleId) return item;
  const ruleId = ruleForInsight(item);
  if (!ruleId) return item;
  const ref = ruleRef(ruleId);
  return {
    ...item,
    ruleId: ref.ruleId,
    ruleSource: ref.ruleSource,
    evidence: [...item.evidence, `Правило ${ref.ruleId}`]
  };
}

function ruleForInsight(item: InsightItem): string | null {
  if (item.id.startsWith("spend-zero-")) {
    if (item.hypothesis.includes("utm_campaign")) return "ym.attribution";
    if (item.hypothesis.includes("до сайта")) return "lp.message-match";
    return "yd.search.negatives";
  }
  if (item.id.startsWith("cpl-outlier-")) return item.hypothesis.startsWith("Сети") ? "yd.rsya.placements" : "yd.search.negatives";
  if (item.id.startsWith("share-")) return "ct.quality-share";
  if (item.id.startsWith("ctr-")) return "yd.copy.message-match";
  if (item.id.startsWith("unpaid-")) return "media.unpaid";
  if (item.id === "short-calls") return "ct.short-call";
  if (item.id === "tracking") return "ym.attribution";
  if (item.id === "mobile") return "lp.mobile-cta";
  if (item.id.startsWith("page-")) return "ym.webvisor";
  if (item.id.startsWith("site-campaign-")) return "lp.message-match";
  if (item.id === "funnel") return "lp.offer";
  if (item.id === "contractor") return "yd.strategy.fit";
  return null;
}

/** Расход идёт, целевых звонков нет. Самая дорогая ситуация, поэтому идёт первой. */
function spendWithoutLeads(campaigns: Campaign[], behavior: BehaviorSnapshot): InsightItem[] {
  const visitsByCampaign = new Map(
    (behavior.byCampaign || []).map((row) => [row.campaign.trim().toLowerCase(), row])
  );

  return campaigns
    .filter((c) => c.current.cost >= MIN_SPEND && c.qualityLeads === 0)
    .sort((a, b) => b.current.cost - a.current.cost)
    .slice(0, 3)
    .map((c) => {
      const site = visitsByCampaign.get(c.name.trim().toLowerCase());
      // Метрика видит визиты с меткой — значит метка живая и дело не в трекинге.
      const trafficArrives = Boolean(site && site.visits >= c.current.clicks * 0.4);
      const noTrace = c.calls === 0;
      const trackingSuspect = noTrace && !trafficArrives;

      return {
        id: `spend-zero-${c.id}`,
        role: "contextologist" as const,
        severity: "critical" as const,
        title: `${money(c.current.cost)} без целевых лидов: ${c.name}`,
        finding: trackingSuspect
          ? `Потрачено ${money(c.current.cost)}, кликов ${num(c.current.clicks)}, а Метрика видит по этой метке ${num(site?.visits || 0)} визитов. Звонков с меткой кампании в Calltouch нет вовсе.`
          : noTrace
            ? `Потрачено ${money(c.current.cost)}: ${num(c.current.clicks)} кликов доходят до сайта (${num(site?.visits || 0)} визитов), отказы ${site ? site.bounceRate.toFixed(0) : "—"}%, целей Метрики ${num(site?.goalLeads || 0)}, звонков ноль.`
            : `Потрачено ${money(c.current.cost)}, звонков ${num(c.calls)}, но ни один не попал в целевые теги. CPC ${money(c.cpc)}.`,
        hypothesis: trackingSuspect
          ? "Клики есть, визитов с этой меткой почти нет: utm_campaign теряется по дороге — редирект, обрезка параметров или подмена номера, которая перетирает источник."
          : noTrace
            ? "Трафик до сайта доходит, но не превращается ни в цель, ни в звонок. Значит вопрос не к закупке, а к тому, что человек видит на посадочной."
            : "Трафик нецелевой: запросы и площадки приводят людей не за покупкой. Теги проставлены, то есть отдел продаж звонки слышит и не квалифицирует.",
        action: trackingSuspect
          ? "Пройти путь клик → лендинг и проверить, доживает ли utm_campaign до страницы и пишет ли его Calltouch."
          : noTrace
            ? "Открыть посадочную этой кампании и Вебвизор по её визитам. Параллельно проверить, что цель «уникальный звонок» на этой странице вообще срабатывает."
            : "Выгрузить поисковые запросы и площадки кампании, отминусовать мусор, а до разбора снизить дневной бюджет вдвое.",
        impact: `На кону ${money(c.current.cost)} за период — верхняя граница экономии, если кампанию не чинить, а остановить.`,
        evidence: [
          `Расход ${money(c.current.cost)}, было ${money(c.previous.cost)}`,
          `Клики ${num(c.current.clicks)}, визиты по метке ${num(site?.visits || 0)}`,
          `Цели Метрики ${num(site?.goalLeads || 0)}, звонки Calltouch ${num(c.calls)}`
        ],
        entity: c.name,
        moneyAtStake: c.current.cost
      };
    });
}

/** CPL по качеству выше, чем у своих же кампаний того же типа. */
function cplOutliers(campaigns: Campaign[]): InsightItem[] {
  return campaigns
    .filter((c) => c.qualityLeads > 0 && c.current.cost >= MIN_SPEND)
    .map((c) => {
      const peer = peerCpl(campaigns, c);
      const overpay = c.current.cost - c.qualityLeads * peer.value;
      return { c, peer, overpay };
    })
    .filter((x) => x.peer.value > 0 && x.c.cplQuality >= x.peer.value * 1.8 && x.overpay > 0)
    .sort((a, b) => b.overpay - a.overpay)
    .slice(0, 3)
    .map(({ c, peer, overpay }) => ({
      id: `cpl-outlier-${c.id}`,
      role: "analyst" as const,
      severity: c.cplQuality >= peer.value * 3 ? ("critical" as const) : ("warning" as const),
      title: `CPL ${money(c.cplQuality)} против ${money(peer.value)} по холдингу: ${c.name}`,
      finding: `${money(c.current.cost)} на ${c.qualityLeads} целевых лидов. Ориентир — ${money(peer.value)} (${peer.source}). Всего звонков ${num(c.calls)}, в целевые попало ${pct(c.qualityShare, 0)}.`,
      hypothesis:
        c.type === "rsya"
          ? "Сети набирают дешёвый клик, но не спрос. Автотаргетинг и широкие площадки дают звонки не по покупке."
          : "Кампания собирает спрос шире, чем нужно: общие запросы, чужие модели, информационные фразы. Стратегия при этом учится на конверсиях кабинета, а не на тегах качества.",
      action: `Перед снижением ставок сравнить структуру с кампанией, которая держит ${money(peer.value)}: запросы, посадочные, тексты. Разница почти всегда в ширине таргетинга, а не в ставке.`,
      impact: `При выходе на ориентир те же ${c.qualityLeads} лидов стоили бы ${money(c.qualityLeads * peer.value)} — экономия около ${money(overpay)} за период.`,
      evidence: [
        `CPL целевой ${money(c.cplQuality)}, было ${money(c.prevCplQuality)}`,
        `CPC ${money(c.cpc)}, CTR ${c.ctr.toFixed(2)}%`,
        `Уник. звонки Директа ${num(c.totalLeads)} против ${num(c.qualityLeads)} целевых Calltouch`
      ],
      entity: c.name,
      moneyAtStake: overpay
    }));
}

/** Звонков много, целевых мало — вопрос к трафику, а не к количеству обращений. */
function weakQualityShare(campaigns: Campaign[], holdingShare: number): InsightItem[] {
  if (holdingShare <= 0) return [];
  return campaigns
    .filter((c) => c.calls >= MIN_CALLS_FOR_SHARE && c.qualityShare < holdingShare * 0.6 && c.current.cost > 0)
    .sort((a, b) => b.current.cost - a.current.cost)
    .slice(0, 2)
    .map((c) => {
      const gap = (holdingShare - c.qualityShare) / holdingShare;
      const waste = c.current.cost * gap;
      return {
        id: `share-${c.id}`,
        role: "analyst" as const,
        severity: "warning" as const,
        title: `Звонки есть, целевых мало: ${c.name}`,
        finding: `${num(c.calls)} звонков, целевых ${num(c.qualityLeads)} — ${pct(c.qualityShare, 0)} против ${pct(holdingShare, 0)} в среднем по срезу.`,
        hypothesis:
          "Кампания приводит обращения не по профилю: чужие бренды, запчасти, вакансии, вопросы по гарантии. Отдел продаж их слышит и не квалифицирует, но клик уже оплачен.",
        action:
          "Послушать 10 звонков этой кампании подряд и выписать, о чём они. Дальше это превращается в минус-слова и правки текстов, а не в изменение ставок.",
        impact: `Подтягивание доли качества до среднего вернуло бы в оборот порядка ${money(waste)} за период.`,
        evidence: [
          `Расход ${money(c.current.cost)}`,
          `Доля качества ${pct(c.qualityShare, 0)}, среднее ${pct(holdingShare, 0)}`,
          `CPL целевой ${c.qualityLeads ? money(c.cplQuality) : "не считается"}`
        ],
        entity: c.name,
        moneyAtStake: waste
      };
    });
}

function ctrDrop(campaigns: Campaign[]): InsightItem[] {
  const worst = campaigns
    .filter((c) => significant(c) && c.previous.clicks >= MIN_CLICKS && c.prevCtr > 0 && c.ctrDelta <= -18)
    .sort((a, b) => a.ctrDelta - b.ctrDelta)[0];
  if (!worst) return [];
  const lostClicks = Math.max(0, Math.round((worst.current.impressions * (worst.prevCtr - worst.ctr)) / 100));
  return [
    {
      id: `ctr-${worst.id}`,
      role: "contextologist",
      severity: worst.ctrDelta <= -30 ? "critical" : "warning",
      title: `CTR упал на ${Math.abs(Math.round(worst.ctrDelta))}%: ${worst.name}`,
      finding: `CTR ${worst.ctr.toFixed(2)}% против ${worst.prevCtr.toFixed(2)}% при ${num(worst.current.impressions)} показах. Коридор для типа «${BENCHMARKS[worst.type].label}» ~${BENCHMARKS[worst.type].ctr}%.`,
      hypothesis:
        worst.type === "search_competitor"
          ? "Конкуренты подняли ставки или обновили офферы, объявления потеряли отличие. Часть показов ушла в нерелевантные запросы после авторасширения."
          : "Объявления выгорели либо показы расползлись по широким запросам. При том же бюджете аукцион отдаёт меньше кликов.",
      action:
        "Сравнить показы по запросам с прошлым периодом: отделить падение спроса от падения релевантности. Затем переписать заголовки под то, что реально ищут, а не под название модели.",
      impact: `На текущих показах разница в CTR стоит примерно ${num(lostClicks)} кликов, это около ${money(lostClicks * worst.cpc)} трафика.`,
      evidence: [
        `Показы ${num(worst.current.impressions)}, клики ${num(worst.current.clicks)} против ${num(worst.previous.clicks)}`,
        `CPC ${money(worst.cpc)}, было ${money(worst.prevCpc)}`,
        `Расход ${money(worst.current.cost)}`
      ],
      entity: worst.name,
      moneyAtStake: lostClicks * worst.cpc
    }
  ];
}

/** Источники вне Директа: их объём звонков часто больше, чем у платного трафика. */
function unpaidSources(leads: LeadSummary, holdingShare: number): InsightItem[] {
  const weak = leads.bySource
    .filter((s) => !s.paid && s.total >= 20 && safeDiv(s.quality, s.total) * 100 < Math.max(holdingShare * 0.5, 12))
    .sort((a, b) => b.total - a.total)[0];
  if (!weak) return [];
  const best = leads.bySource
    .filter((s) => s.total >= 10)
    .sort((a, b) => safeDiv(b.quality, b.total) - safeDiv(a.quality, a.total))[0];
  return [
    {
      id: `unpaid-${weak.source}`,
      role: "marketer",
      severity: "warning",
      title: `Источник «${weak.source}» даёт объём, но не целевых`,
      finding: `${num(weak.total)} звонков, целевых ${num(weak.quality)} — ${pct(safeDiv(weak.quality, weak.total) * 100, 0)}.${
        best ? ` Для сравнения, «${best.source}»: ${pct(safeDiv(best.quality, best.total) * 100, 0)} при ${num(best.total)} звонках.` : ""
      }`,
      hypothesis:
        "Классифайды и агрегаторы приводят людей, которые сравнивают цены по всему рынку. Это не поломка, но платить за такой контакт как за целевой нельзя.",
      action:
        "Свести стоимость размещения на площадке с числом целевых звонков, а не всех. Разговор с площадкой вести в этих цифрах. Расход по этому источнику в дашборде не виден — его стоит завести отдельной строкой бюджета.",
      impact: "Позволяет сравнивать площадки и Директ в одной валюте — рубль за целевой звонок.",
      evidence: [`Звонки ${num(weak.total)}`, `Целевые ${num(weak.quality)}`, "Расход площадки в дашборд не подтягивается"]
    }
  ];
}

function shortCalls(leads: LeadSummary, holdingCpl: number): InsightItem[] {
  if (leads.quality < 10) return [];
  const share = safeDiv(leads.shortQuality, leads.quality) * 100;
  if (share < 8) return [];
  return [
    {
      id: "short-calls",
      role: "analyst",
      severity: "warning",
      title: `${pct(share, 0)} целевых лидов — разговор короче ${SHORT_CALL_MAX_SEC} секунд`,
      finding: `${num(leads.shortQuality)} звонков из ${num(leads.quality)} целевых длились меньше ${SHORT_CALL_MAX_SEC} секунд, но получили тег качества.`,
      hypothesis:
        "За такое время нельзя выяснить модель и потребность. Скорее всего тег ставится по умолчанию или скопом в конце смены.",
      action:
        "Добавить в правила Calltouch автоснятие тега качества при разговоре короче порога и разобрать с отделом продаж, кто и когда проставляет теги.",
      impact: `Эти звонки завышают базу лидов и занижают CPL примерно на ${money(leads.shortQuality * holdingCpl)} за период.`,
      evidence: [`Целевых всего ${num(leads.quality)}`, `Из них короткие ${num(leads.shortQuality)}`]
    }
  ];
}

function trackingLoss(behavior: BehaviorSnapshot, holdingCpc: number): InsightItem[] {
  if (behavior.directClicks < MIN_CLICKS_FOR_TRACKING) return [];
  const loss = 1 - safeDiv(behavior.metrikaDirectVisits, behavior.directClicks);
  if (loss <= TRACKING_LOSS_MAX) return [];
  const lostClicks = Math.round(behavior.directClicks * loss);
  return [
    {
      id: "tracking",
      role: "developer",
      severity: "critical",
      title: `Метрика не видит ${pct(loss * 100, 0)} кликов Директа`,
      finding: `Клики Директа ${num(behavior.directClicks)}, визиты с Директа в Метрике ${num(behavior.metrikaDirectVisits)}. Разрыв ${num(lostClicks)} кликов.`,
      hypothesis:
        "Редирект через промежуточный домен режет query, счётчик стоит дублем, либо страница не успевает загрузиться на мобильном до ухода пользователя.",
      action:
        "Пройти 20 объявлений вручную: клик → проверить ymclid в адресе и наличие визита в Метрике. Отдельно проверить, что Calltouch не перетирает utm при подстановке номера.",
      impact: `Это ${money(lostClicks * holdingCpc)} оплаченного трафика, который не попадает ни в один отчёт и не участвует в обучении стратегий.`,
      evidence: [
        `Порог, с которого разрыв считается аномальным — ${pct(TRACKING_LOSS_MAX * 100, 0)}`,
        `Средний CPC по срезу ${money(holdingCpc)}`
      ],
      moneyAtStake: lostClicks * holdingCpc
    }
  ];
}

function mobileGap(behavior: BehaviorSnapshot, holdingCpl: number, spend: number): InsightItem[] {
  const mobile = behavior.devices.find((d) => d.device === "mobile");
  const desktop = behavior.devices.find((d) => d.device === "desktop");
  if (!mobile || !desktop || mobile.visits < 300 || desktop.cr <= 0) return [];
  if (mobile.cr >= desktop.cr * MOBILE_CR_MIN_SHARE_OF_DESKTOP) return [];
  const missedLeads = Math.round((mobile.visits * (desktop.cr - mobile.cr)) / 100);
  return [
    {
      id: "mobile",
      role: "developer",
      severity: "critical",
      title: `Мобильная конверсия ${mobile.cr.toFixed(2)}% против ${desktop.cr.toFixed(2)}% на десктопе`,
      finding: `${num(mobile.visits)} мобильных визитов — это ${pct(safeDiv(mobile.visits, behavior.visits) * 100, 0)} трафика. Отказы ${mobile.bounceRate.toFixed(0)}% против ${desktop.bounceRate.toFixed(0)}%.`,
      hypothesis:
        "Кнопка звонка перекрыта виджетом, форма не помещается в экран, либо подменный номер Calltouch появляется позже, чем пользователь уходит.",
      action:
        "Открыть карточку модели на реальном Android и замерить время до появления номера. Сделать закреплённую кнопку звонка и убрать входные попапы.",
      impact: `Выравнивание до уровня десктопа дало бы примерно ${num(missedLeads)} дополнительных обращений, это около ${money(missedLeads * holdingCpl)} в эквиваленте закупки.`,
      evidence: [
        `Мобильные визиты ${num(mobile.visits)}, звонки ${num(mobile.calls)}`,
        `Десктоп: визиты ${num(desktop.visits)}, звонки ${num(desktop.calls)}`
      ],
      moneyAtStake: Math.min(missedLeads * holdingCpl, spend)
    }
  ];
}

function worstPage(behavior: BehaviorSnapshot, holdingCpc: number): InsightItem[] {
  const avgBounce = behavior.bounceRate;
  const page = [...behavior.pages]
    .filter((p) => p.visits >= MIN_VISITS_FOR_PAGE && p.bounceRate > Math.max(BOUNCE_MAX, avgBounce + 5))
    .sort((a, b) => b.visits * (b.bounceRate - avgBounce) - a.visits * (a.bounceRate - avgBounce))[0];
  if (!page) return [];
  // Лишние отказы сверх среднего по сайту, пересчитанные в стоимость трафика.
  const wasted = (page.visits * (page.bounceRate - avgBounce)) / 100;
  return [
    {
      id: `page-${page.path}`,
      role: "developer",
      severity: page.bounceRate > 55 ? "critical" : "warning",
      title: `Отказы ${page.bounceRate.toFixed(0)}% на ${page.path}`,
      finding: `${num(page.visits)} визитов, отказы ${page.bounceRate.toFixed(0)}% при среднем по сайту ${avgBounce.toFixed(0)}%. Глубина ${page.pageDepth.toFixed(1)}, конверсия в звонок ${page.cr.toFixed(2)}%.`,
      hypothesis: page.path.includes("used")
        ? "Листинг с пробегом тяжёлый, фильтры ломаются на мобильном, часть карточек без цены — пользователь не находит то, что обещало объявление."
        : "Страница либо долго грузится, либо не отвечает на запрос из объявления: человек искал одно, а на экране другое.",
      action:
        "Снять Web Vitals на мобильном и посмотреть Вебвизор по 10 отказным визитам. Обычно видно за минуту, что именно не грузится или где обрывается сценарий.",
      impact: `Отказы сверх среднего по сайту — это примерно ${num(Math.round(wasted))} оплаченных визитов, около ${money(wasted * holdingCpc)}.`,
      evidence: [`Визиты ${num(page.visits)}`, `Звонки ${num(page.calls)}`, `Средние отказы по сайту ${avgBounce.toFixed(0)}%`],
      entity: page.path,
      moneyAtStake: wasted * holdingCpc
    }
  ];
}

/**
 * Метрика знает, что было с человеком после клика. Сопоставление с расходом кампании
 * отделяет «плохой трафик» от «хорошего трафика на плохой странице».
 */
function campaignOnSite(behavior: BehaviorSnapshot, campaigns: Campaign[]): InsightItem[] {
  if (!behavior.byCampaign?.length) return [];
  const byName = new Map(campaigns.map((c) => [c.name.trim().toLowerCase(), c]));
  const avgBounce = behavior.bounceRate;

  const candidates = behavior.byCampaign
    .filter((row) => row.visits >= 200)
    .map((row) => ({ row, campaign: byName.get(row.campaign.trim().toLowerCase()) }))
    .filter((x) => x.campaign && x.campaign.current.cost >= MIN_SPEND)
    .filter((x) => x.row.bounceRate >= avgBounce + 12 || (x.row.goalLeads === 0 && x.row.visits >= 400))
    .sort((a, b) => (b.campaign?.current.cost || 0) - (a.campaign?.current.cost || 0));

  const top = candidates[0];
  if (!top || !top.campaign) return [];
  const { row, campaign } = top;
  const wasted = campaign.current.cost * Math.min(Math.max((row.bounceRate - avgBounce) / 100, 0.1), 0.6);

  return [
    {
      id: `site-campaign-${campaign.id}`,
      role: "developer",
      severity: row.goalLeads === 0 ? "critical" : "warning",
      title: `После клика по «${campaign.name}» на сайте ничего не происходит`,
      finding: `${num(row.visits)} визитов, отказы ${row.bounceRate.toFixed(0)}% при среднем ${avgBounce.toFixed(0)}%, средний визит ${Math.round(row.durationSec)} секунд, целей Метрики ${num(row.goalLeads)}. Расход кампании ${money(campaign.current.cost)}.`,
      hypothesis:
        row.durationSec < 30
          ? "Люди уходят почти сразу: либо страница долго открывается, либо на ней не то, что было в объявлении."
          : "Страницу смотрят, но повода для контакта не находят: телефон не на виду, формы длинные, оффера из объявления на экране нет.",
      action:
        "Открыть посадочную этой кампании и сверить её с текстом объявления. Дальше — Вебвизор по десяти отказным визитам: этого хватает, чтобы понять, техническая это проблема или смысловая.",
      impact: `Разрыв по отказам относительно сайта — это порядка ${money(wasted)} расхода кампании, который до диалога не доходит.`,
      evidence: [
        `Визиты ${num(row.visits)}, клики Директа ${num(campaign.current.clicks)}`,
        `Цели Метрики ${num(row.goalLeads)}, целевые звонки ${num(campaign.qualityLeads)}`,
        `Отказы кампании ${row.bounceRate.toFixed(0)}% против ${avgBounce.toFixed(0)}% по сайту`
      ],
      entity: campaign.name,
      moneyAtStake: wasted
    }
  ];
}

function funnelLeak(
  behavior: BehaviorSnapshot,
  leads: LeadSummary,
  holdingCpl: number,
  spend: number
): InsightItem[] {
  if (behavior.visits < 1000) return [];
  const cr = safeDiv(leads.quality, behavior.visits) * 100;
  if (cr >= SITE_CR_TARGET * 0.5) return [];
  const missed = Math.round((behavior.visits * (SITE_CR_TARGET - cr)) / 100);
  return [
    {
      id: "funnel",
      role: "marketer",
      severity: "critical",
      title: `Конверсия сайта в целевой звонок ${pct(cr, 2)}`,
      finding: `${num(behavior.visits)} визитов, целей Метрики ${num(behavior.goalLeads)}, целевых звонков ${num(leads.quality)}. Ориентир для дилера — около ${SITE_CR_TARGET}%.`,
      hypothesis:
        "Между визитом и звонком нет причины звонить именно сейчас: нет цены, наличия и срока. Пользователь уходит сравнивать на классифайды, где мы платим за него второй раз.",
      action:
        "На карточках моделей: цена «от», наличие на складе сегодня, запись на тест-драйв в два поля. Проверять гипотезы по тегам качества за 14 дней, не по всем звонкам.",
      impact: `Разрыв с ориентиром — примерно ${num(missed)} обращений за период. Столько же лидов через закупку стоили бы ${money(missed * holdingCpl)}, но это верхняя оценка: ориентир ${SITE_CR_TARGET}% взят по рынку, а не по вашим брендам.`,
      evidence: behavior.funnel.map((s) => `${s.name}: ${num(s.value)}`),
      moneyAtStake: Math.min(missed * holdingCpl, spend)
    }
  ];
}

function contractorGap(campaigns: Campaign[]): InsightItem[] {
  const map = new Map<string, { spend: number; quality: number; calls: number }>();
  for (const c of campaigns) {
    const cur = map.get(c.contractor) || { spend: 0, quality: 0, calls: 0 };
    cur.spend += c.current.cost;
    cur.quality += c.qualityLeads;
    cur.calls += c.calls;
    map.set(c.contractor, cur);
  }
  const ranked = Array.from(map.entries())
    .filter(([, v]) => v.spend >= MIN_SPEND && v.quality > 0)
    .map(([name, v]) => ({ name, cpl: safeDiv(v.spend, v.quality), ...v }))
    .sort((a, b) => b.cpl - a.cpl);
  if (ranked.length < 2 || ranked[0].cpl < ranked[ranked.length - 1].cpl * 1.4) return [];
  const poor = ranked[0];
  const best = ranked[ranked.length - 1];
  const overpay = poor.spend - poor.quality * best.cpl;
  return [
    {
      id: "contractor",
      role: "analyst",
      severity: "warning",
      title: `${poor.name}: целевой лид дороже в ${(poor.cpl / best.cpl).toFixed(1)} раза`,
      finding: `CPL ${money(poor.cpl)} при ${num(poor.quality)} целевых и расходе ${money(poor.spend)}. У ${best.name} — ${money(best.cpl)}.`,
      hypothesis:
        "Разница обычно не в мастерстве, а в структуре: доля сетей, ширина таргетинга и то, на какую цель обучается стратегия.",
      action: `Запросить у ${poor.name} разбивку расхода на поиск и сети и на какую конверсию настроена стратегия. Сравнить с ${best.name} по этим двум параметрам, прежде чем обсуждать бюджет.`,
      impact: `При CPL уровня ${best.name} тот же объём лидов стоил бы на ${money(Math.max(overpay, 0))} меньше.`,
      evidence: ranked.map((r) => `${r.name}: CPL ${money(r.cpl)}, целевых ${num(r.quality)}, расход ${money(r.spend)}`),
      moneyAtStake: Math.max(overpay, 0)
    }
  ];
}
