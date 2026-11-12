"use client";
import { useEffect, useRef, useState } from "react";
import { opsCall } from "@/lib/api";
import { initial, type Member } from "@/lib/ops";

// Equipe carregada uma vez e compartilhada entre Tarefas e CRM.
let teamPromise: Promise<Member[]> | null = null;
export function useTeam() {
  const [team, setTeam] = useState<Member[]>([]);
  useEffect(() => {
    teamPromise ??= opsCall<{ members: Member[] }>({ action: "team" }).then((r) => r.members).catch((e) => { teamPromise = null; throw e; });
    let live = true;
    teamPromise.then((m) => live && setTeam(m)).catch(() => {});
    return () => { live = false; };
  }, []);
  return team;
}

export function Avatar({ m, size = 28 }: { m?: Member | null; size?: number }) {
  if (!m) return null;
  return (
    <span title={m.email} aria-label={`Responsável: ${m.email}`} style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-medium text-accent">
      {initial(m)}
    </span>
  );
}

export function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />{children}
    </span>
  );
}

// Fileira de chips rolável na horizontal (toque grande, sem quebra de linha).
export function ChipRow<T extends string>({ items, value, onChange, label }: {
  items: { id: T; label: string; count?: number; color?: string }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button key={it.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(it.id)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[0.9375rem] ${on ? "border-[var(--ink)] bg-[var(--btn)] text-[var(--btn-ink)]" : "border-line hover:bg-[var(--accent-soft)]"}`}>
            {it.color && !on && <span className="h-2 w-2 rounded-full" style={{ background: it.color }} aria-hidden />}
            {it.label}
            {it.count !== undefined && <span className={on ? "opacity-80" : "text-mute"}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-6 text-center">
      <p>{title}</p>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

// Erro de formulário: rola até a mensagem para que ela nunca fique fora da tela (principalmente no celular).
export function FormError({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [message]);
  if (!message) return null;
  return <p ref={ref} role="alert" className="rounded-xl border border-neg/50 p-3 text-neg">{message}</p>;
}
