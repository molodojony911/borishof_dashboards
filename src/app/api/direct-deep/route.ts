import { NextRequest, NextResponse } from "next/server";
import { buildDirectDeep } from "@/lib/deep";
import { parseFilters } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period");
  const filter = parseFilters((key) => req.nextUrl.searchParams.get(key));
  try {
    const data = await buildDirectDeep(period, filter);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка выгрузки Директа" },
      { status: 500 }
    );
  }
}
