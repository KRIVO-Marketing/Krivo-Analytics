"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { aiCall } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "O que está atrasado hoje?",
  "Quais clientes preciso retornar?",
  "Resumo do funil do CRM",
  "O que cada produto do catálogo entrega?",
];

// Markdown leve e seguro (sem HTML): **negrito**, listas com - ou 1. e parágrafos.
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={`my-1.5 space-y-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
      </Tag>,
    );
    list = null;
  };
  let table: string[][] | null = null;
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    blocks.push(
      <div key={blocks.length} className="my-2 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-max border-collapse text-left text-[0.8125rem]">
          <thead className="bg-[var(--grid)] text-mute"><tr>{head.map((c, i) => <th key={i} className="px-2.5 py-1.5 font-medium">{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-line">{r.map((c, ci) => <td key={ci} className="px-2.5 py-1.5">{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>,
    );
    table = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // linha separadora |---|---|
      (table ??= []).push(cells);
      continue;
    }
    flushTable();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      blocks.push(<p key={blocks.length} className="my-1.5 first:mt-0 last:mb-0">{inline(line.replace(/^#{1,6}\s+/, ""))}</p>);
    }
  }
  flush();
  flushTable();
  return <>{blocks}</>;
}

export function ChatPanel({ firstName }: { firstName: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy, error]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await aiCall<{ reply: string }>({ messages: next.slice(-10) }, ctrl.signal);
      setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <section className="card flex h-[34rem] flex-col overflow-hidden lg:h-[calc(100dvh-8.5rem)] lg:min-h-[30rem]" aria-label="Chat com a KRIVO IA">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent)] text-white" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" /><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z" /></svg>
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">KRIVO IA</h2>
            <p className="text-[11px] text-mute">Pergunte sobre tarefas, CRM, catálogo e metas</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button type="button" className="btn min-h-8 px-3 text-xs" onClick={() => { abortRef.current?.abort(); setMessages([]); setError(null); setBusy(false); }}>
            Nova conversa
          </button>
        )}
      </header>

      <div ref={scrollerRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-center gap-4">
            <div>
              <p className="text-lg font-semibold text-ink">Oi, {firstName}! 👋</p>
              <p className="mt-1 text-sm text-mute">Sou a IA da KRIVO. Eu leio os dados da plataforma e respondo aqui. Experimente:</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn min-h-10 text-left text-[0.8125rem]" onClick={() => void send(s)} disabled={busy}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "whitespace-pre-wrap bg-[var(--accent)] text-white" : "border border-line bg-[var(--surface-2)] text-ink"
              }`}
            >
              {m.role === "user" ? m.content : <Markdown text={m.content} />}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start" role="status" aria-label="A IA está respondendo">
            <div className="flex items-center gap-1 rounded-2xl border border-line bg-[var(--surface-2)] px-4 py-3" aria-hidden>
              {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--mute)]" style={{ animationDelay: `${d * 140}ms` }} />)}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-neg/50 p-3 text-sm text-neg">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <textarea
          className="field max-h-32 min-h-11 flex-1 resize-none"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          maxLength={2000}
          placeholder="Pergunte algo sobre a plataforma…"
          aria-label="Sua pergunta"
        />
        <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !input.trim()} aria-label="Enviar pergunta">
          Enviar
        </button>
      </form>
    </section>
  );
}
