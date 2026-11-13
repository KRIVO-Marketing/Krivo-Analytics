"use client";
import { useState } from "react";
import { opsCall } from "@/lib/api";
import { nameOf, phoneFmt, type Contact, type Member } from "@/lib/ops";
import { useMe } from "../AuthGate";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Props = {
  initial?: Contact;
  team: Member[];
  onClose: () => void;
  onSaved: (c: Contact) => void;
};

export function ContactForm({ initial, team, onClose, onSaved }: Props) {
  const { me } = useMe();
  const [v, setV] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ? phoneFmt(initial.phone) : "",
    company: initial?.company ?? "",
    niche: initial?.niche ?? "",
    city: initial?.city ?? "",
    instagram: initial?.instagram ? `@${initial.instagram}` : "",
    source: initial?.source ?? "",
    value: initial?.value != null ? String(initial.value).replace(".", ",") : "",
    next_contact_at: initial?.next_contact_at ?? "",
    owner_id: initial?.owner_id ?? (initial ? "" : me.id),
    notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = { ...v, value: v.value.replace(",", "."), owner_id: v.owner_id || null, next_contact_at: v.next_contact_at || null };
      const r = await opsCall<{ contact: Contact }>(
        initial ? { action: "contact_update", id: initial.id, ...payload } : { action: "contact_create", ...payload },
      );
      onSaved(r.contact);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Editar cliente" : "Novo cliente"} onClose={() => !busy && onClose()} z={60}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="c-name">Nome</label>
          <input id="c-name" className="field" value={v.name} onChange={set("name")} maxLength={80} required autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="c-phone">WhatsApp</label>
          <input id="c-phone" className="field" type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} placeholder="(19) 99999-9999" autoComplete="off" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="c-co">Empresa</label><input id="c-co" className="field" value={v.company} onChange={set("company")} maxLength={80} /></div>
          <div><label className="label" htmlFor="c-ni">Nicho</label><input id="c-ni" className="field" value={v.niche} onChange={set("niche")} maxLength={60} /></div>
          <div><label className="label" htmlFor="c-ci">Cidade</label><input id="c-ci" className="field" value={v.city} onChange={set("city")} maxLength={60} /></div>
          <div><label className="label" htmlFor="c-ig">Instagram</label><input id="c-ig" className="field" value={v.instagram} onChange={set("instagram")} placeholder="@usuario" autoCapitalize="none" /></div>
          <div><label className="label" htmlFor="c-so">Quem trouxe / origem</label><input id="c-so" className="field" value={v.source} onChange={set("source")} maxLength={60} /></div>
          <div><label className="label" htmlFor="c-va">Valor (R$)</label><input id="c-va" className="field" inputMode="decimal" value={v.value} onChange={set("value")} placeholder="0,00" /></div>
          <div>
            <label className="label" htmlFor="c-nx">Retornar em</label>
            <input id="c-nx" className="field" type="date" value={v.next_contact_at} onChange={set("next_contact_at")} />
          </div>
          <div>
            <label className="label" htmlFor="c-ow">Responsável</label>
            <select id="c-ow" className="field" value={v.owner_id} onChange={set("owner_id")}>
              <option value="">Sem responsável</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {nameOf(m)}
                  {m.id === me.id ? " (eu)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div><label className="label" htmlFor="c-no">Observações</label><textarea id="c-no" className="field" rows={3} value={v.notes} onChange={set("notes")} maxLength={2000} /></div>
        <FormError message={err} />
        <div className="flex gap-2 pt-1">
          <button type="button" className="btn flex-1" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}
