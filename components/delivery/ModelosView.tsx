"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { opsCall } from "@/lib/api";
import { setCached } from "@/lib/cache";
import { CACHE_KEYS, fetchDeliveryDocs, fetchDeliveryMessages, fetchDeliveryTemplates } from "@/lib/data";
import {
  calendarTitle, copyText, downloadUrl, fileSize, fmtDate, type DeliveryDoc, type DeliveryMessage, type DeliveryTemplate,
} from "@/lib/delivery";
import { useMe } from "../AuthGate";
import { FormError } from "../opsui";
import { ErrorBox, Modal } from "../ui";
import { TemplateEditor } from "./TemplateEditor";

const KIND_LABEL: Record<string, string> = { pdf: "PDF", docx: "Word", json: "JSON" };
const ACCEPT: Record<string, string> = { pdf: ".pdf,application/pdf", docx: ".docx", json: ".json,application/json" };

export function ModelosView() {
  const { me } = useMe();
  const isAdmin = me.role === "admin";
  const [docs, setDocs] = useState<DeliveryDoc[] | null>(null);
  const [messages, setMessages] = useState<DeliveryMessage[] | null>(null);
  const [templates, setTemplates] = useState<DeliveryTemplate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const [d, m, t] = await Promise.all([fetchDeliveryDocs(force), fetchDeliveryMessages(force), fetchDeliveryTemplates(force)]);
      setDocs(d);
      setMessages(m);
      setTemplates(t);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (err && !docs) return <ErrorBox message={err} onRetry={() => load(true)} />;
  if (!docs || !messages) return <div className="skeleton h-64" aria-busy="true" aria-label="Carregando modelos" />;

  const rules = templates.filter((t) => t.recurring).sort((a, b) => a.phase - b.phase || a.position - b.position);

  return (
    <div className="space-y-6">
      {err && <ErrorBox message={err} onRetry={() => load(true)} />}
      <p aria-live="polite" className="text-sm">{toast && <span className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-accent">{toast}</span>}</p>

      <section aria-labelledby="h-docs">
        <h2 id="h-docs" className="mb-2 text-base font-semibold text-ink">Documentos</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {docs.map((d) => (
            <DocCard key={d.slug} doc={d} isAdmin={isAdmin} onChanged={(nd) => {
              const next = docs.map((x) => (x.slug === nd.slug ? nd : x));
              setDocs(next);
              setCached(CACHE_KEYS.deliveryDocs, next);
              setToast("Modelo atualizado.");
            }} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-msgs">
        <h2 id="h-msgs" className="mb-1 text-base font-semibold text-ink">Mensagens prontas</h2>
        <p className="mb-2 text-xs text-mute">{"{{nome}}"} e {"{{sócio}}"} são trocados automaticamente quando você copia de dentro de uma entrega.</p>
        <ul className="space-y-3">
          {messages.map((m) => (
            <MessageCard key={m.key} m={m} isAdmin={isAdmin} onCopied={() => setToast(`"${m.title}" copiada.`)} onChanged={(nm) => {
              const next = messages.map((x) => (x.key === nm.key ? nm : x));
              setMessages(next);
              setCached(CACHE_KEYS.deliveryMessages, next);
              setToast("Mensagem atualizada.");
            }} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-std" className="card space-y-4 p-4">
        <h2 id="h-std" className="text-base font-semibold text-ink">Padrões</h2>
        <CalendarHelper onCopied={() => setToast("Título copiado.")} />
        <div>
          <p className="label">Regras de rotina</p>
          <ul className="divide-y divide-line text-sm">
            {rules.map((r) => (
              <li key={r.id} className="py-2">
                <p className="font-medium text-ink">{r.title}</p>
                {r.description && <p className="text-mute">{r.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {isAdmin && <TemplateEditor templates={templates} docs={docs} messages={messages} onChanged={(t) => { setTemplates(t); setCached(CACHE_KEYS.deliveryTemplates, t); }} />}
    </div>
  );
}

function CalendarHelper({ onCopied }: { onCopied: () => void }) {
  const [client, setClient] = useState("");
  const [kind, setKind] = useState("Alinhamento");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [y, m, d] = date.split("-").map(Number);
  const title = calendarTitle(client.trim() || "Nome do cliente", new Date(y, (m || 1) - 1, d || 1), kind.trim() || "Tipo de reunião");
  return (
    <div>
      <p className="label">Título de evento no Google Agenda</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="field" aria-label="Nome do cliente" placeholder="Nome do cliente" value={client} onChange={(e) => setClient(e.target.value)} />
        <input className="field" type="date" aria-label="Data da reunião" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="field" aria-label="Tipo de reunião" placeholder="Alinhamento" value={kind} onChange={(e) => setKind(e.target.value)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-ink">{title}</code>
        <button type="button" className="btn min-h-9 px-3 text-xs" onClick={async () => { if (await copyText(title)) onCopied(); }}>Copiar</button>
      </div>
    </div>
  );
}

function DocCard({ doc, isAdmin, onChanged }: { doc: DeliveryDoc; isAdmin: boolean; onChanged: (d: DeliveryDoc) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await opsCall<{ url: string }>({ action: "doc_url", slug: doc.slug });
      downloadUrl(r.url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 1) pede URL de envio, 2) envia direto ao Storage, 3) o servidor confere e troca
  const replace = async (f: File) => {
    setErr(null);
    if (f.size > 10 * 1024 * 1024) return setErr("O arquivo deve ter no máximo 10 MB.");
    setBusy(true);
    try {
      const up = await opsCall<{ path: string; signed_url: string; mime: string }>({ action: "doc_upload_url", slug: doc.slug, file_name: f.name, size_bytes: f.size });
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", new File([f], f.name, { type: up.mime }));
      const res = await fetch(up.signed_url, { method: "PUT", body, credentials: "omit" });
      if (!res.ok) throw new Error("Não foi possível enviar o arquivo. Tente de novo.");
      const r = await opsCall<{ doc: DeliveryDoc }>({ action: "doc_replace", slug: doc.slug, path: up.path, file_name: f.name });
      onChanged(r.doc);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{doc.title}</h3>
          {doc.description && <p className="text-sm text-mute">{doc.description}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-accent">{KIND_LABEL[doc.kind] ?? doc.kind}</span>
      </div>
      <p className="text-xs text-mute">
        {doc.file_name}{doc.size_bytes ? ` · ${fileSize(doc.size_bytes)}` : ""} · atualizado em {fmtDate(doc.updated_at.slice(0, 10))}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn btn-primary" onClick={download} disabled={busy}>Baixar</button>
        {isAdmin && (
          <>
            <input ref={file} type="file" accept={ACCEPT[doc.kind]} className="sr-only" id={`up-${doc.slug}`}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) replace(f); }} />
            <label htmlFor={`up-${doc.slug}`} className={`btn cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}
              tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.current?.click(); } }}>
              {busy ? "Enviando…" : "Substituir arquivo"}
            </label>
            <button type="button" className="btn" onClick={() => setEdit(true)} disabled={busy}>Editar</button>
          </>
        )}
      </div>
      <FormError message={err} />
      {edit && <DocEdit doc={doc} onClose={() => setEdit(false)} onSaved={(d) => { setEdit(false); onChanged(d); }} />}
    </li>
  );
}

function DocEdit({ doc, onClose, onSaved }: { doc: DeliveryDoc; onClose: () => void; onSaved: (d: DeliveryDoc) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [desc, setDesc] = useState(doc.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Editar modelo" onClose={() => !busy && onClose()}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const r = await opsCall<{ doc: DeliveryDoc }>({ action: "doc_update", slug: doc.slug, title, description: desc });
          onSaved(r.doc);
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <div><label className="label" htmlFor="doc-t">Título</label><input id="doc-t" className="field" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div><label className="label" htmlFor="doc-d">Descrição</label><textarea id="doc-d" className="field" rows={3} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <FormError message={err} />
        <div className="flex gap-2"><button type="button" className="btn flex-1" onClick={onClose}>Cancelar</button><button type="submit" className="btn btn-primary flex-1" disabled={busy}>Salvar</button></div>
      </form>
    </Modal>
  );
}

function MessageCard({ m, isAdmin, onCopied, onChanged }: { m: DeliveryMessage; isAdmin: boolean; onCopied: () => void; onChanged: (m: DeliveryMessage) => void }) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [body, setBody] = useState(m.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold text-ink">{m.title}</h3>
        <div className="flex gap-2">
          <button type="button" className="btn min-h-9 px-3 text-xs" onClick={async () => { if (await copyText(m.body)) onCopied(); }}>Copiar</button>
          {isAdmin && <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => setEdit(true)}>Editar</button>}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-mute">{m.body}</p>
      {edit && (
        <Modal title="Editar mensagem" onClose={() => !busy && setEdit(false)}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              const r = await opsCall<{ message: DeliveryMessage }>({ action: "message_update", key: m.key, title, body });
              setEdit(false);
              onChanged(r.message);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}>
            <div><label className="label" htmlFor={`mt-${m.key}`}>Título</label><input id={`mt-${m.key}`} className="field" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
            <div>
              <label className="label" htmlFor={`mb-${m.key}`}>Texto</label>
              <textarea id={`mb-${m.key}`} className="field" rows={6} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} required />
              <p className="hint">Variáveis: {"{{nome}}"}, {"{{sócio}}"}, {"{{produto}}"}. As outras ({"{{data}}"}, {"{{itens}}"}, {"{{lista}}"}) a equipe completa à mão.</p>
            </div>
            <FormError message={err} />
            <div className="flex gap-2"><button type="button" className="btn flex-1" onClick={() => setEdit(false)}>Cancelar</button><button type="submit" className="btn btn-primary flex-1" disabled={busy}>Salvar</button></div>
          </form>
        </Modal>
      )}
    </li>
  );
}
