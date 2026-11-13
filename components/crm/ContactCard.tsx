"use client";
import type { TouchEvent } from "react";
import { prefetchContactDetail } from "@/lib/data";
import { brl, dueInfo, STAGES, stageOf, waLink, type Contact, type Member, type Stage } from "@/lib/ops";
import { IconMessage, IconPhone } from "../Icons";
import { Avatar, Pill } from "../opsui";

type Props = {
  c: Contact;
  owner?: Member;
  followUp: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  onOpen: () => void;
  onQuickStage: (stage: Stage) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onTouchDragStart?: (e: TouchEvent) => void;
  onTouchDragMove?: (e: TouchEvent) => void;
  onTouchDragEnd?: () => void;
};

export function ContactCard({
  c,
  owner,
  followUp,
  draggable = false,
  isDragging = false,
  onOpen,
  onQuickStage,
  onDragStart,
  onDragEnd,
  onTouchDragStart,
  onTouchDragMove,
  onTouchDragEnd,
}: Props) {
  const st = stageOf(c.stage)!;
  const due = c.next_contact_at && c.stage !== "fechado" && c.stage !== "perdido" ? dueInfo(c.next_contact_at) : null;
  const sub = [c.company, c.niche, c.city].filter(Boolean).join(" · ");

  return (
    <li
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`card flex flex-col justify-between transition hover:border-[var(--soft)] ${
        draggable ? "lg:cursor-grab" : ""
      } ${isDragging ? "scale-[0.98] opacity-55 ring-2 ring-[var(--accent)]" : ""} ${
        followUp && due?.late ? "border-l-4 border-l-[var(--neg)]" : followUp ? "border-l-4 border-l-[var(--accent)]" : ""
      }`}
    >
      <div className="flex items-stretch">
        {draggable && onTouchDragStart && (
          <div
            role="button"
            tabIndex={-1}
            aria-label={`Arrastar ${c.name} para outra etapa`}
            title="Arrastar para outra etapa"
            onTouchStart={onTouchDragStart}
            onTouchMove={onTouchDragMove}
            onTouchEnd={onTouchDragEnd}
            onTouchCancel={onTouchDragEnd}
            className="flex w-7 shrink-0 touch-none select-none items-center justify-center border-r border-line/50 text-mute/60 hover:text-ink lg:hidden"
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
              <circle cx="3.5" cy="3" r="1.2" />
              <circle cx="8.5" cy="3" r="1.2" />
              <circle cx="3.5" cy="8" r="1.2" />
              <circle cx="8.5" cy="8" r="1.2" />
              <circle cx="3.5" cy="13" r="1.2" />
              <circle cx="8.5" cy="13" r="1.2" />
            </svg>
          </div>
        )}
        <button
          type="button"
          onMouseEnter={() => prefetchContactDetail(c.id)}
          onFocus={() => prefetchContactDetail(c.id)}
          onTouchStart={() => prefetchContactDetail(c.id)}
          onClick={onOpen}
          className="min-w-0 flex-1 p-3.5 text-left"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="block truncate text-base font-normal">{c.name}</span>
            <Avatar m={owner} size={24} />
          </div>
          {sub && <span className="mt-0.5 block truncate text-sm text-mute">{sub}</span>}
          <span className="mt-2.5 flex flex-wrap items-center gap-2">
            <Pill color={st.color}>{st.label}</Pill>
            {c.value != null && <span className="rounded-md bg-[var(--grid)] px-1.5 py-0.5 text-xs font-normal text-ink">{brl(c.value)}</span>}
            {due && (
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs font-normal ${
                  due.late
                    ? "bg-[color-mix(in_srgb,var(--neg)_12%,transparent)] text-neg"
                    : due.soon
                      ? "bg-[var(--accent-soft)] text-accent"
                      : "bg-[var(--grid)] text-mute"
                }`}
              >
                Retornar: {due.text}
              </span>
            )}
          </span>
        </button>

        {c.phone && (
          <div className="flex shrink-0 flex-col border-l border-line">
            <a
              href={waLink(c.phone)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Abrir WhatsApp de ${c.name}`}
              title="WhatsApp"
              className="flex flex-1 w-12 items-center justify-center text-accent transition hover:bg-[var(--accent-soft)]"
            >
              <IconMessage size={17} />
            </a>
            <a
              href={`tel:+${c.phone}`}
              aria-label={`Ligar para ${c.name}`}
              title="Ligar"
              className="flex flex-1 w-12 items-center justify-center border-t border-line text-mute transition hover:bg-[var(--accent-soft)] hover:text-ink"
            >
              <IconPhone size={16} />
            </a>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line/60 px-3 py-1.5 lg:hidden">
        <span className="inline-flex items-center gap-1.5 text-xs text-mute">
          <span className="h-2 w-2 rounded-full" style={{ background: st.color }} aria-hidden />
          Estágio
        </span>
        <select
          aria-label={`Estágio de ${c.name}`}
          value={c.stage}
          onChange={(e) => onQuickStage(e.target.value as Stage)}
          className="min-h-8 rounded-lg border border-line bg-transparent px-2 py-0.5 text-xs font-normal text-ink"
        >
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
