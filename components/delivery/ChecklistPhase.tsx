"use client";
import { useProducts } from "@/lib/useProducts";
import { useEffect, useId, useState } from "react";
import { fmtDateTime, isOverdue, messageKeysOf, messageShortLabel, productByCode, type DeliveryItem } from "@/lib/delivery";
import { dueInfo, nameOf, type Member } from "@/lib/ops";

type Handlers = {
  team: Member[];
  docTitle: (slug: string) => string | undefined;
  messageTitle: (key: string) => string | undefined;
  onUpdate: (id: string, patch: Partial<Pick<DeliveryItem, "done" | "assignee_id" | "due_date" | "note">>) => Promise<void>;
  onDownload: (slug: string) => void;
  onCopy: (key: string) => void;
  onContract: () => void;
  onTask: (item: DeliveryItem) => void;
  busyId: string | null;
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}><path d="m9 6 6 6-6 6" /></svg>
);

export function ChecklistPhase({ phase, title, items, defaultOpen, ...h }: { phase: number; title: string; items: DeliveryItem[]; defaultOpen: boolean } & Handlers) {
  const [open, setOpen] = useState(defaultOpen);
  const panel = useId();
  const recurring = items.every((i) => i.recurring);
  const total = items.filter((i) => !i.recurring).length;
  const done = items.filter((i) => !i.recurring && i.done).length;
  const late = items.filter(isOverdue).length;

  return (
    <section className="card overflow-hidden">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)]">
          <Chevron open={open} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Fase {phase} · {title}</span>
            <span className="block text-xs text-mute">
              {recurring ? "Regras de rotina" : `${done} de ${total} feitos`}
              {late > 0 && <span className="text-neg"> · {late} atrasado{late === 1 ? "" : "s"}</span>}
            </span>
          </span>
          {!recurring && total > 0 && done === total && (
            <span className="rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[11px] font-medium text-pos">Completa</span>
          )}
        </button>
      </h3>
      {open && (
        <div id={panel} className="border-t border-line">
          {recurring ? (
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.id} className="px-4 py-3 text-sm">
                  <p className="font-medium text-ink">{it.title}</p>
                  {it.description && <p className="text-mute">{it.description}</p>}
                  {it.owner_hint && <p className="mt-0.5 text-xs text-mute">{it.owner_hint}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((it) => <ItemRow key={it.id} it={it} {...h} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ItemRow({ it, team, docTitle, messageTitle, onUpdate, onDownload, onCopy, onContract, onTask, busyId }: { it: DeliveryItem } & Handlers) {
  useProducts();
  const [more, setMore] = useState(false);
  const [note, setNote] = useState(it.note ?? "");
  useEffect(() => setNote(it.note ?? ""), [it.note]);
  const busy = busyId === it.id;
  const due = dueInfo(it.due_date);
  const late = isOverdue(it);
  const doneBy = it.done_by ? team.find((m) => m.id === it.done_by) : undefined;
  const assignee = it.assignee_id ? team.find((m) => m.id === it.assignee_id) : undefined;
  const prod = productByCode(it.product_code);
  const cbId = `chk-${it.id}`;
  const messageKeys = messageKeysOf(it);

  return (
    <li className={`px-4 py-3 ${it.done ? "bg-[var(--surface-2)]/40" : ""}`}>
      <div className="flex items-start gap-3">
        <input
          id={cbId}
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--accent)]"
          checked={it.done}
          disabled={busy}
          onChange={(e) => onUpdate(it.id, { done: e.target.checked })}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={cbId} className={`block cursor-pointer text-sm font-medium ${it.done ? "text-mute line-through" : "text-ink"}`}>
            {it.title}
          </label>
          {it.description && <p className="mt-0.5 text-sm text-mute">{it.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {prod && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-medium text-accent">{prod.short}</span>}
            {it.owner_hint && <span className="rounded-full border border-line px-2 py-0.5 text-mute">{it.owner_hint}</span>}
            {assignee && <span className="rounded-full border border-line px-2 py-0.5 text-ink">{nameOf(assignee)}</span>}
            {due && !it.done && (
              <span className={`rounded-full px-2 py-0.5 font-medium ${late ? "bg-[var(--neg-soft)] text-neg" : due.soon ? "bg-[#b7791f]/15 text-[#b7791f]" : "border border-line text-mute"}`}>
                {late ? "Atrasado · " : "Prazo · "}{due.text}
              </span>
            )}
            {it.done && it.done_at && (
              <span className="text-mute">Feito por {doneBy ? nameOf(doneBy) : "alguém da equipe"} em {fmtDateTime(it.done_at)}</span>
            )}
          </div>
          {it.note && !more && <p className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-ink">{it.note}</p>}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {it.action === "contrato" && <button type="button" className="btn min-h-9 px-3 text-xs" onClick={onContract}>Preencher contrato</button>}
            {it.doc_slug && (
              <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => onDownload(it.doc_slug!)} title={docTitle(it.doc_slug)}>
                Baixar modelo
              </button>
            )}
            {messageKeys.length === 1 && (
              <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => onCopy(messageKeys[0])} title={messageTitle(messageKeys[0])}>
                Copiar mensagem
              </button>
            )}
            {messageKeys.length > 1 && (
              <span role="group" aria-label="Copiar mensagem" className="inline-flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-mute">Copiar mensagem:</span>
                {messageKeys.map((k) => (
                  <button key={k} type="button" className="btn min-h-9 px-3 text-xs" onClick={() => onCopy(k)} title={messageTitle(k)}>
                    {messageShortLabel(messageTitle(k) ?? k)}
                  </button>
                ))}
              </span>
            )}
            {it.task_id ? (
              <span className="inline-flex min-h-9 items-center rounded-xl border border-line px-3 text-xs text-mute">Tarefa criada</span>
            ) : (
              <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => onTask(it)} disabled={busy}>Criar tarefa</button>
            )}
            <button type="button" className="btn min-h-9 px-3 text-xs" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? "Fechar detalhes" : "Responsável, prazo e nota"}
            </button>
          </div>

          {more && (
            <div className="mt-3 grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`asg-${it.id}`}>Responsável</label>
                <select id={`asg-${it.id}`} className="field" value={it.assignee_id ?? ""} disabled={busy}
                  onChange={(e) => onUpdate(it.id, { assignee_id: e.target.value || null })}>
                  <option value="">Sem responsável</option>
                  {team.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor={`due-${it.id}`}>Prazo</label>
                <input id={`due-${it.id}`} type="date" className="field" value={it.due_date ?? ""} disabled={busy}
                  onChange={(e) => onUpdate(it.id, { due_date: e.target.value || null })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor={`note-${it.id}`}>Nota do item</label>
                <textarea id={`note-${it.id}`} className="field" rows={2} maxLength={1000} value={note}
                  onChange={(e) => setNote(e.target.value)} placeholder="Sem senhas. Ex.: convite enviado em 20/11." />
                <div className="mt-2 flex justify-end">
                  <button type="button" className="btn btn-primary min-h-9 px-3 text-xs" disabled={busy || note === (it.note ?? "")}
                    onClick={() => onUpdate(it.id, { note: note || null })}>Salvar nota</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
