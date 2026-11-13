"use client";
import { dec1, ddmm, num } from "@/lib/format";
import { buildInsights } from "@/lib/insights";
import type { Metrics } from "@/lib/types";

export function Change({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-xs text-mute">sem comparação</span>;
  if (v === 0) return <span className="inline-flex items-center rounded-full bg-[var(--grid)] px-2.5 py-0.5 text-xs font-medium text-mute">0,0%</span>;
  const up = v > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
        up ? "bg-[var(--pos-soft)] text-pos" : "bg-[var(--neg-soft)] text-neg"
      }`}
    >
      {up ? "+" : "−"}
      {dec1(Math.abs(v))}%
      <span className="sr-only">{up ? ", alta vs. anterior" : ", queda vs. anterior"}</span>
    </span>
  );
}

export function StatCard({
  label,
  help,
  value,
  children,
  accent,
  hero,
  icon,
}: {
  label: string;
  help: string;
  value: string;
  children: React.ReactNode;
  accent?: boolean;
  hero?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className={`${hero ? "card-hero" : "card"} flex flex-col justify-between p-4 sm:p-5`}>
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${
            hero ? "bg-white/20 text-white" : "bg-[var(--surface-2)] text-ink"
          }`}
          aria-hidden
        >
          {icon ?? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="m19 9-5 5-4-4-3 3" />
            </svg>
          )}
        </span>
        <div>{children}</div>
      </div>

      <div className="mt-4">
        <p className={`text-xs font-medium ${hero ? "text-white/80" : "text-mute"}`}>{label}</p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <p className={`text-2xl sm:text-3xl font-semibold tracking-tight ${hero ? "text-white" : accent ? "text-accent" : "text-ink"}`}>
            {value}
          </p>
        </div>
        <p className={`mt-1.5 hidden text-xs leading-snug sm:block ${hero ? "text-white/75" : "text-mute"}`}>{help}</p>
      </div>
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

export function MetricsDigest({ data }: { data: Metrics }) {
  const items = buildInsights(data);
  const top = items.slice(0, 2);
  const rest = items.slice(2);
  const best = data.daily.reduce((b, d) => (d.sessions > b.sessions ? d : b), data.daily[0]);
  const mark = {
    good: ["✓", "text-pos", "border-l-pos"],
    warn: ["!", "text-neg", "border-l-neg"],
    info: ["i", "text-mute", "border-l-line"],
  } as const;

  if (items.length === 0) return null;

  return (
    <Section title="Leitura rápida" sub="Principais sinais do período, sem repetição.">
      <ul className="grid gap-3 lg:grid-cols-2">
        {top.map((it, i) => (
          <li key={i} className={`rounded-xl border border-line border-l-4 p-3 ${mark[it.tone][2]}`}>
            <p className="font-medium">
              <span aria-hidden className={`mr-2 ${mark[it.tone][1]}`}>{mark[it.tone][0]}</span>
              {it.title}
            </p>
            <p className="mt-1 text-sm text-mute">{it.text}</p>
          </li>
        ))}
      </ul>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-mute">
          {rest.length > 0 ? `Ver mais ${rest.length} sinais e glossário` : "Como ler estes números"}
        </summary>
        <div className="mt-3 space-y-3">
          {rest.length > 0 && (
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {rest.map((it, i) => (
                <li key={i} className={`rounded-xl border border-line border-l-4 p-3 ${mark[it.tone][2]}`}>
                  <p className="font-medium">
                    <span aria-hidden className={`mr-2 ${mark[it.tone][1]}`}>{mark[it.tone][0]}</span>
                    {it.title}
                  </p>
                  <p className="mt-1 text-sm text-mute">{it.text}</p>
                </li>
              ))}
            </ul>
          )}
          {best && best.sessions > 0 && (
            <p className="text-mute">
              Pico de movimento: <b className="font-medium text-ink">{ddmm(best.date)}</b> ({num(best.sessions)} visitas).
            </p>
          )}
          <dl className="space-y-1 text-mute">
            <div><dt className="inline font-medium text-ink">Visitante: </dt><dd className="inline">pessoa única contabilizada no período.</dd></div>
            <div><dt className="inline font-medium text-ink">Sessão: </dt><dd className="inline">cada visita ao site (a mesma pessoa pode gerar várias).</dd></div>
            <div><dt className="inline font-medium text-ink">Taxa de conversão: </dt><dd className="inline">quantos de cada 100 visitantes clicaram no botão principal.</dd></div>
          </dl>
        </div>
      </details>
    </Section>
  );
}
