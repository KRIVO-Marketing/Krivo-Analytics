"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchContacts } from "@/lib/data";
import {
  DIM_ORDER, GOALS, PAINS, instaAnalyze, instaCompare, instaDelete, instaGenerate, instaGet, instaList, scoreTone,
  type Asset, type AnalysisDetail, type InstaListItem,
} from "@/lib/insta/types";
import type { Contact } from "@/lib/ops";
import AiLoader from "../AiLoader";
import { EmptyState, FormError } from "../opsui";
import { ErrorBox } from "../ui";

const ddmmyy = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const FORMAT_LABEL: Record<string, string> = { video: "Reels", carousel: "Carrossel", image: "Foto" };

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* sem permissão de área de transferência */ } }}>
      {done ? "Copiado ✓" : label}
    </button>
  );
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm"><span className="font-medium text-ink">{label}</span><span className="tabular-nums text-mute">{score}/{max}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-mute">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-xs text-mute">{sub}</p>}
    </div>
  );
}

// ---------- material gerado (plano, bios, Reels, mensagens) ----------
function AssetList({ title, kind, assets, busy, onGenerate }: {
  title: string; kind: Asset["kind"]; assets: Asset[]; busy: boolean; onGenerate: () => void;
}) {
  const items = assets.filter((a) => a.kind === kind);
  const textOf = (a: Asset) => {
    const p = a.payload;
    if (kind === "plan_post") return `${p.title}\n\nGancho: ${p.hook}\n\nRoteiro: ${p.script}\n\nLegenda: ${p.caption}\n\n${(p.hashtags ?? []).join(" ")}`;
    if (kind === "reel") return `${p.title}\n${p.objective}\n\n${(p.scenes ?? []).join("\n")}\n\nCTA: ${p.cta}`;
    return p.text;
  };
  const weeks = kind === "plan_post" ? [...new Set(items.map((a) => a.payload.week as number))] : [];
  const row = (a: Asset) => (
    <li key={a.id} className="rounded-lg border border-line p-3">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between">
        <div className="min-w-0 w-full flex-1 sm:w-auto">
          {kind === "plan_post" && <p className="text-xs text-mute">{a.payload.day} · {a.payload.time} · {a.payload.format}</p>}
          {kind === "bio" && <p className="text-xs uppercase tracking-wider text-mute">{a.payload.angle}</p>}
          {kind === "sales_message" && <p className="text-xs uppercase tracking-wider text-mute">{a.payload.channel}</p>}
          <p className="whitespace-pre-wrap text-sm text-ink">{kind === "plan_post" || kind === "reel" ? <b>{a.payload.title}</b> : a.payload.text}</p>
          {kind === "plan_post" && (<>
            <p className="mt-1 text-sm text-mute"><b className="text-ink">Gancho:</b> {a.payload.hook}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-mute"><b className="text-ink">Roteiro:</b> {a.payload.script}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-mute"><b className="text-ink">Legenda:</b> {a.payload.caption}</p>
            <p className="mt-1 text-xs text-mute">{(a.payload.hashtags ?? []).join(" ")}</p>
          </>)}
          {kind === "reel" && (<>
            <p className="text-sm text-mute">{a.payload.objective}</p>
            <ul className="mt-1 space-y-0.5 text-sm text-mute">{(a.payload.scenes ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
            <p className="mt-1 text-sm text-ink"><b>CTA:</b> {a.payload.cta}</p>
          </>)}
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={textOf(a)} />
        </div>
      </div>
    </li>
  );
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">{title}{items.length ? ` · ${items.length}` : ""}</h3>
        <button type="button" className="btn" onClick={onGenerate} disabled={busy}>{busy ? "Gerando…" : items.length ? "Gerar de novo" : "Gerar"}</button>
      </div>
      {busy && <AiLoader compact title="A IA está escrevendo… (até 1 min)" />}
      {!items.length && !busy && <p className="mt-2 text-sm text-mute">Ainda não gerado. Clique em Gerar para a IA montar com base no diagnóstico.</p>}
      {kind === "plan_post"
        ? weeks.map((w) => {
          const wk = items.filter((a) => a.payload.week === w);
          return (
            <details key={w} className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">Semana {w} · {wk[0]?.payload.theme}</summary>
              <p className="mt-1 text-xs text-mute">{wk[0]?.payload.goal}</p>
              <ul className="mt-2 space-y-2">{wk.map(row)}</ul>
            </details>
          );
        })
        : <ul className="mt-3 space-y-2">{items.map(row)}</ul>}
    </section>
  );
}

// ---------- detalhe de uma análise ----------
function Detail({ detail, onBack, onChange, onDeleted }: { detail: AnalysisDetail; onBack: () => void; onChange: (d: AnalysisDetail) => void; onDeleted: () => void }) {
  const { analysis: a, profile, snapshot } = detail;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cmp, setCmp] = useState("");
  const raw = snapshot?.raw;
  const m = a.metrics;
  const r = a.result;

  const generate = async (group: "plan" | "bios" | "reels" | "messages") => {
    setBusy(group); setErr(null);
    try {
      const res = await instaGenerate(a.id, group);
      onChange({ ...detail, assets: [...detail.assets.filter((x) => x.kind !== res.kind), ...res.assets] });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const compare = async () => {
    if (!cmp.trim()) return;
    setBusy("cmp"); setErr(null);
    try {
      const res = await instaCompare(a.id, cmp);
      const others = (r?.comparisons ?? []).filter((c) => c.username !== res.comparison.username);
      onChange({ ...detail, analysis: { ...a, result: { ...(r as NonNullable<typeof r>), comparisons: [...others, res.comparison] } } });
      setCmp("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!window.confirm(`Excluir @${profile.username} e todas as análises dele? Não dá para desfazer.`)) return;
    setBusy("del");
    try { await instaDelete(profile.id); onDeleted(); } catch (e) { setErr((e as Error).message); setBusy(null); }
  };

  if (a.status !== "ready" || !m || !r || !a.dimensions) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn" onClick={onBack}>← Voltar</button>
        <ErrorBox message={a.status === "failed" ? a.error ?? "A análise falhou." : "Análise ainda em andamento."} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn" onClick={onBack}>← Voltar</button>
        <button type="button" className="btn btn-danger" onClick={remove} disabled={busy === "del"}>Excluir perfil</button>
      </div>
      <FormError message={err} />

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-5">
          <div className="text-center">
            <p className={`text-6xl font-semibold tabular-nums ${scoreTone(a.total_score ?? 0)}`}>{a.total_score}</p>
            <p className="text-xs text-mute">de 100</p>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-ink">@{profile.username}{raw?.fullName ? ` · ${raw.fullName}` : ""}</h2>
            <p className="text-sm text-mute">
              {raw ? `${raw.followers.toLocaleString("pt-BR")} seguidores · ${raw.postsCount} posts · ` : ""}analisado em {ddmmyy(a.finished_at ?? a.created_at)}
              {profile.is_internal ? " · KRIVO (interno)" : ""}
            </p>
            {r.share_verdict && <p className="mt-1 font-medium text-ink">{r.share_verdict}</p>}
            <p className="mt-2 text-sm text-ink">{r.summary}</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Posts por semana" value={m.postsPerWeek === null ? "—" : String(m.postsPerWeek).replace(".", ",")} sub={`${m.sampleSize} posts em ${m.windowDays ?? "—"} dias`} />
        <Metric label="Engajamento típico" value={m.engagementMedianPct === null ? "—" : `${String(m.engagementMedianPct).replace(".", ",")}%`} sub={`média ${String(m.engagementMeanPct ?? "—").replace(".", ",")}% · porte ${m.tier}`} />
        <Metric label="Melhor formato" value={m.bestFormat ? FORMAT_LABEL[m.bestFormat] : "—"} sub={`Reels ${m.formats.video.share}% · Carrossel ${m.formats.carousel.share}% · Foto ${m.formats.image.share}%`} />
        <Metric label="Legendas" value={`${m.caption.hashtagRate}% com #`} sub={`${m.caption.questionRate}% com pergunta · ${m.caption.ctaRate}% com CTA`} />
      </section>
      {m.outlierShare >= 60 && <p className="rounded-lg bg-[var(--surface-2)] p-3 text-sm text-mute">Atenção: {m.outlierShare}% das interações vêm de só 2 posts, então a taxa de engajamento pode estar inflada.</p>}

      <section className="card space-y-4 p-5">
        <h3 className="text-base font-semibold text-ink">As 5 dimensões da nota</h3>
        {DIM_ORDER.map((k) => {
          const d = a.dimensions![k];
          return (
            <details key={k} className="group">
              <summary className="cursor-pointer list-none"><ScoreBar label={d.label} score={d.score} max={d.max} /></summary>
              <div className="mt-2 space-y-2 text-sm">
                <p className="text-ink">{d.feedback}</p>
                <ul className="list-disc space-y-1 pl-5 text-mute">{d.positives.map((t, i) => <li key={i}><span className="text-pos">✓</span> {t}</li>)}</ul>
                <ul className="list-disc space-y-1 pl-5 text-mute">{d.improvements.map((t, i) => <li key={i}><span className="text-accent">↑</span> {t}</li>)}</ul>
              </div>
            </details>
          );
        })}
      </section>

      <section className="card p-5">
        <h3 className="text-base font-semibold text-ink">O que fazer agora</h3>
        <ol className="mt-3 space-y-3">
          {r.recommendations.map((x, i) => (
            <li key={i} className="rounded-lg border border-line p-3">
              <p className="text-xs uppercase tracking-wider text-mute">Prioridade {x.priority === "media" ? "média" : x.priority}</p>
              <p className="font-medium text-ink">{x.title}</p>
              <p className="text-sm text-mute">{x.description}</p>
              <p className="mt-1 text-sm text-ink"><b>Impacto esperado:</b> {x.impact}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card space-y-3 p-5">
        <h3 className="text-base font-semibold text-ink">Soluções prontas</h3>
        {[
          ["Bio reescrita", r.solutions.bio_rewritten], ["Cadência ideal", r.solutions.cadence],
          ["Frase para gerar comentário", r.solutions.comment_hook], ["CTA pronto", r.solutions.cta],
        ].filter(([, t]) => t).map(([label, text]) => (
          <div key={label} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-3">
            <div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-wider text-mute">{label}</p><p className="whitespace-pre-wrap text-sm text-ink">{text}</p></div>
            <CopyButton text={text} />
          </div>
        ))}
        {r.solutions.post_ideas.map((p, i) => (
          <div key={i} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-3">
            <div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-wider text-mute">Ideia de post {i + 1} · {p.format}</p><p className="text-sm font-medium text-ink">{p.first_line}</p><p className="text-sm text-mute">{p.outline}</p></div>
            <CopyButton text={`${p.first_line}\n\n${p.outline}`} />
          </div>
        ))}
      </section>

      <section className="card space-y-3 p-5">
        <h3 className="text-base font-semibold text-ink">Você vs. concorrentes</h3>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void compare(); }}>
          <input className="field !w-auto min-w-48 flex-1" placeholder="@concorrente" value={cmp} onChange={(e) => setCmp(e.target.value)} aria-label="@ do concorrente" maxLength={60} />
          <button className="btn" disabled={busy === "cmp" || !cmp.trim()}>{busy === "cmp" ? "Analisando…" : "Comparar"}</button>
        </form>
        {busy === "cmp" && <AiLoader compact title="Comparando com o concorrente… (até 1 min)" />}
        {(r.comparisons ?? []).map((c) => (
          <div key={c.username} className="space-y-2 rounded-lg border border-line p-3 text-sm">
            <p className="font-medium text-ink">@{c.username} · {c.followers.toLocaleString("pt-BR")} seguidores · {c.stats.cadence.competitor ?? "—"} posts/sem (você {c.stats.cadence.user ?? "—"})</p>
            <p><b className="text-ink">Onde você está à frente:</b> <span className="text-mute">{c.you_ahead}</span></p>
            <p><b className="text-ink">Onde ele está à frente:</b> <span className="text-mute">{c.them_ahead}</span></p>
            <ul className="list-disc space-y-1 pl-5 text-mute">{c.what_to_copy.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        ))}
      </section>

      <AssetList title="Plano de conteúdo · 13 semanas" kind="plan_post" assets={detail.assets} busy={busy === "plan"} onGenerate={() => generate("plan")} />
      <AssetList title="Bios prontas" kind="bio" assets={detail.assets} busy={busy === "bios"} onGenerate={() => generate("bios")} />
      <AssetList title="Reels prontos para gravar" kind="reel" assets={detail.assets} busy={busy === "reels"} onGenerate={() => generate("reels")} />
      <AssetList title="Mensagens que viram venda" kind="sales_message" assets={detail.assets} busy={busy === "messages"} onGenerate={() => generate("messages")} />
    </div>
  );
}

// ---------- aba ----------
export default function InstaTab() {
  const [profiles, setProfiles] = useState<InstaListItem[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [username, setUsername] = useState("");
  const [contactId, setContactId] = useState("");
  const [internal, setInternal] = useState(false);
  const [goal, setGoal] = useState("");
  const [pain, setPain] = useState("");
  const [running, setRunning] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setProfiles(await instaList()); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); fetchContacts().then(setContacts).catch(() => undefined); }, [load]);

  const open = async (analysisId: string) => {
    try { setDetail(await instaGet(analysisId)); } catch (e) { setError((e as Error).message); }
  };
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true); setFormErr(null);
    try {
      const d = await instaAnalyze({ username, contact_id: internal ? null : contactId || null, is_internal: internal, goal: goal || null, pain: pain || null });
      setUsername(""); setDetail(d); void load();
    } catch (err) { setFormErr((err as Error).message); void load(); } finally { setRunning(false); }
  };

  if (detail) return <Detail detail={detail} onBack={() => { setDetail(null); void load(); }} onChange={setDetail} onDeleted={() => { setDetail(null); void load(); }} />;

  return (
    <div className="space-y-4">
      <form onSubmit={run} className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold text-ink">Analisar um perfil de Instagram</h2>
        <p className="text-sm text-mute">Informe o @ de um perfil público. A análise busca os últimos posts, calcula as métricas e gera nota, diagnóstico e plano. Leva cerca de 1 minuto.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label" htmlFor="ig-user">@ do Instagram</label><input id="ig-user" className="field" placeholder="@krivo.mkt" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={80} required /></div>
          <div>
            <label className="label" htmlFor="ig-client">Cliente (opcional)</label>
            <select id="ig-client" className="field" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={internal}>
              <option value="">— sem vínculo —</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ""}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="ig-goal">Objetivo</label><select id="ig-goal" className="field" value={goal} onChange={(e) => setGoal(e.target.value)}><option value="">— não informado —</option>{GOALS.map((g) => <option key={g}>{g}</option>)}</select></div>
          <div><label className="label" htmlFor="ig-pain">Maior dor hoje</label><select id="ig-pain" className="field" value={pain} onChange={(e) => setPain(e.target.value)}><option value="">— não informada —</option>{PAINS.map((g) => <option key={g}>{g}</option>)}</select></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> É o perfil da própria KRIVO (uso interno)</label>
        <FormError message={formErr} />
        <button className="btn btn-primary" disabled={running || !username.trim()}>{running ? "Analisando…" : "Analisar perfil"}</button>
        {running && <AiLoader title="Analisando o perfil do Instagram…" tips={["Buscando bio, seguidores e os últimos posts públicos.", "Calculando cadência, engajamento e mix de formatos em código.", "A IA dá a nota de 0 a 20 em cada dimensão e escreve o diagnóstico.", "Leva cerca de 1 minuto. Não feche esta aba."]} />}
      </form>

      {error && <ErrorBox message={error} onRetry={load} />}
      {profiles === null && !error && <p className="text-sm text-mute">Carregando…</p>}
      {profiles && !profiles.length && <EmptyState title="Nenhum perfil analisado ainda" hint="Digite um @ acima para fazer a primeira análise." />}
      {profiles && profiles.length > 0 && (
        <section className="card p-2">
          <ul>
            {profiles.map((p) => {
              const last = p.analyses.find((x) => x.status === "ready");
              const prev = p.analyses.filter((x) => x.status === "ready")[1];
              const delta = last && prev && last.total_score !== null && prev.total_score !== null ? last.total_score - prev.total_score : null;
              return (
                <li key={p.id}>
                  <button type="button" disabled={!last} onClick={() => last && void open(last.id)} className="flex w-full items-center justify-between gap-3 rounded-lg p-3 text-left transition hover:bg-[var(--surface-2)] disabled:opacity-60">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">@{p.username}{p.is_internal ? " · KRIVO" : ""}</p>
                      <p className="truncate text-xs text-mute">{p.contact_name ?? (p.is_internal ? "Uso interno" : "Sem cliente vinculado")} · {p.analyses.filter((x) => x.status === "ready").length} análise(s) · {last ? ddmmyy(last.created_at) : p.analyses[0]?.status === "failed" ? "última falhou" : "sem análise pronta"}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-semibold tabular-nums ${last?.total_score != null ? scoreTone(last.total_score) : "text-mute"}`}>{last?.total_score ?? "—"}</p>
                      {delta !== null && <p className={`text-xs tabular-nums ${delta >= 0 ? "text-pos" : "text-neg"}`}>{delta >= 0 ? "+" : ""}{delta} vs. anterior</p>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
