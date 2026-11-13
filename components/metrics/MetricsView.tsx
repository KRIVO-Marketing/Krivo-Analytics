"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCached } from "@/lib/cache";
import { CACHE_KEYS, fetchMetrics } from "@/lib/data";
import { dec1, diaMes, hora, num } from "@/lib/format";
import { eventInfo, groupPages, isTechnicalEvent, pageLabel } from "@/lib/translate";
import type { Metrics } from "@/lib/types";
import LineChart, { type SeriesKey } from "../LineChart";
import { ErrorBox } from "../ui";
import { CampaignBreakdown } from "./CampaignBreakdown";
import { ChannelBreakdown } from "./ChannelBreakdown";
import { Change, MetricsDigest, MetricsSkeleton, Section, StatCard } from "./MetricsParts";
import { RealtimeBanner } from "./RealtimeBanner";

const PERIODS = [7, 14, 28, 90];
const CTA_HINT = "Defina o evento do botão no cadastro para acompanhar cliques";

export default function MetricsView({ propertyId, title }: { propertyId: string; title?: string }) {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<Metrics | null>(() => getCached<Metrics>(CACHE_KEYS.metrics(propertyId, 28)) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => getCached<Metrics>(CACHE_KEYS.metrics(propertyId, 28)) === undefined);
  const [series, setSeries] = useState<SeriesKey>("sessions");
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async (force = false) => {
    ctl.current?.abort();
    const cached = !force ? getCached<Metrics>(CACHE_KEYS.metrics(propertyId, days)) : undefined;
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    setError(null);
    if (!force) setData(null);
    try {
      const m = await fetchMetrics(propertyId, days, { force, signal: c.signal });
      if (!c.signal.aborted) setData(m);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [propertyId, days]);

  useEffect(() => {
    load();
    return () => ctl.current?.abort();
  }, [load]);

  const cta = data?.property.cta_event ?? null;
  const hasCta = !!data && data.totals.cta_clicks !== null;
  const empty = !!data && data.totals.sessions === 0 && data.totals.events === 0 && data.sources.length === 0;
  const pages = data ? groupPages(data.pages) : [];
  const valueEvents = data ? data.events.filter((ev) => ev.name === cta || !isTechnicalEvent(ev.name)) : [];
  const techEvents = data ? data.events.filter((ev) => ev.name !== cta && isTechnicalEvent(ev.name)) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl">{data?.property.name ?? title ?? "Métricas"}</h2>
          <p className="text-sm text-mute" aria-live="polite">
            {data ? `${diaMes(data.range.start)} a ${diaMes(data.range.end)} · atualizado às ${hora(data.generated_at)}` : loading ? "Carregando…" : " "}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div role="group" aria-label="Período" className="flex w-full overflow-hidden rounded-xl border border-line sm:inline-flex sm:w-auto">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                onClick={() => setDays(p)}
                className={`min-h-11 flex-1 px-3 text-sm sm:min-h-10 sm:flex-none ${
                  days === p ? "bg-[var(--btn)] font-medium text-[var(--btn-ink)]" : "hover:bg-accent-soft"
                }`}
              >
                {p} dias
              </button>
            ))}
          </div>
          <button type="button" className="btn w-full sm:w-auto" onClick={() => load(true)} disabled={loading}>
            {loading && data ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </div>

      <RealtimeBanner propertyId={propertyId} />

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}
      {loading && !data && !error && <MetricsSkeleton />}

      {data && empty && (
        <div className="card p-8 text-center">
          <p className="text-lg">Sem dados neste período</p>
          <p className="mt-1 text-mute">Escolha um período maior ou volte mais tarde.</p>
        </div>
      )}

      {data && !empty && (
        <>
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="grid grid-cols-2 gap-3 lg:col-span-6">
              <StatCard label="Visitantes" help="Pessoas únicas que acessaram o site." value={num(data.totals.users)} hero>
                <Change v={data.change_pct.users} />
              </StatCard>
              <StatCard label="Sessões" help={`${num(data.totals.pageviews)} visualizações de página no período.`} value={num(data.totals.sessions)}>
                <Change v={data.change_pct.sessions} />
              </StatCard>
              {hasCta ? (
                <>
                  <StatCard
                    label={data.property.cta_label ?? "Cliques no botão"}
                    help={data.totals.cta_users !== null ? `${num(data.totals.cta_users)} pessoas únicas clicaram.` : `Evento ${cta}.`}
                    value={num(data.totals.cta_clicks!)}
                    accent
                  >
                    <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-accent">
                      {data.totals.cta_users !== null ? `${num(data.totals.cta_users)} pessoas` : "cliques"}
                    </span>
                  </StatCard>
                  <StatCard label="Taxa de conversão" help="De cada 100 visitantes, quantos clicaram no botão principal." value={data.totals.cta_rate !== null ? `${dec1(data.totals.cta_rate)}%` : "–"} accent>
                    <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-xs font-medium text-mute">dos visitantes</span>
                  </StatCard>
                </>
              ) : (
                <>
                  <StatCard label="Páginas vistas" help="Total de páginas abertas em todas as visitas." value={num(data.totals.pageviews)}>
                    <Change v={data.change_pct.pageviews} />
                  </StatCard>
                  <div className="card flex items-center p-4">
                    <p className="text-xs sm:text-sm text-mute">{CTA_HINT}</p>
                  </div>
                </>
              )}
            </div>

            <div className="lg:col-span-6">
              <ChannelBreakdown sources={data.sources} hasCta={hasCta} />
            </div>
          </div>

          <Section
            title="Evolução por dia"
            sub="Passe o mouse (ou toque) para ver os números de cada dia."
            action={
              <div role="group" aria-label="Métrica do gráfico" className="flex w-full overflow-hidden rounded-xl border border-line bg-[var(--surface-2)] p-0.5 text-sm sm:inline-flex sm:w-auto">
                {([["sessions", "Sessões"], ["users", "Visitantes"], ["pageviews", "Páginas vistas"]] as [SeriesKey, string][]).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={series === k}
                    onClick={() => setSeries(k)}
                    className={`min-h-10 flex-1 rounded-lg px-2.5 text-xs font-medium transition sm:min-h-8 sm:flex-none sm:px-3 ${
                      series === k ? "bg-[var(--card)] text-ink shadow-sm" : "text-mute hover:text-ink"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            }
          >
            <LineChart daily={data.daily} series={series} />
          </Section>

          <MetricsDigest data={data} />

          <CampaignBreakdown
            campaigns={data.campaigns ?? []}
            ctaLabel={data.property.cta_label ?? "cliques"}
            hasCta={hasCta}
          />

          {data.funnel.length > 0 && (
            <Section title="Do acesso ao clique" sub="Quantas pessoas chegaram em cada etapa da visita.">
              <ol className="space-y-3">
                {data.funnel.map((f) => {
                  const base = data.funnel[0].users || 1;
                  const pct = Math.min(100, (f.users / base) * 100);
                  const isCta = f.key === "cta";
                  return (
                    <li key={f.key}>
                      <div className="mb-1 flex flex-wrap justify-between gap-x-2 text-sm">
                        <span>{isCta && data.property.cta_label ? `Clicaram em "${data.property.cta_label}"` : f.label}</span>
                        <span>
                          <b className={isCta ? "text-accent" : ""}>{num(f.users)} pessoas</b>{" "}
                          <span className="text-mute">· {dec1(pct)}% dos visitantes</span>
                        </span>
                      </div>
                      <div className="h-3 rounded-r-full bg-[var(--grid)]" aria-hidden>
                        <div className="h-3 rounded-r-full" style={{ width: `${Math.max(pct, 1)}%`, background: isCta ? "var(--accent)" : "var(--chart-line)" }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Páginas mais acessadas" sub="URLs limpas e agrupadas por caminho.">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th">Página</th>
                    <th className="th text-right">Vezes aberta</th>
                    <th className="th hidden text-right sm:table-cell">Visitantes</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr key={p.path}>
                      <td className="td break-all">
                        {pageLabel(p.path)}
                        {pageLabel(p.path) !== p.path && <span className="block text-xs text-mute">{p.path}</span>}
                      </td>
                      <td className="td text-right">
                        {num(p.views)}
                        <span className="block text-xs text-mute sm:hidden">{num(p.users)} pessoas</span>
                      </td>
                      <td className="td hidden text-right sm:table-cell">{num(p.users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="Ações de valor no site" sub="Interações reais, sem ruído técnico do GA4.">
              {valueEvents.length === 0 ? (
                <p className="text-sm text-mute">Nenhuma ação de intenção registrada neste período.</p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="th">Ação</th>
                      <th className="th text-right">Vezes</th>
                      <th className="th hidden text-right sm:table-cell">Visitantes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valueEvents.map((ev) => {
                      const isCta = !!cta && ev.name === cta;
                      return (
                        <tr key={ev.name} className={isCta ? "bg-accent-soft" : ""}>
                          <td className="td break-all">
                            <span className={isCta ? "font-medium text-accent" : ""}>
                              {isCta ? data.property.cta_label ?? "Clique no botão" : eventInfo(ev.name).label}
                            </span>
                            {isCta && <span className="ml-2 rounded-full border border-accent px-2 py-0.5 text-xs text-accent">botão principal</span>}
                            {eventInfo(ev.name).hint && !isCta && (
                              <span className="block text-xs text-mute">{eventInfo(ev.name).hint}</span>
                            )}
                          </td>
                          <td className="td text-right">
                            {num(ev.count)}
                            <span className="block text-xs text-mute sm:hidden">{num(ev.users)} pessoas</span>
                          </td>
                          <td className="td hidden text-right sm:table-cell">{num(ev.users)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {techEvents.length > 0 && (
                <details className="mt-3 text-xs text-mute">
                  <summary className="cursor-pointer">Eventos técnicos do GA4 ({techEvents.length})</summary>
                  <ul className="mt-2 space-y-1 border-t border-line pt-2">
                    {techEvents.map((ev) => (
                      <li key={ev.name} className="flex justify-between gap-2">
                        <span>{eventInfo(ev.name).label} ({ev.name})</span>
                        <span>{num(ev.count)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
