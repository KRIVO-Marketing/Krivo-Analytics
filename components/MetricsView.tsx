"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCached } from "@/lib/cache";
import { CACHE_KEYS, fetchMetrics } from "@/lib/data";
import { dec1, ddmm, diaMes, hora, num } from "@/lib/format";
import type { Metrics } from "@/lib/types";
import { buildInsights } from "@/lib/insights";
import { eventInfo, pageLabel, sourceInfo } from "@/lib/translate";
import LineChart, { type SeriesKey } from "./LineChart";
import { ErrorBox } from "./ui";

const PERIODS = [7, 14, 28, 90];
const CTA_HINT = "Defina o evento do botão no cadastro para acompanhar cliques";

function Change({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-sm text-mute">sem base de comparação</span>;
  if (v === 0) return <span className="text-sm text-mute">= 0,0% vs. período anterior</span>;
  const up = v > 0;
  return (
    <span className={`text-sm font-normal ${up ? "text-pos" : "text-neg"}`}>
      <span aria-hidden>{up ? "▲" : "▼"} </span>
      {up ? "+" : "−"}{dec1(Math.abs(v))}%
      <span className="text-mute"> vs. período anterior</span>
      <span className="sr-only">{up ? ", alta" : ", queda"}</span>
    </span>
  );
}

function StatCard({ label, help, value, children, accent }: { label: string; help: string; value: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-sm font-normal">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${accent ? "text-accent" : ""}`}>{value}</p>
      <div className="mt-1">{children}</div>
      <p className="mt-2 text-xs leading-snug text-mute">{help}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando métricas" className="space-y-4">
      <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}
      </div>
      <div className="skeleton h-72" />
      <div className="skeleton h-40" />
    </div>
  );
}

function Section({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg">{title}</h2>
          {sub && <p className="text-sm text-mute">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}


function Insights({ data }: { data: Metrics }) {
  const items = buildInsights(data);
  if (items.length === 0) return null;
  const mark = { good: ["✓", "text-pos", "border-l-pos"], warn: ["!", "text-neg", "border-l-neg"], info: ["i", "text-mute", "border-l-line"] } as const;
  return (
    <Section title="O que isso significa" sub="Leitura dos números, em poucas palavras.">
      <ul className="grid gap-3 lg:grid-cols-2">
        {items.map((it, i) => (
          <li key={i} className={`rounded-xl border border-line border-l-4 p-3 ${mark[it.tone][2]}`}>
            <p className="font-medium"><span aria-hidden className={`mr-2 ${mark[it.tone][1]}`}>{mark[it.tone][0]}</span>{it.title}</p>
            <p className="mt-1 text-sm text-mute">{it.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Summary({ data }: { data: Metrics }) {
  const t = data.totals;
  const top = data.sources[0];
  const topPage = data.pages[0];
  const best = data.daily.reduce((b, d) => (d.sessions > b.sessions ? d : b), data.daily[0]);
  const chg = data.change_pct.sessions;
  return (
    <section className="card border-l-4 border-l-[var(--accent)] p-4" aria-label="Resumo do período">
      <h2 className="mb-2 text-lg">Resumo dos últimos {data.days} dias</h2>
      <ul className="space-y-1.5 text-[0.9375rem]">
        <li>O site teve <b>{num(t.sessions)} visitas</b> de <b>{num(t.users)} pessoas</b>
          {chg !== null && <>, <b className={chg >= 0 ? "text-pos" : "text-neg"}>{chg >= 0 ? "▲ " : "▼ "}{chg >= 0 ? "+" : "−"}{dec1(Math.abs(chg))}%</b> em relação ao período anterior</>}.</li>
        {t.cta_clicks !== null && t.cta_rate !== null && (
          <li><b className="text-accent">{num(t.cta_users ?? t.cta_clicks)} {(t.cta_users ?? t.cta_clicks) === 1 ? "pessoa clicou" : "pessoas clicaram"} {data.property.cta_label ? `em "${data.property.cta_label}"` : "no botão principal"}</b> ({dec1(t.cta_rate)}% dos visitantes).</li>
        )}
        {top && <li>A principal origem foi <b>{sourceInfo(top.source, top.medium).label}</b> ({sourceInfo(top.source, top.medium).detail}), com {dec1(top.share)}% das visitas.</li>}
        {topPage && <li>A página mais aberta foi <b>{pageLabel(topPage.path)}</b>, com {num(topPage.views)} visualizações.</li>}
        {best && best.sessions > 0 && <li>O dia de maior movimento foi <b>{ddmm(best.date)}</b>, com {num(best.sessions)} visitas.</li>}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-mute">Como ler estes números</summary>
        <dl className="mt-2 space-y-1.5 text-mute">
          <div><dt className="inline font-medium text-ink">Sessão: </dt><dd className="inline">uma visita ao site, do momento em que a pessoa entra até sair.</dd></div>
          <div><dt className="inline font-medium text-ink">Visitante: </dt><dd className="inline">uma pessoa (ou aparelho), contada uma vez mesmo que volte várias vezes.</dd></div>
          <div><dt className="inline font-medium text-ink">Visualização de página: </dt><dd className="inline">cada página aberta. Quem navega por 3 páginas gera 3.</dd></div>
          <div><dt className="inline font-medium text-ink">Taxa de clique: </dt><dd className="inline">de cada 100 visitantes, quantos clicaram no botão principal.</dd></div>
          <div><dt className="inline font-medium text-ink">Período anterior: </dt><dd className="inline">os mesmos {data.days} dias imediatamente antes, usados para comparar.</dd></div>
        </dl>
      </details>
    </section>
  );
}

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

  useEffect(() => { load(); return () => ctl.current?.abort(); }, [load]);

  const cta = data?.property.cta_event ?? null;
  const hasCta = !!data && data.totals.cta_clicks !== null;
  const empty = !!data && data.totals.sessions === 0 && data.totals.events === 0 && data.sources.length === 0;

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
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}
                className={`min-h-11 flex-1 px-3 text-sm sm:min-h-10 sm:flex-none ${days === p ? "bg-[var(--btn)] font-medium text-[var(--btn-ink)]" : "hover:bg-accent-soft"}`}>
                {p} dias
              </button>
            ))}
          </div>
          <button type="button" className="btn w-full sm:w-auto" onClick={() => load(true)} disabled={loading}>
            {loading && data ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}
      {loading && !data && !error && <Skeleton />}

      {data && empty && (
        <div className="card p-8 text-center">
          <p className="text-lg">Sem dados neste período</p>
          <p className="mt-1 text-mute">Escolha um período maior ou volte mais tarde.</p>
        </div>
      )}

      {data && !empty && (
        <>
          <Summary data={data} />
          <Insights data={data} />

          <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Sessões" help="Quantas vezes o site foi acessado. A mesma pessoa pode gerar várias." value={num(data.totals.sessions)}><Change v={data.change_pct.sessions} /></StatCard>
            <StatCard label="Visitantes" help="Quantas pessoas diferentes visitaram o site." value={num(data.totals.users)}><Change v={data.change_pct.users} /></StatCard>
            <StatCard label="Visualizações de página" help="Quantas páginas foram abertas, somando todas as visitas." value={num(data.totals.pageviews)}><Change v={data.change_pct.pageviews} /></StatCard>
            {hasCta ? (
              <StatCard label={data.property.cta_label ?? "Cliques no botão"} help={`Pessoas que clicaram${data.property.cta_label ? "" : " no botão principal"} (${data.totals.cta_users !== null ? num(data.totals.cta_users) + " pessoas" : "evento " + cta}). É o clique, não o resultado final.`} value={num(data.totals.cta_clicks!)} accent>
                <span className="text-sm text-mute">
                  {data.totals.cta_rate !== null && <><b className="text-accent">{dec1(data.totals.cta_rate)}%</b> dos visitantes clicaram</>}
                </span>
              </StatCard>
            ) : (
              <div className="card flex items-center p-4"><p className="text-sm text-mute">{CTA_HINT}</p></div>
            )}
          </div>

          <Section
            title="Evolução por dia"
            sub={`Passe o mouse (ou toque) para ver os números de cada dia.`}
            action={
              <div role="group" aria-label="Métrica do gráfico" className="flex w-full overflow-hidden rounded-xl border border-line text-sm sm:inline-flex sm:w-auto">
                {([["sessions", "Sessões"], ["users", "Visitantes"], ["pageviews", "Páginas vistas"]] as [SeriesKey, string][]).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={series === k} onClick={() => setSeries(k)}
                    className={`min-h-11 flex-1 px-2 sm:min-h-9 sm:flex-none sm:px-3 ${series === k ? "bg-[var(--btn)] font-medium text-[var(--btn-ink)]" : "hover:bg-accent-soft"}`}>{l}</button>
                ))}
              </div>
            }
          >
            <LineChart daily={data.daily} series={series} />
          </Section>

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
                        <span><b className={isCta ? "text-accent" : ""}>{num(f.users)} pessoas</b> <span className="text-mute">· {dec1(pct)}% dos visitantes</span></span>
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

          <Section title="De onde vieram os visitantes" sub="Por qual caminho as pessoas chegaram ao site.">
            {data.sources.length === 0 ? <p className="text-mute">Sem origens neste período.</p> : (
              <table className="w-full border-collapse">
                <thead><tr>
                  <th className="th">Origem</th><th className="th text-right">Sessões</th><th className="th hidden text-right sm:table-cell">%</th>
                  {hasCta && <th className="th text-right text-accent">Cliques<span className="hidden sm:inline"> no botão</span></th>}
                </tr></thead>
                <tbody>
                  {data.sources.map((s, i) => {
                    const maxS = data.sources[0].sessions || 1;
                    return (
                      <tr key={i}>
                        <td className="td min-w-0 break-words">
                          <b className="font-medium">{sourceInfo(s.source, s.medium).label}</b> <span className="text-mute">· {sourceInfo(s.source, s.medium).detail}</span>
                          <div className="mt-1.5 h-1.5 rounded-r-full bg-[var(--grid)]" aria-hidden>
                            <div className="h-1.5 rounded-r-full bg-soft" style={{ width: `${(s.sessions / maxS) * 100}%` }} />
                          </div>
                        </td>
                        <td className="td text-right">{num(s.sessions)}<span className="block text-xs text-mute sm:hidden">{dec1(s.share)}%</span></td>
                        <td className="td hidden text-right sm:table-cell">{dec1(s.share)}%</td>
                        {hasCta && <td className="td text-right font-medium text-accent">{s.cta_clicks === null ? "–" : num(s.cta_clicks)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Páginas mais vistas" sub="O que as pessoas mais abriram no site.">
              <table className="w-full border-collapse">
                <thead><tr><th className="th">Página</th><th className="th text-right">Vezes aberta</th><th className="th hidden text-right sm:table-cell">Visitantes</th></tr></thead>
                <tbody>
                  {data.pages.map((p, i) => (
                    <tr key={i}><td className="td break-all">{pageLabel(p.path)}{pageLabel(p.path) !== p.path && <span className="block text-xs text-mute">{p.path}</span>}</td><td className="td text-right">{num(p.views)}<span className="block text-xs text-mute sm:hidden">{num(p.users)} pessoas</span></td><td className="td hidden text-right sm:table-cell">{num(p.users)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="O que as pessoas fizeram" sub="Ações registradas no site, com o nome técnico em cinza.">
              <table className="w-full border-collapse">
                <thead><tr><th className="th">Ação</th><th className="th text-right">Vezes</th><th className="th hidden text-right sm:table-cell">Visitantes</th></tr></thead>
                <tbody>
                  {data.events.map((ev, i) => {
                    const isCta = !!cta && ev.name === cta;
                    return (
                      <tr key={i} className={isCta ? "bg-accent-soft" : ""}>
                        <td className="td break-all">
                          <span className={isCta ? "font-medium text-accent" : ""}>{isCta ? (data.property.cta_label ?? "Clique no botão") : eventInfo(ev.name).label}</span>
                          {isCta && <span className="ml-2 rounded-full border border-accent px-2 py-0.5 text-xs text-accent">botão principal</span>}
                          <span className="block text-xs text-mute">{ev.name}{eventInfo(ev.name).hint && !isCta ? ` · ${eventInfo(ev.name).hint}` : ""}</span>
                        </td>
                        <td className="td text-right">{num(ev.count)}<span className="block text-xs text-mute sm:hidden">{num(ev.users)} pessoas</span></td><td className="td hidden text-right sm:table-cell">{num(ev.users)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
