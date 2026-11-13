"use client";
import { useCallback, useEffect, useState } from "react";
import { opsCall } from "@/lib/api";
import { getCached, invalidateCache } from "@/lib/cache";
import { CACHE_KEYS, fetchContactDetail, type ContactDetail } from "@/lib/data";
import { brl, dueInfo, KINDS, nameOf, phoneFmt, prettyNote, STAGES, waLink, type Contact, type Member, type Stage } from "@/lib/ops";
import { useMe } from "../AuthGate";
import { IconInstagram, IconMessage, IconPhone } from "../Icons";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Props = {
  id: string;
  initialContact?: Contact;
  team: Member[];
  askLossInitially?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (c: Contact) => void;
  onDeleted: () => void;
};

export function ContactSheet({ id, initialContact, team, askLossInitially = false, onClose, onChanged, onEdit, onDeleted }: Props) {
  const { me } = useMe();
  const [data, setData] = useState<ContactDetail | null>(() => getCached<ContactDetail>(CACHE_KEYS.contactDetail(id)) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState("nota");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [lossReason, setLossReason] = useState("");
  const [askLoss, setAskLoss] = useState(askLossInitially);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      setData(await fetchContactDetail(id, force));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load(true);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStage = (stage: Stage) => {
    if (stage === "perdido") {
      setAskLoss(true);
      return;
    }
    setAskLoss(false);
    run(() => opsCall({ action: "contact_update", id, stage }));
  };

  const addNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    run(async () => {
      await opsCall({ action: "interaction_add", contact_id: id, kind, body });
      setBody("");
    });
  };

  const c = data?.contact ?? initialContact;
  const owner = c?.owner_id ? team.find((m) => m.id === c.owner_id) : undefined;

  return (
    <Modal title={c?.name ?? "Cliente"} onClose={() => !busy && onClose()}>
      {!c ? (
        err ? <p role="alert" className="text-neg">{err}</p> : <div className="skeleton h-40" aria-busy="true" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {c.phone ? (
              <a className="btn font-medium text-accent" href={waLink(c.phone)} target="_blank" rel="noopener noreferrer">
                <IconMessage size={16} />
                WhatsApp
              </a>
            ) : (
              <span className="btn opacity-40" aria-disabled>WhatsApp</span>
            )}
            {c.phone ? (
              <a className="btn" href={`tel:+${c.phone}`}>
                <IconPhone size={15} />
                Ligar
              </a>
            ) : (
              <span className="btn opacity-40" aria-disabled>Ligar</span>
            )}
            {c.instagram ? (
              <a className="btn" href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noopener noreferrer">
                <IconInstagram size={15} />
                Instagram
              </a>
            ) : (
              <span className="btn opacity-40" aria-disabled>Instagram</span>
            )}
          </div>

          <div>
            <span className="label">Pipeline</span>
            <div className="mb-2.5 flex gap-1" aria-hidden>
              {STAGES.filter((s) => s.id !== "perdido").map((s, idx, arr) => {
                const curIdx = arr.findIndex((x) => x.id === c.stage);
                const filled = c.stage !== "perdido" && curIdx >= idx;
                return (
                  <div
                    key={s.id}
                    className="h-1.5 flex-1 rounded-full transition-colors"
                    style={{ background: filled ? s.color : "var(--surface-2)" }}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={c.stage === s.id}
                  onClick={() => setStage(s.id)}
                  className={`btn ${c.stage === s.id ? "btn-primary" : ""}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: c.stage === s.id ? "currentColor" : s.color }} aria-hidden />
                  {s.label}
                </button>
              ))}
            </div>
            {askLoss && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await opsCall({ action: "contact_update", id, stage: "perdido", loss_reason: lossReason });
                    setAskLoss(false);
                    setLossReason("");
                  });
                }}
              >
                <input
                  className="field"
                  value={lossReason}
                  onChange={(e) => setLossReason(e.target.value)}
                  maxLength={200}
                  placeholder="Motivo da perda (opcional)"
                  aria-label="Motivo da perda"
                  autoFocus
                />
                <button type="submit" className="btn btn-danger shrink-0" disabled={busy}>Marcar perdido</button>
              </form>
            )}
            {c.stage === "perdido" && c.loss_reason && <p className="hint">Motivo: {c.loss_reason}</p>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line p-3.5 text-sm">
            {([
              ["WhatsApp", c.phone ? phoneFmt(c.phone) : ""],
              ["Empresa", c.company],
              ["Nicho", c.niche],
              ["Cidade", c.city],
              ["Origem", c.source],
              ["Valor", c.value != null ? brl(c.value) : ""],
              ["Responsável", owner ? nameOf(owner) : ""],
              ["Retornar em", c.next_contact_at ? dueInfo(c.next_contact_at)!.text : ""],
            ] as const)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-mute">{k}</dt>
                  <dd className="break-words font-normal">{v}</dd>
                </div>
              ))}
          </dl>

          {c.notes && <p className="whitespace-pre-wrap break-words rounded-2xl border border-line p-3.5 text-sm">{c.notes}</p>}

          {data && data.tasks.length > 0 && (
            <div>
              <span className="label">Tarefas deste cliente</span>
              <ul className="space-y-1 text-sm">
                {data.tasks.map((t) => (
                  <li key={t.id} className={t.status === "concluida" ? "text-mute line-through" : ""}>• {t.title}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <span className="label">Histórico</span>
            <form onSubmit={addNote} className="space-y-2">
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={kind === k.id}
                    onClick={() => setKind(k.id)}
                    className={`btn shrink-0 ${kind === k.id ? "btn-primary" : ""}`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="field"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={1000}
                  placeholder="O que aconteceu?"
                  aria-label="Novo registro"
                />
                <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !body.trim()}>Salvar</button>
              </div>
            </form>
            {!data ? (
              <div className="mt-3 space-y-2" aria-busy="true" aria-label="Carregando histórico">
                <div className="skeleton h-12" />
                <div className="skeleton h-12" />
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.interactions.map((i) => (
                  <li key={i.id} className="rounded-xl border border-line border-l-4 border-l-[var(--soft)] p-3 text-sm">
                    <span className="text-xs text-mute">
                      {KINDS.find((k) => k.id === i.kind)?.label ?? i.kind} ·{" "}
                      {new Date(i.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <p className="mt-0.5 whitespace-pre-wrap break-words">{prettyNote(i.body)}</p>
                  </li>
                ))}
                {data.interactions.length === 0 && <li className="text-sm text-mute">Nenhum registro ainda.</li>}
              </ul>
            )}
          </div>

          <FormError message={err} />
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
            {me.role === "admin" ? (
              confirmDel ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-danger flex-1"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setErr(null);
                      try {
                        await opsCall({ action: "contact_delete", id });
                        invalidateCache(CACHE_KEYS.contactDetail(id));
                        onDeleted();
                      } catch (e) {
                        setErr((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Confirmar exclusão
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDel(false)}>Cancelar</button>
                </div>
              ) : (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>Excluir</button>
              )
            ) : (
              <span />
            )}
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
