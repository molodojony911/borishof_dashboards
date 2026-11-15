import { NextResponse } from "next/server";
import { suggestAdCopy, type AdCopyInput } from "@/lib/ad-copy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asText(value: unknown, limit: number): string {
  return String(value ?? "").slice(0, limit);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<AdCopyInput> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Нет объявления для вариантов." }, { status: 400 });
  }
  const input: AdCopyInput = {
    brand: asText(body.brand, 80),
    line: asText(body.line, 8),
    title: asText(body.title, 200),
    title2: asText(body.title2, 120),
    text: asText(body.text, 400),
    reasons: Array.isArray(body.reasons) ? body.reasons.map((item) => asText(item, 240)).slice(0, 6) : [],
    leaders: Array.isArray(body.leaders)
      ? body.leaders.slice(0, 3).map((item) => ({
          title: asText(item?.title, 200),
          title2: asText(item?.title2, 120),
          text: asText(item?.text, 400)
        }))
      : []
  };
  if (!input.title && !input.text) {
    return NextResponse.json({ error: "У объявления нет текста, варианты собирать не из чего." }, { status: 400 });
  }
  const result = await suggestAdCopy(input);
  return NextResponse.json(result);
}
