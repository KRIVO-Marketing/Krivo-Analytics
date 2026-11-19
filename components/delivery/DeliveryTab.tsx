"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchContacts, fetchDeliveries } from "@/lib/data";
import { DELIVERY_STATUS, onDeliveryIntent, PASSWORD_WARNING, takePendingIntent, type DeliveryIntent, type DeliveryStatus, type DeliverySummary } from "@/lib/delivery";
import { nameOf, type Contact } from "@/lib/ops";
import { ChipRow, EmptyState, useTeam } from "../opsui";
import { ErrorBox } from "../ui";
import { DeliveryCard } from "./DeliveryCard";
import { DeliverySheet } from "./DeliverySheet";
import { ModelosView } from "./ModelosView";
import { StartDeliveryForm } from "./StartDeliveryForm";

type View = "clientes" | "modelos";

export default function DeliveryTab() {
  const team = useTeam();
  const [view, setView] = useState<View>("clientes");
  const [list, setList] = useState<DeliverySummary[]>(() => getCached<DeliverySummary[]>(CACHE_KEYS.deliveries) ?? []);
  const [contacts, setContacts] = useState<Contact[]>(() => getCached<Contact[]>(CACHE_KEYS.contacts) ?? []);
  const [loading, setLoading] = useState(() => getCached<DeliverySummary[]>(CACHE_KEYS.deliveries) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DeliveryStatus>("ativa");
  const [owner, setOwner] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [start, setStart] = useState<{ contactId?: string } | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      setList(await fetchDeliveries(force));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const u1 = subscribeCache(CACHE_KEYS.deliveries, () => setList(getCached<DeliverySummary[]>(CACHE_KEYS.deliveries) ?? []));
    const u2 = subscribeCache(CACHE_KEYS.contacts, () => setContacts(getCached<Contact[]>(CACHE_KEYS.contacts) ?? []));
    load(true);
    fetchContacts().then(setContacts).catch(() => {});
    return () => { u1(); u2(); };
  }, [load]);

  // pedidos vindos do CRM ("Iniciar entrega" / "Ver entrega")
  useEffect(() => {
    const handle = (i: DeliveryIntent | null) => {
      if (!i) return;
      takePendingIntent();
      setView("clientes");
      if (i.deliveryId) setOpenId(i.deliveryId);
      else setStart({ contactId: i.contactId });
    };
    handle(takePendingIntent());
    return onDeliveryIntent(handle);
  }, []);

  const busyContactIds = useMemo(() => new Set(list.filter((d) => d.status !== "concluida").map((d) => d.contact_id)), [list]);
  const counts = useMemo(() => Object.fromEntries(DELIVERY_STATUS.map((s) => [s.id, list.filter((d) => d.status === s.id).length])), [list]);
  const shown = list
    .filter((d) => d.status === status && (!owner || d.owner_id === owner))
    .sort((a, b) => b.overdue - a.overdue || a.started_at.localeCompare(b.started_at));

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Visões da Entrega" className="inline-flex rounded-2xl border border-line bg-card p-1">
        {([["clientes", "Clientes em entrega"], ["modelos", "Modelos"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
            className={`min-h-10 rounded-xl px-4 text-sm font-medium transition ${view === id ? "bg-[var(--accent)] text-white" : "text-mute hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      <p role="note" className="rounded-xl border border-[#b7791f]/40 bg-[#b7791f]/10 p-3 text-sm text-ink">{PASSWORD_WARNING}</p>

      {view === "modelos" ? (
        <ModelosView />
      ) : (
        <>
          {error && <ErrorBox message={error} onRetry={() => load(true)} />}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ChipRow
              label="Filtrar por status"
              value={status}
              onChange={setStatus}
              items={DELIVERY_STATUS.map((s) => ({ id: s.id, label: s.label, count: counts[s.id], color: s.color }))}
            />
            <div className="flex gap-2">
              <select className="field sm:w-48" aria-label="Filtrar por responsável" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Todos os responsáveis</option>
                {team.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
              </select>
              <button type="button" className="btn btn-primary shrink-0" onClick={() => setStart({})}>+ Iniciar entrega</button>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Carregando entregas">
              <div className="skeleton h-56" /><div className="skeleton h-56" /><div className="skeleton h-56" />
            </div>
          ) : shown.length === 0 ? (
            <EmptyState
              title={list.length === 0 ? "Nenhuma entrega ainda. Quando um contato fechar, inicie a entrega por aqui." : "Nenhuma entrega neste filtro."}
              hint={list.length === 0 ? "Use o botão Iniciar entrega ou abra o contato Fechado no CRM." : undefined}
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((d) => (
                <li key={d.id}>
                  <DeliveryCard d={d} owner={team.find((m) => m.id === d.owner_id)} onOpen={() => setOpenId(d.id)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {start && (
        <StartDeliveryForm
          contacts={contacts}
          team={team}
          busyContactIds={busyContactIds}
          initialContactId={start.contactId}
          onClose={() => setStart(null)}
          onCreated={(id) => {
            setStart(null);
            setStatus("ativa");
            load(true);
            setOpenId(id);
          }}
        />
      )}
      {openId && (
        <DeliverySheet
          id={openId}
          team={team}
          onClose={() => setOpenId(null)}
          onChanged={() => load(true)}
          onDeleted={() => { setOpenId(null); load(true); }}
        />
      )}
    </div>
  );
}
