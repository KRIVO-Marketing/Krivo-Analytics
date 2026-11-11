"use client";
import { useState } from "react";
import { apiWrite } from "@/lib/api";
import type { Property } from "@/lib/types";
import { Modal } from "./ui";

export default function ClientForm({ initial, onClose, onSaved }: { initial?: Property; onClose: () => void; onSaved: () => void }) {
  const edit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [pid, setPid] = useState(initial?.property_id ?? "");
  const [cta, setCta] = useState(initial?.cta_event ?? "");
  const [ctaLabel, setCtaLabel] = useState(initial?.cta_label ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (edit) {
        await apiWrite({ action: "update", id: initial!.id, name, cta_event: cta, cta_label: ctaLabel, notes });
      } else {
        const body: Record<string, unknown> = { action: "create", name, property_id: pid };
        if (cta.trim()) body.cta_event = cta;
        if (ctaLabel.trim()) body.cta_label = ctaLabel;
        if (notes.trim()) body.notes = notes;
        await apiWrite(body);
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={edit ? "Editar cliente" : "Adicionar cliente"} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="cf-name">Nome</label>
          <input id="cf-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cf-pid">ID da propriedade GA4</label>
          <input id="cf-pid" className="field" inputMode="numeric" value={pid} onChange={(e) => setPid(e.target.value)} disabled={edit} aria-describedby="cf-pid-h" />
          <p id="cf-pid-h" className="hint">{edit ? "O ID não muda. Para trocar, remova o cliente e cadastre de novo." : "Só números, ex.: 558329404. Está em Administrador > Detalhes da propriedade."}</p>
        </div>
        <div>
          <label className="label" htmlFor="cf-cta">Evento do botão (opcional)</label>
          <input id="cf-cta" className="field" value={cta} onChange={(e) => setCta(e.target.value)} aria-describedby="cf-cta-h" />
          <p id="cf-cta-h" className="hint">Nome do evento do GA4 que representa o clique que importa, ex.: clique_whatsapp.</p>
        </div>
        <div>
          <label className="label" htmlFor="cf-ctalabel">O que esse botão faz? (opcional)</label>
          <input id="cf-ctalabel" className="field" maxLength={80} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} aria-describedby="cf-ctalabel-h" />
          <p id="cf-ctalabel-h" className="hint">É o nome que o cliente vai ver, ex.: Agendar consulta pelo WhatsApp.</p>
        </div>
        <div>
          <label className="label" htmlFor="cf-notes">Observações (opcional)</label>
          <textarea id="cf-notes" rows={3} className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {busy && !edit && <p role="status" className="text-mute">Verificando acesso ao Google Analytics…</p>}
        {err && <p role="alert" className="rounded-xl border border-neg/50 p-3 text-neg">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || (!edit && !pid.trim())}>
            {busy ? (edit ? "Salvando…" : "Verificando…") : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
