import { describe, expect, it } from "vitest";
import { buildMapsReport } from "../src/lib/maps-report";

describe("срез Яндекс Бизнеса", () => {
  it("оставляет только работающие карточки и собирает поиск с продвижением", () => {
    const report = buildMapsReport({
      savedAt: "2026-11-18T12:00:00.000Z",
      cards: {
        closed: {
          id: "1",
          name: "Закрытый филиал",
          status: "closed",
          promotion: { campaigns: [{ id: 9, status: "RUNNING", type: "UNIFIED", remainingDays: 10 }] },
          discovery: { sessions: [{ type: "text_search_on_map", query: "закрытый", actions: [] }] }
        },
        seres: {
          id: "2",
          name: "БорисХоф Seres",
          status: "publish",
          discovery: { sessions: [{ type: "text_search_on_map", query: "seres", actions: ["call"] }] }
        },
        open: {
          id: "3",
          name: "Volvo центр",
          status: "publish",
          address: "Центральный федеральный округ, Москва, улица Пример, 1",
          site: "https://example.test/",
          promotion: {
            campaigns: [
              { id: 50, status: "RUNNING", type: "BRANDING", remainingDays: 12 },
              { id: 51, status: "FINISHED", type: "UNIFIED", remainingDays: null }
            ]
          },
          discovery: {
            lastProcessedDate: "2026-11-16",
            sessions: [
              { type: "text_search_on_map", query: "volvo сервис", actions: ["route"] },
              { type: "text_search_on_map", query: "volvo сервис", actions: [] },
              { type: "external_open", query: "yandex.ru", actions: [] }
            ]
          }
        }
      }
    });
    expect(report.cards.map((card) => card.name)).toEqual(["Volvo центр"]);
    expect(report.cards[0].address).toBe("Москва, улица Пример, 1");
    expect(report.cards[0].promotion).toBe("active");
    expect(report.cards[0].searchVisits).toBe(2);
    expect(report.cards[0].linkVisits).toBe(1);
    expect(report.cards[0].actionVisits).toBe(1);
    expect(report.queries[0]).toMatchObject({ query: "volvo сервис", visits: 2, actions: 1, cards: 1 });
    expect(report.campaigns).toEqual([{ id: 50, type: "BRANDING", status: "RUNNING", remainingDays: 12, cards: 1 }]);
  });
});
