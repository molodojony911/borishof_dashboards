import { NextRequest, NextResponse } from "next/server";
import { buildDashboard } from "@/lib/pipeline";
import { dispatchTelegram } from "@/lib/connectors/telegram";
import { parseFilters } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period");
  const filter = parseFilters((key) => req.nextUrl.searchParams.get(key));
  const data = await buildDashboard(period, filter);
  const result = await dispatchTelegram(data.alerts);
  return NextResponse.json(result);
}
