/**
 * Таймаут исходящего HTTP. Без AbortSignal зависший сокет Яндекса или Calltouch
 * держит сборку дашборда и `npm test`, пока их не убьют снаружи.
 * Длительности прежние: отчёты Директа и журналы звонков бывают медленными.
 * У Telegram таймаута не было — теперь 10 с.
 */
export const HTTP_TIMEOUT = {
  directReportMs: 12_000,
  directClientsMs: 10_000,
  directDeepReportMs: 60_000,
  directDeepApiMs: 45_000,
  metrikaMs: 25_000,
  calltouchMs: 35_000,
  telegramMs: 10_000
} as const;

export function apiTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
