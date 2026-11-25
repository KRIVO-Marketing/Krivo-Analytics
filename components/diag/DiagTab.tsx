"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchContacts } from "@/lib/data";
import { PILLAR_LABELS, diagDelete, diagGet, diagList, runDiagnostic, scoreColor, TIER_LABEL, type DiagBrief, type DiagFull, type PillarKey, type Tier } from "@/lib/diag/types";
import type { Contact } from "@/lib/ops";
import AiLoader from "../AiLoader";
import { EmptyState, FormError } from "../opsui";
import { ErrorBox } from "../ui";
import ReportView from "./ReportView";

const ddmmyy = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

// Etapas reais do diagnóstico; a etapa atual vem do texto que o runDiagnostic informa.
function DiagProgress({ step, hasInsta, hasGoogle, tier, nComp }: { step: string; hasInsta: boolean; hasGoogle: boolean; tier: Tier; nComp: number }) {
  const full = tier === "completo";
  const list = [
    hasInsta && { key: "Instagram…", label: "Analisando o Instagram" },
    hasGoogle && { key: "Google Meu Negócio", label: "Analisando o Google Meu Negócio e as avaliações" },
    full && hasInsta && { key: "Plano de conteúdo", label: "Plano de conteúdo de 13 semanas" },
    full && hasInsta && { key: "Bios prontas", label: "Bios prontas" },
    full && hasInsta && { key: "Reels", label: "Reels prontos para gravar" },
    full && hasInsta && { key: "Mensagens", label: "Mensagens que viram venda" },
    full && hasInsta && nComp > 0 && { key: "Comparando", label: "Comparação com concorrentes" },
    full && hasGoogle && { key: "pacote do Google", label: "Ideias de posts e pacote do Google" },
    { key: "Montando", label: "Montando o relatório" },
  ].filter(Boolean) as { key: string; label: string }[];
  const found = list.findIndex((x) => step.includes(x.key));
  const idx = Math.max(0, found);
  const waiting = step.includes("limite") ? "A IA atingiu o limite de uso por minuto. Aguardando para continuar automaticamente, sem perder o que já foi feito." : null;
  return (
    <AiLoader title="Gerando o diagnóstico…" steps={list.map((x) => x.label)} current={idx} note={waiting}
      tips={[full ? "O relatório Completo leva de 6 a 10 minutos: são várias gerações de IA." : "Cada diagnóstico leva de 2 a 3 minutos.", "Os números (nota, % de respostas, posts por semana) são calculados em código.", "A IA escreve o texto e a ordem de prioridades.", "Não feche esta aba."]} />
  );
}

export default function DiagTab() {
  const [list, setList] = useState<DiagBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [business, setBusiness] = useState("");
  const [contactId, setContactId] = useState("");
  const [insta, setInsta] = useState("");
  const [google, setGoogle] = useState("");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tier, setTier] = useState<Tier>("essencial");
  const [comp, setComp] = useState("");
  const [view, setView] = useState<DiagFull | null>(null);

  const load = useCallback(async () => {
    try { setList(await diagList()); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); fetchContacts().then(setContacts).catch(() => undefined); }, [load]);

  const pickContact = (id: string) => {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c) {
      if (!business.trim()) setBusiness(c.company || c.name);
      if (!insta.trim() && (c as { instagram?: string | null }).instagram) setInsta(String((c as { instagram?: string | null }).instagram));
    }
  };

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true); setFormErr(null); setWarnings([]);
    try {
      const { full, warnings: w } = await runDiagnostic({ business_name: business, contact_id: contactId || null, instagram_username: insta.trim(), google_input: google.trim(), tier, competitors: tier === "completo" ? comp.split(/[,\s]+/).filter(Boolean).slice(0, 2) : [] }, setStep);
      setWarnings(w); setView(full); setBusiness(""); setInsta(""); setGoogle(""); setContactId(""); setComp("");
    } catch (err) { setFormErr((err as Error).message); } finally { setRunning(false); setStep(""); void load(); }
  };
  const open = async (id: string) => {
    try { setWarnings([]); setView(await diagGet(id)); } catch (e) { setError((e as Error).message); }
  };
  const closeView = useCallback(() => setView(null), []);
  const remove = async (b: DiagBrief) => {
    if (!window.confirm(`Excluir o diagnóstico de ${b.business_name}?`)) return;
    try { await diagDelete(b.id); void load(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={run} className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold text-ink">Gerar um KRIVO Diagnóstico</h2>
        <p className="text-sm text-mute">Cole o Instagram e o link do Google Meu Negócio do cliente. A IA analisa os dois (incluindo as respostas às avaliações) e monta o relatório padrão, com nota por pilar, principais problemas e prioridades, pronto para baixar em PDF. Leva de 2 a 3 minutos.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label" htmlFor="dg-name">Nome da empresa</label><input id="dg-name" className="field" value={business} onChange={(e) => setBusiness(e.target.value)} maxLength={120} required /></div>
          <div>
            <label className="label" htmlFor="dg-client">Cliente (opcional)</label>
            <select id="dg-client" className="field" value={contactId} onChange={(e) => pickContact(e.target.value)}>
              <option value="">— sem vínculo —</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ""}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="dg-ig">Instagram (@ ou link)</label><input id="dg-ig" className="field" placeholder="@empresa ou instagram.com/empresa" value={insta} onChange={(e) => setInsta(e.target.value)} maxLength={120} /></div>
          <div><label className="label" htmlFor="dg-g">Google Meu Negócio (link do Maps, ou nome + cidade)</label><input id="dg-g" className="field" placeholder="https://maps.app.goo.gl/… ou Padaria Pão Quente, Curitiba" value={google} onChange={(e) => setGoogle(e.target.value)} maxLength={400} /></div>
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-2" disabled={running}>
          <legend className="label">Tipo de relatório</legend>
          {([["essencial", "Essencial · R$ 14,90", "Nota por pilar, problemas e prioridades do Instagram e do Google, com soluções prontas. 2 a 3 min."], ["completo", "Completo", "Tudo do Essencial + plano de 13 semanas, bios, Reels, mensagens de venda, comparação com concorrente e pacote de execução do Google. 6 a 10 min."]] as [Tier, string, string][]).map(([k, t, d]) => (
            <label key={k} className={`card cursor-pointer p-3 text-sm ${tier === k ? "ring-2 ring-[var(--accent)]" : ""}`}>
              <span className="flex items-center gap-2 font-semibold text-ink"><input type="radio" name="tier" checked={tier === k} onChange={() => setTier(k)} /> {t}</span>
              <span className="mt-1 block text-xs text-mute">{d}</span>
            </label>
          ))}
        </fieldset>
        {tier === "completo" && (
          <div><label className="label" htmlFor="dg-comp">Concorrentes no Instagram (opcional, até 2, separados por vírgula)</label><input id="dg-comp" className="field" placeholder="@concorrente1, @concorrente2" value={comp} onChange={(e) => setComp(e.target.value)} maxLength={120} /></div>
        )}
        <FormError message={formErr} />
        {running && <DiagProgress step={step} hasInsta={!!insta.trim()} hasGoogle={!!google.trim()} tier={tier} nComp={comp.split(/[,\s]+/).filter(Boolean).length} />}
        <button className="btn btn-primary" disabled={running || !business.trim() || (!insta.trim() && !google.trim())}>{running ? "Gerando…" : "Gerar diagnóstico"}</button>
      </form>
      {warnings.length > 0 && <div className="card border-l-4 p-3 text-sm text-ink" role="alert" style={{ borderLeftColor: "#d97706" }}><b>Parte do relatório ficou de fora:</b> {warnings.join(" · ")}</div>}

      {error && <ErrorBox message={error} onRetry={load} />}
      {list === null && !error && <p className="text-sm text-mute">Carregando…</p>}
      {list && !list.some((b) => b.status === "ready") && <EmptyState title="Nenhum diagnóstico gerado ainda" hint="Preencha o formulário acima para gerar o primeiro." />}
      {list && list.some((b) => b.status === "ready") && (
        <section className="card p-2">
          <ul>
            {list.filter((b) => b.status === "ready").map((b) => (
              <li key={b.id} className="flex items-center gap-2 rounded-lg p-3 transition hover:bg-[var(--surface-2)]">
                <button type="button" onClick={() => void open(b.id)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{b.business_name} <span className="ml-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mute">{TIER_LABEL[b.tier === "completo" ? "completo" : "essencial"]}</span></p>
                    <p className="truncate text-xs text-mute">
                      {(Object.keys(b.pillar_scores ?? {}) as PillarKey[]).map((k) => `${PILLAR_LABELS[k]} ${b.pillar_scores?.[k]}`).join(" · ")} · {ddmmyy(b.finished_at ?? b.created_at)}
                    </p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums" style={{ color: scoreColor(b.overall_score ?? 0) }}>{b.overall_score ?? "—"}</p>
                </button>
                <button type="button" className="btn" aria-label={`Excluir diagnóstico de ${b.business_name}`} onClick={() => void remove(b)}>Excluir</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view && <ReportView data={view} warnings={warnings} onClose={closeView} />}
    </div>
  );
}
