import type { AlertItem } from "../types";
import { loadSettings } from "../config";
import { HTTP_TIMEOUT, apiTimeout } from "../http";

export function telegramMinSeverity(): "critical" | "warning" {
  return process.env.TELEGRAM_MIN_SEVERITY === "critical" ? "critical" : "warning";
}

export function selectTelegramAlerts(alerts: AlertItem[]): AlertItem[] {
  const min = telegramMinSeverity();
  return alerts.filter((a) => (min === "critical" ? a.severity === "critical" : true));
}

export function formatTelegram(alerts: AlertItem[]): string {
  const lines = [
    "Борисхоф Digital · алерты",
    "",
    ...alerts.slice(0, 8).map((a) => {
      const flag = a.severity === "critical" ? "CRIT" : "WARN";
      const why = a.explanation ? `\n${a.explanation}` : "";
      const action = a.recommendation ? `\n${a.recommendation.slice(0, 280)}` : "";
      return `[${flag}] ${a.entity}\n${a.message}${why}${action}`;
    })
  ];
  return lines.join("\n\n").slice(0, 3500);
}

export async function dispatchTelegram(
  alerts: AlertItem[]
): Promise<{ sent: boolean; dryRun?: boolean; count: number; error?: string; preview?: string }> {
  const settings = loadSettings();
  const token = (process.env.TELEGRAM_BOT_TOKEN || settings.telegramBotToken || "").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || settings.telegramChatId || "").trim();
  const chosen = selectTelegramAlerts(alerts);
  if (!chosen.length) return { sent: false, count: 0, error: "Нет алертов выбранной важности" };
  const preview = formatTelegram(chosen);
  if (!token || !chatId) {
    return {
      sent: false,
      count: chosen.length,
      error: "Не заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (или поля в разделе «Подключение»)"
    };
  }
  if (process.env.TELEGRAM_DRY_RUN === "1") {
    return { sent: false, dryRun: true, count: chosen.length, preview };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: preview
    }),
    signal: apiTimeout(HTTP_TIMEOUT.telegramMs)
  });
  if (!res.ok) {
    const text = await res.text();
    return { sent: false, count: chosen.length, error: text.slice(0, 300) };
  }
  return { sent: true, count: chosen.length };
}
