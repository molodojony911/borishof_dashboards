export function detectDelimiter(text: string): "," | ";" | "\t" {
  const line = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((row) => row.trim()) || "";
  const semi = (line.match(/;/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  if (semi > commas && semi >= tabs) return ";";
  if (tabs > commas && tabs > semi) return "\t";
  return ",";
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delim) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseNumberCell(raw: string): number | null {
  const text = raw
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/₽/g, "")
    .replace(/руб\.?/gi, "")
    .replace(/%/g, "");
  if (!text || text === "—" || text === "-" || text === "–") return null;
  let normalized = text;
  if (normalized.includes(",") && !normalized.includes(".")) normalized = normalized.replace(",", ".");
  else normalized = normalized.replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
