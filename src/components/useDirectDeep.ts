"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { DirectDeepPayload } from "@/lib/deep";

export function useDirectDeep() {
  const search = useSearchParams();
  const query = search.toString();
  const period = search.get("period") || "14d";
  const [data, setData] = useState<DirectDeepPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    const params = new URLSearchParams(query);
    if (!params.get("period")) params.set("period", period);
    fetch(`/api/direct-deep?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error || "Ошибка загрузки");
        return json as DirectDeepPayload;
      })
      .then((json) => {
        if (!dead) {
          setData(json);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!dead) setError(e.message);
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [query, period]);

  return { data, error, loading: loading && !data, refreshing: loading && Boolean(data) };
}
