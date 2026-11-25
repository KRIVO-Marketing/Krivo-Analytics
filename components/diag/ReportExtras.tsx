"use client";
import type { DiagAsset, DiagFull, GoogleAssets } from "@/lib/diag/types";

const Badge = () => <span className="rpt-badge rpt-badge-full">Completo</span>;
const Item = ({ label, children }: { label?: string; children: React.ReactNode }) => (
  <div className="rpt-item">{label && <p className="rpt-label">{label}</p>}<div>{children}</div></div>
);
const FORMAT_LABEL: Record<string, string> = { video: "Reels", carousel: "Carrossel", image: "Foto" };
const PCT = (n: number) => `${Math.round(n * 100)}%`;

// Soluções prontas da análise de Instagram (vão no Essencial e no Completo).
export function InstaSolutions({ s }: { s: NonNullable<DiagFull["insta"]>["result"] }) {
  const sol = s?.solutions;
  if (!sol) return null;
  return (
    <section className="rpt-sec">
      <h2 className="rpt-h2">Instagram · Soluções prontas</h2>
      <Item label="Bio reescrita"><p className="rpt-p rpt-pre">{sol.bio_rewritten}</p></Item>
      <Item label="Cadência ideal"><p className="rpt-p">{sol.cadence}</p></Item>
      <Item label="Frase para gerar comentário"><p className="rpt-p">{sol.comment_hook}</p></Item>
      <Item label="CTA pronto"><p className="rpt-p">{sol.cta}</p></Item>
      {sol.post_ideas.map((x, i) => (
        <Item key={i} label={`Ideia de post ${i + 1} · ${x.format}`}><p className="rpt-strong">{x.first_line}</p><p className="rpt-p rpt-sm">{x.outline}</p></Item>
      ))}
    </section>
  );
}

export function InstaMetricCards({ m }: { m: NonNullable<DiagFull["insta"]>["metrics"] }) {
  if (!m) return null;
  const best = m.bestFormat ? FORMAT_LABEL[m.bestFormat] : null;
  const card = (label: string, value: string, sub?: string) => (
    <div className="rpt-card" key={label}><p className="rpt-label">{label}</p><p className="rpt-strong">{value}</p>{sub && <p className="rpt-muted">{sub}</p>}</div>
  );
  return (
    <div className="rpt-cards">
      {m.postsPerWeek != null && card("Posts por semana", m.postsPerWeek.toLocaleString("pt-BR"), m.windowDays ? `${m.sampleSize} posts em ${m.windowDays} dias` : undefined)}
      {m.engagementMedianPct != null && card("Engajamento típico", `${m.engagementMedianPct.toLocaleString("pt-BR")}%`, `média ${m.engagementMeanPct?.toLocaleString("pt-BR")}% · porte ${m.tier}`)}
      {best && card("Melhor formato", best, `Reels ${PCT(m.formats.video.share)} · Carrossel ${PCT(m.formats.carousel.share)} · Foto ${PCT(m.formats.image.share)}`)}
      {card("Legendas", `${Math.round(m.caption.hashtagRate * 100)}% com #`, `${Math.round(m.caption.questionRate * 100)}% com pergunta · ${Math.round(m.caption.ctaRate * 100)}% com CTA`)}
    </div>
  );
}

// ---------- só no relatório Completo ----------
export function InstaCompleto({ data }: { data: DiagFull }) {
  const assets: DiagAsset[] = data.assets ?? [];
  const of = (k: DiagAsset["kind"]) => assets.filter((a) => a.kind === k);
  const plan = of("plan_post"), bios = of("bio"), reels = of("reel"), msgs = of("sales_message");
  const weeks = [...new Set(plan.map((a) => a.payload.week as number))].sort((a, b) => a - b);
  const comps = data.insta?.result?.comparisons ?? [];
  return (
    <>
      {comps.length > 0 && (
        <section className="rpt-sec">
          <h2 className="rpt-h2">Comparação com concorrentes <Badge /></h2>
          {comps.map((c) => (
            <div key={c.username} className="rpt-panel">
              <p className="rpt-strong">@{c.username} <span className="rpt-muted">· {c.followers.toLocaleString("pt-BR")} seguidores</span></p>
              <Item label="Onde você está à frente"><p className="rpt-p rpt-sm">{c.you_ahead}</p></Item>
              <Item label={`Onde @${c.username} está à frente`}><p className="rpt-p rpt-sm">{c.them_ahead}</p></Item>
              <Item label="O que copiar"><ul className="rpt-list">{c.what_to_copy.map((x, i) => <li key={i}>{x}</li>)}</ul></Item>
            </div>
          ))}
        </section>
      )}
      {plan.length > 0 && (
        <section className="rpt-sec">
          <h2 className="rpt-h2">Plano de conteúdo · 13 semanas <Badge /></h2>
          {weeks.map((w) => {
            const wk = plan.filter((a) => a.payload.week === w);
            return (
              <div key={w} className="rpt-week">
                <h3 className="rpt-h3">Semana {w} · {wk[0]?.payload.theme}</h3>
                <p className="rpt-muted">{wk[0]?.payload.goal}</p>
                {wk.map((a) => (
                  <div key={a.id} className="rpt-post">
                    <p className="rpt-tag">{a.payload.day} · {a.payload.time} · {a.payload.format}</p>
                    <p className="rpt-strong">{a.payload.title}</p>
                    <p className="rpt-sm"><b>Gancho:</b> {a.payload.hook}</p>
                    <p className="rpt-sm rpt-pre"><b>Roteiro:</b> {a.payload.script}</p>
                    <p className="rpt-sm rpt-pre"><b>Legenda:</b> {a.payload.caption}</p>
                    {a.payload.hashtags?.length > 0 && <p className="rpt-tag">{a.payload.hashtags.join(" ")}</p>}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      )}
      {bios.length > 0 && (
        <section className="rpt-sec">
          <h2 className="rpt-h2">Bios prontas para colar <Badge /></h2>
          {bios.map((a) => <Item key={a.id} label={a.payload.angle}><p className="rpt-p rpt-pre">{a.payload.text}</p></Item>)}
        </section>
      )}
      {reels.length > 0 && (
        <section className="rpt-sec">
          <h2 className="rpt-h2">Reels prontos para gravar <Badge /></h2>
          {reels.map((a, i) => (
            <div key={a.id} className="rpt-post">
              <p className="rpt-tag">Reel {i + 1} · {a.payload.objective}</p>
              <p className="rpt-strong">{a.payload.title}</p>
              <ul className="rpt-list">{(a.payload.scenes ?? []).map((x: string, j: number) => <li key={j}>{x}</li>)}</ul>
              <p className="rpt-sm"><b>CTA:</b> {a.payload.cta}</p>
            </div>
          ))}
        </section>
      )}
      {msgs.length > 0 && (
        <section className="rpt-sec">
          <h2 className="rpt-h2">Mensagens que viram venda <Badge /></h2>
          {msgs.map((a) => <Item key={a.id} label={a.payload.channel}><p className="rpt-p rpt-pre">{a.payload.text}</p></Item>)}
        </section>
      )}
    </>
  );
}

export function GoogleCompleto({ x }: { x: GoogleAssets }) {
  return (
    <>
      <section className="rpt-sec">
        <h2 className="rpt-h2">Google Meu Negócio · Descrição pronta <Badge /></h2>
        <div className="rpt-panel"><p className="rpt-p rpt-pre" style={{ margin: 0 }}>{x.description}</p></div>
      </section>
      <section className="rpt-sec">
        <h2 className="rpt-h2">Ideias de posts para o Google <Badge /></h2>
        {x.posts.map((p, i) => (
          <div key={i} className="rpt-post">
            <p className="rpt-tag">{p.type} · botão “{p.button}”</p>
            <p className="rpt-strong">{p.title}</p>
            <p className="rpt-sm rpt-pre">{p.text}</p>
            <p className="rpt-muted">Foto: {p.photo}</p>
          </div>
        ))}
      </section>
      <section className="rpt-sec">
        <h2 className="rpt-h2">Fotos para subir na ficha <Badge /></h2>
        <ol className="rpt-list rpt-olist">{x.photos.map((p, i) => <li key={i}><b>{p.what}.</b> {p.tip}</li>)}</ol>
      </section>
      <section className="rpt-sec">
        <h2 className="rpt-h2">Como pedir e responder avaliações <Badge /></h2>
        {x.review_requests.map((r, i) => <Item key={`r${i}`} label={`Pedido de avaliação · ${r.channel}`}><p className="rpt-p rpt-pre">{r.text}</p></Item>)}
        {x.replies.map((r, i) => <Item key={`a${i}`} label={`Modelo de resposta · ${r.kind}`}><p className="rpt-p rpt-pre">{r.text}</p></Item>)}
      </section>
      {x.qa.length > 0 && (
        <section className="rpt-sec">
          <h2 className="rpt-h2">Perguntas e respostas da ficha <Badge /></h2>
          {x.qa.map((q, i) => <Item key={i} label={q.q}><p className="rpt-p">{q.a}</p></Item>)}
        </section>
      )}
    </>
  );
}
