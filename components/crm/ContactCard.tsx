"use client";
import { brl, dueInfo, STAGES, stageOf, waLink, type Contact, type Member, type Stage } from "@/lib/ops";
import { Avatar, Pill } from "../opsui";

type Props = {
  c: Contact;
  owner?: Member;
  followUp: boolean;
  onOpen: () => void;
  onQuickStage: (stage: Stage) => void;
};

export function ContactCard({ c, owner, followUp, onOpen, onQuickStage }: Props) {
  const st = stageOf(c.stage)!;
  const due = c.next_contact_at && c.stage !== "fechado" && c.stage !== "perdido" ? dueInfo(c.next_contact_at) : null;
  const sub = [c.company, c.niche, c.city].filter(Boolean).join(" · ");

  return (
    <li
      className={`card flex flex-col justify-between transition hover:border-[var(--soft)] ${
        followUp && due?.late ? "border-l-4 border-l-[var(--neg)]" : followUp ? "border-l-4 border-l-[var(--accent)]" : ""
      }`}
    >
      <div className="flex items-stretch">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 p-3.5 text-left">
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
              <span aria-hidden className="text-lg">💬</span>
            </a>
            <a
              href={`tel:+${c.phone}`}
              aria-label={`Ligar para ${c.name}`}
              title="Ligar"
              className="flex flex-1 w-12 items-center justify-center border-t border-line text-mute transition hover:bg-[var(--accent-soft)] hover:text-ink"
            >
              <span aria-hidden className="text-base">📞</span>
            </a>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line/60 px-3 py-1.5">
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
