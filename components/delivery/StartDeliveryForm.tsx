"use client";
import { useProducts } from "@/lib/useProducts";
import { useMemo, useState } from "react";
import { opsCall } from "@/lib/api";
import { BUNDLE_CODE, METODOLOGIA_CODES } from "@/lib/delivery";
import { nameOf, stageOf, todayISO, type Contact, type Member } from "@/lib/ops";
import { useMe } from "../AuthGate";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Props = {
  contacts: Contact[];
  team: Member[];
  busyContactIds: Set<string>;
  initialContactId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
};

export function StartDeliveryForm({ contacts, team, busyContactIds, initialContactId, onClose, onCreated }: Props) {
  const { me } = useMe();
  const products = useProducts();
  const [contactId, setContactId] = useState(initialContactId ?? "");
  const [codes, setCodes] = useState<string[]>([]);
  const [owner, setOwner] = useState(() => contacts.find((c) => c.id === initialContactId)?.owner_id ?? me.id);
  const [start, setStart] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // contatos "Fechado" primeiro; quem já tem entrega em andamento fica de fora
  const options = useMemo(
    () =>
      contacts
        .filter((c) => !busyContactIds.has(c.id) || c.id === initialContactId)
        .sort((a, b) => Number(b.stage === "fechado") - Number(a.stage === "fechado") || a.name.localeCompare(b.name, "pt-BR")),
    [contacts, busyContactIds, initialContactId],
  );
  const closed = options.filter((c) => c.stage === "fechado");
  const others = options.filter((c) => c.stage !== "fechado");
  const picked = contacts.find((c) => c.id === contactId);
  const metodologia = codes.includes(BUNDLE_CODE);

  const toggle = (code: string) => setCodes((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) return setErr("Escolha o cliente.");
    if (!codes.length) return setErr("Escolha pelo menos 1 produto.");
    setBusy(true);
    setErr(null);
    try {
      const r = await opsCall<{ delivery: { id: string } }>({
        action: "delivery_create",
        contact_id: contactId,
        product_codes: codes,
        owner_id: owner || null,
        started_at: start,
      });
      onCreated(r.delivery.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label = (c: Contact) => `${c.name}${c.company ? ` · ${c.company}` : ""}`;

  return (
    <Modal title="Iniciar entrega" onClose={() => !busy && onClose()} z={60}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="d-contact">Cliente (CRM)</label>
          <select id="d-contact" className="field" value={contactId} onChange={(e) => {
            setContactId(e.target.value);
            const c = contacts.find((x) => x.id === e.target.value);
            if (c?.owner_id) setOwner(c.owner_id);
          }} required>
            <option value="">Escolha um contato</option>
            {closed.length > 0 && (
              <optgroup label="Fechados">
                {closed.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Outros estágios">
                {others.map((c) => <option key={c.id} value={c.id}>{label(c)} ({stageOf(c.stage)?.label ?? c.stage})</option>)}
              </optgroup>
            )}
          </select>
          {picked && picked.stage !== "fechado" && <p className="hint">Este contato ainda não está como Fechado no CRM.</p>}
        </div>

        <fieldset>
          <legend className="label">Produtos contratados</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((p) => {
              const on = codes.includes(p.code);
              const implied = metodologia && METODOLOGIA_CODES.includes(p.code);
              return (
                <label key={p.code} className={`btn justify-start ${on ? "btn-primary" : ""} ${implied && !on ? "opacity-60" : ""}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(p.code)} />
                  <span className="tabular-nums opacity-70">{p.code}</span>
                  {p.name}
                </label>
              );
            })}
          </div>
          {metodologia && <p className="hint">A Metodologia KRIVO já inclui os itens de Diagnóstico, Local, Site, Social e Atende.</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="d-owner">Sócio responsável</label>
            <select id="d-owner" className="field" value={owner ?? ""} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Sem responsável</option>
              {team.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}{m.id === me.id ? " (eu)" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="d-start">Data de início</label>
            <input id="d-start" type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} required />
            <p className="hint">Os prazos do checklist e a fidelidade de 3 meses contam a partir daqui.</p>
          </div>
        </div>

        <FormError message={err} />
        <div className="flex gap-2 pt-1">
          <button type="button" className="btn flex-1" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Criando…" : "Iniciar entrega"}</button>
        </div>
      </form>
    </Modal>
  );
}
