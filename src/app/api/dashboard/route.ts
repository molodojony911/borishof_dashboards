import { NextRequest, NextResponse } from "next/server";
import { buildDashboard } from "@/lib/pipeline";
import { parseFilters } from "@/lib/catalog";
import { startSheetsSync } from "@/lib/sheets-sync";

startSheetsSync();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period");
  const filter = parseFilters((key) => req.nextUrl.searchParams.get(key));
  try {
    const data = await buildDashboard(period, filter);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка сборки дашборда" },
      { status: 500 }
    );
  }
}
