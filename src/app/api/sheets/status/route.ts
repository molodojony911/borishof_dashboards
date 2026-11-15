import { NextResponse } from "next/server";
import { readSheetsStatus } from "@/lib/sheets-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(readSheetsStatus());
}
