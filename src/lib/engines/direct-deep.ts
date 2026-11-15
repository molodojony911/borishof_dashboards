import { money, num, pct, safeDiv } from "../format";
import { ruleRef } from "../knowledge/rules";
import type { AdRow, AudiencePack, PlacementRow, QueryRow, SliceRow } from "../connectors/direct-deep";
import type { InsightItem } from "../types";

export interface JunkQuery extends QueryRow {
  reason: string;
}

export interface NegativeCandidate {
  word: string;
  cost: number;
  clicks: number;
  queries: number;
}

export interface QueriesSection {
  cost: number;
  clicks: number;
  conversions: number;
  waste: QueryRow[];
  wasteCost: number;
  junk: JunkQuery[];
  junkCost: number;
  research: JunkQuery[];
  researchCost: number;
  negatives: NegativeCandidate[];
  best: QueryRow[];
}

export interface AdsSection {
  rows: AdRow[];
  noTitle2: { count: number; impressions: number; cost: number };
  shortTitle: { count: number; cost: number };
  noExtensions: { count: number; cost: number };
  burning: AdRow[];
  leaders: AdRow[];
}

export interface PlacementsSection {
  rows: PlacementRow[];
  waste: PlacementRow[];
  wasteCost: number;
  cost: number;
}

/**
 * Слова склеиваются в шаблон с проверкой границ вручную: \b в JS работает по латинице,
 * из-за чего «машина» ловилась как «шина», а «тест-драйв» уезжал в мусор.
 */
function wordsRe(words: string[]): RegExp {
  return new RegExp(`(?<![а-яёa-z])(?:${words.join("|")})(?![а-яёa-z])`, "i");
}

/**
 * Запросы, по которым в дилерском контексте покупки не бывает.
 * Список намеренно консервативный: лучше пропустить мусор, чем предложить отминусовать спрос.
 */
const JUNK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: wordsRe(["ваканси\\w*", "зарплат\\w*", "резюме", "устроиться", "подработк\\w*"]), reason: "поиск работы" },
  {
    re: wordsRe(["своими", "самостоятельно", "инструкци\\w*", "схема", "чертеж\\w*", "мануал"]),
    reason: "сделай сам"
  },
  {
    re: wordsRe([
      "запчаст\\w*",
      "аккумулятор\\w*",
      "масл[оа]",
      "фильтр\\w*",
      "шин[ыау]",
      "резин[аыу]",
      "коврик\\w*",
      "чехл\\w*",
      "разбор\\w*",
      "контрактн\\w*"
    ]),
    reason: "запчасти и расходники"
  },
  {
    re: wordsRe(["обои", "картинк\\w*", "скачать", "торрент", "игра", "симулятор", "gta", "forza"]),
    reason: "не коммерческий"
  },
  {
    re: wordsRe(["авито", "дром", "drom", "каршеринг", "прокат", "аренда", "такси"]),
    reason: "чужая площадка или другой сценарий"
  },
  { re: wordsRe(["угнан\\w*", "штраф\\w*", "осаго", "каско", "растаможк\\w*"]), reason: "не про покупку" }
];

/** Не мусор, но и не готовность купить: человек изучает вопрос. */
const RESEARCH_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: wordsRe(["отзыв\\w*", "характеристик\\w*", "клиренс", "сравнен\\w*", "минусы", "недостатки"]), reason: "изучает характеристики" },
  { re: /(чем отличается|что лучше|плюсы и минусы|расход топлива)/i, reason: "сравнивает варианты" }
];

const STOP_WORDS = new Set([
  "купить", "цена", "цены", "стоимость", "москва", "москве", "авто", "автомобиль", "автомобили", "машина",
  "новый", "новая", "новые", "официальный", "официальные", "дилер", "дилера", "дилерский", "центр",
  "в", "на", "с", "для", "и", "от", "до", "по", "у", "или", "год", "года", "года.", "руб", "р"
]);

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function matchReason(query: string, patterns: Array<{ re: RegExp; reason: string }>): string | null {
  for (const p of patterns) {
    if (p.re.test(query)) return p.reason;
  }
  return null;
}

export function buildQueriesSection(rows: QueryRow[], brandWords: string[]): QueriesSection {
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);

  const junk: JunkQuery[] = [];
  const research: JunkQuery[] = [];
  for (const row of rows) {
    if (row.cost <= 0) continue;
    const junkWhy = matchReason(row.query, JUNK_PATTERNS);
    if (junkWhy) {
      junk.push({ ...row, reason: junkWhy });
      continue;
    }
    const researchWhy = matchReason(row.query, RESEARCH_PATTERNS);
    if (researchWhy && row.conversions === 0) research.push({ ...row, reason: researchWhy });
  }
  junk.sort((a, b) => b.cost - a.cost);
  research.sort((a, b) => b.cost - a.cost);

  const waste = rows
    .filter((r) => r.conversions === 0 && r.clicks >= 3 && r.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  // Слово попадает в кандидаты, только если ни один запрос с ним не дал конверсию.
  const converting = new Set<string>();
  for (const row of rows) {
    if (row.conversions > 0) for (const word of tokens(row.query)) converting.add(word);
  }
  const brandSet = new Set(brandWords.map((w) => w.toLowerCase()));
  const wordMap = new Map<string, NegativeCandidate>();
  for (const row of waste) {
    for (const word of new Set(tokens(row.query))) {
      if (brandSet.has(word) || converting.has(word)) continue;
      const cur = wordMap.get(word) || { word, cost: 0, clicks: 0, queries: 0 };
      cur.cost += row.cost;
      cur.clicks += row.clicks;
      cur.queries += 1;
      wordMap.set(word, cur);
    }
  }
  const negatives = Array.from(wordMap.values())
    .filter((w) => w.queries >= 2 && w.clicks >= 3)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 25);

  return {
    cost,
    clicks,
    conversions,
    waste: waste.slice(0, 40),
    wasteCost: waste.reduce((s, r) => s + r.cost, 0),
    junk: junk.slice(0, 40),
    junkCost: junk.reduce((s, r) => s + r.cost, 0),
    research: research.slice(0, 25),
    researchCost: research.reduce((s, r) => s + r.cost, 0),
    negatives,
    best: rows
      .filter((r) => r.conversions > 0)
      .sort((a, b) => b.conversions - a.conversions)
      .slice(0, 20)
  };
}

export function buildAdsSection(rows: AdRow[]): AdsSection {
  const known = rows.filter((r) => r.title);
  const noTitle2 = known.filter((r) => !r.title2);
  const shortTitle = known.filter((r) => r.title.length > 0 && r.title.length < 25);
  const noExtensions = known.filter((r) => !r.sitelinks || r.callouts === 0);
  const withVolume = known.filter((r) => r.impressions >= 300);
  const avgCtr = safeDiv(
    withVolume.reduce((s, r) => s + r.clicks, 0),
    withVolume.reduce((s, r) => s + r.impressions, 0)
  ) * 100;

  return {
    rows: known.sort((a, b) => b.cost - a.cost).slice(0, 60),
    noTitle2: {
      count: noTitle2.length,
      impressions: noTitle2.reduce((s, r) => s + r.impressions, 0),
      cost: noTitle2.reduce((s, r) => s + r.cost, 0)
    },
    shortTitle: { count: shortTitle.length, cost: shortTitle.reduce((s, r) => s + r.cost, 0) },
    noExtensions: { count: noExtensions.length, cost: noExtensions.reduce((s, r) => s + r.cost, 0) },
    burning: withVolume
      .filter((r) => avgCtr > 0 && r.ctr < avgCtr * 0.6)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 12),
    leaders: withVolume.sort((a, b) => b.ctr - a.ctr).slice(0, 12)
  };
}

export function buildPlacementsSection(rows: PlacementRow[]): PlacementsSection {
  const merged = new Map<string, PlacementRow>();
  for (const row of rows) {
    const cur = merged.get(row.placement) || { ...row, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    cur.impressions += row.impressions;
    cur.clicks += row.clicks;
    cur.cost += row.cost;
    cur.conversions += row.conversions;
    merged.set(row.placement, cur);
  }
  const list = Array.from(merged.values()).sort((a, b) => b.cost - a.cost);
  const waste = list.filter((r) => r.conversions === 0 && r.cost > 0 && r.clicks >= 10);
  return {
    rows: list.slice(0, 40),
    waste: waste.slice(0, 25),
    wasteCost: waste.reduce((s, r) => s + r.cost, 0),
    cost: list.reduce((s, r) => s + r.cost, 0)
  };
}

function sliceInsight(
  id: string,
  title: string,
  rows: SliceRow[],
  totalCost: number,
  what: string,
  action: string
): InsightItem[] {
  const dead = rows.filter((r) => r.conversions === 0 && r.cost >= totalCost * 0.08 && r.clicks >= 30);
  if (!dead.length) return [];
  const cost = dead.reduce((s, r) => s + r.cost, 0);
  return [
    {
      id,
      role: "contextologist",
      severity: cost >= totalCost * 0.25 ? "critical" : "warning",
      title,
      finding: `${dead.map((d) => `${d.label} — ${money(d.cost)} и ${num(d.clicks)} кликов без конверсий`).join("; ")}. Всего по срезу ${money(totalCost)}.`,
      hypothesis: what,
      action,
      impact: `Перераспределение этих ${money(cost)} в сегменты, которые дают звонки, — прямой рост числа обращений без роста бюджета.`,
      evidence: rows
        .slice(0, 6)
        .map((r) => `${r.label}: ${money(r.cost)}, кликов ${num(r.clicks)}, конверсий ${num(r.conversions)}`),
      moneyAtStake: cost
    }
  ];
}

export function buildDeepInsights(
  queries: QueriesSection,
  ads: AdsSection,
  placements: PlacementsSection,
  audience: AudiencePack
): InsightItem[] {
  const items: InsightItem[] = [];

  if (queries.junkCost > 0 && queries.junk.length >= 3) {
    items.push({
      id: "q-junk",
      role: "contextologist",
      severity: queries.junkCost > queries.cost * 0.1 ? "critical" : "warning",
      title: `${money(queries.junkCost)} на запросах, по которым не покупают`,
      finding: `${num(queries.junk.length)} запросов из выгрузки — это работа, запчасти, «своими руками» и информационные фразы. Доля от расхода на поиске ${pct(safeDiv(queries.junkCost, queries.cost) * 100, 1)}.`,
      hypothesis:
        "Автотаргетинг и широкое соответствие подтягивают всё, что содержит название марки. Кампания честно выкупает эти показы, потому что формально они релевантны.",
      action:
        "Добавить перечисленные слова в минус-слова на уровне кампании, а не группы. Для автотаргетинга — отключить категорию «сопутствующие запросы».",
      impact: `Освобождает около ${money(queries.junkCost)} за период, при этом целевой спрос не режется — эти запросы не давали конверсий.`,
      evidence: queries.junk.slice(0, 6).map((q) => `«${q.query}» — ${money(q.cost)}, ${q.reason}`),
      moneyAtStake: queries.junkCost
    });
  }

  if (queries.research.length >= 5) {
    items.push({
      id: "q-research",
      role: "marketer",
      severity: "opportunity",
      title: `${money(queries.researchCost)} уходит на тех, кто ещё выбирает`,
      finding: `${num(queries.research.length)} запросов вида «отзывы», «характеристики», «чем отличается» — с кликами, но без конверсий.`,
      hypothesis:
        "Это не мусор: человек в начале выбора и до звонка не дозрел. Мы платим за него, приводим на карточку с кнопкой «позвонить» и теряем.",
      action:
        "Вести такие запросы на сравнение комплектаций и обзор, а не на карточку с ценой. Собирать этих людей в ретаргетинг и догонять предложением тест-драйва через неделю.",
      impact: "Тот же трафик перестаёт быть расходом и становится верхом воронки, из которого приходят звонки в следующем месяце.",
      evidence: queries.research.slice(0, 6).map((q) => `«${q.query}» — ${money(q.cost)}, ${q.reason}`)
    });
  }

  if (queries.negatives.length >= 5) {
    const top = queries.negatives.slice(0, 10);
    const cost = top.reduce((s, w) => s + w.cost, 0);
    items.push({
      id: "q-negatives",
      role: "contextologist",
      severity: "warning",
      title: "Кандидаты в минус-слова по расходу без конверсий",
      finding: `Слова, встречающиеся в запросах без единой конверсии: ${top.map((w) => w.word).join(", ")}.`,
      hypothesis:
        "Каждое из этих слов встречается минимум в трёх разных запросах, то есть это не случайность, а устойчивый поток нецелевого спроса.",
      action:
        "Прогнать список глазами и отминусовать очевидное. Слова, связанные с моделями и комплектациями, оставить — по ним спрос есть, вопрос к посадочной.",
      impact: `Верхняя оценка экономии — ${money(cost)} за период.`,
      evidence: top.map((w) => `${w.word}: ${money(w.cost)}, кликов ${num(w.clicks)}, запросов ${w.queries}`),
      moneyAtStake: cost
    });
  }

  if (placements.waste.length >= 3) {
    items.push({
      id: "placements",
      role: "contextologist",
      severity: placements.wasteCost > placements.cost * 0.2 ? "critical" : "warning",
      title: `Площадки РСЯ: ${money(placements.wasteCost)} без единой конверсии`,
      finding: `${num(placements.waste.length)} площадок с кликами и нулём конверсий. Крупнейшие: ${placements.waste
        .slice(0, 5)
        .map((p) => `${p.placement} (${money(p.cost)})`)
        .join(", ")}.`,
      hypothesis:
        "Мобильные приложения и развлекательные сайты дают дешёвый клик, который почти никогда не превращается в обращение к дилеру.",
      action:
        "Запретите на уровне кампании только площадки с заметным расходом и нулём целевых звонков. Не чистите список пачкой: лишние запреты роняют показы и сбивают обучение. Повторите разбор через 14 дней.",
      impact: `Возврат в оборот примерно ${money(placements.wasteCost)} за период.`,
      evidence: placements.waste
        .slice(0, 8)
        .map((p) => `${p.placement}: ${money(p.cost)}, кликов ${num(p.clicks)}`),
      moneyAtStake: placements.wasteCost
    });
  }

  if (ads.noTitle2.count > 0 && ads.noTitle2.impressions >= 1000) {
    items.push({
      id: "ads-title2",
      role: "contextologist",
      severity: "warning",
      title: `${ads.noTitle2.count} объявлений без второго заголовка`,
      finding: `На них пришлось ${num(ads.noTitle2.impressions)} показов и ${money(ads.noTitle2.cost)}. Второй заголовок показывается не всегда, но занимает место в выдаче и почти бесплатно повышает кликабельность.`,
      hypothesis:
        "Объявления собирались давно или переносились шаблоном. Это не ошибка стратегии, а незакрытый гигиенический минимум.",
      action:
        "Дописать второй заголовок с конкретикой: наличие, цена «от», срок поставки. Не дублировать первый заголовок — в этом случае Директ его просто не покажет.",
      impact: "Обычно даёт несколько десятых процентного пункта CTR при том же бюджете.",
      evidence: [`Объявлений ${ads.noTitle2.count}`, `Показы ${num(ads.noTitle2.impressions)}`, `Расход ${money(ads.noTitle2.cost)}`],
      moneyAtStake: 0
    });
  }

  if (ads.burning.length >= 3) {
    const cost = ads.burning.reduce((s, r) => s + r.cost, 0);
    items.push({
      id: "ads-ctr",
      role: "contextologist",
      severity: "warning",
      title: "Объявления с CTR заметно ниже своих же",
      finding: `${ads.burning.length} объявлений работают хуже среднего по аккаунту при ${money(cost)} расхода. Худшее: «${ads.burning[0].title}» — CTR ${ads.burning[0].ctr.toFixed(2)}%.`,
      hypothesis:
        "Заголовок не повторяет запрос пользователя либо оффер устарел: цена, срок, акция уже неактуальны.",
      action:
        "Взять три объявления-лидера из этого же аккаунта и переписать отстающие по их структуре. Менять по одному элементу, иначе непонятно, что сработало.",
      impact: `Выравнивание CTR до среднего вернуло бы часть из ${money(cost)} в виде кликов той же стоимости.`,
      evidence: ads.burning
        .slice(0, 6)
        .map((a) => `«${a.title}${a.title2 ? ` — ${a.title2}` : ""}»: CTR ${a.ctr.toFixed(2)}%, ${money(a.cost)}`),
      moneyAtStake: cost * 0.3
    });
  }

  const audienceCost = (rows: SliceRow[]) => rows.reduce((s, r) => s + r.cost, 0);
  items.push(
    ...sliceInsight(
      "aud-age",
      "Возрастные группы без конверсий",
      audience.age,
      audienceCost(audience.age),
      "Часть возрастных групп у дилера не покупает, но исправно набирает клики: чаще всего это самые молодые и «не определён».",
      "Поставить понижающие корректировки на группы без конверсий, а не отключать их полностью — данных по «не определён» всегда много."
    )
  );
  items.push(
    ...sliceInsight(
      "aud-geo",
      "География без конверсий",
      audience.geo,
      audienceCost(audience.geo),
      "Показы уходят в регионы, откуда до дилерского центра не доезжают. Для холдинга в Москве это обычно дальние области.",
      "Ограничить гео радиусом реальной доступности салона и оставить область только там, где звонки подтверждаются."
    )
  );

  const order: Record<InsightItem["severity"], number> = { critical: 0, warning: 1, opportunity: 2 };
  const ruleById: Record<string, string> = {
    "q-junk": "yd.autotargeting.categories",
    "q-research": "yd.search.research",
    "q-negatives": "yd.search.negatives",
    placements: "yd.rsya.placements",
    "ads-title2": "yd.copy.extensions",
    "ads-ctr": "yd.copy.message-match",
    "aud-age": "yd.audience.adjustments",
    "aud-geo": "yd.geo.radius"
  };
  return items
    .map((item) => {
      const ruleId = ruleById[item.id];
      if (!ruleId) return item;
      const ref = ruleRef(ruleId);
      return { ...item, ruleId: ref.ruleId, ruleSource: ref.ruleSource };
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || (b.moneyAtStake || 0) - (a.moneyAtStake || 0));
}
