"use client";
import { useCallback, useEffect, useState } from "react";
import { apiWrite } from "@/lib/api";
import { getCached, invalidateCache } from "@/lib/cache";
import { CACHE_KEYS, fetchInfo, fetchProperties } from "@/lib/data";
import type { Info, Property } from "@/lib/types";
import { useMe } from "../AuthGate";
import ClientForm from "../ClientForm";
import { ErrorBox, Modal } from "../ui";
import MetricsView from "./MetricsView";

type Confirm = { kind: "remove" | "deactivate"; p: Property };

export default function ClientsTab() {
  const canEdit = useMe().me.role === "admin"; // só esconde botões; quem recusa é o back-end
  const [info, setInfo] = useState<Info | null>(() => getCached<Info>(CACHE_KEYS.info) ?? null);
  const [list, setList] = useState<Property[] | null>(() => {
    const props = getCached<Property[]>(CACHE_KEYS.properties);
    return props ? props.filter((p) => p.kind === "client") : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit?: Property } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState<{ id: string; message: string } | null>(null);
  const [viewing, setViewing] = useState<Property | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      const [i, l] = await Promise.all([fetchInfo(force), fetchProperties(force)]);
      setInfo(i);
      setList(l.filter((p) => p.kind === "client"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.service_account_email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão */
    }
  };

  const toggle = async (p: Property) => {
    setRowErr(null);
    setBusy(true);
    try {
      await apiWrite({ action: "update", id: p.id, active: !p.active });
      invalidateCache(`metrics:${p.id}:`);
      await load(true);
    } catch (e) {
      setRowErr({ id: p.id, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    setConfirmErr(null);
    try {
      if (confirm.kind === "remove") await apiWrite({ action: "delete", id: confirm.p.id });
      else await apiWrite({ action: "update", id: confirm.p.id, active: false });
      invalidateCache(`metrics:${confirm.p.id}:`);
      setConfirm(null);
      await load(true);
    } catch (e) {
      setConfirmErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (viewing) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn" onClick={() => setViewing(null)}>← Voltar à lista</button>
          {list && list.length > 1 && (
            <select
              aria-label="Trocar cliente"
              value={viewing.id}
              onChange={(e) => {
                const next = list.find((p) => p.id === e.target.value);
                if (next) setViewing(next);
              }}
              className="field w-auto min-w-[12rem] flex-1 sm:flex-none"
            >
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <MetricsView propertyId={viewing.id} title={viewing.name} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Clientes</h2>
        {canEdit && (
          <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => setForm({})}>
            + Adicionar cliente
          </button>
        )}
      </div>

      {info && (
        <details className="card p-4" open={!list || list.length === 0}>
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-normal">
            <span>Como liberar o acesso no Google Analytics do cliente</span>
            <button
              type="button"
              className="btn min-h-9 px-3 text-xs"
              onClick={(e) => {
                e.preventDefault();
                copy();
              }}
            >
              {copied ? "✓ E-mail copiado" : "Copiar e-mail"}
            </button>
          </summary>
          <p className="mt-3 text-sm text-mute">
            No Google Analytics do cliente vá em <b className="text-ink">Administrador &gt; Acesso à propriedade</b> e adicione{" "}
            <b className="break-all text-ink">{info.service_account_email}</b> com a função <b className="text-ink">Leitor</b>.
          </p>
        </details>
      )}

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}
      {!error && list === null && <div className="skeleton h-40" aria-busy="true" aria-label="Carregando clientes" />}

      {list && list.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-lg">Nenhum cliente cadastrado ainda</p>
          {canEdit && (
            <button type="button" className="btn btn-primary mt-4" onClick={() => setForm({})}>
              Adicionar cliente
            </button>
          )}
        </div>
      )}

      {list && list.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((p) => (
            <li key={p.id} className="card flex flex-col justify-between p-4">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words text-lg">{p.name}</h3>
                    <p className="text-xs text-mute">ID GA4: {p.property_id}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs ${p.active ? "border-pos text-pos" : "border-line text-mute"}`}>
                    {p.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  Botão acompanhado:{" "}
                  {p.cta_event ? (
                    <>
                      <b className="break-words">{p.cta_label ?? "sem nome"}</b>{" "}
                      <span className="break-all text-mute">({p.cta_event})</span>
                    </>
                  ) : (
                    <span className="text-mute">não definido</span>
                  )}
                </p>
                {p.notes && <p className="mt-1 whitespace-pre-line break-words text-sm text-mute">{p.notes}</p>}
              </div>

              <div className="mt-3">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <button type="button" className="btn btn-primary col-span-2 sm:col-span-1" onClick={() => setViewing(p)}>
                    Ver métricas
                  </button>
                  {canEdit && (
                    <>
                      <button type="button" className="btn" onClick={() => setForm({ edit: p })}>Editar</button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => (p.active ? (setConfirmErr(null), setConfirm({ kind: "deactivate", p })) : toggle(p))}
                      >
                        {p.active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger col-span-2 sm:col-span-1"
                        onClick={() => {
                          setConfirmErr(null);
                          setConfirm({ kind: "remove", p });
                        }}
                      >
                        Remover
                      </button>
                    </>
                  )}
                </div>
                {rowErr?.id === p.id && <p role="alert" className="mt-3 rounded-xl border border-neg/50 p-3 text-neg">{rowErr.message}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <ClientForm
          initial={form.edit}
          onClose={() => setForm(null)}
          onSaved={() => {
            if (form.edit) invalidateCache(`metrics:${form.edit.id}:`);
            setForm(null);
            load(true);
          }}
        />
      )}

      {confirm && (
        <Modal title={confirm.kind === "remove" ? "Remover cliente" : "Desativar cliente"} onClose={() => !busy && setConfirm(null)}>
          <p>
            {confirm.kind === "remove" ? (
              <>Remover <b>{confirm.p.name}</b>? Essa ação não pode ser desfeita.</>
            ) : (
              <>Desativar <b>{confirm.p.name}</b>? As métricas deixam de ser consultadas até você ativar de novo.</>
            )}
          </p>
          {confirmErr && <p role="alert" className="mt-3 rounded-xl border border-neg/50 p-3 text-neg">{confirmErr}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancelar</button>
            <button
              type="button"
              className={`btn ${confirm.kind === "remove" ? "btn-danger" : "btn-primary"}`}
              onClick={runConfirm}
              disabled={busy}
            >
              {busy ? "Aguarde…" : confirm.kind === "remove" ? "Remover" : "Desativar"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
