export async function mapChunk<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const part = await Promise.all(items.slice(i, i + size).map(fn));
    out.push(...part);
    if (i + size < items.length) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  return out;
}
