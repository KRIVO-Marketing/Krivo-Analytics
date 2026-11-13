"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { opsCall } from "@/lib/api";
import { getCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchContacts, fetchTasks, updateTasksCache } from "@/lib/data";
import { dueInfo, nameOf, TASK_STATUS, todayISO, type Contact, type Member, type Task, type TaskStatus } from "@/lib/ops";
import { useMe } from "./AuthGate";
import { Avatar, ChipRow, EmptyState, FormError, useTeam } from "./opsui";
import { ErrorBox, Modal } from "./ui";

export default function TasksTab() {
  const { me } = useMe();
  const team = useTeam();
  const [tasks, setTasks] = useState<Task[]>(() => getCached<Task[]>(CACHE_KEYS.tasks) ?? []);
  const [contacts, setContacts] = useState<Contact[]>(() => getCached<Contact[]>(CACHE_KEYS.contacts) ?? []);
  const [loading, setLoading] = useState(() => getCached<Task[]>(CACHE_KEYS.tasks) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>("a_fazer");
  const [mine, setMine] = useState(false);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Task | null>(null);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px) and (hover: hover)");
    const f = () => setDesktop(mq.matches);
    f(); mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const dragId = useRef<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const byId = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);
  const contactNames = useMemo(() => new Map(contacts.map((c) => [c.id, c.name])), [contacts]);

  const load = useCallback(async (force = false) => {
    try {
      const list = await fetchTasks(force);
      setTasks(list); setError(null);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const unsubTasks = subscribeCache(CACHE_KEYS.tasks, () => {
      const cached = getCached<Task[]>(CACHE_KEYS.tasks);
      if (cached) { setTasks(cached); setLoading(false); }
    });
    const unsubContacts = subscribeCache(CACHE_KEYS.contacts, () => {
      const cached = getCached<Contact[]>(CACHE_KEYS.contacts);
      if (cached) setContacts(cached);
    });
    load();
    fetchContacts().then(setContacts).catch(() => {});
    return () => { unsubTasks(); unsubContacts(); };
  }, [load]);

  const visible = useMemo(() => (mine ? tasks.filter((t) => t.assignee_id === me.id) : tasks), [tasks, mine, me.id]);
  const col = (s: TaskStatus) => visible.filter((t) => t.status === s);

  // Mudança otimista: a tela responde na hora; se o servidor recusar, recarrega e avisa.
  const patch = async (t: Task, changes: Record<string, unknown>) => {
    const minPos = Math.min(0, ...tasks.map((x) => x.position)) - 1;
    updateTasksCache((all) => all.map((x) => (x.id === t.id ? { ...x, ...changes, ...(changes.status && changes.status !== t.status ? { position: minPos } : {}) } as Task : x)));
    try {
      const r = await opsCall<{ task: Task }>({ action: "task_update", id: t.id, ...changes });
      updateTasksCache((all) => all.map((x) => (x.id === t.id ? r.task : x)));
    } catch (e) { setError((e as Error).message); load(true); }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (title.length < 2 || adding) return;
    setAdding(true);
    try {
      const r = await opsCall<{ task: Task }>({ action: "task_create", title, status, assignee_id: me.id });
      updateTasksCache((all) => [r.task, ...all]);
      setDraft(""); setError(null);
    } catch (e) { setError((e as Error).message); } finally { setAdding(false); }
  };

  if (loading) return <div className="skeleton h-72" aria-busy="true" aria-label="Carregando" />;

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} placeholder={`Nova tarefa em “${TASK_STATUS.find((s) => s.id === status)!.label}”`} aria-label="Título da nova tarefa" enterKeyHint="done" />
        <button type="submit" className="btn btn-primary shrink-0" disabled={adding || draft.trim().length < 2}>Adicionar</button>
      </form>

      <div className="space-y-3">
        <div className="lg:hidden">
          <ChipRow label="Status" value={status} onChange={setStatus}
            items={TASK_STATUS.map((s) => ({ id: s.id, label: s.short, count: col(s.id).length, color: s.color }))} />
        </div>
        <div className="flex justify-end">
          <button type="button" aria-pressed={mine} onClick={() => setMine((v) => !v)}
            className={`btn ${mine ? "btn-primary" : ""}`}>{mine ? "✓ Só minhas" : "Só minhas"}</button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}

      <div className="grid gap-4 lg:grid-cols-4">
        {TASK_STATUS.map((s) => {
          const list = col(s.id);
          return (
            <section key={s.id} aria-label={s.label}
              className={`${status === s.id ? "" : "hidden"} min-w-0 rounded-2xl lg:block lg:border lg:p-3 ${over === s.id ? "lg:border-[var(--accent)] lg:bg-[var(--accent-soft)]" : "lg:border-line"}`}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={() => {
                setOver(null);
                const t = tasks.find((x) => x.id === dragId.current);
                if (t && t.status !== s.id) patch(t, { status: s.id });
              }}>
              <h3 className="mb-3 hidden items-center gap-2 text-base lg:flex">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}
                <span className="text-mute">{list.length}</span>
              </h3>
              <ul className="space-y-2">
                {list.map((t) => (
                  <TaskCard key={t.id} t={t} desktop={desktop} client={t.contact_id ? contactNames.get(t.contact_id) : undefined} assignee={t.assignee_id ? byId.get(t.assignee_id) : undefined}
                    onOpen={() => setOpen(t)} onToggle={() => patch(t, { status: t.status === "concluida" ? "a_fazer" : "concluida" })}
                    onDragStart={() => { dragId.current = t.id; }} />
                ))}
              </ul>
              {list.length === 0 && <EmptyState title="Nada por aqui" hint={s.id === "a_fazer" ? "Escreva uma tarefa acima e toque em Adicionar." : undefined} />}
            </section>
          );
        })}
      </div>

      {open && (
        <TaskSheet task={open} team={team} contacts={contacts} onClose={() => setOpen(null)}
          onSaved={(t) => { updateTasksCache((all) => all.map((x) => (x.id === t.id ? t : x))); setOpen(null); }}
          onDeleted={(id) => { updateTasksCache((all) => all.filter((x) => x.id !== id)); setOpen(null); }} />
      )}
    </div>
  );
}

function TaskCard({ t, assignee, desktop, client, onOpen, onToggle, onDragStart }: { t: Task; assignee?: Member; desktop: boolean; client?: string; onOpen: () => void; onToggle: () => void; onDragStart: () => void }) {
  const due = t.status === "concluida" ? null : dueInfo(t.due_date);
  const done = t.status === "concluida";
  return (
    <li draggable={desktop} onDragStart={onDragStart} className="card flex items-stretch lg:cursor-grab">
      <button type="button" onClick={onToggle} aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"} aria-pressed={done}
        className="flex w-12 shrink-0 items-center justify-center">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs ${done ? "border-[var(--pos)] bg-[var(--pos)] text-white" : "border-[var(--soft)]"}`}>{done ? "✓" : ""}</span>
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-3 pr-3 text-left">
        <span className={`block break-words text-[0.9375rem] font-normal ${done ? "text-mute line-through" : ""}`}>{t.title}</span>
        {(due || client || t.tags.length > 0) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {due && <span className={due.late ? "text-neg" : due.soon ? "text-accent" : "text-mute"}>{due.late ? "Atrasada · " : ""}{due.text}</span>}
            {client && <span className="text-mute">👤 {client}</span>}
            {t.tags.map((g) => <span key={g} className="text-mute">#{g}</span>)}
          </span>
        )}
      </button>
      <span className="flex items-center pr-3"><Avatar m={assignee} /></span>
    </li>
  );
}

function TaskSheet({ task, team, contacts, onClose, onSaved, onDeleted }: { task: Task; team: Member[]; contacts: Contact[]; onClose: () => void; onSaved: (t: Task) => void; onDeleted: (id: string) => void }) {
  const { me } = useMe();
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [due, setDue] = useState(task.due_date ?? "");
  const [desc, setDesc] = useState(task.description ?? "");
  const [tags, setTags] = useState(task.tags.join(", "));
  const [contact, setContact] = useState(task.contact_id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await opsCall<{ task: Task }>({
        action: "task_update", id: task.id, title, status, assignee_id: assignee || null, due_date: due || null, description: desc,
        tags: tags.split(",").map((x) => x.trim()).filter(Boolean), contact_id: contact || null,
      });
      onSaved(r.task);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const del = async () => {
    setBusy(true); setErr(null);
    try { await opsCall({ action: "task_delete", id: task.id }); onDeleted(task.id); }
    catch (e) { setErr((e as Error).message); setConfirmDel(false); } finally { setBusy(false); }
  };

  return (
    <Modal title="Tarefa" onClose={() => !busy && onClose()}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="t-title">Título</label>
          <input id="t-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </div>
        <div>
          <span className="label">Status</span>
          <div className="grid grid-cols-2 gap-2">
            {TASK_STATUS.map((s) => (
              <button key={s.id} type="button" aria-pressed={status === s.id} onClick={() => setStatus(s.id)}
                className={`btn justify-start ${status === s.id ? "btn-primary" : ""}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="t-asg">Responsável</label>
            <select id="t-asg" className="field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Sem responsável</option>
              {team.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}{m.id === me.id ? " (eu)" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="t-due">Prazo</label>
            <input id="t-due" type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setDue(todayISO())}>Hoje</button>
              <button type="button" className="btn" onClick={() => setDue(tomorrow())}>Amanhã</button>
              {due && <button type="button" className="btn" onClick={() => setDue("")}>Limpar</button>}
            </div>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="t-desc">Descrição</label>
          <textarea id="t-desc" className="field" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} />
        </div>
        <div>
          <label className="label" htmlFor="t-cli">Cliente (CRM)</label>
          <select id="t-cli" className="field" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">Nenhum</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="t-tags">Etiquetas</label>
          <input id="t-tags" className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ex.: urgente, proposta" />
          <p className="hint">Separe por vírgula. Até 5.</p>
        </div>
        <FormError message={err} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {confirmDel ? (
            <div className="flex gap-2">
              <button type="button" className="btn btn-danger flex-1" onClick={del} disabled={busy}>Confirmar exclusão</button>
              <button type="button" className="btn" onClick={() => setConfirmDel(false)}>Cancelar</button>
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)} disabled={busy}>Excluir</button>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={onClose} disabled={busy}>Fechar</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
