import { dec1, num } from "@/lib/format";
import { sourceInfo } from "@/lib/translate";
import type { CampaignMetric } from "@/lib/types";
import { Section } from "./MetricsParts";

function formatCampaignName(raw: string): string {
  if (!raw || raw === "(not set)") return "Sem campanha definida";
  return raw.replace(/[-_]+/g, " ");
}

export function CampaignBreakdown({
  campaigns,
  ctaLabel,
  hasCta,
}: {
  campaigns: CampaignMetric[];
  ctaLabel: string;
  hasCta: boolean;
}) {
  const max = campaigns[0]?.sessions || 1;

  return (
    <Section
      title="Campanhas e Links (UTM)"
      sub="Separa links específicos — ex.: Bio do Murilo vs. Bio da KRIVO, posts do LinkedIn ou campanhas."
    >
      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-bg/50 p-4 text-sm text-mute">
          <p className="font-medium text-ink">Nenhum link com UTM registrado neste período.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Para separar cada origem exata (ex.: <code className="rounded bg-accent-soft px-1 py-0.5 text-ink">utm_campaign=bio-murilo</code> vs.{" "}
            <code className="rounded bg-accent-soft px-1 py-0.5 text-ink">bio-krivo</code>), use parâmetros UTM nos links da bio e dos posts.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {campaigns.map((c) => {
            const src = sourceInfo(c.source, c.medium);
            const conv = hasCta && c.sessions > 0 && c.cta_clicks !== null ? (c.cta_clicks / c.sessions) * 100 : null;
            const key = `${c.campaign}|${c.source}|${c.medium}|${c.content ?? ""}`;

            return (
              <li key={key} className="rounded-xl border border-line/70 bg-bg/40 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{formatCampaignName(c.campaign)}</span>
                    {c.content && (
                      <span className="ml-1.5 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-ink">
                        {c.content}
                      </span>
                    )}
                    <span className="ml-2 text-xs text-mute">· {src.label}</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2.5 tabular-nums text-xs sm:text-sm">
                    <span className="font-medium text-ink">{num(c.sessions)} sessões</span>
                    <span className="text-mute">{dec1(c.share)}%</span>
                    {hasCta && c.cta_clicks !== null && (
                      <span className="font-medium text-accent">
                        {num(c.cta_clicks)} {ctaLabel.toLowerCase()}
                        {conv !== null && <span className="ml-1 text-xs font-normal text-mute">({dec1(conv)}%)</span>}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-accent-soft">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max((c.sessions / max) * 100, 3)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
