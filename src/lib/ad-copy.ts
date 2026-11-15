import { apiTimeout } from "./http";

/** Лимиты текстово-графического объявления Директа, с пробелами и знаками. */
export const DIRECT_TEXT_LIMITS = {
  title: 56,
  title2: 30,
  text: 81
} as const;

export interface AdCopyInput {
  brand: string;
  line: string;
  title: string;
  title2: string;
  text: string;
  reasons: string[];
  leaders: Array<{ title: string; title2: string; text: string }>;
}

export interface AdCopyVariant {
  title: string;
  title2: string;
  text: string;
  why: string;
}

export function openAiConfig(): { apiKey: string; baseUrl: string; model: string } {
  return {
    apiKey: (process.env.OPENAI_API_KEY || "").trim(),
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/$/, ""),
    model: (process.env.OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini"
  };
}

/** Ключ только из окружения. Без него анализ остаётся, генерация текстов скрыта. */
export function openAiConfigured(): boolean {
  return Boolean(openAiConfig().apiKey);
}

export function buildAdCopyPrompt(input: AdCopyInput): { system: string; user: string } {
  const line = input.line === "afs" ? "AFS, сервис и запчасти" : input.line === "nc" ? "NC, продажи новых автомобилей" : "линия не задана";
  const leaders = input.leaders
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title} / ${item.title2} — ${item.text}`)
    .join("\n");
  return {
    system:
      "Ты пишешь тексты Яндекс Директа для автомобильного дилера. Не обещай цену, скидку и наличие, если их нет в исходном объявлении. Не меняй марку. Ответ — только JSON без пояснений вокруг.",
    user: [
      `Бренд: ${input.brand || "не указан"}. Линия: ${line}.`,
      `Слабое объявление: «${input.title}» / «${input.title2}». Текст: «${input.text}».`,
      `Почему слабое: ${input.reasons.join(" ") || "не сказано"}.`,
      leaders ? `Сильные объявления той же группы, на них опирайся:\n${leaders}` : "Сильных объявлений в группе нет.",
      `Сделай от 3 до 5 вариантов. Лимиты знаков: заголовок ${DIRECT_TEXT_LIMITS.title}, второй заголовок ${DIRECT_TEXT_LIMITS.title2}, текст ${DIRECT_TEXT_LIMITS.text}.`,
      'Формат: {"variants":[{"title":"","title2":"","text":"","why":""}]}'
    ].join("\n")
  };
}

function clip(value: unknown, limit: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).trim();
}

export function parseAdCopyResponse(raw: string): AdCopyVariant[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] || raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  const parsed = JSON.parse(body.slice(start, end + 1)) as { variants?: unknown };
  if (!Array.isArray(parsed.variants)) return [];
  return parsed.variants
    .map((item) => {
      const row = item as { title?: unknown; title2?: unknown; text?: unknown; why?: unknown };
      return {
        title: clip(row.title, DIRECT_TEXT_LIMITS.title),
        title2: clip(row.title2, DIRECT_TEXT_LIMITS.title2),
        text: clip(row.text, DIRECT_TEXT_LIMITS.text),
        why: clip(row.why, 240)
      };
    })
    .filter((item) => item.title && item.text)
    .slice(0, 5);
}

export async function suggestAdCopy(
  input: AdCopyInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ variants: AdCopyVariant[]; error?: string }> {
  const cfg = openAiConfig();
  if (!cfg.apiKey) {
    return { variants: [], error: "Задайте OPENAI_API_KEY. Анализ объявлений работает и без ключа, в Директ ничего не отправляется." };
  }
  const prompt = buildAdCopyPrompt(input);
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    }),
    signal: apiTimeout(30_000)
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    return { variants: [], error: json.error?.message || `Модель ответила ${res.status}` };
  }
  const content = json.choices?.[0]?.message?.content || "";
  try {
    const variants = parseAdCopyResponse(content);
    if (variants.length < 3) return { variants, error: "Модель вернула меньше трёх пригодных вариантов." };
    return { variants };
  } catch {
    return { variants: [], error: "Модель ответила не списком вариантов." };
  }
}
