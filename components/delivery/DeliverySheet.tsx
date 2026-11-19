"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { opsCall } from "@/lib/api";
import { getCached, invalidateCache, setCached } from "@/lib/cache";
import { CACHE_KEYS, fetchDeliveryDetail, fetchDeliveryDocs, fetchDeliveryMessages, updateTasksCache } from "@/lib/data";
import {
  CONTRACT_STATUS, copyText, DELIVERY_STATUS, downloadUrl, fillMessage, fmtDate, fmtDateTime, idleDays, isIdle, PASSWORD_WARNING,
  productByCode, termEnd, type DeliveryDetail, type DeliveryDoc, type DeliveryItem, type DeliveryMessage,
} from "@/lib/delivery";
import { nameOf, type Member, type Task } from "@/lib/ops";
import { useMe } from "../AuthGate";
import { FormError } from "../opsui";
import { Modal } from "../ui";
import { ChecklistPhase } from "./ChecklistPhase";
import { ContractForm } from "./ContractForm";
import { ProductChips, ProgressBar, TermBadge } from "./DeliveryCard";

type Props = { id: string; team: Member[]; onClose: () => void; onChanged: () => void; onDeleted: () => void };

export function DeliverySheet({ id, team, onClose, onChanged, onDeleted }: Props) {
  const { me } = useMe();
  const isAdmin = me.role === "admin";
  const [data, setData] = useState<DeliveryDetail | null>(() => getCached<DeliveryDetail>(CACHE_KEYS.deliveryDetail(id)) ?? null);
  const [docs, setDocs] = useState<DeliveryDoc[]>(() => getCached<DeliveryDoc[]>(CACHE_KEYS.deliveryDocs) ?? []);
  const [messages, setMessages] = useState<DeliveryMessage[]>(() => getCached<DeliveryMessage[]>(CACHE_KEYS.deliveryMessages) ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [contractOpen, setContractOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const d = await fetchDeliveryDetail(id, force);
      setData(d);
      setDetail(d.delivery.status_detail ?? "");
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load(true);
    fetchDeliveryDocs().then(setDocs).catch(() => {});
    fetchDeliveryMessages().then(setMessages).catch(() => {});
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = async () => {
    await load(true);
    onChanged();
  };
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refresh();
      if (msg) setToast(msg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const d = data?.delivery;
  const contact = data?.contact;
  const owner = d?.owner_id ? team.find((m) => m.id === d.owner_id) : undefined;

  const phases = useMemo(() => {
    const map = new Map<number, { title: string; items: DeliveryItem[] }>();
    for (const it of data?.items ?? []) {
      const p = map.get(it.phase) ?? { title: it.phase_title, items: [] };
      p.items.push(it);
      map.set(it.phase, p);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [data?.items]);
  const currentPhase = d?.current_phase?.phase;

  const updateItem = async (itemId: string, patch: Partial<DeliveryItem>) => {
    setBusyId(itemId);
    setErr(null);
    try {
      const r = await opsCall<{ item: DeliveryItem }>({ action: "delivery_item_update", id: itemId, ...patch });
      setData((cur) => {
        if (!cur) return cur;
        const items = cur.items.map((x) => (x.id === itemId ? r.item : x));
        const counted = items.filter((x) => !x.recurring);
        const next = { ...cur, items, delivery: { ...cur.delivery, done: counted.filter((x) => x.done).length } };
        setCached(CACHE_KEYS.deliveryDetail(id), next, 60_000);
        return next;
      });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const download = async (slug: string) => {
    setErr(null);
    try {
      const r = await opsCall<{ url: string }>({ action: "doc_url", slug });
      downloadUrl(r.url);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const msgVars = () => ({
    nome: (contact?.name ?? "").split(" ")[0] || contact?.company || undefined,
    sócio: owner ? nameOf(owner).split(" ")[0] : (me.name || me.email.split("@")[0]).split(" ")[0],
    socio: owner ? nameOf(owner).split(" ")[0] : (me.name || me.email.split("@")[0]).split(" ")[0],
    produto: d?.product_codes.map((c) => productByCode(c)?.name).filter(Boolean).join(", "),
  });
  const copyMessage = async (key: string) => {
    const m = messages.find((x) => x.key === key);
    if (!m) return setErr("Mensagem não encontrada. Veja em Modelos > Mensagens prontas.");
    const ok = await copyText(fillMessage(m.body, msgVars()));
    setToast(ok ? `Mensagem "${m.title}" copiada. Complete os campos entre [ ] antes de enviar.` : "Não foi possível copiar.");
  };

  const toTask = (it: DeliveryItem) =>
    run(async () => {
      const r = await opsCall<{ task: Task; emailWarning?: string }>({ action: "delivery_item_to_task", id: it.id });
      updateTasksCache((all) => [r.task, ...all.filter((t) => t.id !== r.task.id)]);
    }, "Tarefa criada em Tarefas, ligada ao cliente.");

  const setField = (patch: Record<string, unknown>) => run(() => opsCall({ action: "delivery_update", id, ...patch }));

  const addNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    run(async () => {
      await opsCall({ action: "delivery_note_add", delivery_id: id, body: note });
      setNote("");
    });
  };

  const downloadContract = async (cid: string) => {
    setErr(null);
    try {
      const r = await opsCall<{ url: string }>({ action: "contract_url", id: cid });
      downloadUrl(r.url);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Modal title={d?.title ?? "Entrega"} onClose={() => !busy && onClose()} wide>
      {!d || !data ? (
        err ? <p role="alert" className="text-neg">{err}</p> : <div className="skeleton h-64" aria-busy="true" aria-label="Carregando entrega" />
      ) : (
        <div className="space-y-5">
          <p role="note" className="rounded-xl border border-[#b7791f]/40 bg-[#b7791f]/10 p-3 text-sm text-ink">{PASSWORD_WARNING}</p>

          {/* cabeçalho */}
          <div className="card space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-mute">Cliente</p>
                <p className="font-medium text-ink">{contact?.name ?? "—"}{contact?.company ? ` · ${contact.company}` : ""}</p>
              </div>
              <ProductChips codes={d.product_codes} />
            </div>
            <ProgressBar done={d.done} total={d.total} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-mute">Início</dt><dd>{fmtDate(d.started_at)}</dd></div>
              <div><dt className="text-xs text-mute">Fim da fidelidade</dt><dd>{fmtDate(termEnd(d.started_at, d.min_term_months))}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-mute">Prazo mínimo</dt><dd><TermBadge startedAt={d.started_at} months={d.min_term_months} /></dd></div>
            </dl>
            {isIdle(d) && (
              <p className="rounded-lg bg-[#b7791f]/15 px-3 py-2 text-sm text-[#b7791f]">
                Sem interação há {idleDays(d.last_interaction_at)} dias. O sócio responsável chama no grupo.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <span className="label">Status</span>
                <div className="flex flex-wrap gap-1.5">
                  {DELIVERY_STATUS.map((s) => (
                    <button key={s.id} type="button" disabled={busy} aria-pressed={d.status === s.id}
                      className={`btn min-h-9 px-3 text-xs ${d.status === s.id ? "btn-primary" : ""}`}
                      onClick={() => d.status !== s.id && setField({ status: s.id })}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="d-owner-s">Responsável</label>
                <select id="d-owner-s" className="field" value={d.owner_id ?? ""} disabled={busy} onChange={(e) => setField({ owner_id: e.target.value || null })}>
                  <option value="">Sem responsável</option>
                  {team.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="d-detail">Situação</label>
                <input id="d-detail" className="field" maxLength={80} placeholder="Ex.: aguardando acessos" value={detail ?? ""}
                  onChange={(e) => setDetail(e.target.value)}
                  onBlur={() => (detail ?? "") !== (d.status_detail ?? "") && setField({ status_detail: detail })} />
              </div>
            </div>
          </div>

          {/* contrato */}
          <section className="card p-4" aria-label="Contrato">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Contrato</h3>
                <p className="text-xs text-mute">Status: {CONTRACT_STATUS[data.contract_status]}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={() => setContractOpen(true)}>
                  {data.contract_status === "nao_iniciado" ? "Preencher contrato" : "Abrir formulário do contrato"}
                </button>
              </div>
            </div>
            {data.contracts.length > 0 && (
              <ul className="mt-3 divide-y divide-line text-sm">
                {data.contracts.map((c) => {
                  const by = c.generated_by ? team.find((m) => m.id === c.generated_by) : undefined;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{c.file_name}</span>
                        <span className="text-xs text-mute">Gerado por {by ? nameOf(by) : "alguém da equipe"} em {fmtDateTime(c.generated_at)}</span>
                      </span>
                      <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => downloadContract(c.id)}>Baixar</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* checklist */}
          <section aria-label="Checklist" className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Checklist</h3>
            {phases.map(([phase, p]) => (
              <ChecklistPhase
                key={phase}
                phase={phase}
                title={p.title}
                items={p.items}
                defaultOpen={phase === currentPhase}
                team={team}
                busyId={busyId}
                docTitle={(s) => docs.find((x) => x.slug === s)?.title}
                messageTitle={(k) => messages.find((x) => x.key === k)?.title}
                onUpdate={updateItem}
                onDownload={download}
                onCopy={copyMessage}
                onContract={() => setContractOpen(true)}
                onTask={toTask}
              />
            ))}
          </section>

          {/* linha do tempo */}
          <section aria-label="Notas da entrega">
            <span className="label">Linha do tempo</span>
            <form onSubmit={addNote} className="flex gap-2">
              <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
                placeholder="O que aconteceu? (sem senhas)" aria-label="Nova nota" />
              <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !note.trim()}>Salvar</button>
            </form>
            <ul className="mt-3 space-y-2">
              {data.notes.map((n) => {
                const by = n.created_by ? team.find((m) => m.id === n.created_by) : undefined;
                return (
                  <li key={n.id} className="rounded-xl border border-line border-l-4 border-l-[var(--soft)] p-3 text-sm">
                    <span className="text-xs text-mute">{by ? nameOf(by) : "Equipe"} · {fmtDateTime(n.created_at)}</span>
                    <p className="mt-0.5 whitespace-pre-wrap break-words">{n.body}</p>
                  </li>
                );
              })}
              {data.notes.length === 0 && <li className="text-sm text-mute">Nenhuma nota ainda.</li>}
            </ul>
          </section>

          <p aria-live="polite" className="text-sm">
            {toast && <span className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-accent">{toast}</span>}
          </p>
          <FormError message={err} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
            {isAdmin ? (
              confirmDel ? (
                <div className="flex gap-2">
                  <button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try {
                      await opsCall({ action: "delivery_delete", id });
                      invalidateCache(CACHE_KEYS.deliveryDetail(id));
                      onDeleted();
                    } catch (e) {
                      setErr((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}>Confirmar exclusão</button>
                  <button type="button" className="btn" onClick={() => setConfirmDel(false)}>Cancelar</button>
                </div>
              ) : (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>Excluir entrega</button>
              )
            ) : <span />}
            <button type="button" className="btn" onClick={onClose}>Fechar</button>
          </div>
        </div>
      )}

      {contractOpen && data && (
        <ContractForm
          deliveryId={id}
          saved={data.delivery.contract_data}
          prefill={data.contract_prefill}
          onClose={() => { setContractOpen(false); refresh(); }}
          onSaved={() => invalidateCache(CACHE_KEYS.deliveryDetail(id))}
          onGenerated={refresh}
        />
      )}
    </Modal>
  );
}
