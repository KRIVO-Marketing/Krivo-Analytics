"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { opsCall } from "@/lib/api";
import { getCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchContacts, updateContactsCache } from "@/lib/data";
import { brl, dueInfo, KINDS, nameOf, phoneFmt, prettyNote, STAGES, stageOf, todayISO, waLink, type Contact, type Interaction, type Member, type Stage } from "@/lib/ops";
import { useMe } from "./AuthGate";
import { ChipRow, EmptyState, FormError, Pill, useTeam } from "./opsui";
import { ErrorBox, Modal } from "./ui";

type Filter = "todos" | "retornar" | Stage;

export default function CrmTab() {
  const team = useTeam();
  const [contacts, setContacts] = useState<Contact[]>(() => getCached<Contact[]>(CACHE_KEYS.contacts) ?? []);
  const [loading, setLoading] = useState(() => getCached<Contact[]>(CACHE_KEYS.contacts) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<Contact | "new" | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      setContacts(await fetchContacts(force));
      setError(null);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const unsub = subscribeCache(CACHE_KEYS.contacts, () => {
      const cached = getCached<Contact[]>(CACHE_KEYS.contacts);
      if (cached) { setContacts(cached); setLoading(false); }
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
  const count = (f: Filter) => (f === "todos" ? contacts.length : f === "retornar" ? contacts.filter(isFollowUp).length : contacts.filter((c) => c.stage === f).length);

  if (loading) return <div className="skeleton h-72" aria-busy="true" aria-label="Carregando" />;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input type="search" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome, empresa, nicho, cidade…" aria-label="Buscar" />
        <button type="button" className="btn btn-primary shrink-0" onClick={() => setForm("new")}>+ Novo</button>
      </div>
      <ChipRow label="Estágio" value={filter} onChange={setFilter}
        items={[
          { id: "todos", label: "Todos", count: count("todos") },
          { id: "retornar", label: "Retornar", count: count("retornar") },
          ...STAGES.map((s) => ({ id: s.id as Filter, label: s.label, count: count(s.id), color: s.color })),
        ]} />
      {error && <ErrorBox message={error} onRetry={() => load(true)} />}

      {shown.length === 0 ? (
        <EmptyState title={contacts.length ? "Nenhum cliente neste filtro" : "Nenhum cliente cadastrado ainda"} hint={contacts.length ? undefined : "Toque em “+ Novo” para cadastrar o primeiro."} />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => {
            const st = stageOf(c.stage)!;
            const due = isFollowUp(c) ? dueInfo(c.next_contact_at) : c.next_contact_at ? dueInfo(c.next_contact_at) : null;
            const sub = [c.company, c.niche, c.city].filter(Boolean).join(" · ");
            return (
              <li key={c.id} className="card flex items-stretch">
                <button type="button" onClick={() => setOpenId(c.id)} className="min-w-0 flex-1 p-3 text-left">
                  <span className="block truncate text-base font-normal">{c.name}</span>
                  {sub && <span className="block truncate text-sm text-mute">{sub}</span>}
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Pill color={st.color}>{st.label}</Pill>
                    {c.value != null && <span className="text-xs text-mute">{brl(c.value)}</span>}
                    {due && c.stage !== "fechado" && c.stage !== "perdido" && (
                      <span className={`text-xs ${due.late ? "text-neg" : due.soon ? "text-accent" : "text-mute"}`}>Retornar: {due.text}</span>
                    )}
                  </span>
                </button>
                {c.phone && (
                  <a href={waLink(c.phone)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir WhatsApp de ${c.name}`}
                    className="flex w-14 shrink-0 items-center justify-center border-l border-line text-sm text-accent hover:bg-[var(--accent-soft)]">
                    <span aria-hidden className="text-xl">💬</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {openId && (
        <ContactSheet id={openId} team={team} onClose={() => setOpenId(null)} onChanged={() => load(true)}
          onEdit={(c) => setForm(c)} onDeleted={() => { const removed = openId; setOpenId(null); updateContactsCache((all) => all.filter((x) => x.id !== removed)); }} />
      )}
      {form && (
        <ContactForm initial={form === "new" ? undefined : form} team={team} onClose={() => setForm(null)}
          onSaved={(c) => {
            const isNew = form === "new";
            setForm(null);
            updateContactsCache((all) => (isNew ? [c, ...all] : all.map((x) => (x.id === c.id ? c : x))));
            if (isNew) setOpenId(c.id);
          }} />
      )}
    </div>
  );
}

function ContactSheet({ id, team, onClose, onChanged, onEdit, onDeleted }: { id: string; team: Member[]; onClose: () => void; onChanged: () => void; onEdit: (c: Contact) => void; onDeleted: () => void }) {
  const { me } = useMe();
  const [data, setData] = useState<{ contact: Contact; interactions: Interaction[]; tasks: { id: string; title: string; status: string; due_date: string | null }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState("nota");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [lossReason, setLossReason] = useState("");
  const [askLoss, setAskLoss] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async () => {
    try { setData(await opsCall({ action: "contact_get", id })); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const setStage = (stage: Stage) => {
    if (stage === "perdido") { setAskLoss(true); return; }
    setAskLoss(false);
    run(() => opsCall({ action: "contact_update", id, stage }));
  };
  const addNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    run(async () => { await opsCall({ action: "interaction_add", contact_id: id, kind, body }); setBody(""); });
  };

  const c = data?.contact;
  const owner = c?.owner_id ? team.find((m) => m.id === c.owner_id) : undefined;
  return (
    <Modal title={c?.name ?? "Cliente"} onClose={() => !busy && onClose()}>
      {!c ? (err ? <p role="alert" className="text-neg">{err}</p> : <div className="skeleton h-40" aria-busy="true" />) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {c.phone ? <a className="btn" href={waLink(c.phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a> : <span className="btn opacity-40" aria-disabled>WhatsApp</span>}
            {c.phone ? <a className="btn" href={`tel:+${c.phone}`}>Ligar</a> : <span className="btn opacity-40" aria-disabled>Ligar</span>}
            {c.instagram ? <a className="btn" href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noopener noreferrer">Instagram</a> : <span className="btn opacity-40" aria-disabled>Instagram</span>}
          </div>

          <div>
            <span className="label">Estágio</span>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <button key={s.id} type="button" disabled={busy} aria-pressed={c.stage === s.id} onClick={() => setStage(s.id)}
                  className={`btn ${c.stage === s.id ? "btn-primary" : ""}`}>{s.label}</button>
              ))}
            </div>
            {askLoss && (
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await opsCall({ action: "contact_update", id, stage: "perdido", loss_reason: lossReason }); setAskLoss(false); setLossReason(""); }); }}>
                <input className="field" value={lossReason} onChange={(e) => setLossReason(e.target.value)} maxLength={200} placeholder="Motivo da perda (opcional)" aria-label="Motivo da perda" autoFocus />
                <button type="submit" className="btn btn-danger shrink-0" disabled={busy}>Marcar perdido</button>
              </form>
            )}
            {c.stage === "perdido" && c.loss_reason && <p className="hint">Motivo: {c.loss_reason}</p>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {([
              ["WhatsApp", c.phone ? phoneFmt(c.phone) : ""], ["Empresa", c.company], ["Nicho", c.niche], ["Cidade", c.city],
              ["Origem", c.source], ["Valor", c.value != null ? brl(c.value) : ""], ["Responsável", owner ? nameOf(owner) : ""],
              ["Retornar em", c.next_contact_at ? dueInfo(c.next_contact_at)!.text : ""],
            ] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-mute">{k}</dt><dd className="break-words font-normal">{v}</dd></div>
            ))}
          </dl>
          {c.notes && <p className="whitespace-pre-wrap break-words rounded-xl border border-line p-3 text-sm">{c.notes}</p>}

          {data!.tasks.length > 0 && (
            <div>
              <span className="label">Tarefas deste cliente</span>
              <ul className="space-y-1 text-sm">
                {data!.tasks.map((t) => <li key={t.id} className={t.status === "concluida" ? "text-mute line-through" : ""}>• {t.title}</li>)}
              </ul>
            </div>
          )}

          <div>
            <span className="label">Histórico</span>
            <form onSubmit={addNote} className="space-y-2">
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {KINDS.map((k) => (
                  <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)} className={`btn shrink-0 ${kind === k.id ? "btn-primary" : ""}`}>{k.label}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <input className="field" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder="O que aconteceu?" aria-label="Novo registro" />
                <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !body.trim()}>Salvar</button>
              </div>
            </form>
            <ul className="mt-3 space-y-2">
              {data!.interactions.map((i) => (
                <li key={i.id} className="rounded-xl border border-line p-3 text-sm">
                  <span className="text-xs text-mute">{KINDS.find((k) => k.id === i.kind)?.label ?? i.kind} · {new Date(i.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <p className="whitespace-pre-wrap break-words">{prettyNote(i.body)}</p>
                </li>
              ))}
              {data!.interactions.length === 0 && <li className="text-sm text-mute">Nenhum registro ainda.</li>}
            </ul>
          </div>

          <FormError message={err} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {me.role === "admin" ? (confirmDel ? (
              <div className="flex gap-2">
                <button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={async () => {
                  setBusy(true); setErr(null);
                  try { await opsCall({ action: "contact_delete", id }); onDeleted(); }
                  catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
                }}>Confirmar exclusão</button>
                <button type="button" className="btn" onClick={() => setConfirmDel(false)}>Cancelar</button>
              </div>
            ) : <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>Excluir</button>) : <span />}
            <div className="flex gap-2">
              <button type="button" className="btn flex-1" onClick={onClose}>Fechar</button>
              <button type="button" className="btn btn-primary flex-1" onClick={() => onEdit(c)}>Editar</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ContactForm({ initial, team, onClose, onSaved }: { initial?: Contact; team: Member[]; onClose: () => void; onSaved: (c: Contact) => void }) {
  const { me } = useMe();
  const [v, setV] = useState({
    name: initial?.name ?? "", phone: initial?.phone ? phoneFmt(initial.phone) : "", company: initial?.company ?? "", niche: initial?.niche ?? "",
    city: initial?.city ?? "", instagram: initial?.instagram ? `@${initial.instagram}` : "", source: initial?.source ?? "",
    value: initial?.value != null ? String(initial.value).replace(".", ",") : "", next_contact_at: initial?.next_contact_at ?? "", owner_id: initial?.owner_id ?? (initial ? "" : me.id), notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const payload = { ...v, value: v.value.replace(",", "."), owner_id: v.owner_id || null, next_contact_at: v.next_contact_at || null };
      const r = await opsCall<{ contact: Contact }>(initial ? { action: "contact_update", id: initial.id, ...payload } : { action: "contact_create", ...payload });
      onSaved(r.contact);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title={initial ? "Editar cliente" : "Novo cliente"} onClose={() => !busy && onClose()} z={60}>
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="c-name">Nome</label><input id="c-name" className="field" value={v.name} onChange={set("name")} maxLength={80} required autoComplete="off" /></div>
        <div><label className="label" htmlFor="c-phone">WhatsApp</label><input id="c-phone" className="field" type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} placeholder="(19) 99999-9999" autoComplete="off" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="c-co">Empresa</label><input id="c-co" className="field" value={v.company} onChange={set("company")} maxLength={80} /></div>
          <div><label className="label" htmlFor="c-ni">Nicho</label><input id="c-ni" className="field" value={v.niche} onChange={set("niche")} maxLength={60} /></div>
          <div><label className="label" htmlFor="c-ci">Cidade</label><input id="c-ci" className="field" value={v.city} onChange={set("city")} maxLength={60} /></div>
          <div><label className="label" htmlFor="c-ig">Instagram</label><input id="c-ig" className="field" value={v.instagram} onChange={set("instagram")} placeholder="@usuario" autoCapitalize="none" /></div>
          <div><label className="label" htmlFor="c-so">Quem trouxe / origem</label><input id="c-so" className="field" value={v.source} onChange={set("source")} maxLength={60} /></div>
          <div><label className="label" htmlFor="c-va">Valor (R$)</label><input id="c-va" className="field" inputMode="decimal" value={v.value} onChange={set("value")} placeholder="0,00" /></div>
          <div>
            <label className="label" htmlFor="c-nx">Retornar em</label>
            <input id="c-nx" className="field" type="date" value={v.next_contact_at} onChange={set("next_contact_at")} />
          </div>
          <div>
            <label className="label" htmlFor="c-ow">Responsável</label>
            <select id="c-ow" className="field" value={v.owner_id} onChange={set("owner_id")}>
              <option value="">Sem responsável</option>
              {team.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}{m.id === me.id ? " (eu)" : ""}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label" htmlFor="c-no">Observações</label><textarea id="c-no" className="field" rows={3} value={v.notes} onChange={set("notes")} maxLength={2000} /></div>
        <FormError message={err} />
        <div className="flex gap-2">
          <button type="button" className="btn flex-1" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}
