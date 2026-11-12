// Tipos e rótulos de Tarefas e CRM. Regras de negócio ficam na função ops-api; aqui só apresentação.
export const TASK_STATUS = [
  { id: "a_fazer", label: "A fazer", short: "A fazer", color: "#626f94" },
  { id: "em_andamento", label: "Em andamento", short: "Fazendo", color: "#5560c8" },
  { id: "em_revisao", label: "Em revisão", short: "Revisão", color: "#b7791f" },
  { id: "concluida", label: "Concluída", short: "Feito", color: "#1a7f45" },
] as const;
export type TaskStatus = (typeof TASK_STATUS)[number]["id"];

export const STAGES = [
  { id: "triagem", label: "Triagem", color: "#626f94" },
  { id: "a_abordar", label: "A abordar", color: "#1a7f45" },
  { id: "abordado", label: "Abordado", color: "#7c5cc4" },
  { id: "respondeu", label: "Respondeu", color: "#3b6fb6" },
  { id: "reuniao_marcada", label: "Reunião marcada", color: "#0f8a8a" },
  { id: "proposta_enviada", label: "Proposta enviada", color: "#b7791f" },
  { id: "fechado", label: "Fechado", color: "#1a7f45" },
  { id: "perdido", label: "Perdido", color: "#b42318" },
] as const;
export type Stage = (typeof STAGES)[number]["id"];

export const KINDS = [
  { id: "nota", label: "Nota" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "ligacao", label: "Ligação" },
  { id: "reuniao", label: "Reunião" },
  { id: "email", label: "E-mail" },
] as const;

export type Task = {
  id: string; title: string; description: string | null; status: TaskStatus;
  assignee_id: string | null; due_date: string | null; tags: string[]; contact_id: string | null;
  position: number; completed_at: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type Contact = {
  id: string; name: string; company: string | null; phone: string | null; instagram: string | null;
  niche: string | null; city: string | null; source: string | null; stage: Stage; loss_reason: string | null;
  value: number | string | null; notes: string | null; owner_id: string | null; next_contact_at: string | null;
  created_at: string; updated_at: string;
};
export type Interaction = { id: string; contact_id: string; kind: string; body: string; created_at: string };
export type Member = { id: string; email: string };

export const stageOf = (id: string) => STAGES.find((s) => s.id === id);
export const nameOf = (m?: Member | null) => (m ? m.email.split("@")[0] : "");
export const initial = (m?: Member | null) => (m ? m.email.charAt(0).toUpperCase() : "?");

// "2026-11-12" -> hoje/amanhã/ontem/12 nov (sem fuso: compara só a data local)
export function dueInfo(d: string | null): { text: string; late: boolean; soon: boolean } | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(y, m - 1, day).getTime();
  const n = new Date(); const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const diff = Math.round((t - today) / 864e5);
  if (diff === 0) return { text: "Hoje", late: false, soon: true };
  if (diff === 1) return { text: "Amanhã", late: false, soon: true };
  if (diff === -1) return { text: "Ontem", late: true, soon: false };
  const showYear = y !== n.getFullYear();
  const text = new Date(y, m - 1, day).toLocaleDateString("pt-BR", showYear ? { day: "2-digit", month: "short", year: "numeric" } : { day: "2-digit", month: "short" }).replace(/\./g, "");
  return { text, late: diff < 0, soon: false };
}
export const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
export const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
export const brl = (v: number | string | null) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
export const phoneFmt = (p: string) => {
  const d = p.startsWith("55") && p.length >= 12 ? p.slice(2) : p;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
};

// Notas automáticas de mudança de estágio chegam como "Estágio: a_abordar → perdido": mostra os rótulos.
export function prettyNote(body: string) {
  const m = /^Estágio: (\w+) → (\w+)$/.exec(body);
  if (!m) return body;
  return `Estágio: ${stageOf(m[1])?.label ?? m[1]} → ${stageOf(m[2])?.label ?? m[2]}`;
}
