"use client";
import { useState } from "react";
import { dec1, num } from "@/lib/format";
import { groupChannels } from "@/lib/translate";
import type { Metrics } from "@/lib/types";
import { Section } from "./MetricsParts";

export function ChannelBreakdown({ sources, hasCta }: { sources: Metrics["sources"]; hasCta: boolean }) {
  const channels = groupChannels(sources);
  const [expanded, setExpanded] = useState<string | null>(null);
  const maxSessions = channels[0]?.sessions || 1;

  return (
    <Section
      title="De onde vieram e o que converteu"
      sub={hasCta ? "Canais agrupados com visitas, cliques no botão e taxa de conversão." : "Canais agrupados por origem de acesso."}
    >
      {channels.length === 0 ? (
        <p className="text-mute">Sem origens neste período.</p>
      ) : (
        <ul className="divide-y divide-[var(--grid)]">
          {channels.map((ch) => {
            const hasDetails = ch.items.length > 1;
            const isOpen = expanded === ch.label;
            return (
              <li key={ch.label} className="py-3 first:pt-1 last:pb-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{ch.label}</span>
                      {!hasDetails && ch.items[0] && ch.label !== "Direto" && (
                        <span className="text-xs text-mute">· {ch.items[0].detail}</span>
                      )}
                      {hasDetails && (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : ch.label)}
                          className="rounded-md bg-[var(--grid)] px-2 py-0.5 text-xs text-mute transition hover:text-ink"
                        >
                          {isOpen ? "Ocultar origens ▲" : `${ch.items.length} origens ▼`}
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--grid)]" aria-hidden>
                      <div className="h-1.5 rounded-full bg-soft" style={{ width: `${Math.max(3, (ch.sessions / maxSessions) * 100)}%` }} />
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3 text-right">
                    <div>
                      <span className="block text-sm font-medium">{num(ch.sessions)}</span>
                      <span className="block text-xs text-mute">{dec1(ch.share)}%</span>
                    </div>
                    {hasCta && (
                      <div className="min-w-[4.5rem]">
                        <span className="block text-sm font-medium text-accent">
                          {ch.cta_clicks === null ? "–" : `${num(ch.cta_clicks)} ${ch.cta_clicks === 1 ? "clique" : "cliques"}`}
                        </span>
                        <span className="block text-xs text-mute">
                          {ch.conversionRate !== null ? `${dec1(ch.conversionRate)}% conv.` : "–"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {hasDetails && isOpen && (
                  <ul className="mt-2.5 space-y-1.5 border-l-2 border-line pl-3">
                    {ch.items.map((it) => (
                      <li key={it.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-mute">{it.detail}</span>
                        <span className="flex items-center gap-3">
                          <span>{num(it.sessions)} visitas</span>
                          {hasCta && (
                            <span className="font-medium text-accent">
                              {it.cta_clicks ?? 0} cl. ({it.conversionRate !== null ? `${dec1(it.conversionRate)}%` : "–"})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
