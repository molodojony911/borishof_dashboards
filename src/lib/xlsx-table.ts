import * as XLSX from "xlsx";

export function matrixFromXlsx(buf: Buffer): string[][] {
  const book = XLSX.read(buf, { type: "buffer", cellDates: true });
  const name = book.SheetNames[0];
  if (!name) return [];
  const rows = XLSX.utils.sheet_to_json<Array<string | number | Date | null>>(book.Sheets[name], {
    header: 1,
    raw: false,
    defval: "",
    dateNF: "yyyy-mm-dd"
  });
  return rows
    .map((row) => (Array.isArray(row) ? row : []).map((cell) => (cell == null ? "" : String(cell).trim())))
    .filter((row) => row.some(Boolean));
}
