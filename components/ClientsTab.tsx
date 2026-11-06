"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRead, apiWrite } from "@/lib/api";
import type { Info, Property } from "@/lib/types";
import { useMe } from "./AuthGate";
import ClientForm from "./ClientForm";
import MetricsView from "./MetricsView";
import { ErrorBox, Modal } from "./ui";

type Confirm = { kind: "remove" | "deactivate"; p: Property };

export default function ClientsTab() {
  const canEdit = useMe().me.role === "admin"; // só esconde botões; quem recusa é o back-end
  const [info, setInfo] = useState<Info | null>(null);
  const [list, setList] = useState<Property[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit?: Property } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState<{ id: string; message: string } | null>(null);
  const [viewing, setViewing] = useState<Property | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [i, l] = await Promise.all([apiRead<Info>({ action: "info" }), apiRead<{ properties: Property[] }>({ action: "list" })]);
      setInfo(i);
      setList(l.properties.filter((p) => p.kind === "client"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const copy = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.service_account_email); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sem permissão */ }
  };

  const toggle = async (p: Property) => {
    setRowErr(null); setBusy(true);
    try { await apiWrite({ action: "update", id: p.id, active: !p.active }); await load(); }
    catch (e) { setRowErr({ id: p.id, message: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true); setConfirmErr(null);
    try {
      if (confirm.kind === "remove") await apiWrite({ action: "delete", id: confirm.p.id });
      else await apiWrite({ action: "update", id: confirm.p.id, active: false });
      setConfirm(null);
      await load();
    } catch (e) { setConfirmErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (viewing) {
    return (
      <div className="space-y-4">
        <button type="button" className="btn w-full sm:w-auto" onClick={() => setViewing(null)}>← Voltar à lista</button>
        <MetricsView propertyId={viewing.id} title={viewing.name} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Clientes</h2>
        {canEdit && <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => setForm({})}>Adicionar cliente</button>}
      </div>

      {info && (
        <div className="card p-4">
          <p>Para liberar a leitura, no Google Analytics do cliente vá em <b>Administrador &gt; Acesso à propriedade</b> e adicione{" "}
            <b className="break-all">{info.service_account_email}</b> com a função <b>Leitor</b>.</p>
          <button type="button" className="btn mt-3 w-full sm:w-auto" onClick={copy}>{copied ? "E-mail copiado" : "Copiar e-mail"}</button>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={load} />}
      {!error && list === null && <div className="skeleton h-40" aria-busy="true" aria-label="Carregando clientes" />}

      {list && list.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-lg">Nenhum cliente cadastrado ainda</p>
          {canEdit && <button type="button" className="btn btn-primary mt-4" onClick={() => setForm({})}>Adicionar cliente</button>}
        </div>
      )}

      {list && list.length > 0 && (
        <ul className="space-y-3">
          {list.map((p) => (
            <li key={p.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words text-lg">{p.name}</h3>
                  <p className="text-sm text-mute">ID GA4: {p.property_id}</p>
                </div>
                <span className={`rounded-full border px-3 py-0.5 text-sm ${p.active ? "border-pos text-pos" : "border-line text-mute"}`}>{p.active ? "Ativo" : "Inativo"}</span>
              </div>
              <p className="mt-2 text-sm">Evento do botão: {p.cta_event ? <b className="break-all">{p.cta_event}</b> : <span className="text-mute">não definido</span>}</p>
              {p.notes && <p className="mt-1 whitespace-pre-line break-words text-sm text-mute">{p.notes}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button type="button" className="btn" onClick={() => setViewing(p)}>Ver métricas</button>
                {canEdit && <>
                  <button type="button" className="btn" onClick={() => setForm({ edit: p })}>Editar</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => (p.active ? (setConfirmErr(null), setConfirm({ kind: "deactivate", p })) : toggle(p))}>{p.active ? "Desativar" : "Ativar"}</button>
                  <button type="button" className="btn btn-danger" onClick={() => { setConfirmErr(null); setConfirm({ kind: "remove", p }); }}>Remover</button>
                </>}
              </div>
              {rowErr?.id === p.id && <p role="alert" className="mt-3 rounded-xl border border-neg/50 p-3 text-neg">{rowErr.message}</p>}
            </li>
          ))}
        </ul>
      )}

      {form && <ClientForm initial={form.edit} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}

      {confirm && (
        <Modal title={confirm.kind === "remove" ? "Remover cliente" : "Desativar cliente"} onClose={() => !busy && setConfirm(null)}>
          <p>{confirm.kind === "remove" ? <>Remover <b>{confirm.p.name}</b>? Essa ação não pode ser desfeita.</> : <>Desativar <b>{confirm.p.name}</b>? As métricas deixam de ser consultadas até você ativar de novo.</>}</p>
          {confirmErr && <p role="alert" className="mt-3 rounded-xl border border-neg/50 p-3 text-neg">{confirmErr}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancelar</button>
            <button type="button" className={`btn ${confirm.kind === "remove" ? "btn-danger" : "btn-primary"}`} onClick={runConfirm} disabled={busy}>
              {busy ? "Aguarde…" : confirm.kind === "remove" ? "Remover" : "Desativar"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
