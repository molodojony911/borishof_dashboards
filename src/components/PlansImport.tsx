"use client";

import { useEffect, useState } from "react";

interface SyncStatus {
  configured?: boolean;
  intervalHours?: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  plansRows?: number;
  classifiedsRows?: number;
  plansUpdatedAt?: string;
  classifiedsUpdatedAt?: string;
  plansSource?: string;
  classifiedsSource?: string;
}

function when(value?: string): string {
  if (!value) return "ещё не было";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export function PlansImport() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    const res = await fetch("/api/sheets/status");
    setStatus(await res.json());
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function upload(kind: "plans" | "classifieds", file: File | undefined) {
    if (!file) return;
    setMessage("Читаем файл…");
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    const res = await fetch("/api/plans/upload", { method: "POST", body });
    const json = (await res.json()) as { rows?: number; error?: string };
    setMessage(res.ok ? `Загружено строк: ${json.rows}` : json.error || "Не удалось прочитать файл");
    await refresh();
  }

  async function sync() {
    setMessage("Тянем таблицу…");
    const res = await fetch("/api/sheets/sync", { method: "POST" });
    const json = (await res.json()) as SyncStatus;
    setStatus(json);
    setMessage(json.lastError ? json.lastError : `Обновлено ${when(json.lastSuccessAt)}`);
  }

  return (
    <section className="mb-12 max-w-3xl border border-white/[0.08] p-5">
      <h2 className="font-display text-xl">Планы и классифайды</h2>
      <p className="mt-2 text-sm leading-relaxed text-mute">
        Файл подрядчика можно загрузить вручную (CSV или XLSX). Классифайды по расписанию читаются из Google Таблицы, раз в{" "}
        {status?.intervalHours ?? 3} ч. Дашборд в таблицу ничего не пишет. Образцы колонок лежат в{" "}
        <span className="text-paper">data/samples/</span>.
      </p>
      <div className="mt-4 flex flex-wrap gap-6 text-sm">
        <label className="text-xs text-mute">
          План месяца (CSV/XLSX)
          <input
            className="mt-1 block text-sm text-paper"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            onChange={(event) => upload("plans", event.target.files?.[0])}
          />
        </label>
        <label className="text-xs text-mute">
          Классифайды (CSV/XLSX)
          <input
            className="mt-1 block text-sm text-paper"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            onChange={(event) => upload("classifieds", event.target.files?.[0])}
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-mute">
        <button type="button" onClick={sync} className="border border-white/15 px-3 py-2 text-paper">
          Обновить сейчас
        </button>
        <span>Планы: {status?.plansRows ?? 0}, обновлены {when(status?.plansUpdatedAt)}</span>
        <span>Классифайды: {status?.classifiedsRows ?? 0}, обновлены {when(status?.classifiedsUpdatedAt)}</span>
      </div>
      <p className="mt-2 text-xs text-mute">
        Последняя удачная синхронизация: {when(status?.lastSuccessAt)}
        {status?.lastError ? <span className="mt-1 block text-rose-200">{status.lastError}</span> : null}
      </p>
      {message ? <p className="mt-2 text-sm text-paper">{message}</p> : null}
    </section>
  );
}
