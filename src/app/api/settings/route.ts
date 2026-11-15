import { NextResponse } from "next/server";
import { loadSettings, publicSettings, saveSettings, emptySettings } from "@/lib/config";
import type { AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

function restoreSecrets(incoming: AppSettings, stored: AppSettings): AppSettings {
  const keep = (value: string, previous: string) => {
    if (!value) return previous;
    if (value.includes("••••")) return previous;
    return value;
  };
  return {
    ...incoming,
    telegramBotToken: keep(incoming.telegramBotToken, stored.telegramBotToken),
    metrika: incoming.metrika.map((row, i) => ({
      ...row,
      token: keep(row.token, stored.metrika[i]?.token || "")
    })),
    direct: incoming.direct.map((row, i) => ({
      ...row,
      token: keep(row.token, stored.direct[i]?.token || "")
    })),
    calltouch: incoming.calltouch.map((row, i) => ({
      ...row,
      token: keep(row.token, stored.calltouch[i]?.token || "")
    }))
  };
}

export async function GET() {
  return NextResponse.json(publicSettings(loadSettings()));
}

export async function PUT(req: Request) {
  const body = (await req.json()) as AppSettings;
  const stored = loadSettings();
  const next = restoreSecrets({ ...emptySettings(), ...body }, stored);
  return NextResponse.json(publicSettings(saveSettings(next)));
}
