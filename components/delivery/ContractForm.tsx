"use client";
import { useProducts } from "@/lib/useProducts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, opsCall } from "@/lib/api";
import { fetchContractFields } from "@/lib/data";
import { downloadUrl, PASSWORD_WARNING, productByKey, type FieldSpec } from "@/lib/delivery";
import {
  activeProducts, brl, buildRenderData, checkContract, dateExtenso, GROUP_PRODUCT, moneyText, parseMoney, validCNPJ, validCPF, type Spec,
} from "@/supabase/functions/ops-api/contract";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Data = Record<string, unknown>;
type Row = { item?: string; valor?: string; vencimento?: string; forma?: string };

const kindOf = (t: string) => t.split(":")[0];
const optionsOf = (t: string) => (t.split(":")[1] ?? "").split("|").filter(Boolean);
const COLS: { key: keyof Row; label: string; placeholder: string }[] = [
  { key: "item", label: "Item", placeholder: "Implantação" },
  { key: "valor", label: "Valor", placeholder: "1500" },
  { key: "vencimento", label: "Vencimento", placeholder: "25/11/2026 ou Todo dia 10" },
  { key: "forma", label: "Forma", placeholder: "Pix" },
];

// "25/11/2026" -> "25 de novembro de 2026"; texto livre fica como está
function normalizeDue(s: string) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return s;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const out = dateExtenso(iso);
  return out === iso ? s : out;
}

type Props = {
  deliveryId: string;
  saved: Data | null;
  prefill: Data;
  onClose: () => void;
  onSaved: () => void;
  onGenerated: () => void;
};

export function ContractForm({ deliveryId, saved, prefill, onClose, onSaved, onGenerated }: Props) {
  useProducts();
  const [spec, setSpec] = useState<Spec | null>(null);
  const [data, setData] = useState<Data>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errDetails, setErrDetails] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState<{ file: string; warnings: string[] } | null>(null);
  const [step, setStep] = useState<"form" | "preview">("form");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchContractFields()
      .then((r) => {
        const s = { fields: r.fields as FieldSpec[], computed: r.computed } as Spec;
        const base: Data = {};
        for (const f of s.fields) base[f.key] = f.default;
        const keys = new Set(s.fields.map((f) => f.key));
        const pick = (o: Data | null) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => keys.has(k)));
        setSpec(s);
        setData({ ...base, ...pick(prefill), ...pick(saved) });
      })
      .catch((e) => setLoadErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async (d: Data) => {
    setSaveState("saving");
    try {
      const r = await opsCall<{ saved_at: string }>({ action: "contract_save", delivery_id: deliveryId, data: d });
      setSaveState("saved");
      setSavedAt(r.saved_at);
      dirty.current = false;
      onSaved();
    } catch (e) {
      setSaveState("error");
      setErr((e as Error).message);
    }
  }, [deliveryId, onSaved]);

  // rascunho salvo a cada alteração (com 800 ms de espera para não salvar a cada tecla)
  const set = (key: string, value: unknown) => {
    setData((cur) => {
      const next = { ...cur, [key]: value };
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => save(next), 800);
      return next;
    });
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const check = useMemo(() => (spec ? checkContract(data, spec) : { errors: [], warnings: [] }), [spec, data]);
  const preview = useMemo(() => (spec ? buildRenderData(data, spec) : null), [spec, data]);
  const on = activeProducts((data.produtos as string[]) ?? []);

  const close = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (dirty.current) await save(data);
    onClose();
  };

  const generate = async () => {
    if (timer.current) clearTimeout(timer.current);
    setGenerating(true);
    setErr(null);
    setErrDetails([]);
    try {
      const r = await opsCall<{ url: string; file_name: string; warnings: string[] }>({ action: "contract_generate", delivery_id: deliveryId, data });
      dirty.current = false;
      downloadUrl(r.url);
      setDone({ file: r.file_name, warnings: r.warnings });
      onGenerated();
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof ApiError) setErrDetails(e.details);
    } finally {
      setGenerating(false);
    }
  };

  if (loadErr) return <Modal title="Contrato" onClose={onClose} z={60}><FormError message={loadErr} /></Modal>;
  if (!spec) return <Modal title="Contrato" onClose={onClose} z={60}><div className="skeleton h-64" aria-busy="true" /></Modal>;

  const groups = [...new Set(spec.fields.map((f) => f.group))].filter((g) => !GROUP_PRODUCT[g] || on[GROUP_PRODUCT[g] as keyof typeof on]);

  return (
    <Modal title="Contrato" onClose={close} z={60} wide>
      <div className="space-y-5">
        <p role="note" className="rounded-xl border border-[#b7791f]/40 bg-[#b7791f]/10 p-3 text-sm text-ink">{PASSWORD_WARNING}</p>

        <div className="flex items-center justify-between gap-3">
          <div role="tablist" aria-label="Etapas do contrato" className="flex gap-2">
            <button type="button" role="tab" aria-selected={step === "form"} className={`btn ${step === "form" ? "btn-primary" : ""}`} onClick={() => setStep("form")}>Preencher</button>
            <button type="button" role="tab" aria-selected={step === "preview"} className={`btn ${step === "preview" ? "btn-primary" : ""}`} onClick={() => setStep("preview")}>Pré-visualizar</button>
          </div>
          <span className="text-xs text-mute" aria-live="polite">
            {saveState === "saving" ? "Salvando rascunho…" : saveState === "saved" && savedAt ? `Rascunho salvo às ${new Date(savedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : saveState === "error" ? "Não foi possível salvar" : ""}
          </span>
        </div>

        {step === "form" ? (
          <div className="space-y-6">
            {groups.map((g) => (
              <fieldset key={g} className="card space-y-4 p-4">
                <legend className="px-1 text-sm font-semibold text-ink">{g}</legend>
                {spec.fields.filter((f) => f.group === g).map((f) => (
                  <Field key={f.key} f={f} data={data} set={set} hasSite={!!on.site} />
                ))}
              </fieldset>
            ))}
          </div>
        ) : (
          preview && <Preview p={preview} check={check} />
        )}

        {step === "form" && (check.errors.length > 0 || check.warnings.length > 0) && (
          <Issues errors={check.errors} warnings={check.warnings} />
        )}

        {done && (
          <div role="status" className="rounded-xl border border-[var(--pos)]/40 bg-[var(--pos-soft)] p-3 text-sm">
            <p className="font-medium text-ink">Contrato gerado: {done.file}</p>
            <p className="text-mute">O download começou. Confira o arquivo antes de enviar para assinatura.</p>
            {done.warnings.length > 0 && <ul className="mt-1 list-disc pl-5 text-mute">{done.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          </div>
        )}
        <FormError message={err} />
        {errDetails.length > 0 && <ul className="list-disc pl-5 text-sm text-neg">{errDetails.map((d) => <li key={d}>{d}</li>)}</ul>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn" onClick={close}>Fechar</button>
          {step === "form" && <button type="button" className="btn" onClick={() => setStep("preview")}>Pré-visualizar</button>}
          <button type="button" className="btn btn-primary" onClick={generate} disabled={generating || check.errors.length > 0}
            title={check.errors.length ? "Corrija os itens em vermelho para gerar" : undefined}>
            {generating ? "Gerando…" : "Gerar contrato (Word)"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SiteSplit({ onSplit }: { onSplit: (total: string) => void }) {
  const [total, setTotal] = useState("");
  const n = parseMoney(total);
  return (
    <div className="mb-3 rounded-xl border border-line bg-[var(--surface-2)] p-3">
      <p className="text-sm font-medium text-ink">KRIVO Site: 50% na entrada e 50% na entrega</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label" htmlFor="site-total">Valor total do projeto do Site</label>
          <input id="site-total" className="field" inputMode="decimal" placeholder="3000" value={total} onChange={(e) => setTotal(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary shrink-0" disabled={n === null || n <= 0} onClick={() => onSplit(total)}>Criar as 2 parcelas</button>
      </div>
      {n !== null && n > 0 && (
        <p className="hint">Entrada de {brl(Math.round(n * 100 / 2) / 100)} na assinatura e {brl(Math.round((n - Math.round(n * 100 / 2) / 100) * 100) / 100)} na entrega do site. Você pode ajustar as linhas depois.</p>
      )}
    </div>
  );
}

function Issues({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  return (
    <div className="space-y-2 text-sm">
      {errors.length > 0 && (
        <div className="rounded-xl border border-neg/40 p-3">
          <p className="font-medium text-neg">Falta para gerar</p>
          <ul className="mt-1 list-disc pl-5 text-neg">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-line p-3">
          <p className="font-medium text-ink">Vale conferir</p>
          <ul className="mt-1 list-disc pl-5 text-mute">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function Preview({ p, check }: { p: Record<string, unknown>; check: { errors: string[]; warnings: string[] } }) {
  const t = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : "—");
  const rows = (p.parcelas as Row[]) ?? [];
  return (
    <div className="space-y-4 text-sm">
      <dl className="card grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2">
        {([
          ["Contratante", t("nome_contratante")],
          ["Tipo", t("tipo_pessoa")],
          ["Documento", `${t("doc_tipo")} ${t("doc_numero")}`],
          ["Endereço", t("endereco")],
          ["E-mail", t("email")],
          ["WhatsApp", t("whatsapp")],
          ["Representante", p.representante ? (p.representante as string) : "Sem representante (a frase sai do contrato)"],
          ["Produtos", t("produtos_lista")],
          ["Início", t("data_inicio")],
          ["Prazo mínimo", `${t("prazo_minimo")} meses · aviso prévio de ${t("aviso_previo")} dias`],
          ["Aprovação prévia", p.aprov_previa ? `Sim, resposta em até ${t("prazo_aprovacao")} dias úteis` : "Dispensada"],
          ["Parceria", p.parceria ? "Sim (cláusula 10.4)" : "Não"],
        ] as const).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-mute">{k}</dt>
            <dd className="break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="card overflow-x-auto p-4">
        <p className="mb-2 text-xs text-mute">Valores (cláusula 8.1)</p>
        {rows.length === 0 ? <p className="text-neg">Nenhuma parcela.</p> : (
          <table className="w-full min-w-[32rem]">
            <thead><tr>{COLS.map((c) => <th key={c.key} className="th">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{COLS.map((c) => <td key={c.key} className="td">{r[c.key] || "—"}</td>)}</tr>)}</tbody>
          </table>
        )}
        {p.outra_forma ? <p className="hint">Outra forma: {p.outra_forma as string}</p> : null}
      </div>
      {check.errors.length === 0 && check.warnings.length === 0 ? (
        <p className="rounded-xl border border-[var(--pos)]/40 bg-[var(--pos-soft)] p-3 text-ink">Tudo certo para gerar.</p>
      ) : (
        <Issues errors={check.errors} warnings={check.warnings} />
      )}
    </div>
  );
}

function Field({ f, data, set, hasSite }: { f: FieldSpec; data: Data; set: (k: string, v: unknown) => void; hasSite?: boolean }) {
  const id = `cf-${f.key}`;
  const kind = kindOf(f.type);
  const opts = optionsOf(f.type);
  const v = data[f.key];
  const str = typeof v === "string" ? v : "";
  const label = (
    <label className="label" htmlFor={id}>
      {f.label}{f.required && kind !== "bool" ? <span className="text-neg" aria-hidden> *</span> : null}
    </label>
  );
  const help = f.help ? <p className="hint">{f.help}</p> : null;

  if (kind === "bool") {
    return (
      <div>
        <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
          <input id={id} type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={v === true} onChange={(e) => set(f.key, e.target.checked)} />
          <span className="text-sm text-ink">{f.label}</span>
        </label>
        {help}
      </div>
    );
  }
  if (kind === "select") {
    return (
      <fieldset>
        <legend className="label">{f.label}</legend>
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => (
            <button key={o} type="button" aria-pressed={str === o} className={`btn ${str === o ? "btn-primary" : ""}`} onClick={() => set(f.key, o)}>{o}</button>
          ))}
        </div>
        {f.key === "tipo_pessoa" && str === "pessoa jurídica" && !data.representante && (
          <p className="hint">Pessoa jurídica: preencha o representante (nome, CPF e cargo).</p>
        )}
        {help}
      </fieldset>
    );
  }
  if (kind === "multiselect") {
    const sel = Array.isArray(v) ? (v as string[]) : [];
    return (
      <fieldset>
        <legend className="label">{f.label} <span className="text-neg" aria-hidden>*</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {opts.map((o) => {
            const onIt = sel.includes(o);
            return (
              <label key={o} className={`btn justify-start has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-[var(--focus)] ${onIt ? "btn-primary" : ""}`}>
                <input type="checkbox" className="sr-only" checked={onIt} onChange={() => set(f.key, onIt ? sel.filter((x) => x !== o) : [...sel, o])} />
                {productByKey(o)?.name ?? o}
              </label>
            );
          })}
        </div>
        {help}
      </fieldset>
    );
  }
  if (kind === "rows") {
    const rows = Array.isArray(v) ? (v as Row[]) : [];
    const upd = (i: number, k: keyof Row, val: string) => set(f.key, rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
    // KRIVO Site: 50% na entrada e 50% na entrega. Cria as duas parcelas a partir do valor total do projeto.
    const splitSite = (totalText: string) => {
      const total = parseMoney(totalText);
      if (total === null || total <= 0) return;
      const first = Math.round(total * 100 / 2) / 100;
      const second = Math.round((total - first) * 100) / 100;
      const fmt = (n: number) => n.toFixed(2).replace(".", ",");
      const kept = rows.filter((r) => !/^KRIVO Site – (entrada|entrega)/.test(r.item ?? ""));
      set(f.key, [
        ...kept,
        { item: "KRIVO Site – entrada (50%)", valor: fmt(first), vencimento: "Na assinatura do contrato", forma: "Pix" },
        { item: "KRIVO Site – entrega (50%)", valor: fmt(second), vencimento: "Na entrega do site", forma: "Pix" },
      ]);
    };
    return (
      <fieldset>
        <legend className="label">{f.label} <span className="text-neg" aria-hidden>*</span></legend>
        {hasSite && <SiteSplit onSplit={splitSite} />}
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="rounded-xl border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {COLS.map((c) => (
                  <div key={c.key}>
                    <label className="label" htmlFor={`${id}-${i}-${c.key}`}>{c.label} {i + 1}</label>
                    <input id={`${id}-${i}-${c.key}`} className="field" maxLength={200} placeholder={c.placeholder} value={r[c.key] ?? ""}
                      inputMode={c.key === "valor" ? "decimal" : undefined}
                      onChange={(e) => upd(i, c.key, e.target.value)}
                      onBlur={c.key === "vencimento" ? (e) => { const n = normalizeDue(e.target.value); if (n !== e.target.value) upd(i, "vencimento", n); } : undefined} />
                    {c.key === "valor" && r.valor && <p className="hint">{moneyText(r.valor)}</p>}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-end">
                <button type="button" className="btn btn-danger min-h-9 px-3 text-xs" onClick={() => set(f.key, rows.filter((_, j) => j !== i))}>Remover parcela</button>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn mt-2" disabled={rows.length >= 24}
          onClick={() => set(f.key, [...rows, { item: rows.length ? "Mensalidade" : "Implantação", valor: "", vencimento: "", forma: "Pix" }])}>
          + Adicionar parcela
        </button>
        <p className="hint">Digite só o número no valor (ex.: 1500). O contrato sai com "R$ 1.500,00 (mil e quinhentos reais)". No vencimento, use 25/11/2026 ou um texto como "Todo dia 10, a partir de dezembro de 2026".</p>
      </fieldset>
    );
  }
  if (kind === "date_ptbr") {
    return (
      <div>
        {label}
        <input id={id} type="date" className="field" value={str} onChange={(e) => set(f.key, e.target.value)} />
        {str && <p className="hint">No contrato: {dateExtenso(str)}</p>}
      </div>
    );
  }
  if (kind === "textarea") {
    return (
      <div>
        {label}
        <textarea id={id} className="field" rows={4} maxLength={3000} value={str} onChange={(e) => set(f.key, e.target.value)} />
        {help}
      </div>
    );
  }
  // text / email
  let inline: string | null = null;
  if (f.key === "doc_numero" && str.replace(/\D/g, "").length >= 11) {
    const tipo = data.doc_tipo === "CNPJ" ? "CNPJ" : "CPF";
    const ok = tipo === "CNPJ" ? validCNPJ(str) : validCPF(str);
    inline = ok ? `${tipo} válido.` : `${tipo} inválido: confira os dígitos.`;
  }
  return (
    <div>
      {label}
      <input id={id} className="field" type={kind === "email" ? "email" : "text"} maxLength={400} value={str}
        inputMode={f.key === "doc_numero" || f.key === "whatsapp" ? "numeric" : undefined}
        autoComplete="off" onChange={(e) => set(f.key, e.target.value)} />
      {inline && <p className={`hint ${inline.includes("inválido") ? "text-neg" : ""}`}>{inline}</p>}
      {help}
    </div>
  );
}
