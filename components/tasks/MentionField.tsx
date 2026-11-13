"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { nameOf, type Contact, type Member } from "@/lib/ops";

export type MentionItem =
  | { kind: "member"; id: string; label: string; sub: string; member: Member }
  | { kind: "contact"; id: string; label: string; sub: string; contact: Contact };

type Props = {
  id?: string;
  multiline?: boolean;
  rows?: number;
  value: string;
  onChange: (next: string) => void;
  team: Member[];
  contacts: Contact[];
  onPickMember: (m: Member) => void;
  onPickContact: (c: Contact) => void;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  ariaLabel?: string;
  className?: string;
};

type Match = { start: number; end: number; query: string };

function findMention(text: string, caret: number): Match | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!m) return null;
  const start = before.length - m[2].length - 1;
  return { start, end: caret, query: m[2].toLowerCase() };
}

export function MentionField({
  id,
  multiline = false,
  rows = 4,
  value,
  onChange,
  team,
  contacts,
  onPickMember,
  onPickContact,
  placeholder,
  maxLength,
  required,
  ariaLabel,
  className = "field",
}: Props) {
  const elRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const items = useMemo<MentionItem[]>(() => {
    if (!match) return [];
    const q = match.query;
    const memberHits: MentionItem[] = team
      .filter((m) => !q || nameOf(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .slice(0, 5)
      .map((m) => ({
        kind: "member",
        id: `m:${m.id}`,
        label: nameOf(m),
        sub: m.email,
        member: m,
      }));
    const contactHits: MentionItem[] = contacts
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.company && c.company.toLowerCase().includes(q)) ||
          (c.instagram && c.instagram.toLowerCase().includes(q)),
      )
      .slice(0, 6)
      .map((c) => ({
        kind: "contact",
        id: `c:${c.id}`,
        label: c.name,
        sub: [c.company, c.city].filter(Boolean).join(" · ") || "Cliente CRM",
        contact: c,
      }));
    return [...memberHits, ...contactHits];
  }, [match, team, contacts]);

  useEffect(() => {
    setActiveIdx(0);
  }, [match?.query, items.length]);

  const syncMatch = (text: string, caret: number | null) => {
    if (caret == null) {
      setMatch(null);
      return;
    }
    setMatch(findMention(text, caret));
  };

  const pick = (item: MentionItem) => {
    if (!match) return;
    const before = value.slice(0, match.start);
    const after = value.slice(match.end);
    // Remove @termo evitando espaço duplo ao juntar os lados
    const cleaned = `${before.replace(/[ \t]+$/, "")}${before && after ? " " : ""}${after.replace(/^[ \t]+/, "")}`;
    onChange(cleaned);
    setMatch(null);
    if (item.kind === "member") onPickMember(item.member);
    else onPickContact(item.contact);
    requestAnimationFrame(() => elRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!match || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(items[activeIdx] ?? items[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMatch(null);
    }
  };

  const shared = {
    id,
    ref: elRef,
    className,
    value,
    maxLength,
    required,
    placeholder,
    "aria-label": ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value;
      onChange(next);
      syncMatch(next, e.target.selectionStart);
    },
    onClick: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      syncMatch(value, e.currentTarget.selectionStart);
    },
    onBlur: () => {
      setTimeout(() => setMatch(null), 150);
    },
    onKeyDown: handleKeyDown,
  };

  return (
    <div className="relative">
      {multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} />}

      {match && (
        <div
          role="listbox"
          aria-label="Mencionar sócio ou cliente"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-60 overflow-y-auto rounded-2xl border border-line bg-card p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.22)]"
        >
          {items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-mute">Nenhum sócio ou cliente encontrado para “@{match.query}”.</p>
          ) : (
            items.map((item, idx) => {
              const active = idx === activeIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(item);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
                    active ? "bg-[var(--accent-soft)] text-ink" : "text-ink hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.label}</span>
                    <span className="block truncate text-[11px] text-mute">{item.sub}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      item.kind === "member"
                        ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent"
                        : "bg-[color-mix(in_srgb,var(--pos)_16%,transparent)] text-pos"
                    }`}
                  >
                    {item.kind === "member" ? "Sócio" : "Cliente"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
