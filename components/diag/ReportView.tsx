"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { PILLAR_LABELS, scoreColor, scoreLabel, type DiagFull, type PillarKey } from "@/lib/diag/types";

type Dim = { label: string; score: number; max: number; feedback: string; positives: string[]; improvements: string[] };
const PRIO: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const EFFORT: Record<string, string> = { baixo: "esforço baixo", medio: "esforço médio", alto: "esforço alto" };
const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const NAVY = "#232f52";

function Ring({ score, size = 140 }: { score: number; size?: number }) {
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Nota ${score} de 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8eaf0" strokeWidth="10" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(score)} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c * 0.75} ${c}`} transform={`rotate(135 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.3} fontWeight="700" fill="#1a2138">{score}</text>
      <text x="50%" y="66%" textAnchor="middle" fontSize="11" fill="#8a90a2">de 100</text>
    </svg>
  );
}

// Radar de N dimensões (0 a max), igual ao do relatório de referência.
function Radar({ dims }: { dims: Dim[] }) {
  const W = 420, H = 300, cx = W / 2, cy = 150, R = 85, n = dims.length;
  const pt = (i: number, f: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f] as const; };
  const poly = (f: number) => dims.map((_, i) => pt(i, f).join(",")).join(" ");
  const shape = dims.map((d, i) => pt(i, Math.max(0.04, d.score / d.max)).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rpt-radar" role="img" aria-label="Pontuação por dimensão">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={poly(f)} fill={f === 1 ? "#f6f7fb" : "none"} stroke="#e3e6ee" />)}
      {dims.map((_, i) => <line key={i} x1={cx} y1={cy} x2={pt(i, 1)[0]} y2={pt(i, 1)[1]} stroke="#e3e6ee" />)}
      <polygon points={shape} fill="rgba(255,90,40,0.85)" stroke={NAVY} strokeWidth="2" />
      {dims.map((d, i) => { const [x, y] = pt(i, Math.max(0.04, d.score / d.max)); return <circle key={i} cx={x} cy={y} r="3.5" fill={NAVY} />; })}
      {dims.map((d, i) => {
        const [x, y] = pt(i, 1.32);
        const anchor = x < cx - 8 ? "end" : x > cx + 8 ? "start" : "middle";
        return (<g key={d.label}><text x={x} y={y - 3} textAnchor={anchor} fontSize="11" fontWeight="700" fill="#1a2138">{d.label.split(" & ")[0]}</text><text x={x} y={y + 11} textAnchor={anchor} fontSize="10" fill="#8a90a2">{d.score} / {d.max}</text></g>);
      })}
    </svg>
  );
}

function Pillar({ n, k, score, summary, dims, facts, extra }: { n: number; k: PillarKey; score: number; summary: string; dims: Dim[]; facts: React.ReactNode; extra?: React.ReactNode }) {
  const ranked = [...dims].sort((a, b) => b.score / b.max - a.score / a.max);
  return (
    <>
      <section className="rpt-page" id={`pilar-${k}`}>
        <h2 className="rpt-h2">{n}. {PILLAR_LABELS[k]} <span className="rpt-score" style={{ color: scoreColor(score) }}>{score}/100 · {scoreLabel(score)}</span></h2>
        <p className="rpt-p">{summary}</p>
        <div className="rpt-facts">{facts}</div>
        <Radar dims={dims} />
        <p className="rpt-caption">Pontuação por dimensão, escala de 0 a 20</p>
        <div className="rpt-panel">
          <p className="rpt-label">Ranking das dimensões</p>
          {ranked.map((d) => (
            <div key={d.label} className="rpt-rank"><span>{d.label}</span><div className="rpt-track"><i style={{ width: `${(d.score / d.max) * 100}%`, background: scoreColor((d.score / d.max) * 100) }} /></div><b style={{ color: scoreColor((d.score / d.max) * 100) }}>{d.score}/{d.max}</b></div>
          ))}
        </div>
      </section>
      <section className="rpt-page">
        <h2 className="rpt-h2">Dimensões avaliadas · {PILLAR_LABELS[k]}</h2>
        {dims.map((d) => (
          <div key={d.label} className="rpt-dimcard">
            <div className="rpt-dimhead"><h3>{d.label}</h3><b style={{ color: scoreColor((d.score / d.max) * 100) }}>{d.score}/{d.max}</b></div>
            <div className="rpt-track"><i style={{ width: `${(d.score / d.max) * 100}%`, background: scoreColor((d.score / d.max) * 100) }} /></div>
            <p className="rpt-muted">{d.feedback}</p>
            <ul className="rpt-dots">
              {d.positives.map((x, i) => <li key={`p${i}`} data-t="pos">{x}</li>)}
              {d.improvements.map((x, i) => <li key={`i${i}`} data-t="imp">{x}</li>)}
            </ul>
          </div>
        ))}
        {extra}
      </section>
    </>
  );
}

export default function ReportView({ data, onClose, warnings = [] }: { data: DiagFull; onClose: () => void; warnings?: string[] }) {
  const { report: d, insta } = data;
  const rep = d.report;
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `Diagnóstico KRIVO - ${d.business_name}`; // vira o nome do arquivo ao salvar em PDF
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("rpt-open");
    return () => { document.title = prevTitle; document.removeEventListener("keydown", onKey); document.body.classList.remove("rpt-open"); };
  }, [d.business_name, onClose]);
  if (!rep) return null;
  const g = d.google;
  const igDims: Dim[] = insta ? Object.values(insta.dimensions) : [];
  const gDims: Dim[] = g ? Object.values(g.dimensions) : [];
  const all = [...igDims.map((x) => ({ ...x, k: "instagram" as PillarKey })), ...gDims.map((x) => ({ ...x, k: "google" as PillarKey }))];
  const pct = (x: Dim) => x.score / x.max;
  const best = all.length ? [...all].sort((a, b) => pct(b) - pct(a))[0] : null;
  const worst = all.length ? [...all].sort((a, b) => pct(a) - pct(b))[0] : null;
  const niche = insta?.result?.niche || g?.result.niche || g?.place?.category || "";
  const pillars = (Object.keys(d.pillar_scores ?? {}) as PillarKey[]);
  const when = dateBR(d.finished_at ?? d.created_at);
  let n = 2; // 1 = resumo
  const nIg = insta ? ++n : 0;
  const nG = g ? ++n : 0;
  const nPrio = ++n;
  const toc = [
    ["resumo", "Resumo e nota por pilar"], ...(insta ? [["pilar-instagram", "Instagram"]] : []), ...(g ? [["pilar-google", "Google Meu Negócio"]] : []),
    ["prioridades", "O que fazer agora"],
  ];

  return createPortal(
    <div className="rpt-root" role="dialog" aria-modal="true" aria-label={`Diagnóstico de ${d.business_name}`}>
      <div className="rpt-top no-print">
        <button type="button" className="btn" onClick={onClose}>← Voltar</button>
        <p>Para salvar em PDF, escolha “Salvar como PDF” na janela de impressão.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Baixar PDF</button>
      </div>
      {warnings.length > 0 && <div className="rpt-warn no-print" role="alert"><b>Parte do relatório ficou de fora:</b> {warnings.join(" · ")} Volte e gere de novo para incluir.</div>}
      <article className="rpt">
        <section className="rpt-page rpt-cover">
          <p className="rpt-brand">KRIVO DIAGNÓSTICO</p>
          <h1>Diagnóstico de Presença Digital</h1>
          <i className="rpt-rule" />
          <div className="rpt-who">
            <span className="rpt-avatar" aria-hidden>{d.business_name.slice(0, 1).toUpperCase()}</span>
            <div><p className="rpt-name">{d.business_name}</p><p className="rpt-muted">{[d.instagram_username && `@${d.instagram_username}`, g?.place?.city].filter(Boolean).join(" · ")}</p></div>
          </div>
          <div className="rpt-hero">
            <div className="rpt-ring"><Ring score={d.overall_score ?? 0} /><p style={{ color: scoreColor(d.overall_score ?? 0) }}>{rep.verdict}</p></div>
            <div className="rpt-exec">
              <p className="rpt-label">Resumo executivo</p>
              {niche && <><p className="rpt-label2"><i style={{ background: NAVY }} /> Nicho</p><p className="rpt-strong">{niche}</p></>}
              {best && <><p className="rpt-label2"><i style={{ background: "#2f8f4e" }} /> Ponto mais forte</p><p className="rpt-strong">{best.label} · {best.score}/{best.max} <span className="rpt-muted">({PILLAR_LABELS[best.k]})</span></p></>}
              {worst && <><p className="rpt-label2"><i style={{ background: "#b83a3a" }} /> Ponto a desenvolver</p><p className="rpt-strong">{worst.label} · {worst.score}/{worst.max} <span className="rpt-muted">({PILLAR_LABELS[worst.k]})</span></p></>}
            </div>
          </div>
          <dl className="rpt-meta">
            <dt>Data da análise</dt><dd>{when}</dd>
            <dt>Pilares analisados</dt><dd>{pillars.map((k) => PILLAR_LABELS[k]).join(" · ")}</dd>
            <dt>Desenvolvido por</dt><dd>KRIVO®</dd>
          </dl>
        </section>

        <section className="rpt-page">
          <h2 className="rpt-h2">Conteúdo deste relatório</h2>
          <ol className="rpt-toc">{toc.map(([id, label]) => <li key={id}><a href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }}>{label}</a></li>)}</ol>
          <h2 className="rpt-h2" id="resumo" style={{ marginTop: 36 }}>1. Resumo e nota por pilar</h2>
          <p className="rpt-p">{rep.summary}</p>
          <div className="rpt-cards">
            {pillars.map((k) => { const s = d.pillar_scores?.[k] ?? 0; return (
              <div key={k} className="rpt-card"><p className="rpt-label">{PILLAR_LABELS[k]}</p><p className="rpt-big" style={{ color: scoreColor(s) }}>{s}<small>/100</small></p><p className="rpt-muted">{scoreLabel(s)}</p></div>
            ); })}
          </div>
          <h3 className="rpt-h3">Principais problemas</h3>
          <ol className="rpt-problems">
            {rep.top_problems.map((p, i) => (
              <li key={i}><span className="rpt-num">{i + 1}</span><div><p className="rpt-label">{PILLAR_LABELS[p.pillar]}</p><p className="rpt-strong">{p.title}</p><p className="rpt-muted">{p.detail}</p></div></li>
            ))}
          </ol>
        </section>

        {insta && <Pillar n={nIg} k="instagram" score={insta.total_score} summary={insta.result?.summary ?? ""} dims={igDims}
          facts={<>
            {insta.metrics?.followers != null && <span><b>{insta.metrics.followers.toLocaleString("pt-BR")}</b> seguidores</span>}
            {insta.metrics?.postsPerWeek != null && <span><b>{insta.metrics.postsPerWeek.toLocaleString("pt-BR")}</b> posts por semana</span>}
            {insta.metrics?.engagementMedianPct != null && <span><b>{insta.metrics.engagementMedianPct.toLocaleString("pt-BR")}%</b> de engajamento (mediana)</span>}
          </>} />}
        {g && <Pillar n={nG} k="google" score={g.total_score} summary={g.result.summary} dims={gDims}
          facts={<>
            {g.metrics.rating != null && <span><b>{g.metrics.rating.toLocaleString("pt-BR")}</b> de nota</span>}
            <span><b>{g.metrics.reviewsCount.toLocaleString("pt-BR")}</b> avaliações</span>
            {g.metrics.repliedShare != null && <span><b>{g.metrics.repliedShare}%</b> respondidas</span>}
            <span><b>{g.metrics.photosCount.toLocaleString("pt-BR")}</b> fotos</span>
            {g.metrics.negativeUnanswered > 0 && <span><b>{g.metrics.negativeUnanswered}</b> negativas sem resposta</span>}
          </>}
          extra={<>
            {g.result.reviews_insight && <div className="rpt-panel"><p className="rpt-label">O que os clientes dizem</p><p className="rpt-p" style={{ margin: 0 }}>{g.result.reviews_insight}</p></div>}
            {g.result.reply_examples.length > 0 && <div className="rpt-panel"><p className="rpt-label">Como responder às avaliações</p>
              {g.result.reply_examples.map((x, i) => <div key={i} className="rpt-quote"><p><b>Avaliação:</b> “{x.review}”</p><p><b>Sugestão de resposta:</b> {x.suggested_reply}</p></div>)}</div>}
          </>} />}

        <section className="rpt-page" id="prioridades">
          <h2 className="rpt-h2">{nPrio}. O que fazer agora</h2>
          <p className="rpt-muted">Em ordem: comece pelo topo.</p>
          {rep.priorities.map((p, i) => (
            <div key={i} className="rpt-prio" data-p={p.priority}>
              <h3><span className="rpt-badge" data-p={p.priority}>{PRIO[p.priority]}</span> {p.title}</h3>
              <p className="rpt-tag">{PILLAR_LABELS[p.pillar]} · {EFFORT[p.effort]}</p>
              <p className="rpt-p">{p.action}</p>
              <p className="rpt-muted"><b>Impacto esperado:</b> {p.impact}</p>
            </div>
          ))}
          <p className="rpt-note">Base da análise: dados públicos do Instagram (até 12 posts do feed) e da ficha do Google (avaliações mais recentes e respostas do dono) no momento da análise, em {when}. Stories, visualizações de Reels, salvamentos e compartilhamentos não são acessíveis e não entram na nota.</p>
        </section>
      </article>
    </div>,
    document.body,
  );
}
