/** EXEED и Esteo в дашборде — один проект. Сайты и кабинеты остаются, бренд общий. */
export const COMBINED_BRAND = "Exeed + Esteo";

function foldName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
}

/** combined — в названии оба бренда, part — только один из них. */
export function exeedEsteoKind(raw: string): "combined" | "part" | "other" {
  const text = foldName(raw);
  if (!text) return "other";
  const exeed = /exeed|эксид/.test(text);
  const esteo = /esteo|эстео/.test(text);
  if (exeed && esteo) return "combined";
  if (exeed || esteo) return "part";
  return "other";
}

export function canonicalBrand(raw: string): string {
  return exeedEsteoKind(raw) === "other" ? raw : COMBINED_BRAND;
}

export function sameBrand(left: string, right: string): boolean {
  return canonicalBrand(left) === canonicalBrand(right);
}
