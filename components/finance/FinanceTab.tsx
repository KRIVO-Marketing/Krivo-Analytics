"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { opsCall } from "@/lib/api";
import { getCached, peekCached, setCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchFinance } from "@/lib/data";
import {
  amountOf, byCategory, categoryLabel, currentMonth, monthLong, monthOf, monthlySeries, shiftMonth, totalsFor,
  type FinEntry, type FinKind,
} from "@/lib/finance";
import { brl } from "@/lib/format";
import { todayISO } from "@/lib/ops";
import { EmptyState, FormError } from "../opsui";
import { ErrorBox, Modal } from "../ui";
import { CategoryBars, CumulativeLine, FlowBars } from "./FinanceCharts";
import { EntryForm } from "./EntryForm";

type Filter = "all" | "in" | "out" | "pending";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "in", label: "Entradas" },
  { id: "out", label: "Saídas" },
  { id: "pending", label: "Pendentes" },
];

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const signed = (e: FinEntry) => `${e.kind === "in" ? "+" : "−"} ${brl(amountOf(e))}`;

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: "pos" | "neg"; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-mute">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-mute">{sub}</p>}
    </div>
  );
}

function StatusBadge({ e, today, onToggle, busy }: { e: FinEntry; today: string; onToggle: () => void; busy: boolean }) {
  const paid = e.status === "paid";
  const late = !paid && e.entry_date < today;
  const label = paid ? (e.kind === "in" ? "Recebido" : "Pago") : late ? "Atrasado" : e.kind === "in" ? "A receber" : "A pagar";
  const cls = paid ? "bg-[var(--pos-soft)] text-pos" : late ? "bg-[var(--neg-soft)] text-neg" : "bg-[var(--surface-2)] text-mute";
  return (
    <button type="button" onClick={onToggle} disabled={busy}
      title={paid ? "Clique para voltar a pendente" : e.kind === "in" ? "Clique para marcar como recebido" : "Clique para marcar como pago"}
      className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium transition hover:opacity-80 disabled:opacity-50 ${cls}`}>
      {paid ? "✓ " : ""}{label}
    </button>
  );
}

export default function FinanceTab() {
  const [entries, setEntries] = useState<FinEntry[]>(() => getCached<FinEntry[]>(CACHE_KEYS.finance) ?? []);
  const [loading, setLoading] = useState(() => getCached<FinEntry[]>(CACHE_KEYS.finance) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ kind: FinKind; entry?: FinEntry } | null>(null);
  const [del, setDel] = useState<FinEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const today = todayISO();

  const load = useCallback(async (force = false) => {
    try {
      setEntries(await fetchFinance(force));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeCache(CACHE_KEYS.finance, () => {
      const cached = getCached<FinEntry[]>(CACHE_KEYS.finance);
      if (cached) setEntries(cached);
    });
    load();
    return unsub;
  }, [load]);

  const write = (fn: (prev: FinEntry[]) => FinEntry[]) => setCached(CACHE_KEYS.finance, fn(peekCached<FinEntry[]>(CACHE_KEYS.finance) ?? entries));
  const upsert = (list: FinEntry[]) =>
    write((prev) => {
      const byId = new Map(list.map((x) => [x.id, x]));
      const merged = prev.map((x) => { const n = byId.get(x.id); return n ? { ...x, ...n, attachments: n.attachments ?? x.attachments } : x; });
      const known = new Set(prev.map((x) => x.id));
      return [...merged, ...list.filter((x) => !known.has(x.id))];
    });

  const toggle = async (e: FinEntry) => {
    const next = e.status === "paid" ? "pending" : "paid";
    setBusyId(e.id);
    setActionErr(null);
    upsert([{ ...e, status: next }]); // otimista
    try {
      const r = await opsCall<{ entry: FinEntry }>({ action: "finance_update", id: e.id, status: next });
      upsert([r.entry]);
    } catch (err) {
      upsert([e]);
      setActionErr((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (e: FinEntry, scope: "one" | "following") => {
    setBusyId(e.id);
    setActionErr(null);
    try {
      const r = await opsCall<{ ids: string[] }>({ action: "finance_delete", id: e.id, scope });
      const gone = new Set(r.ids);
      write((prev) => prev.filter((x) => !gone.has(x.id)));
      setDel(null);
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const monthEntries = useMemo(
    () => entries.filter((e) => monthOf(e.entry_date) === month).sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at)),
    [entries, month],
  );
  const totals = useMemo(() => totalsFor(monthEntries), [monthEntries]);
  const series = useMemo(() => monthlySeries(entries, currentMonth(), 12), [entries]);
  const outCats = useMemo(() => byCategory(monthEntries, "out"), [monthEntries]);
  const inCats = useMemo(() => byCategory(monthEntries, "in"), [monthEntries]);
  const cash = series[series.length - 1]?.cumulative ?? 0;

  const term = q.trim().toLowerCase();
  const shown = monthEntries.filter((e) => {
    if (filter === "in" && e.kind !== "in") return false;
    if (filter === "out" && e.kind !== "out") return false;
    if (filter === "pending" && e.status !== "pending") return false;
    if (!term) return true;
    return [e.description, e.counterparty, categoryLabel(e.category), e.notes].filter(Boolean).join(" ").toLowerCase().includes(term);
  });

  if (loading) return <div className="skeleton h-64" aria-busy="true" aria-label="Carregando fluxo de caixa" />;

  const isNow = month === currentMonth();
  const hasAny = entries.length > 0;

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} onRetry={() => load(true)} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" className="btn px-3" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">←</button>
          <h2 className="min-w-44 text-center text-base font-semibold text-ink">{monthLong(month)}</h2>
          <button type="button" className="btn px-3" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">→</button>
          {!isNow && <button type="button" className="btn" onClick={() => setMonth(currentMonth())}>Hoje</button>}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn flex-1 sm:flex-none" onClick={() => setForm({ kind: "in" })}>+ Entrada</button>
          <button type="button" className="btn btn-primary flex-1 sm:flex-none" onClick={() => setForm({ kind: "out" })}>+ Saída</button>
        </div>
      </div>

      <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Entradas" value={brl(totals.in)} tone="pos" sub={totals.pendingIn > 0 ? `+ ${brl(totals.pendingIn)} a receber` : "recebidas no mês"} />
        <Stat label="Saídas" value={brl(totals.out)} tone="neg" sub={totals.pendingOut > 0 ? `+ ${brl(totals.pendingOut)} a pagar` : "pagas no mês"} />
        <Stat label="Resultado do mês" value={brl(totals.balance)} tone={totals.balance < 0 ? "neg" : totals.balance > 0 ? "pos" : undefined}
          sub={totals.pendingIn || totals.pendingOut ? `Previsto: ${brl(totals.balance + totals.pendingIn - totals.pendingOut)}` : "entradas − saídas"} />
        <Stat label="Caixa acumulado" value={brl(cash)} tone={cash < 0 ? "neg" : undefined} sub="tudo que já foi pago até hoje" />
      </section>

      {actionErr && <FormError message={actionErr} />}

      <section aria-label="Lançamentos" className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-base font-semibold text-ink">Lançamentos <span className="font-normal text-mute">· {shown.length}</span></h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div role="tablist" aria-label="Filtro" className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                  className={`min-h-9 shrink-0 rounded-full border px-3.5 text-sm ${filter === f.id ? "border-[var(--ink)] bg-[var(--btn)] text-[var(--btn-ink)]" : "border-line hover:bg-[var(--accent-soft)]"}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <input type="search" className="field sm:w-56" placeholder="Buscar…" aria-label="Buscar lançamentos" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            title={hasAny && (term || filter !== "all") ? "Nenhum lançamento com esse filtro" : "Nenhum lançamento neste mês"}
            hint={hasAny ? "Use “+ Entrada” ou “+ Saída” para registrar." : "Comece registrando as assinaturas e ferramentas que a KRIVO paga todo mês."}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th w-16">Data</th>
                    <th className="th">Descrição</th>
                    <th className="th">Categoria</th>
                    <th className="th text-right">Valor</th>
                    <th className="th">Situação</th>
                    <th className="th w-28"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id}>
                      <td className="td tabular-nums text-mute">{ddmm(e.entry_date)}</td>
                      <td className="td">
                        <p className="font-medium text-ink">{e.description}{e.series_id && <span className="ml-1.5 text-xs font-normal text-mute" title="Lançamento recorrente">↻</span>}{(e.attachments ?? []).length > 0 && <span className="ml-1.5 text-xs font-normal text-mute" title="Possui anexos">📎{(e.attachments ?? []).length}</span>}</p>
                        {e.counterparty && <p className="text-xs text-mute">{e.counterparty}</p>}
                      </td>
                      <td className="td text-mute">{categoryLabel(e.category)}</td>
                      <td className={`td text-right font-medium tabular-nums ${e.kind === "in" ? "text-pos" : "text-neg"}`}>{signed(e)}</td>
                      <td className="td"><StatusBadge e={e} today={today} busy={busyId === e.id} onToggle={() => toggle(e)} /></td>
                      <td className="td">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" className="btn px-3" onClick={() => setForm({ kind: e.kind, entry: e })} aria-label={`Editar ${e.description}`}>Editar</button>
                          <button type="button" className="btn btn-danger px-3" onClick={() => setDel(e)} aria-label={`Excluir ${e.description}`}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line sm:hidden">
              {shown.map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 text-left" onClick={() => setForm({ kind: e.kind, entry: e })}>
                      <p className="truncate text-sm font-medium text-ink">{e.description}{e.series_id && <span className="ml-1 text-xs font-normal text-mute">↻</span>}{(e.attachments ?? []).length > 0 && <span className="ml-1 text-xs font-normal text-mute">📎{(e.attachments ?? []).length}</span>}</p>
                      <p className="truncate text-xs text-mute">{ddmm(e.entry_date)} · {categoryLabel(e.category)}</p>
                    </button>
                    <p className={`shrink-0 text-sm font-semibold tabular-nums ${e.kind === "in" ? "text-pos" : "text-neg"}`}>{signed(e)}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <StatusBadge e={e} today={today} busy={busyId === e.id} onToggle={() => toggle(e)} />
                    <button type="button" className="min-h-9 px-2 text-xs text-mute hover:text-neg" onClick={() => setDel(e)}>Excluir</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Gráficos" className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Entradas x saídas</h2>
              <p className="text-xs text-mute">Últimos 12 meses (só o que foi pago). Toque num mês para abrir.</p>
            </div>
            <div className="flex shrink-0 gap-3 text-xs text-mute">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--pos)]" />Entradas</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--neg)]" />Saídas</span>
            </div>
          </div>
          <FlowBars series={series} selected={month} onSelect={setMonth} />
        </div>
        <div className="card p-4 sm:p-5">
          <div className="mb-2">
            <h2 className="text-base font-semibold text-ink">Caixa acumulado</h2>
            <p className="text-xs text-mute">Quanto sobrou somando tudo que já entrou e saiu.</p>
          </div>
          <CumulativeLine series={series} />
        </div>
        <div className="card p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">Saídas por categoria <span className="font-normal text-mute">· {monthLong(month)}</span></h2>
          <CategoryBars rows={outCats} color="var(--neg)" />
        </div>
        <div className="card p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">Entradas por categoria <span className="font-normal text-mute">· {monthLong(month)}</span></h2>
          <CategoryBars rows={inCats} color="var(--pos)" />
        </div>
      </section>

      {form && (
        <EntryForm
          kind={form.kind}
          initial={form.entry}
          defaultDate={isNow ? undefined : `${month}-01`}
          onClose={() => setForm(null)}
          onChanged={upsert}
          onSaved={(list) => {
            upsert(list);
            setForm(null);
            if (!form.entry && list[0]) setMonth(monthOf(list[0].entry_date));
          }}
        />
      )}

      {del && (
        <Modal title="Excluir lançamento" onClose={() => busyId !== del.id && setDel(null)} z={60}>
          <div className="space-y-4">
            <p className="text-sm text-ink">
              <span className="font-medium">{del.description}</span> · {signed(del)} em {ddmm(del.entry_date)}
            </p>
            {actionErr && <FormError message={actionErr} />}
            <div className="flex flex-col gap-2">
              <button type="button" className="btn btn-danger" disabled={busyId === del.id} onClick={() => remove(del, "one")}>
                {del.series_id ? "Excluir só este mês" : "Excluir"}
              </button>
              {del.series_id && (
                <button type="button" className="btn btn-danger" disabled={busyId === del.id} onClick={() => remove(del, "following")}>
                  Excluir este e os próximos meses
                </button>
              )}
              <button type="button" className="btn" onClick={() => setDel(null)} disabled={busyId === del.id}>Cancelar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
