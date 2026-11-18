"use client";
import { useState } from "react";
import { opsCall } from "@/lib/api";
import type { CatalogDetail, CatalogItem } from "@/lib/ops";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Props = {
  kind: "product" | "rule";
  initial?: CatalogItem;
  onClose: () => void;
  onSaved: (item: CatalogItem) => void;
};

// "1.500,50" | "1500.5" | "R$ 800" -> número (ou null se vazio)
function parseMoney(s: string): number | null {
  const t = s.replace(/R\$|\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  if (!Number.isFinite(n)) throw new Error("Preço inválido. Use só números, ex.: 1500 ou 1.500,00.");
  return n;
}
const moneyStr = (v: number | string | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export function ItemForm({ kind, initial, onClose, onSaved }: Props) {
  const isProduct = kind === "product";
  const [v, setV] = useState({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    tagline: initial?.tagline ?? "",
    billing: initial?.billing ?? "",
    summary: initial?.summary ?? "",
    upfront_label: initial?.upfront_label ?? "",
    price_upfront: moneyStr(initial?.price_upfront),
    price_monthly: moneyStr(initial?.price_monthly),
  });
  const [hasUpfront, setHasUpfront] = useState(initial ? !!initial.upfront_label : true);
  const [hasMonthly, setHasMonthly] = useState(initial ? initial.has_monthly : true);
  const [details, setDetails] = useState<CatalogDetail[]>(initial?.details ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  const setDetail = (i: number, patch: Partial<CatalogDetail>) =>
    setDetails((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const moveDetail = (i: number, dir: -1 | 1) =>
    setDetails((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      let payload: Record<string, unknown>;
      if (isProduct) {
        const cleaned = details.filter((d) => d.label.trim() || d.text.trim());
        if (cleaned.some((d) => !d.label.trim() || !d.text.trim())) {
          throw new Error("Cada tópico precisa de título e texto. Preencha os dois ou remova o tópico.");
        }
        if (hasUpfront && !v.upfront_label.trim()) {
          throw new Error("Dê um nome à cobrança inicial (ex.: Setup, Projeto ou Pontual) ou desmarque a opção.");
        }
        payload = {
          name: v.name,
          code: v.code,
          tagline: v.tagline,
          billing: v.billing,
          summary: v.summary,
          upfront_label: hasUpfront ? v.upfront_label : null,
          price_upfront: hasUpfront ? parseMoney(v.price_upfront) : null,
          has_monthly: hasMonthly,
          price_monthly: hasMonthly ? parseMoney(v.price_monthly) : null,
          details: cleaned,
        };
      } else {
        payload = { name: v.name, summary: v.summary };
      }
      const r = await opsCall<{ item: CatalogItem }>(
        initial ? { action: "catalog_update", id: initial.id, ...payload } : { action: "catalog_create", kind, ...payload },
      );
      onSaved(r.item);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = initial ? (isProduct ? "Editar produto" : "Editar regra") : isProduct ? "Novo produto" : "Nova regra";

  return (
    <Modal title={title} onClose={() => !busy && onClose()} z={60}>
      <form onSubmit={submit} className="space-y-4">
        {isProduct && (
          <fieldset className="space-y-3 rounded-2xl border border-line p-3.5">
            <legend className="px-1 text-xs font-medium uppercase tracking-wider text-mute">Preços</legend>

            <div className="space-y-2">
              <label className="flex min-h-11 items-center gap-2.5 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={hasUpfront} onChange={(e) => setHasUpfront(e.target.checked)} />
                Tem cobrança inicial (setup, projeto ou pontual)
              </label>
              {hasUpfront && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="i-ul">Nome da cobrança</label>
                    <input id="i-ul" className="field" value={v.upfront_label} onChange={set("upfront_label")} maxLength={30} placeholder="Setup" />
                  </div>
                  <div>
                    <label className="label" htmlFor="i-pu">Valor (R$)</label>
                    <input id="i-pu" className="field" inputMode="decimal" value={v.price_upfront} onChange={set("price_upfront")} placeholder="A definir" />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex min-h-11 items-center gap-2.5 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={hasMonthly} onChange={(e) => setHasMonthly(e.target.checked)} />
                Tem mensalidade
              </label>
              {hasMonthly && (
                <div>
                  <label className="label" htmlFor="i-pm">Mensalidade (R$/mês)</label>
                  <input id="i-pm" className="field" inputMode="decimal" value={v.price_monthly} onChange={set("price_monthly")} placeholder="A definir" />
                </div>
              )}
            </div>
            <p className="hint">Deixe o valor em branco para mostrar “a definir”.</p>
          </fieldset>
        )}

        <div>
          <label className="label" htmlFor="i-name">{isProduct ? "Nome do produto" : "Título da regra"}</label>
          <input id="i-name" className="field" value={v.name} onChange={set("name")} maxLength={80} required autoComplete="off" />
        </div>

        {isProduct && (
          <div className="grid gap-4 sm:grid-cols-[6rem_1fr_1fr]">
            <div>
              <label className="label" htmlFor="i-code">Nº</label>
              <input id="i-code" className="field" value={v.code} onChange={set("code")} maxLength={8} placeholder="06" />
            </div>
            <div>
              <label className="label" htmlFor="i-tag">Papel</label>
              <input id="i-tag" className="field" value={v.tagline} onChange={set("tagline")} maxLength={120} placeholder="Pilar: …" />
            </div>
            <div>
              <label className="label" htmlFor="i-bil">Tipo de cobrança</label>
              <input id="i-bil" className="field" value={v.billing} onChange={set("billing")} maxLength={40} placeholder="Setup + mensal" />
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="i-sum">{isProduct ? "Resumo" : "Texto"}</label>
          <textarea id="i-sum" className="field" rows={isProduct ? 3 : 4} value={v.summary} onChange={set("summary")} maxLength={1000} />
        </div>

        {isProduct && (
          <div>
            <span className="label">Tópicos (para quem, o que entrega, escopo…)</span>
            <ul className="space-y-3">
              {details.map((d, i) => (
                <li key={i} className="space-y-2 rounded-2xl border border-line p-3">
                  <div className="flex gap-2">
                    <input
                      className="field"
                      value={d.label}
                      onChange={(e) => setDetail(i, { label: e.target.value })}
                      maxLength={60}
                      placeholder="Título do tópico"
                      aria-label={`Título do tópico ${i + 1}`}
                    />
                    <button type="button" className="btn shrink-0 px-3" onClick={() => moveDetail(i, -1)} disabled={i === 0} aria-label="Subir tópico">↑</button>
                    <button type="button" className="btn shrink-0 px-3" onClick={() => moveDetail(i, 1)} disabled={i === details.length - 1} aria-label="Descer tópico">↓</button>
                    <button type="button" className="btn btn-danger shrink-0 px-3" onClick={() => setDetails((x) => x.filter((_, idx) => idx !== i))} aria-label="Remover tópico">✕</button>
                  </div>
                  <textarea
                    className="field"
                    rows={3}
                    value={d.text}
                    onChange={(e) => setDetail(i, { text: e.target.value })}
                    maxLength={800}
                    placeholder="Texto"
                    aria-label={`Texto do tópico ${i + 1}`}
                  />
                </li>
              ))}
            </ul>
            {details.length < 12 && (
              <button type="button" className="btn mt-3 w-full" onClick={() => setDetails((d) => [...d, { label: "", text: "" }])}>
                + Adicionar tópico
              </button>
            )}
          </div>
        )}

        <FormError message={err} />
        <div className="flex gap-2 pt-1">
          <button type="button" className="btn flex-1" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}
