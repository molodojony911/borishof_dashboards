import { NextResponse } from "next/server";
import { loadMapsReport } from "@/lib/maps-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(loadMapsReport());
}
