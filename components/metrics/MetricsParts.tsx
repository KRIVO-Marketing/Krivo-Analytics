"use client";
import { dec1, ddmm, num } from "@/lib/format";
import { buildInsights } from "@/lib/insights";
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
