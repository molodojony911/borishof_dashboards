import { NextResponse } from "next/server";
import { loadPlans } from "@/lib/plan-store";
import { startSheetsSync, syncIfDue } from "@/lib/sheets-sync";

startSheetsSync();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await syncIfDue().catch(() => undefined);
  return NextResponse.json(loadPlans());
}
