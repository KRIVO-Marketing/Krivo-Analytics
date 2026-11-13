"use client";
import { dec1, ddmm, num } from "@/lib/format";
import { buildInsights } from "@/lib/insights";
import { pageLabel, sourceInfo } from "@/lib/translate";
import type { Metrics } from "@/lib/types";

export function Change({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-xs sm:text-sm text-mute">sem comparação</span>;
  if (v === 0) return <span className="text-xs sm:text-sm text-mute">= 0,0%</span>;
  const up = v > 0;
  return (
    <span className={`text-xs sm:text-sm font-normal ${up ? "text-pos" : "text-neg"}`}>
      <span aria-hidden>{up ? "▲" : "▼"} </span>
      {up ? "+" : "−"}
      {dec1(Math.abs(v))}%
      <span className="hidden text-mute sm:inline"> vs. período anterior</span>
      <span className="sr-only">{up ? ", alta" : ", queda"}</span>
    </span>
  );
}

export function StatCard({ label, help, value, children, accent }: { label: string; help: string; value: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className="card flex flex-col justify-between p-3.5 sm:p-4">
      <div>
        <p className="text-xs sm:text-sm font-normal text-mute">{label}</p>
        <p className={`mt-1 text-2xl sm:text-3xl font-semibold tracking-tight ${accent ? "text-accent" : ""}`}>{value}</p>
        <div className="mt-1">{children}</div>
      </div>
      <p className="mt-2 hidden text-xs leading-snug text-mute sm:block">{help}</p>
    </div>
  );
}

export function MetricsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando métricas" className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 sm:h-28" />)}
      </div>
      <div className="skeleton h-72" />
      <div className="skeleton h-40" />
    </div>
  );
}

export function Section({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
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

export function MetricsInsights({ data }: { data: Metrics }) {
  const items = buildInsights(data);
  if (items.length === 0) return null;
  const mark = {
    good: ["✓", "text-pos", "border-l-pos"],
    warn: ["!", "text-neg", "border-l-neg"],
    info: ["i", "text-mute", "border-l-line"],
  } as const;
  return (
    <Section title="O que isso significa" sub="Leitura dos números, em poucas palavras.">
      <ul className="grid gap-3 lg:grid-cols-2">
        {items.map((it, i) => (
          <li key={i} className={`rounded-xl border border-line border-l-4 p-3 ${mark[it.tone][2]}`}>
            <p className="font-medium">
              <span aria-hidden className={`mr-2 ${mark[it.tone][1]}`}>{mark[it.tone][0]}</span>
              {it.title}
            </p>
            <p className="mt-1 text-sm text-mute">{it.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function MetricsSummary({ data }: { data: Metrics }) {
  const t = data.totals;
  const top = data.sources[0];
  const topPage = data.pages[0];
  const best = data.daily.reduce((b, d) => (d.sessions > b.sessions ? d : b), data.daily[0]);
  const chg = data.change_pct.sessions;
  return (
    <section className="card border-l-4 border-l-[var(--accent)] p-4" aria-label="Resumo do período">
      <h2 className="mb-2 text-lg">Resumo dos últimos {data.days} dias</h2>
      <ul className="space-y-1.5 text-[0.9375rem]">
        <li>
          O site teve <b>{num(t.sessions)} visitas</b> de <b>{num(t.users)} pessoas</b>
          {chg !== null && (
            <>
              , <b className={chg >= 0 ? "text-pos" : "text-neg"}>{chg >= 0 ? "▲ " : "▼ "}{chg >= 0 ? "+" : "−"}{dec1(Math.abs(chg))}%</b> em relação ao período anterior
            </>
          )}.
        </li>
        {t.cta_clicks !== null && t.cta_rate !== null && (
          <li>
            <b className="text-accent">
              {num(t.cta_users ?? t.cta_clicks)} {(t.cta_users ?? t.cta_clicks) === 1 ? "pessoa clicou" : "pessoas clicaram"}{" "}
              {data.property.cta_label ? `em "${data.property.cta_label}"` : "no botão principal"}
            </b>{" "}
            ({dec1(t.cta_rate)}% dos visitantes).
          </li>
        )}
        {top && (
          <li>
            A principal origem foi <b>{sourceInfo(top.source, top.medium).label}</b> ({sourceInfo(top.source, top.medium).detail}), com {dec1(top.share)}% das visitas.
          </li>
        )}
        {topPage && (
          <li>
            A página mais aberta foi <b>{pageLabel(topPage.path)}</b>, com {num(topPage.views)} visualizações.
          </li>
        )}
        {best && best.sessions > 0 && (
          <li>
            O dia de maior movimento foi <b>{ddmm(best.date)}</b>, com {num(best.sessions)} visitas.
          </li>
        )}
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
