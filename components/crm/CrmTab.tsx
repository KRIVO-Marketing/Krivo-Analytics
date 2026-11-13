"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [q, setQ] = useState("");
  const [openState, setOpenState] = useState<{ id: string; askLoss?: boolean } | null>(null);
  const [form, setForm] = useState<Contact | "new" | null>(null);

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

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (filter === "retornar" ? !isFollowUp(c) : filter !== "todos" && c.stage !== filter) return false;
      return !t || [c.name, c.company, c.niche, c.city, c.phone, c.instagram].some((v) => v?.toLowerCase().includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, filter, q, today]);

  const count = (f: Filter) =>
    f === "todos" ? contacts.length : f === "retornar" ? contacts.filter(isFollowUp).length : contacts.filter((c) => c.stage === f).length;

  const totalValue = useMemo(() => shown.reduce((sum, c) => sum + (c.value != null ? Number(c.value) || 0 : 0), 0), [shown]);

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
        onChange={setFilter}
        items={[
          { id: "todos", label: "Todos", count: count("todos") },
          { id: "retornar", label: "Retornar", count: count("retornar"), color: "#b42318" },
          ...STAGES.map((s) => ({ id: s.id as Filter, label: s.label, count: count(s.id), color: s.color })),
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-mute">
        <span>
          {shown.length} {shown.length === 1 ? "contato" : "contatos"}
        </span>
        {totalValue > 0 && <span>Potencial: <b className="font-medium text-ink">{brl(totalValue)}</b></span>}
      </div>

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}

      {shown.length === 0 ? (
        <EmptyState
          title={contacts.length ? "Nenhum cliente neste filtro" : "Nenhum cliente cadastrado ainda"}
          hint={contacts.length ? undefined : "Toque em “+ Novo” para cadastrar o primeiro."}
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
