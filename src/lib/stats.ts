/** Медиана. Пустой ряд — 0. Нужна как устойчивая база, среднее слишком легко тянет один день. */
export function median(values: number[]): number {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/**
 * Робастный z-score: 0.6745 × (x − median) / MAD.
 * MAD = 0 и x отличается от медианы — ряд «плоский», любой выброс считаем сильным (z = ±99),
 * а не пропускаем его. Меньше 5 точек — статистике верить рано, возвращаем null.
 */
export function robustZ(value: number, sample: number[]): number | null {
  const list = sample.filter((v) => Number.isFinite(v));
  if (list.length < 5 || !Number.isFinite(value)) return null;
  const med = median(list);
  const mad = median(list.map((v) => Math.abs(v - med)));
  if (mad === 0) {
    if (value === med) return 0;
    return value > med ? 99 : -99;
  }
  return (0.6745 * (value - med)) / mad;
}
