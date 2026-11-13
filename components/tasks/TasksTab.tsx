"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { opsCall } from "@/lib/api";
import { getCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchContacts, fetchTasks, updateTasksCache } from "@/lib/data";
import { TASK_STATUS, type Contact, type Task, type TaskStatus } from "@/lib/ops";
import { useMe } from "../AuthGate";
import { ChipRow, EmptyState, useTeam } from "../opsui";
import { ErrorBox } from "../ui";
import { TaskCard } from "./TaskCard";
import { TaskSheet } from "./TaskSheet";

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
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);

  const dragId = useRef<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const byId = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);
  const contactNames = useMemo(() => new Map(contacts.map((c) => [c.id, c.name])), [contacts]);

  const load = useCallback(async (force = false) => {
    try {
      const list = await fetchTasks(force);
      setTasks(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubTasks = subscribeCache(CACHE_KEYS.tasks, () => {
      const cached = getCached<Task[]>(CACHE_KEYS.tasks);
      if (cached) {
        setTasks(cached);
        setLoading(false);
      }
    });
    const unsubContacts = subscribeCache(CACHE_KEYS.contacts, () => {
      const cached = getCached<Contact[]>(CACHE_KEYS.contacts);
      if (cached) setContacts(cached);
    });
    load();
    fetchContacts().then(setContacts).catch(() => {});
    return () => {
      unsubTasks();
      unsubContacts();
    };
  }, [load]);

  const visible = useMemo(() => (mine ? tasks.filter((t) => t.assignee_id === me.id) : tasks), [tasks, mine, me.id]);
  const col = (s: TaskStatus) => visible.filter((t) => t.status === s);

  // Mudança otimista: a tela responde na hora; se o servidor recusar, recarrega e avisa.
  const patch = async (t: Task, changes: Record<string, unknown>) => {
    const minPos = Math.min(0, ...tasks.map((x) => x.position)) - 1;
    updateTasksCache((all) =>
      all.map((x) => (x.id === t.id ? ({ ...x, ...changes, ...(changes.status && changes.status !== t.status ? { position: minPos } : {}) } as Task) : x)),
    );
    try {
      const r = await opsCall<{ task: Task }>({ action: "task_update", id: t.id, ...changes });
      updateTasksCache((all) => all.map((x) => (x.id === t.id ? r.task : x)));
    } catch (e) {
      setError((e as Error).message);
      load(true);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (title.length < 2 || adding) return;
    setAdding(true);
    try {
      const r = await opsCall<{ task: Task }>({ action: "task_create", title, status, assignee_id: me.id });
      updateTasksCache((all) => [r.task, ...all]);
      setDraft("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <div className="skeleton h-72" aria-busy="true" aria-label="Carregando" />;

  const activeLabel = TASK_STATUS.find((s) => s.id === status)!.label;

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <input
          className="field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={120}
          placeholder={`Nova tarefa em “${activeLabel}”`}
          aria-label="Título da nova tarefa"
          enterKeyHint="done"
        />
        <button type="submit" className="btn btn-primary shrink-0" disabled={adding || draft.trim().length < 2}>
          {adding ? "…" : "+ Adicionar"}
        </button>
      </form>

      <div className="space-y-3">
        <div className="lg:hidden">
          <ChipRow
            label="Status"
            value={status}
            onChange={setStatus}
            items={TASK_STATUS.map((s) => ({ id: s.id, label: s.short, count: col(s.id).length, color: s.color }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-mute">
            {visible.length} {visible.length === 1 ? "tarefa" : "tarefas"}
            {mine ? " atribuídas a você" : ""}
          </span>
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => setMine((v) => !v)}
            className={`btn min-h-9 rounded-full px-4 text-sm ${mine ? "btn-primary" : ""}`}
          >
            {mine ? "✓ Só minhas" : "Só minhas"}
          </button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}

      <div className="grid gap-4 lg:grid-cols-4">
        {TASK_STATUS.map((s) => {
          const list = col(s.id);
          return (
            <section
              key={s.id}
              aria-label={s.label}
              className={`${status === s.id ? "" : "hidden"} min-w-0 rounded-2xl lg:block lg:border lg:p-3 ${
                over === s.id ? "lg:border-[var(--accent)] lg:bg-[var(--accent-soft)]" : "lg:border-line"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s.id);
              }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={() => {
                setOver(null);
                const t = tasks.find((x) => x.id === dragId.current);
                if (t && t.status !== s.id) patch(t, { status: s.id });
              }}
            >
              <h3 className="mb-3 hidden items-center justify-between text-base lg:flex">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
                <span className="rounded-full bg-[var(--grid)] px-2 py-0.5 text-xs text-mute">{list.length}</span>
              </h3>
              <ul className="space-y-2">
                {list.map((t) => (
                  <TaskCard
                    key={t.id}
                    t={t}
                    desktop={desktop}
                    client={t.contact_id ? contactNames.get(t.contact_id) : undefined}
                    assignee={t.assignee_id ? byId.get(t.assignee_id) : undefined}
                    onOpen={() => setOpen(t)}
                    onToggle={() => patch(t, { status: t.status === "concluida" ? "a_fazer" : "concluida" })}
                    onStatusChange={(nextStatus) => {
                      if (nextStatus !== t.status) patch(t, { status: nextStatus });
                    }}
                    onDragStart={() => {
                      dragId.current = t.id;
                    }}
                  />
                ))}
              </ul>
              {list.length === 0 && (
                <EmptyState
                  title="Nada por aqui"
                  hint={s.id === "a_fazer" ? "Escreva uma tarefa acima e toque em + Adicionar." : undefined}
                />
              )}
            </section>
          );
        })}
      </div>

      {open && (
        <TaskSheet
          task={open}
          team={team}
          contacts={contacts}
          onClose={() => setOpen(null)}
          onSaved={(t) => {
            updateTasksCache((all) => all.map((x) => (x.id === t.id ? t : x)));
            setOpen(null);
          }}
          onDeleted={(id) => {
            updateTasksCache((all) => all.filter((x) => x.id !== id));
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}
