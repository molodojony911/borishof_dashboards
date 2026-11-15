import path from "path";

/**
 * Каталог рабочих файлов (токены, настройки, кэш, цели).
 * Боевой путь — `data/` в корне проекта.
 * Тесты задают BORISHOF_DATA_DIR на пустую папку, чтобы не читать .env и data/*.json машины.
 * Читается при каждом вызове, а не при загрузке модуля.
 */
export function dataDir(): string {
  const override = (process.env.BORISHOF_DATA_DIR || "").trim();
  if (!override) return path.join(process.cwd(), "data");
  return path.resolve(override);
}

export function dataPath(...parts: string[]): string {
  return path.join(dataDir(), ...parts);
}
