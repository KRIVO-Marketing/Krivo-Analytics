"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCached, setCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchCatalog } from "@/lib/data";
import { hasAnyPrice, priceLine, type CatalogItem } from "@/lib/ops";
import { EmptyState } from "../opsui";
import { ErrorBox } from "../ui";
import { ItemForm } from "./ItemForm";
import { ItemSheet } from "./ItemSheet";

const byOrder = (a: CatalogItem, b: CatalogItem) => a.position - b.position;

export default function CatalogTab() {
  const [items, setItems] = useState<CatalogItem[]>(() => getCached<CatalogItem[]>(CACHE_KEYS.catalog) ?? []);
  const [loading, setLoading] = useState(() => getCached<CatalogItem[]>(CACHE_KEYS.catalog) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: "product" | "rule"; item?: CatalogItem } | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      setItems(await fetchCatalog(force));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeCache(CACHE_KEYS.catalog, () => {
      const cached = getCached<CatalogItem[]>(CACHE_KEYS.catalog);
      if (cached) setItems(cached);
    });
    load();
    return unsub;
  }, [load]);

  const products = useMemo(() => items.filter((i) => i.kind === "product").sort(byOrder), [items]);
  const rules = useMemo(() => items.filter((i) => i.kind === "rule").sort(byOrder), [items]);
  const opened = openId ? items.find((i) => i.id === openId) ?? null : null;

  const term = q.trim().toLowerCase();
  const shown = term
    ? products.filter((p) =>
        [p.name, p.tagline, p.billing, p.summary, ...p.details.map((d) => `${d.label} ${d.text}`)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
    : products;

  const upsert = (item: CatalogItem) => {
    const prev = getCached<CatalogItem[]>(CACHE_KEYS.catalog) ?? items;
    setCached(CACHE_KEYS.catalog, prev.some((x) => x.id === item.id) ? prev.map((x) => (x.id === item.id ? item : x)) : [...prev, item]);
    setItems(getCached<CatalogItem[]>(CACHE_KEYS.catalog) ?? []);
  };
  const drop = (id: string) => {
    const prev = getCached<CatalogItem[]>(CACHE_KEYS.catalog) ?? items;
    setCached(CACHE_KEYS.catalog, prev.filter((x) => x.id !== id));
    setItems(getCached<CatalogItem[]>(CACHE_KEYS.catalog) ?? []);
  };

  if (loading) return <div className="skeleton h-64" aria-busy="true" aria-label="Carregando catálogo" />;

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} onRetry={() => load(true)} />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          className="field"
          placeholder="Buscar no catálogo…"
          aria-label="Buscar no catálogo"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn btn-primary shrink-0" onClick={() => setForm({ kind: "product" })}>
          + Novo produto
        </button>
      </div>

      <section aria-label="Produtos">
        {shown.length === 0 ? (
          <EmptyState
            title={term ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
            hint={term ? "Tente outra palavra." : "Toque em “Novo produto” para começar."}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className="card flex h-full w-full flex-col gap-2 p-4 text-left transition hover:border-[var(--accent)] focus-visible:outline-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-2xl font-semibold leading-none text-mute/70 tabular-nums">{p.code ?? ""}</span>
                    {p.billing && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-accent">
                        {p.billing}
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-ink">{p.name}</h3>
                    {p.tagline && <p className="text-xs text-mute">{p.tagline}</p>}
                  </div>
                  {p.summary && <p className="line-clamp-3 text-sm text-mute">{p.summary}</p>}
                  <p className={`mt-auto pt-1 text-sm font-medium ${hasAnyPrice(p) ? "text-ink" : "text-mute"}`}>
                    {priceLine(p) || "Sem cobrança definida"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!term && (
        <section aria-label="Regras comuns" className="card p-4 sm:p-5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Regras comuns</h2>
              <p className="text-xs text-mute">Valem para todos os produtos.</p>
            </div>
            <button type="button" className="btn shrink-0" onClick={() => setForm({ kind: "rule" })}>+ Regra</button>
          </div>
          {rules.length === 0 ? (
            <p className="py-3 text-sm text-mute">Nenhuma regra cadastrada.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpenId(r.id)} className="flex min-h-11 w-full flex-col gap-0.5 py-3 text-left">
                    <span className="text-sm font-medium text-ink">{r.name}</span>
                    {r.summary && <span className="text-sm text-mute">{r.summary}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {opened && !form && (
        <ItemSheet
          item={opened}
          onClose={() => setOpenId(null)}
          onEdit={(item) => setForm({ kind: item.kind, item })}
          onDeleted={(id) => {
            drop(id);
            setOpenId(null);
          }}
        />
      )}
      {form && (
        <ItemForm
          kind={form.kind}
          initial={form.item}
          onClose={() => setForm(null)}
          onSaved={(item) => {
            upsert(item);
            setForm(null);
            setOpenId(item.id);
          }}
        />
      )}
    </div>
  );
}
