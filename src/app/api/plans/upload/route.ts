import { NextResponse } from "next/server";
import { classifiedCount, matrixToPlans, parseClassifiedMatrix } from "@/lib/plan-model";
import { saveClassifieds, savePlans } from "@/lib/plan-store";
import { noteUpload } from "@/lib/sheets-sync";
import { parseCsv } from "@/lib/tabular";
import { matrixFromXlsx } from "@/lib/xlsx-table";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 2_000_000;

function isXlsx(name: string, buf: Buffer): boolean {
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return true;
  return buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const kind = String(form.get("kind") || "");
  const file = form.get("file");
  if (kind !== "plans" && kind !== "classifieds") {
    return NextResponse.json({ error: "Нужно указать kind: plans или classifieds" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Приложите CSV или XLSX" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 2 МБ" }, { status: 400 });
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let matrix: string[][] = [];
  try {
    matrix = isXlsx(name, buf) ? matrixFromXlsx(buf) : parseCsv(buf.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать файл" }, { status: 400 });
  }
  if (kind === "plans") {
    const rows = matrixToPlans(matrix);
    if (!rows.length) {
      return NextResponse.json(
        { error: "Не вижу строк плана. Нужны колонки month, contractor, brand, line, spend, leads, visits." },
        { status: 400 }
      );
    }
    savePlans(rows, "upload");
    noteUpload("plans", rows.length);
    return NextResponse.json({ ok: true, rows: rows.length });
  }
  const sheet = parseClassifiedMatrix(matrix);
  const count = classifiedCount(sheet);
  if (!count) {
    return NextResponse.json(
      {
        error:
          "Не вижу классифайдов. Для таблицы «Текущий месяц» нужна колонка «План расход». Для простого файла — колонки month, platform, plan, fact."
      },
      { status: 400 }
    );
  }
  saveClassifieds(sheet, "upload");
  noteUpload("classifieds", count);
  return NextResponse.json({ ok: true, rows: count });
}
