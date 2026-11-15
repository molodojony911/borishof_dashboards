import { NextResponse } from "next/server";
import { startSheetsSync, syncNow } from "@/lib/sheets-sync";

startSheetsSync();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const status = await syncNow();
  const failed = Boolean(status.lastError) && !status.plansRows && !status.classifiedsRows && status.configured;
  return NextResponse.json(status, { status: failed ? 502 : 200 });
}
