"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { opsCall } from "@/lib/api";
import { getCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchContacts, updateContactsCache } from "@/lib/data";
import { brl, STAGES, todayISO, type Contact, type Stage } from "@/lib/ops";
import { ChipRow, EmptyState, useTeam } from "../opsui";
import { ErrorBox } from "../ui";
import { ContactCard } from "./ContactCard";
import { ContactForm } from "./ContactForm";
import { ContactSheet } from "./ContactSheet";

type Filter = "todos" | "retornar" | Stage;

export default function CrmTab() {
  const team = useTeam();
  const [contacts, setContacts] = useState<Contact[]>(() => getCached<Contact[]>(CACHE_KEYS.contacts) ?? []);
  const [loading, setLoading] = useState(() => getCached<Contact[]>(CACHE_KEYS.contacts) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [onlyFollowUp, setOnlyFollowUp] = useState(false);
  const [q, setQ] = useState("");
  const [openState, setOpenState] = useState<{ id: string; askLoss?: boolean } | null>(null);
  const [form, setForm] = useState<Contact | "new" | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const dragId = useRef<string | null>(null);
  const kanbanRef = useRef<HTMLDivElement | null>(null);
  const pan = useRef<{ startX: number; scrollLeft: number } | null>(null);

  const byId = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);

  const load = useCallback(async (force = false) => {
    try {
      setContacts(await fetchContacts(force));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeCache(CACHE_KEYS.contacts, () => {
      const cached = getCached<Contact[]>(CACHE_KEYS.contacts);
      if (cached) {
        setContacts(cached);
        setLoading(false);
      }
    });
    load();
    return unsub;
  }, [load]);

  const today = todayISO();
  const isFollowUp = (c: Contact) => !!c.next_contact_at && c.next_contact_at <= today && c.stage !== "fechado" && c.stage !== "perdido";

  const searchFiltered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (onlyFollowUp && !isFollowUp(c)) return false;
      return !t || [c.name, c.company, c.niche, c.city, c.phone, c.instagram].some((v) => v?.toLowerCase().includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, q, onlyFollowUp, today]);

  const shown = useMemo(() => {
    return searchFiltered.filter((c) => (filter === "retornar" ? isFollowUp(c) : filter === "todos" || c.stage === filter));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFiltered, filter, today]);

  const count = (f: Filter) =>
    f === "todos" ? contacts.length : f === "retornar" ? contacts.filter(isFollowUp).length : contacts.filter((c) => c.stage === f).length;

  const totalValue = useMemo(() => shown.reduce((sum, c) => sum + (c.value != null ? Number(c.value) || 0 : 0), 0), [shown]);
  const kanbanValue = useMemo(() => searchFiltered.reduce((sum, c) => sum + (c.value != null ? Number(c.value) || 0 : 0), 0), [searchFiltered]);

  const quickStage = async (c: Contact, stage: Stage) => {
    if (stage === c.stage) return;
    if (stage === "perdido") {
      setOpenState({ id: c.id, askLoss: true });
      return;
    }
    updateContactsCache((all) => all.map((x) => (x.id === c.id ? { ...x, stage } : x)));
    try {
      const r = await opsCall<{ contact: Contact }>({ action: "contact_update", id: c.id, stage });
      updateContactsCache((all) => all.map((x) => (x.id === c.id ? r.contact : x)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      load(true);
    }
  };

  const handleDropToStage = (targetStage: Stage) => {
    const id = dragId.current;
    dragId.current = null;
    setDraggingId(null);
    setOver(null);
    if (!id) return;
    const c = contacts.find((x) => x.id === id);
    if (c && c.stage !== targetStage) quickStage(c, targetStage);
  };

  const handleTouchDragMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || !dragId.current) return;
    const board = kanbanRef.current;
    if (board) {
      const rect = board.getBoundingClientRect();
      if (t.clientX < rect.left + 44) board.scrollLeft -= 14;
      else if (t.clientX > rect.right - 44) board.scrollLeft += 14;
    }
    const el = document.elementFromPoint(t.clientX, t.clientY)?.closest("[data-stage-col]");
    const st = el?.getAttribute("data-stage-col") as Stage | null;
    setOver(st ?? null);
  };

  const handleTouchDragEnd = () => {
    if (over) {
      handleDropToStage(over);
    } else {
      dragId.current = null;
      setDraggingId(null);
      setOver(null);
    }
  };

  useEffect(() => {
    if (!panning) return;
    const onMove = (e: globalThis.MouseEvent) => {
      if (!pan.current || !kanbanRef.current) return;
      kanbanRef.current.scrollLeft = pan.current.scrollLeft - (e.clientX - pan.current.startX);
    };
    const onUp = () => {
      pan.current = null;
      setPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panning]);

  const handleBoardMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !kanbanRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('li[draggable="true"], button, a, input, select, textarea')) return;
    pan.current = { startX: e.clientX, scrollLeft: kanbanRef.current.scrollLeft };
    setPanning(true);
  };

  if (loading) return <div className="skeleton h-72" aria-busy="true" aria-label="Carregando" />;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="search"
          className="field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nome, empresa, nicho, cidade…"
          aria-label="Buscar"
        />
        <button type="button" className="btn btn-primary shrink-0" onClick={() => setForm("new")}>+ Novo</button>
      </div>

      <ChipRow
        label="Estágio"
        value={filter}
        onChange={(next) => setFilter((prev) => (prev === next && next !== "todos" ? "todos" : next))}
        items={[
          { id: "todos", label: "Todos", count: count("todos") },
          { id: "retornar", label: "Retornar", count: count("retornar"), color: "#b42318" },
          ...STAGES.map((s) => ({ id: s.id as Filter, label: s.label, count: count(s.id), color: s.color })),
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-mute">
        {filter === "todos" ? (
          <span>
            {searchFiltered.length} {searchFiltered.length === 1 ? "contato" : "contatos"}
            {kanbanValue > 0 && <> · Pipeline: <b className="font-medium text-ink">{brl(kanbanValue)}</b></>}
          </span>
        ) : (
          <span>
            {shown.length} {shown.length === 1 ? "contato" : "contatos"}
            {totalValue > 0 && <> · Potencial: <b className="font-medium text-ink">{brl(totalValue)}</b></>}
          </span>
        )}
        <button
          type="button"
          aria-pressed={onlyFollowUp}
          onClick={() => setOnlyFollowUp((v) => !v)}
          className={`btn min-h-9 rounded-full px-4 text-xs ${onlyFollowUp ? "btn-primary" : ""}`}
        >
          {onlyFollowUp ? "✓ Só retornos" : `Só retornos (${count("retornar")})`}
        </button>
      </div>

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}

      {filter !== "todos" ? (
        shown.length === 0 ? (
          <EmptyState
            title={contacts.length ? "Nenhum cliente neste filtro" : "Nenhum cliente cadastrado ainda"}
            hint={contacts.length ? "Toque em \"Todos\" para voltar ao Kanban." : "Toque em “+ Novo” para cadastrar o primeiro."}
          />
        ) : (
          <ul className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => (
              <ContactCard
                key={c.id}
                c={c}
                owner={c.owner_id ? byId.get(c.owner_id) : undefined}
                followUp={isFollowUp(c)}
                onOpen={() => setOpenState({ id: c.id })}
                onQuickStage={(stage) => quickStage(c, stage)}
              />
            ))}
          </ul>
        )
      ) : (
        <div
          ref={kanbanRef}
          onMouseDown={handleBoardMouseDown}
          className={`no-scrollbar grid grid-flow-col auto-cols-[minmax(265px,82vw)] items-start gap-3.5 overflow-x-auto pb-2 lg:auto-cols-[minmax(275px,1fr)] ${
            panning ? "cursor-grabbing select-none" : "lg:cursor-grab"
          }`}
        >
          {STAGES.map((s) => {
            const list = searchFiltered.filter((c) => c.stage === s.id);
            const colVal = list.reduce((sum, c) => sum + (c.value != null ? Number(c.value) || 0 : 0), 0);
            const isOver = over === s.id;
            return (
              <section
                key={s.id}
                data-stage-col={s.id}
                aria-label={s.label}
                style={{
                  borderColor: isOver ? s.color : `color-mix(in srgb, ${s.color} 22%, var(--line))`,
                  background: isOver
                    ? `color-mix(in srgb, ${s.color} 12%, var(--card))`
                    : `color-mix(in srgb, ${s.color} 4%, var(--card))`,
                }}
                className="flex max-h-[calc(100dvh-16.5rem)] min-w-0 flex-col rounded-2xl border p-3 transition lg:max-h-[calc(100dvh-14.5rem)]"
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(s.id);
                }}
                onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                onDrop={() => handleDropToStage(s.id)}
              >
                <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFilter(s.id)}
                      title={`Filtrar apenas ${s.label}`}
                      style={{
                        background: `color-mix(in srgb, ${s.color} 18%, transparent)`,
                        color: s.color,
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition hover:opacity-85"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                      <span className="truncate">{s.label}</span>
                    </button>
                    <span className="text-xs font-medium text-mute tabular-nums">{list.length}</span>
                  </div>
                  {colVal > 0 && (
                    <span className="shrink-0 text-xs font-medium text-mute tabular-nums">{brl(colVal)}</span>
                  )}
                </div>

                {list.length > 0 ? (
                  <ul className="col-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
                    {list.map((c) => (
                      <ContactCard
                        key={c.id}
                        c={c}
                        draggable
                        isDragging={draggingId === c.id}
                        owner={c.owner_id ? byId.get(c.owner_id) : undefined}
                        followUp={isFollowUp(c)}
                        onOpen={() => setOpenState({ id: c.id })}
                        onQuickStage={(stage) => quickStage(c, stage)}
                        onDragStart={() => {
                          dragId.current = c.id;
                          setDraggingId(c.id);
                        }}
                        onDragEnd={() => {
                          dragId.current = null;
                          setDraggingId(null);
                          setOver(null);
                        }}
                        onTouchDragStart={() => {
                          dragId.current = c.id;
                          setDraggingId(c.id);
                        }}
                        onTouchDragMove={handleTouchDragMove}
                        onTouchDragEnd={handleTouchDragEnd}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-xl border border-dashed border-line/80 p-4 text-center text-xs text-mute">
                    Arraste um contato para cá
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setForm("new")}
                  className="mt-2.5 flex w-full shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-mute transition hover:bg-[var(--grid)] hover:text-ink"
                >
                  <span aria-hidden>+</span> Adicionar contato
                </button>
              </section>
            );
          })}
        </div>
      )}

      {openState && (
        <ContactSheet
          id={openState.id}
          initialContact={contacts.find((x) => x.id === openState.id)}
          team={team}
          askLossInitially={openState.askLoss}
          onClose={() => setOpenState(null)}
          onChanged={() => load(true)}
          onEdit={(c) => setForm(c)}
          onDeleted={() => {
            const removed = openState.id;
            setOpenState(null);
            updateContactsCache((all) => all.filter((x) => x.id !== removed));
          }}
        />
      )}

      {form && (
        <ContactForm
          initial={form === "new" ? undefined : form}
          team={team}
          onClose={() => setForm(null)}
          onSaved={(c) => {
            const isNew = form === "new";
            setForm(null);
            updateContactsCache((all) => (isNew ? [c, ...all] : all.map((x) => (x.id === c.id ? c : x))));
            if (isNew) setOpenState({ id: c.id });
          }}
        />
      )}
    </div>
  );
}
