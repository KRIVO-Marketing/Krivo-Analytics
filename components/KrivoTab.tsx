"use client";
import { useCallback, useEffect, useState } from "react";
import { getCached } from "@/lib/cache";
import { CACHE_KEYS, fetchProperties } from "@/lib/data";
import type { Property } from "@/lib/types";
import GoalCard from "./GoalCard";
import MetricsView from "./MetricsView";
import { ErrorBox } from "./ui";

export default function KrivoTab() {
  const [own, setOwn] = useState<Property | null>(() => getCached<Property[]>(CACHE_KEYS.properties)?.find((x) => x.kind === "own") ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => getCached<Property[]>(CACHE_KEYS.properties) === undefined);

  const load = useCallback(async (force = false) => {
    if (!own) setLoading(true);
    setError(null);
    try {
      const properties = await fetchProperties(force);
      setOwn(properties.find((x) => x.kind === "own") ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [own]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <GoalCard />
      {loading && !own && <div className="skeleton h-72" aria-busy="true" aria-label="Carregando" />}
      {error && !own && <ErrorBox message={error} onRetry={() => load(true)} />}
      {!loading && !error && !own && <div className="card p-8 text-center"><p className="text-lg">Nenhuma propriedade da KRIVO encontrada</p></div>}
      {own && <MetricsView propertyId={own.id} title="KRIVO" />}
    </div>
  );
}
