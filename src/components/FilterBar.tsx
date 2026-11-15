"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { canonicalBrand } from "@/lib/brand-alias";
import { ACCOUNTS, CONTRACTORS, LINE_LABEL } from "@/lib/catalog";
import { buildQuery } from "@/lib/href";

function brandFits(brand: string, contractor: string, line: string): boolean {
  if (!brand) return true;
  return ACCOUNTS.some(
    (acc) => acc.brand === canonicalBrand(brand) && (!contractor || acc.contractor === contractor) && (!line || acc.line === line)
  );
}

export function FilterBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const contractor = search.get("contractor") || "";
  const line = search.get("line") || "";
  const brand = canonicalBrand(search.get("brand") || "");
  const q = search.toString();
  const brands = useMemo(() => {
    const names = new Set(
      ACCOUNTS.filter((acc) => (!contractor || acc.contractor === contractor) && (!line || acc.line === line)).map(
        (acc) => acc.brand
      )
    );
    if (brand) names.add(brand);
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ru"));
  }, [contractor, line, brand]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterLink pathname={pathname} search={q} patch={{ contractor: undefined }} active={!contractor} label="Все подрядчики" />
      {CONTRACTORS.map((name) => (
        <FilterLink
          key={name}
          pathname={pathname}
          search={q}
          patch={{ contractor: name, brand: brandFits(brand, name, line) ? brand || undefined : undefined }}
          active={contractor === name}
          label={name}
        />
      ))}
      <span className="mx-1 h-4 w-px bg-white/10" />
      <FilterLink
        pathname={pathname}
        search={q}
        patch={{ line: undefined, brand: brandFits(brand, contractor, "") ? brand || undefined : undefined }}
        active={!line}
        label="NC+AFS"
      />
      <FilterLink
        pathname={pathname}
        search={q}
        patch={{ line: "nc", brand: brandFits(brand, contractor, "nc") ? brand || undefined : undefined }}
        active={line === "nc"}
        label={LINE_LABEL.nc}
      />
      <FilterLink
        pathname={pathname}
        search={q}
        patch={{ line: "afs", brand: brandFits(brand, contractor, "afs") ? brand || undefined : undefined }}
        active={line === "afs"}
        label={LINE_LABEL.afs}
      />
      <label className="ml-1 text-xs text-mute">
        Бренд
        <select
          className="ml-2 border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-paper"
          value={brand}
          onChange={(e) => {
            router.push(`${pathname}${buildQuery(q, { brand: e.target.value || undefined })}`);
          }}
        >
          <option value="">Все бренды</option>
          {brands.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function FilterLink({
  pathname,
  search,
  patch,
  active,
  label
}: {
  pathname: string;
  search: string;
  patch: Record<string, string | undefined>;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={`${pathname}${buildQuery(search, patch)}`}
      className={`px-2.5 py-1.5 text-xs ${active ? "bg-paper text-ink-950" : "border border-white/10 text-mute"}`}
    >
      {label}
    </Link>
  );
}
