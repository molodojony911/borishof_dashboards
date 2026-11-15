import { num, pct } from "../format";
import { ruleRef } from "../knowledge/rules";
import type { BehaviorSnapshot, HypothesisItem, IceScore, LeadSummary, PieScore } from "../types";

/**
 * Гипотезы по сайтам, которые смотрит Метрика.
 * ICE и PIE: оценки 1–10, итог (a × b × c) / 100. Приоритет high от 5.5, medium от 3.5.
 * В список не попадает всё, что ниже medium: иначе страница поведения тонет в догадках.
 * Вебвизор как запись сессии Reporting API не отдаёт. Если в снимке есть pageSignals
 * (скролл, мёртвые клики, визиты с Вебвизором), гипотеза опирается на них.
 * Иначе используются отказ, глубина, время, устройства, воронка и источники.
 */

const MIN_PAGE_VISITS = 250;

function productScore(a: number, b: number, c: number): number {
  return Math.round(((a * b * c) / 100) * 10) / 10;
}

function ice(impact: number, confidence: number, ease: number): IceScore {
  return { impact, confidence, ease, score: productScore(impact, confidence, ease) };
}

function pie(potential: number, importance: number, ease: number): PieScore {
  return { potential, importance, ease, score: productScore(potential, importance, ease) };
}

function priorityOf(score: number): HypothesisItem["priority"] {
  if (score >= 5.5) return "high";
  if (score >= 3.2) return "medium";
  return "low";
}

function cited(id: string): { ruleId: string; ruleSource: string } {
  const ref = ruleRef(id);
  return { ruleId: ref.ruleId, ruleSource: ref.ruleSource };
}

export function buildHypotheses(behavior: BehaviorSnapshot, leads?: Pick<LeadSummary, "quality" | "total"> | null): HypothesisItem[] {
  if (!behavior || behavior.visits < 400) return [];
  const items: HypothesisItem[] = [];
  items.push(...pageHypotheses(behavior));
  items.push(...signalHypotheses(behavior));
  items.push(...mobileHypothesis(behavior));
  items.push(...sourceHypothesis(behavior));
  items.push(...pathHypothesis(behavior));
  items.push(...funnelHypothesis(behavior, leads));

  const seen = new Set<string>();
  return items
    .filter((item) => item.ice.score >= 3.2)
    .sort((a, b) => b.ice.score - a.ice.score || b.pie.score - a.pie.score)
    .filter((item) => {
      const key = item.entity || item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function pageHypotheses(behavior: BehaviorSnapshot): HypothesisItem[] {
  const out: HypothesisItem[] = [];
  const avgBounce = behavior.bounceRate || 0;
  for (const page of behavior.pages) {
    if (page.visits < MIN_PAGE_VISITS) continue;
    const short = page.avgDurationSec < 25 && page.pageDepth < 1.4 && page.bounceRate >= Math.max(55, avgBounce + 12);
    if (short) {
      const score = ice(8, 8, 6);
      out.push({
        id: `hyp-bounce-${page.path}`,
        priority: priorityOf(score.score),
        title: `Первый экран ${page.path} не отвечает на объявление`,
        observation: `${num(page.visits)} визитов, отказ ${pct(page.bounceRate, 0)} при среднем по срезу ${pct(avgBounce, 0)}, время ${Math.round(page.avgDurationSec)} с, глубина ${page.pageDepth.toFixed(1)}, CR в лид ${pct(page.cr, 2)}.`,
        hypothesis: `Если на первом экране без прокрутки показать то, что обещает объявление (модель, цену «от», наличие), отказ упадёт хотя бы на треть разрыва со средним сайта — люди перестанут уходить, не увидев оффер.`,
        expectedImpact: `Сверхсредний отказ — около ${num(Math.round((page.visits * (page.bounceRate - avgBounce)) / 100))} визитов. Часть из них должна дойти до клика по телефону.`,
        ice: score,
        pie: pie(8, 7, 6),
        test: {
          method: "A/B",
          variantA: `Текущая ${page.path}`,
          variantB: "Первый экран: марка, цена «от», наличие и кнопка звонка. Ниже тот же контент.",
          audience: "Платный трафик Яндекса, 50/50, в первую очередь смартфоны",
          duration: "14 дней или 2 000 визитов на вариант, что наступит раньше",
          primaryMetric: "Отказ и CR визита в цель «звонок»",
          guardrail: "Глубина и CR десктопа не хуже контроля больше чем на 10%"
        },
        evidence: [`Визиты ${num(page.visits)}`, `Отказ ${pct(page.bounceRate)}`, `Время ${Math.round(page.avgDurationSec)} с`],
        entity: page.path,
        ...cited("lp.message-match")
      });
      continue;
    }

    const engaged = page.avgDurationSec >= 120 && page.pageDepth >= 2.5 && page.bounceRate <= avgBounce && page.cr < 0.6 && page.visits >= 400;
    if (engaged) {
      const score = ice(7, 7, 7);
      out.push({
        id: `hyp-cta-${page.path}`,
        priority: priorityOf(score.score),
        title: `${page.path} читают и не звонят`,
        observation: `${num(page.visits)} визитов, отказ ${pct(page.bounceRate, 0)} (не хуже сайта), время ${Math.round(page.avgDurationSec)} с, глубина ${page.pageDepth.toFixed(1)}, но CR в лид только ${pct(page.cr, 2)}.`,
        hypothesis:
          "Страница удерживает внимание, значит запрос и контент совпали. Не хватает повода позвонить в момент чтения: телефон и цена не стоят рядом с комплектацией.",
        expectedImpact: `Если CR дойдёт до 1%, это около ${num(Math.round(page.visits * 0.01 - page.calls))} дополнительных обращений за период на том же трафике.`,
        ice: score,
        pie: pie(7, 8, 7),
        test: {
          method: "A/B",
          variantA: "Текущая карточка",
          variantB: "Липкая кнопка звонка и цена «от» у блока комплектации, форма из двух полей",
          audience: "Все устройства, визиты этой страницы, 50/50",
          duration: "14 дней",
          primaryMetric: "CR визита в цель «звонок»",
          guardrail: "Отказ не вырастает больше чем на 3 п.п."
        },
        evidence: [`Время ${Math.round(page.avgDurationSec)} с`, `Глубина ${page.pageDepth.toFixed(1)}`, `Лиды ${num(page.calls)}`],
        entity: page.path,
        ...cited("lp.offer")
      });
    }
  }
  return out.sort((a, b) => b.ice.score - a.ice.score).slice(0, 3);
}

function signalHypotheses(behavior: BehaviorSnapshot): HypothesisItem[] {
  const out: HypothesisItem[] = [];
  for (const signal of behavior.pageSignals || []) {
    const page = behavior.pages.find((row) => row.path === signal.path);
    if (!page || page.visits < MIN_PAGE_VISITS) continue;
    const lowScroll = (signal.scroll50Pct ?? 100) < 35;
    const dead = (signal.deadClicks ?? 0) >= 30;
    if (!lowScroll && !dead) continue;
    const score = ice(8, 9, 6);
    const bits = [
      signal.scroll50Pct != null ? `до середины доскроллили ${pct(signal.scroll50Pct, 0)}` : "",
      signal.deadClicks ? `мёртвых кликов ${num(signal.deadClicks)}` : "",
      signal.webvisorVisits ? `визитов с Вебвизором в выгрузке ${num(signal.webvisorVisits)}` : ""
    ].filter(Boolean);
    out.push({
      id: `hyp-signal-${signal.path}`,
      priority: priorityOf(score.score),
      title: `Карта поведения: ${signal.path} обрывается до оффера`,
      observation: `${num(page.visits)} визитов. ${bits.join(", ")}. Отказ страницы ${pct(page.bounceRate, 0)}.`,
      hypothesis: lowScroll
        ? "Если цену и кнопку звонка поднять выше середины экрана, до них дойдёт больше визитов, которые сейчас уходят, не доскроллив."
        : "Мёртвые клики значит, что люди нажимают на блок, который выглядит кнопкой. Если сделать его ссылкой на звонок или форму, часть этих нажатий станет лидом.",
      expectedImpact: "Ожидаем рост CR в звонок на этой странице на 15–30% относительных при том же трафике. Это оценка для теста, не обещание.",
      ice: score,
      pie: pie(8, 8, 6),
      test: {
        method: "A/B",
        variantA: "Текущая вёрстка",
        variantB: lowScroll ? "Цена и кнопка звонка в первом экране" : "Кликабельный блок, который сейчас собирает мёртвые клики, ведёт на звонок",
        audience: "Визиты этого URL, 50/50",
        duration: "14 дней",
        primaryMetric: "CR в цель «звонок» и доля скролла до 50%",
        guardrail: "Отказ и время на сайте не хуже контроля"
      },
      evidence: bits,
      entity: signal.path,
      ...cited("ym.webvisor")
    });
  }
  return out;
}

function mobileHypothesis(behavior: BehaviorSnapshot): HypothesisItem[] {
  const mobile = behavior.devices.find((d) => d.device === "mobile");
  const desktop = behavior.devices.find((d) => d.device === "desktop");
  if (!mobile || !desktop || mobile.visits < 300 || desktop.cr <= 0) return [];
  if (mobile.cr >= desktop.cr * 0.55) return [];
  const missed = Math.max(0, Math.round((mobile.visits * (desktop.cr - mobile.cr)) / 100));
  const score = ice(9, 8, 8);
  return [
    {
      id: "hyp-mobile",
      priority: priorityOf(score.score),
      title: "Смартфоны смотрят сайт и почти не звонят",
      observation: `Мобильная конверсия ${pct(mobile.cr, 2)} при ${num(mobile.visits)} визитах и отказе ${pct(mobile.bounceRate, 0)}. Десктоп: ${pct(desktop.cr, 2)}, визитов ${num(desktop.visits)}, отказ ${pct(desktop.bounceRate, 0)}.`,
      hypothesis:
        "Если закрепить кнопку звонка и убрать перекрытие виджетом, мобильная конверсия сдвинется в сторону десктопа. Разрыв слишком большой, чтобы объясняться только «с телефона не покупают машины».",
      expectedImpact: `Выравнивание до 55% десктопной конверсии дало бы порядка ${num(missed)} обращений за период. Верхняя оценка, её и надо проверить тестом.`,
      ice: score,
      pie: pie(9, 8, 8),
      test: {
        method: "A/B",
        variantA: "Текущая мобильная карточка",
        variantB: "Липкий «Позвонить», без входного попапа, номер виден до загрузки виджетов",
        audience: "Только смартфоны, 50/50",
        duration: "14 дней или 3 000 мобильных визитов на вариант",
        primaryMetric: "CR мобильного визита в цель «звонок»",
        guardrail: "Десктопный CR не меняется, мобильный отказ не растёт больше чем на 3 п.п."
      },
      evidence: [`Мобильные визиты ${num(mobile.visits)}`, `Звонки с мобильных ${num(mobile.calls)}`, `Десктоп CR ${pct(desktop.cr, 2)}`],
      ...cited("lp.mobile-cta")
    }
  ];
}

function sourceHypothesis(behavior: BehaviorSnapshot): HypothesisItem[] {
  const weak = [...behavior.sources]
    .filter((s) => s.visits >= 400 && s.bounceRate >= behavior.bounceRate + 12)
    .sort((a, b) => b.visits * b.bounceRate - a.visits * a.bounceRate)[0];
  if (!weak) return [];
  const score = ice(8, 7, 6);
  return [
    {
      id: `hyp-source-${weak.source}`,
      priority: priorityOf(score.score),
      title: `Источник «${weak.source}» приводит людей не на ту страницу`,
      observation: `${num(weak.visits)} визитов, отказ ${pct(weak.bounceRate, 0)} против ${pct(behavior.bounceRate, 0)} по срезу, лидов ${num(weak.calls)}.`,
      hypothesis:
        "Если посадочная этого источника повторит оффер объявления (для сетей — модель и цену, а не главную), отказ источника опустится к среднему сайта.",
      expectedImpact: `Лишние отказы источника — около ${num(Math.round((weak.visits * (weak.bounceRate - behavior.bounceRate)) / 100))} визитов за период.`,
      ice: score,
      pie: pie(8, 7, 6),
      test: {
        method: "A/B",
        variantA: "Текущая посадочная источника",
        variantB: "Отдельная страница под оффер объявления, без общей главной",
        audience: `Только визиты источника «${weak.source}»`,
        duration: "14 дней",
        primaryMetric: "Отказ и CR в звонок внутри источника",
        guardrail: "CPC и расход кампаний не меняем, пока идёт тест страницы"
      },
      evidence: [`Визиты ${num(weak.visits)}`, `Отказ ${pct(weak.bounceRate)}`],
      entity: weak.source,
      ...cited("lp.message-match")
    }
  ];
}

function pathHypothesis(behavior: BehaviorSnapshot): HypothesisItem[] {
  const dead = [...(behavior.paths || [])]
    .filter((p) => p.sessions >= 200 && p.cr < 0.5 && p.calls < p.sessions * 0.01)
    .sort((a, b) => b.sessions - a.sessions)[0];
  if (!dead) return [];
  const score = ice(6, 6, 5);
  return [
    {
      id: `hyp-path-${dead.steps.join(">")}`,
      priority: priorityOf(score.score),
      title: `Путь «${dead.steps.join(" → ")}» почти не заканчивается звонком`,
      observation: `${num(dead.sessions)} сессий, звонков ${num(dead.calls)}, CR ${pct(dead.cr, 2)}.`,
      hypothesis: `Если на шаге «${dead.steps[1] || dead.steps[0]}» поставить тот же оффер, что в объявлении, а не промежуточную страницу, доля звонков на этом пути вырастет.`,
      expectedImpact: "Даже сдвиг CR пути к 1% на этом объёме сессий — это уже заметные звонки, а не шум.",
      ice: score,
      pie: pie(6, 6, 5),
      test: {
        method: "A/B",
        variantA: dead.steps.join(" → "),
        variantB: "Сократить путь на один шаг: с объявления сразу на карточку с ценой и телефоном",
        audience: "Трафик, который сейчас попадает в этот путь",
        duration: "14 дней",
        primaryMetric: "CR пути в звонок",
        guardrail: "Общий отказ сайта"
      },
      evidence: [`Сессий ${num(dead.sessions)}`, `CR ${pct(dead.cr, 2)}`],
      entity: dead.steps.join(" → "),
      ...cited("lp.message-match")
    }
  ];
}

function funnelHypothesis(
  behavior: BehaviorSnapshot,
  leads?: Pick<LeadSummary, "quality" | "total"> | null
): HypothesisItem[] {
  const quality = leads?.quality ?? behavior.funnel.find((s) => s.id === "quality")?.value ?? 0;
  if (behavior.visits < 1000 || quality <= 0) return [];
  const cr = (quality / behavior.visits) * 100;
  if (cr >= 0.8) return [];
  const visit = behavior.funnel.find((s) => s.id === "visit");
  const goal = behavior.funnel.find((s) => s.id === "goal");
  const score = ice(8, 7, 6);
  return [
    {
      id: "hyp-funnel",
      priority: priorityOf(score.score),
      title: "Между визитом и целевым звонком слишком широкий зазор",
      observation: `${num(behavior.visits)} визитов, целей Метрики ${num(goal?.value ?? behavior.goalLeads)}, целевых звонков ${num(quality)}. CR визита в целевой ${pct(cr, 2)}.${
        visit ? ` Визитов в воронке ${num(visit.value)}.` : ""
      }`,
      hypothesis:
        "Если на карточках моделей одновременно видны цена «от», наличие и способ связаться, CR в целевой тег сдвинется вверх. Сейчас человек сравнивает условия уже на классифайде.",
      expectedImpact: `Подъём CR на 0.3 п.п. на текущем трафике — около ${num(Math.round(behavior.visits * 0.003))} целевых обращений. Цифра для размера теста, не план.`,
      ice: score,
      pie: pie(7, 8, 6),
      test: {
        method: "A/B",
        variantA: "Текущие карточки моделей",
        variantB: "Цена «от», наличие сегодня и форма из двух полей или кнопка звонка в первом экране",
        audience: "Визиты карточек моделей с платного поиска",
        duration: "14 дней",
        primaryMetric: "Целевые теги Calltouch на 1 000 визитов",
        guardrail: "Доля мусорных тегов и длина разговора не падают"
      },
      evidence: behavior.funnel.map((step) => `${step.name}: ${num(step.value)}`),
      ...cited("lp.offer")
    }
  ];
}
