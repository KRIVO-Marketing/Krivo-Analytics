"use client";
import { dueInfo, TASK_STATUS, type Member, type Task, type TaskStatus } from "@/lib/ops";
import { IconUser } from "../Icons";
import { Avatar } from "../opsui";

type Props = {
  t: Task;
  assignee?: Member;
  desktop: boolean;
  client?: string;
  onOpen: () => void;
  onToggle: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onDragStart: () => void;
};

export function TaskCard({ t, assignee, desktop, client, onOpen, onToggle, onStatusChange, onDragStart }: Props) {
  const due = t.status === "concluida" ? null : dueInfo(t.due_date);
  const done = t.status === "concluida";
  const statusMeta = TASK_STATUS.find((s) => s.id === t.status);

  return (
    <li
      draggable={desktop}
      onDragStart={onDragStart}
      className={`card transition hover:border-[var(--soft)] ${desktop ? "lg:cursor-grab" : ""} ${done ? "opacity-75" : ""}`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
          aria-pressed={done}
          className="flex w-12 shrink-0 items-center justify-center"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs transition ${
              done ? "border-[var(--pos)] bg-[var(--pos)] text-white" : "border-[var(--soft)] hover:border-[var(--accent)]"
            }`}
          >
            {done ? "✓" : ""}
          </span>
        </button>

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-3 pr-2 text-left">
          <span className={`block break-words text-[0.9375rem] leading-snug font-normal ${done ? "text-mute line-through" : ""}`}>
            {t.title}
          </span>
          {(due || client || t.tags.length > 0) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {due && (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-normal ${
                    due.late
                      ? "bg-[color-mix(in_srgb,var(--neg)_12%,transparent)] text-neg"
                      : due.soon
                        ? "bg-[var(--accent-soft)] text-accent"
                        : "bg-[var(--grid)] text-mute"
                  }`}
                >
                  {due.late ? "Atrasada · " : ""}
                  {due.text}
                </span>
              )}
              {client && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--grid)] px-1.5 py-0.5 text-mute">
                  <IconUser size={12} />
                  {client}
                </span>
              )}
              {t.tags.map((g) => (
                <span key={g} className="rounded-md bg-[var(--grid)] px-1.5 py-0.5 text-mute">
                  #{g}
                </span>
              ))}
            </span>
          )}
        </button>

        <span className="flex items-center pr-3">
          <Avatar m={assignee} />
        </span>
      </div>

      {/* Troca rápida de coluna no celular (onde não há arrastar-e-soltar) */}
      <div className="flex items-center justify-between border-t border-line/60 px-3 py-1.5 lg:hidden">
        <span className="inline-flex items-center gap-1.5 text-xs text-mute">
          <span className="h-2 w-2 rounded-full" style={{ background: statusMeta?.color }} aria-hidden />
          Status
        </span>
        <select
          aria-label={`Status de ${t.title}`}
          value={t.status}
          onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
          className="min-h-8 rounded-lg border border-line bg-transparent px-2 py-0.5 text-xs font-normal text-ink"
        >
          {TASK_STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
