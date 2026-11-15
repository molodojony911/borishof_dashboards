import { afterEach, describe, expect, it, vi } from "vitest";
import { allocateQualityLeads, analyzeAdPerformance } from "../src/lib/engines/ad-effectiveness";
import { buildAdCopyPrompt, openAiConfig, parseAdCopyResponse, suggestAdCopy } from "../src/lib/ad-copy";
import type { AdRow } from "../src/lib/connectors/direct-deep";

function ad(patch: Partial<AdRow> & Pick<AdRow, "adId">): AdRow {
  return {
    campaign: "HAVAL поиск",
    campaignId: "c1",
    adGroupId: "g1",
    adGroupName: "Модели",
    brand: "HAVAL",
    line: "nc",
    contractor: "Tandem",
    impressions: 2000,
    clicks: 100,
    cost: 10000,
    conversions: 4,
    qualityLeads: 0,
    ctr: 5,
    title: "Haval Jolion в наличии",
    title2: "Тест-драйв сегодня",
    text: "Официальный дилер. Запишитесь на тест-драйв.",
    sitelinks: 1,
    callouts: 1,
    ...patch
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
});

describe("эффективность объявлений", () => {
  it("делит качественные лиды кампании по конверсиям объявлений", () => {
    const rows = allocateQualityLeads(
      [ad({ adId: "a1", conversions: 1 }), ad({ adId: "a2", conversions: 3 })],
      [
        { campaignId: "c1", campaign: "HAVAL поиск", kind: "call", quality: true },
        { campaignId: "c1", campaign: "HAVAL поиск", kind: "call", quality: true },
        { campaignId: "c1", campaign: "HAVAL поиск", kind: "call", quality: true },
        { campaignId: "c1", campaign: "HAVAL поиск", kind: "call", quality: true },
        { campaignId: "c1", campaign: "HAVAL поиск", kind: "form", quality: true }
      ]
    );
    expect(rows.find((row) => row.adId === "a1")?.qualityLeads).toBe(1);
    expect(rows.find((row) => row.adId === "a2")?.qualityLeads).toBe(3);
  });

  it("помечает слабое по CTR и сильное по отрыву, а мелкое не судит", () => {
    const peers = [0, 1, 2, 3].map((index) =>
      ad({
        adId: `peer-${index}`,
        impressions: 2000,
        clicks: 120,
        ctr: 6,
        cost: 8000,
        conversions: 4,
        qualityLeads: 4
      })
    );
    const weak = ad({
      adId: "weak",
      impressions: 2000,
      clicks: 40,
      ctr: 2,
      cost: 12000,
      conversions: 0,
      qualityLeads: 0
    });
    const strong = ad({
      adId: "strong",
      impressions: 2000,
      clicks: 200,
      ctr: 10,
      cost: 8000,
      conversions: 8,
      qualityLeads: 8
    });
    const tiny = ad({ adId: "tiny", impressions: 40, clicks: 2, ctr: 5, cost: 200, conversions: 0 });
    const review = analyzeAdPerformance([...peers, weak, strong, tiny]);
    expect(review.ads.find((row) => row.adId === "weak")?.verdict).toBe("weak");
    expect(review.ads.find((row) => row.adId === "weak")?.reasons.join(" ")).toMatch(/CTR/);
    expect(review.ads.find((row) => row.adId === "strong")?.verdict).toBe("strong");
    expect(review.ads.find((row) => row.adId === "tiny")?.verdict).toBe("insufficient");
    expect(review.groups.some((row) => row.groupName === "Модели")).toBe(true);
  });
});

describe("варианты текстов", () => {
  it("промпт держит лимиты Директа и не содержит ключ", () => {
    process.env.OPENAI_API_KEY = "secret-key";
    const prompt = buildAdCopyPrompt({
      brand: "HAVAL",
      line: "afs",
      title: "Сервис Haval",
      title2: "",
      text: "Запись на ТО",
      reasons: ["CTR ниже медианы"],
      leaders: [{ title: "ТО Haval за час", title2: "Запись онлайн", text: "Официальный сервис" }]
    });
    expect(prompt.user).toContain("56");
    expect(prompt.user).toContain("AFS");
    expect(prompt.user).toContain("ТО Haval за час");
    expect(prompt.user + prompt.system).not.toContain("secret-key");
  });

  it("разбирает JSON модели и обрезает длинный заголовок", () => {
    const raw = 'текст вокруг ```json\n{"variants":[{"title":"' + "А".repeat(80) + '","title2":"Короткий","text":"Запишитесь на тест-драйв.","why":"Короче и конкретнее"}]}\n```';
    const variants = parseAdCopyResponse(raw);
    expect(variants).toHaveLength(1);
    expect(variants[0].title.length).toBeLessThanOrEqual(56);
    expect(variants[0].title2).toBe("Короткий");
  });

  it("ключ и адрес модели берутся только из окружения", async () => {
    process.env.OPENAI_API_KEY = "secret-key";
    process.env.OPENAI_BASE_URL = "https://proxy.example/v1/";
    process.env.OPENAI_MODEL = "demo-model";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    variants: [
                      { title: "Один", title2: "Два", text: "Текст один", why: "a" },
                      { title: "Два", title2: "Три", text: "Текст два", why: "b" },
                      { title: "Три", title2: "Четыре", text: "Текст три", why: "c" }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );
    const result = await suggestAdCopy(
      { brand: "HAVAL", line: "nc", title: "Haval", title2: "", text: "Дилер", reasons: [], leaders: [] },
      fetchMock
    );
    expect(result.variants).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proxy.example/v1/chat/completions");
    expect(String(init.body)).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(openAiConfig().model).toBe("demo-model");
  });

  it("без ключа не ходит в сеть", async () => {
    const fetchMock = vi.fn();
    const result = await suggestAdCopy(
      { brand: "HAVAL", line: "nc", title: "Haval", title2: "", text: "Дилер", reasons: [], leaders: [] },
      fetchMock
    );
    expect(result.error).toMatch(/OPENAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openAiConfig().model).toBe("gpt-4o-mini");
  });
});
