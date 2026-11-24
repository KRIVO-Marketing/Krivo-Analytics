"use client";
import { useRef, useState } from "react";
import { opsCall } from "@/lib/api";
import {
  ATTACH_ACCEPT, ATTACH_MAX_FILES, FIN_CATEGORIES, openAttachment, removeAttachment, uploadAttachment,
  type FinAttachment, type FinEntry, type FinKind,
} from "@/lib/finance";
import { fileSize } from "@/lib/delivery";
import { parseBrl } from "@/lib/format";
import { todayISO } from "@/lib/ops";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Props = {
  kind: FinKind;
  initial?: FinEntry;
  defaultDate?: string;
  onClose: () => void;
  onSaved: (entries: FinEntry[]) => void;
  // atualiza a lista sem fechar o formulário (anexos enviados/removidos, lançamento salvo com falha parcial)
  onChanged: (entries: FinEntry[]) => void;
};

export function EntryForm({ kind: initKind, initial: initial0, defaultDate, onClose, onSaved, onChanged }: Props) {
  const [saved, setSaved] = useState<FinEntry | null>(null); // lançamento criado nesta sessão (quando algum anexo falhou)
  const initial = saved ?? initial0;
  const [kind, setKind] = useState<FinKind>(initial?.kind ?? initKind);
  const [v, setV] = useState({
    description: initial?.description ?? "",
    counterparty: initial?.counterparty ?? "",
    category: initial?.category ?? "",
    amount: initial ? String(initial.amount).replace(".", ",") : "",
    entry_date: initial?.entry_date ?? defaultDate ?? todayISO(),
    notes: initial?.notes ?? "",
  });
  const [paid, setPaid] = useState(initial ? initial.status === "paid" : false);
  const [repeat, setRepeat] = useState(false);
  const [months, setMonths] = useState("12");
  const [atts, setAtts] = useState<FinAttachment[]>(initial0?.attachments ?? []);
  const [queued, setQueued] = useState<File[]>([]); // anexos escolhidos antes de salvar um lançamento novo
  const [attBusy, setAttBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  const cats = FIN_CATEGORIES[kind];
  const category = cats.some((c) => c.id === v.category) ? v.category : cats[cats.length - 1].id;
  const out = kind === "out";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const amount = parseBrl(v.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor maior que zero, ex.: 120 ou 1.500,00.");
      const body = {
        kind, category, amount,
        description: v.description, counterparty: v.counterparty, notes: v.notes,
        entry_date: v.entry_date, status: paid ? "paid" : "pending",
      };
      if (initial) {
        const r = await opsCall<{ entry: FinEntry }>({ action: "finance_update", id: initial.id, ...body });
        onSaved([{ ...r.entry, attachments: atts }]);
      } else {
        const n = repeat ? Number(months) : 1;
        if (!Number.isInteger(n) || n < 1 || n > 36) throw new Error("A repetição deve ser de 1 a 36 meses.");
        const r = await opsCall<{ entries: FinEntry[] }>({ action: "finance_create", ...body, repeat_months: n });
        // anexos vão para o primeiro lançamento da série
        const first = r.entries[0];
        const done: FinAttachment[] = [];
        const failed: string[] = [];
        for (const f of queued) {
          try { done.push(await uploadAttachment(first.id, f)); } catch (e) { failed.push((e as Error).message); }
        }
        const created = r.entries.map((x, k) => (k === 0 ? { ...x, attachments: done } : x));
        if (!failed.length) return onSaved(created);
        // salvou, mas algum anexo falhou: mantém aberto (agora em modo edição) para tentar de novo
        onChanged(created);
        setSaved(created[0]);
        setAtts(done);
        setQueued([]);
        setErr(`Lançamento salvo, mas nem todos os anexos foram enviados. ${failed.join(" ")}`);
        return;
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = atts.length + queued.length;
  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (!files.length) return;
    setErr(null);
    if (total + files.length > ATTACH_MAX_FILES) return setErr(`Cada lançamento aceita até ${ATTACH_MAX_FILES} anexos.`);
    if (!initial) return setQueued((q) => [...q, ...files]); // novo: envia ao salvar
    setAttBusy("up");
    const added: FinAttachment[] = [];
    const fails: string[] = [];
    for (const f of files) {
      try { added.push(await uploadAttachment(initial.id, f)); } catch (e) { fails.push((e as Error).message); }
    }
    const next = [...atts, ...added];
    setAtts(next);
    if (added.length) onChanged([{ ...initial, ...(saved ?? {}), attachments: next }]);
    if (fails.length) setErr(fails.join(" "));
    setAttBusy(null);
  };
  const open = async (a: FinAttachment) => {
    setAttBusy(a.id);
    setErr(null);
    try { await openAttachment(a.id); } catch (e) { setErr((e as Error).message); } finally { setAttBusy(null); }
  };
  const drop = async (a: FinAttachment) => {
    if (!initial) return;
    setAttBusy(a.id);
    setErr(null);
    try {
      await removeAttachment(a.id);
      const next = atts.filter((x) => x.id !== a.id);
      setAtts(next);
      onChanged([{ ...initial, attachments: next }]);
    } catch (e) { setErr((e as Error).message); } finally { setAttBusy(null); }
  };

  return (
    <Modal title={initial ? "Editar lançamento" : out ? "Nova saída" : "Nova entrada"} onClose={() => !busy && onClose()} z={60}>
      <form onSubmit={submit} className="space-y-4">
        <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-2">
          {([["out", "Saída (gasto)"], ["in", "Entrada (recebimento)"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition ${kind === k ? (k === "in" ? "border-[var(--pos)] bg-[var(--pos-soft)] text-pos" : "border-[var(--neg)] bg-[var(--neg-soft)] text-neg") : "border-line text-mute hover:bg-[var(--surface-2)]"}`}>
              {label}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="f-desc">Descrição</label>
          <input id="f-desc" className="field" value={v.description} onChange={set("description")} maxLength={120} required autoComplete="off"
            placeholder={out ? "Ex.: Assinatura Canva, Meta Ads, Notion…" : "Ex.: Mensalidade cliente X"} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="f-amt">Valor (R$)</label>
            <input id="f-amt" className="field" inputMode="decimal" value={v.amount} onChange={set("amount")} required placeholder="0,00" autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="f-date">{paid ? "Data" : "Vencimento / previsão"}</label>
            <input id="f-date" type="date" className="field" value={v.entry_date} onChange={set("entry_date")} required />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="f-cat">Categoria</label>
            <select id="f-cat" className="field" value={category} onChange={set("category")}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-cp">{out ? "Pago a (opcional)" : "Recebido de (opcional)"}</label>
            <input id="f-cp" className="field" value={v.counterparty} onChange={set("counterparty")} maxLength={80} autoComplete="off" />
          </div>
        </div>

        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          {out ? "Já foi pago" : "Já foi recebido"}
        </label>

        {!initial && (
          <fieldset className="space-y-2 rounded-2xl border border-line p-3.5">
            <label className="flex min-h-11 items-center gap-2.5 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              Repete todo mês (assinatura, mensalidade…)
            </label>
            {repeat && (
              <div>
                <label className="label" htmlFor="f-rep">Quantos meses (incluindo este)</label>
                <input id="f-rep" className="field" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))} maxLength={2} />
                <p className="hint">Cria um lançamento por mês, no mesmo dia. Só o primeiro entra como {out ? "pago" : "recebido"}; os outros ficam pendentes até você marcar.</p>
              </div>
            )}
          </fieldset>
        )}

        <fieldset className="space-y-2 rounded-2xl border border-line p-3.5" disabled={busy}>
          <legend className="px-1 text-xs font-medium uppercase tracking-wider text-mute">Anexos</legend>
          {total === 0 && <p className="text-sm text-mute">Nota fiscal, comprovante, boleto… PDF, imagem, Excel ou Word, até 10 MB cada.</p>}
          <ul className="space-y-1.5">
            {atts.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm">
                <span aria-hidden>📎</span>
                <span className="min-w-0 flex-1 truncate text-ink" title={a.file_name}>{a.file_name} <span className="text-xs text-mute">· {fileSize(a.size_bytes)}</span></span>
                <button type="button" className="btn px-3" onClick={() => open(a)} disabled={attBusy !== null}>{attBusy === a.id ? "…" : "Baixar"}</button>
                <button type="button" className="btn btn-danger px-3" onClick={() => drop(a)} disabled={attBusy !== null} aria-label={`Remover ${a.file_name}`}>✕</button>
              </li>
            ))}
            {queued.map((f, k) => (
              <li key={`${f.name}-${k}`} className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm">
                <span aria-hidden>📎</span>
                <span className="min-w-0 flex-1 truncate text-ink">{f.name} <span className="text-xs text-mute">· {fileSize(f.size)} · envia ao salvar</span></span>
                <button type="button" className="btn btn-danger px-3" onClick={() => setQueued((q) => q.filter((_, j) => j !== k))} aria-label={`Tirar ${f.name}`}>✕</button>
              </li>
            ))}
          </ul>
          <input ref={fileInput} id="f-files" type="file" multiple accept={ATTACH_ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files)} />
          {total < ATTACH_MAX_FILES && (
            <label htmlFor="f-files" className={`btn w-full cursor-pointer ${attBusy === "up" ? "pointer-events-none opacity-50" : ""}`}>
              {attBusy === "up" ? "Enviando…" : "+ Anexar arquivo"}
            </label>
          )}
          {!initial && repeat && queued.length > 0 && <p className="hint">Em lançamentos repetidos, os anexos ficam só no primeiro mês.</p>}
        </fieldset>

        <div>
          <label className="label" htmlFor="f-notes">Observação (opcional)</label>
          <textarea id="f-notes" className="field" rows={2} value={v.notes} onChange={set("notes")} maxLength={500} />
        </div>

        <FormError message={err} />
        <div className="flex gap-2">
          <button type="button" className="btn flex-1" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}
