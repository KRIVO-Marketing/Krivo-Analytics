"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRead } from "@/lib/api";
import type { Property } from "@/lib/types";
import MetricsView from "./MetricsView";
import { ErrorBox } from "./ui";

export default function KrivoTab() {
  const [own, setOwn] = useState<Property | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { properties } = await apiRead<{ properties: Property[] }>({ action: "list" });
      const p = properties.find((x) => x.kind === "own") ?? null;
      setOwn(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="skeleton h-72" aria-busy="true" aria-label="Carregando" />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!own) return <div className="card p-8 text-center"><p className="text-lg">Nenhuma propriedade da KRIVO encontrada</p></div>;
  return <MetricsView propertyId={own.id} title="KRIVO" />;
}
