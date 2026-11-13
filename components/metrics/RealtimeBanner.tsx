"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRealtime } from "@/lib/data";
import { hora, num } from "@/lib/format";
import { eventInfo } from "@/lib/translate";
import type { RealtimeMetrics } from "@/lib/types";

const REFRESH_MS = 60_000;

export function RealtimeBanner({ propertyId }: { propertyId: string }) {
  const [rt, setRt] = useState<RealtimeMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchRealtime(propertyId, c.signal);
      if (!c.signal.aborted) setRt(res);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(id);
      ctl.current?.abort();
    };
  }, [load]);

  const active = rt?.active_users ?? 0;
  const hasDetails = !!rt && (rt.pages.length > 0 || rt.top_events.length > 0);

  return (
    <div className="card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              active > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-300 dark:bg-slate-600"
            }`}
          />
          <div>
            <p className="text-sm font-medium leading-snug">
              {loading && !rt ? (
                "Verificando atividade ao vivo…"
              ) : err && !rt ? (
                "Tempo real indisponível agora"
              ) : active === 0 ? (
                "Ninguém ativo nos últimos 30 min"
              ) : (
                <>
                  <span className="tabular-nums font-semibold">{num(active)}</span>{" "}
                  {active === 1 ? "pessoa online agora" : "pessoas online agora"}
                </>
              )}
            </p>
            <p className="text-xs text-mute">
              {rt
                ? `Últimos ${rt.window_minutes} min · ${num(rt.pageviews)} páginas vistas · ${num(rt.events)} eventos · ${hora(rt.generated_at)}`
                : err ?? "Atualiza automaticamente a cada minuto"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-mute hover:bg-accent-soft hover:text-ink disabled:opacity-50"
        >
          {loading ? "Atualizando…" : "Atualizar ao vivo"}
        </button>
      </div>

      {hasDetails && (
        <details className="mt-2.5 border-t border-line pt-2.5 text-xs">
          <summary className="cursor-pointer font-medium text-mute hover:text-ink">
            Ver páginas e eventos em tempo real
          </summary>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            {rt.pages.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium text-ink">Páginas sendo vistas</p>
                <ul className="space-y-1">
                  {rt.pages.map((p) => (
                    <li key={p.title} className="flex items-center justify-between gap-2 text-mute">
                      <span className="truncate">{p.title === "(not set)" ? "Página inicial / sem título" : p.title}</span>
                      <span className="shrink-0 tabular-nums font-medium text-ink">
                        {num(p.users)} {p.users === 1 ? "pessoa" : "pessoas"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rt.top_events.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium text-ink">Eventos recentes (30 min)</p>
                <ul className="space-y-1">
                  {rt.top_events.map((ev) => {
                    const info = eventInfo(ev.name);
                    return (
                      <li key={ev.name} className="flex items-center justify-between gap-2 text-mute">
                        <span className="truncate">{info.label}</span>
                        <span className="shrink-0 tabular-nums font-medium text-ink">{num(ev.count)}×</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
