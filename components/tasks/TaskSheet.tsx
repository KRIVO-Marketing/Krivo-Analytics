"use client";
import { useState } from "react";
import { opsCall } from "@/lib/api";
import { nameOf, TASK_STATUS, todayISO, type Contact, type Member, type Task, type TaskStatus } from "@/lib/ops";
import { useMe } from "../AuthGate";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Props = {
  task: Task;
  team: Member[];
  contacts: Contact[];
  onClose: () => void;
  onSaved: (t: Task) => void;
  onDeleted: (id: string) => void;
};

export function TaskSheet({ task, team, contacts, onClose, onSaved, onDeleted }: Props) {
  const { me } = useMe();
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [due, setDue] = useState(task.due_date ?? "");
  const [desc, setDesc] = useState(task.description ?? "");
  const [tags, setTags] = useState(task.tags.join(", "));
  const [contact, setContact] = useState(task.contact_id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await opsCall<{ task: Task }>({
        action: "task_update",
        id: task.id,
        title,
        status,
        assignee_id: assignee || null,
        due_date: due || null,
        description: desc,
        tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
        contact_id: contact || null,
      });
      onSaved(r.task);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    setErr(null);
    try {
      await opsCall({ action: "task_delete", id: task.id });
      onDeleted(task.id);
    } catch (e) {
      setErr((e as Error).message);
      setConfirmDel(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tarefa" onClose={() => !busy && onClose()}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="t-title">Título</label>
          <input id="t-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </div>
        <div>
          <span className="label">Status</span>
          <div className="grid grid-cols-2 gap-2">
            {TASK_STATUS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={status === s.id}
                onClick={() => setStatus(s.id)}
                className={`btn justify-start ${status === s.id ? "btn-primary" : ""}`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="t-asg">Responsável</label>
            <select id="t-asg" className="field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Sem responsável</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {nameOf(m)}
                  {m.id === me.id ? " (eu)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="t-due">Prazo</label>
            <input id="t-due" type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setDue(todayISO())}>Hoje</button>
              <button type="button" className="btn" onClick={() => setDue(tomorrow())}>Amanhã</button>
              {due && <button type="button" className="btn" onClick={() => setDue("")}>Limpar</button>}
            </div>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="t-desc">Descrição</label>
          <textarea id="t-desc" className="field" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} />
        </div>
        <div>
          <label className="label" htmlFor="t-cli">Cliente (CRM)</label>
          <select id="t-cli" className="field" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">Nenhum</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` · ${c.company}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="t-tags">Etiquetas</label>
          <input id="t-tags" className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ex.: urgente, proposta" />
          <p className="hint">Separe por vírgula. Até 5.</p>
        </div>
        <FormError message={err} />
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
          {confirmDel ? (
            <div className="flex gap-2">
              <button type="button" className="btn btn-danger flex-1" onClick={del} disabled={busy}>Confirmar exclusão</button>
              <button type="button" className="btn" onClick={() => setConfirmDel(false)}>Cancelar</button>
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)} disabled={busy}>Excluir</button>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={onClose} disabled={busy}>Fechar</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
