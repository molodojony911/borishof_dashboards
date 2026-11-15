export function buildQuery(
  search: { toString(): string } | string,
  patch: Record<string, string | undefined | null>
): string {
  const params = new URLSearchParams(typeof search === "string" ? search.replace(/^\?/, "") : search.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}
