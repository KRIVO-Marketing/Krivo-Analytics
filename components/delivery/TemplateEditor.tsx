"use client";
import { useProducts } from "@/lib/useProducts";
import { useMemo, useState } from "react";
import { opsCall } from "@/lib/api";
import { BUNDLE_CODE, messageKeysOf, productByCode, type DeliveryDoc, type DeliveryMessage, type DeliveryTemplate } from "@/lib/delivery";
import { FormError } from "../opsui";
import { Modal } from "../ui";

// Modelo do checklist (só admin). Mudanças valem para entregas novas; as em andamento têm a própria cópia.
export function TemplateEditor({ templates, docs, messages, onChanged }: {
  templates: DeliveryTemplate[]; docs: DeliveryDoc[]; messages: DeliveryMessage[]; onChanged: (t: DeliveryTemplate[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryTemplate | "new" | null>(null);
  const phases = useMemo(() => {
    const map = new Map<number, { title: string; items: DeliveryTemplate[] }>();
    for (const t of [...templates].sort((a, b) => a.phase - b.phase || a.position - b.position)) {
      const p = map.get(t.phase) ?? { title: t.phase_title, items: [] };
      p.items.push(t);
      map.set(t.phase, p);
    }
    return [...map.entries()];
  }, [templates]);

  return (
    <section aria-labelledby="h-tpl" className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="h-tpl" className="text-base font-semibold text-ink">Modelo do checklist</h2>
          <p className="text-xs text-mute">Só administradores. As mudanças valem para entregas novas; as que já começaram não mudam.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Recolher" : `Ver ${templates.length} itens`}</button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>+ Item</button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-4">
          {phases.map(([phase, p]) => (
            <div key={phase}>
              <p className="label">Fase {phase} · {p.title}</p>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {p.items.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="flex min-h-11 w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]" onClick={() => setEditing(t)}>
                      <span className="min-w-0 flex-1 text-ink">{t.title}</span>
                      {t.product_code && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-accent">{productByCode(t.product_code)?.short}</span>}
                      {t.due_offset_days != null && <span className="text-xs text-mute">dia {t.due_offset_days}</span>}
                      {t.recurring && <span className="text-xs text-mute">regra</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <TemplateForm
          t={editing === "new" ? null : editing}
          phases={phases.map(([n, p]) => ({ n, title: p.title }))}
          docs={docs}
          messages={messages}
          onClose={() => setEditing(null)}
          onSaved={(saved, removedId) => {
            setEditing(null);
            if (removedId) onChanged(templates.filter((x) => x.id !== removedId));
            else if (saved) onChanged(templates.some((x) => x.id === saved.id) ? templates.map((x) => (x.id === saved.id ? saved : x)) : [...templates, saved]);
          }}
        />
      )}
    </section>
  );
}

function TemplateForm({ t, phases, docs, messages, onClose, onSaved }: {
  t: DeliveryTemplate | null; phases: { n: number; title: string }[]; docs: DeliveryDoc[]; messages: DeliveryMessage[];
  onClose: () => void; onSaved: (t: DeliveryTemplate | null, removedId?: string) => void;
}) {
  const products = useProducts();
  const [phase, setPhase] = useState(String(t?.phase ?? phases[0]?.n ?? 1));
  const [phaseTitle, setPhaseTitle] = useState(t?.phase_title ?? phases[0]?.title ?? "");
  const [title, setTitle] = useState(t?.title ?? "");
  const [desc, setDesc] = useState(t?.description ?? "");
  const [owner, setOwner] = useState(t?.owner_hint ?? "");
  const [product, setProduct] = useState(t?.product_code ?? "");
  const [offset, setOffset] = useState(t?.due_offset_days != null ? String(t.due_offset_days) : "");
  const [doc, setDoc] = useState(t?.doc_slug ?? "");
  const [msgs, setMsgs] = useState<string[]>(() => (t ? messageKeysOf(t) : []));
  const [recurring, setRecurring] = useState(t?.recurring ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const pickPhase = (v: string) => {
    setPhase(v);
    const known = phases.find((p) => String(p.n) === v);
    if (known) setPhaseTitle(known.title);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        phase: Number(phase), phase_title: phaseTitle, title, description: desc, owner_hint: owner,
        product_code: product || null, due_offset_days: offset === "" ? null : Number(offset),
        doc_slug: doc || null, message_keys: msgs, recurring,
      };
      const r = t
        ? await opsCall<{ template: DeliveryTemplate }>({ action: "delivery_template_update", id: t.id, ...payload })
        : await opsCall<{ template: DeliveryTemplate }>({ action: "delivery_template_create", ...payload });
      onSaved(r.template);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t ? "Editar item do modelo" : "Novo item do modelo"} onClose={() => !busy && onClose()}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div>
            <label className="label" htmlFor="tp-phase">Fase</label>
            <input id="tp-phase" className="field" type="number" min={1} max={20} value={phase} onChange={(e) => pickPhase(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="tp-ptitle">Nome da fase</label>
            <input id="tp-ptitle" className="field" maxLength={80} value={phaseTitle} onChange={(e) => setPhaseTitle(e.target.value)} required />
          </div>
        </div>
        <div><label className="label" htmlFor="tp-title">Título</label><input id="tp-title" className="field" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div><label className="label" htmlFor="tp-desc">Descrição curta</label><textarea id="tp-desc" className="field" rows={3} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="tp-prod">Produto</label>
            <select id="tp-prod" className="field" value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="">Toda entrega</option>
              {products.filter((p) => p.code !== BUNDLE_CODE).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="tp-owner">Responsável sugerido</label><input id="tp-owner" className="field" maxLength={40} placeholder="Sócio responsável" value={owner} onChange={(e) => setOwner(e.target.value)} /></div>
          <div><label className="label" htmlFor="tp-off">Prazo (dias após o início)</label><input id="tp-off" className="field" type="number" min={0} max={365} value={offset} onChange={(e) => setOffset(e.target.value)} /></div>
        </div>
        <div>
          <label className="label" htmlFor="tp-doc">Modelo para baixar</label>
          <select id="tp-doc" className="field" value={doc} onChange={(e) => setDoc(e.target.value)}>
            <option value="">Nenhum</option>
            {docs.map((d) => <option key={d.slug} value={d.slug}>{d.title}</option>)}
          </select>
        </div>
        <fieldset>
          <legend className="label">Mensagens prontas</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {messages.map((m) => (
              <label key={m.key} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={msgs.includes(m.key)}
                  onChange={(e) => setMsgs((cur) => (e.target.checked ? [...cur, m.key] : cur.filter((k) => k !== m.key)))} />
                {m.title}
              </label>
            ))}
          </div>
          <p className="hint">Com mais de uma, o item mostra um botão de copiar para cada mensagem.</p>
        </fieldset>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          Regra de rotina (aparece como regra, sem checkbox)
        </label>
        <FormError message={err} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {t ? (confirmDel ? (
            <div className="flex gap-2">
              <button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await opsCall({ action: "delivery_template_delete", id: t.id }); onSaved(null, t.id); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
              }}>Confirmar exclusão</button>
              <button type="button" className="btn" onClick={() => setConfirmDel(false)}>Cancelar</button>
            </div>
          ) : <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>Excluir</button>) : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
