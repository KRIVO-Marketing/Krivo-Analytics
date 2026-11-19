// Tipos e rótulos da aba Entrega. Regras de negócio ficam na função ops-api; aqui só apresentação.
import { todayISO } from "./ops";

export const PRODUCTS = [
  { code: "00", key: "diagnostico", name: "KRIVO Diagnóstico", short: "Diagnóstico" },
  { code: "01", key: "social", name: "KRIVO Social", short: "Social" },
  { code: "02", key: "local", name: "KRIVO Local", short: "Local" },
  { code: "03", key: "site", name: "KRIVO Site", short: "Site" },
  { code: "04", key: "atende", name: "KRIVO Atende", short: "Atende" },
  { code: "05", key: "metodologia", name: "Metodologia KRIVO", short: "Metodologia" },
] as const;
export type ProductCode = (typeof PRODUCTS)[number]["code"];
export const productByCode = (c: string | null | undefined) => PRODUCTS.find((p) => p.code === c);
export const productByKey = (k: string) => PRODUCTS.find((p) => p.key === k);

export const DELIVERY_STATUS = [
  { id: "ativa", label: "Ativa", color: "#1a7f45" },
  { id: "pausada", label: "Pausada", color: "#b7791f" },
  { id: "concluida", label: "Concluída", color: "#626f94" },
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number]["id"];
export const statusOf = (id: string) => DELIVERY_STATUS.find((s) => s.id === id);

export const CONTRACT_STATUS: Record<string, string> = {
  nao_iniciado: "Não iniciado",
  preenchido: "Preenchido",
  gerado: "Gerado",
};

export const PASSWORD_WARNING = "Nunca guarde senhas de clientes aqui nem em notas. Peça acesso por convite.";
export const IDLE_DAYS = 5;

type Progress = { total: number; done: number; overdue: number; current_phase: { phase: number; title: string } | null };

export type DeliverySummary = Progress & {
  id: string; contact_id: string; title: string; product_codes: string[]; status: DeliveryStatus;
  status_detail: string | null; owner_id: string | null; started_at: string; min_term_months: number;
  last_interaction_at: string; created_at: string; updated_at: string;
  contact_name: string | null; contact_company: string | null; has_contract_data: boolean;
};

export type DeliveryItem = {
  id: string; delivery_id: string; template_id: string | null; phase: number; phase_title: string; position: number;
  product_code: string | null; title: string; description: string | null; owner_hint: string | null; recurring: boolean;
  done: boolean; done_at: string | null; done_by: string | null; assignee_id: string | null; due_date: string | null;
  note: string | null; task_id: string | null; doc_slug: string | null; message_key: string | null; action: string | null;
};
export type DeliveryNote = { id: string; delivery_id: string; body: string; created_by: string | null; created_at: string };
export type DeliveryContract = { id: string; file_name: string; generated_by: string | null; generated_at: string; size_bytes: number | null };

export type DeliveryDetail = {
  delivery: DeliverySummary & { contract_data: Record<string, unknown> | null; notes: string | null };
  contact: { id: string; name: string; company: string | null; phone: string | null; instagram: string | null; stage: string; owner_id: string | null } | null;
  items: DeliveryItem[];
  notes: DeliveryNote[];
  contracts: DeliveryContract[];
  contract_status: "nao_iniciado" | "preenchido" | "gerado";
  contract_prefill: Record<string, unknown>;
};

export type DeliveryDoc = {
  id: string; slug: string; title: string; description: string | null; kind: "pdf" | "docx" | "json";
  audience: string; position: number; file_name: string; mime: string; size_bytes: number | null; updated_at: string;
};
export type DeliveryMessage = { key: string; title: string; body: string; position: number; updated_at: string };
export type DeliveryTemplate = {
  id: string; phase: number; phase_title: string; position: number; product_code: string | null; title: string;
  description: string | null; owner_hint: string | null; due_offset_days: number | null; doc_slug: string | null;
  message_key: string | null; action: string | null; recurring: boolean;
};

export type FieldSpec = { group: string; key: string; label: string; type: string; default: unknown; required: boolean; help: string };
export type ContractFieldsResponse = { fields: FieldSpec[]; computed: string[]; product_codes: Record<string, string> };

// ---------- datas ----------
const parseISO = (d: string) => { const [y, m, day] = d.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, day); };
const toISO = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
export function termEnd(startedAt: string, months: number) {
  const d = parseISO(startedAt);
  d.setMonth(d.getMonth() + months);
  return toISO(d);
}
export function daysUntil(iso: string) {
  return Math.round((parseISO(iso).getTime() - parseISO(todayISO()).getTime()) / 864e5);
}
export const fmtDate = (iso: string | null | undefined) =>
  iso ? parseISO(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(/\./g, "") : "";
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "");
export function idleDays(lastInteraction: string) {
  return Math.floor((Date.now() - new Date(lastInteraction).getTime()) / 864e5);
}
export const isIdle = (d: Pick<DeliverySummary, "status" | "last_interaction_at">) => d.status === "ativa" && idleDays(d.last_interaction_at) > IDLE_DAYS;
export const isOverdue = (it: Pick<DeliveryItem, "done" | "recurring" | "due_date">) => !it.done && !it.recurring && !!it.due_date && it.due_date < todayISO();

// "[KRIVO][Barbearia X][25.11.26] Alinhamento"
export function calendarTitle(client: string, date: Date = new Date(), kind = "Alinhamento") {
  const dd = String(date.getDate()).padStart(2, "0"), mm = String(date.getMonth() + 1).padStart(2, "0"), yy = String(date.getFullYear()).slice(2);
  return `[KRIVO][${client}][${dd}.${mm}.${yy}] ${kind}`;
}

// {{nome}}, {{sócio}} e demais: troca as que tiverem valor e mantém as outras para preencher à mão
export function fillMessage(body: string, vars: Record<string, string | undefined>) {
  return body.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (all, k: string) => {
    const v = vars[k] ?? vars[k.normalize("NFD").replace(/[̀-ͯ]/g, "")];
    return v ? v : all;
  });
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

// baixa por URL assinada (o servidor já manda Content-Disposition: attachment)
export function downloadUrl(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const fileSize = (n: number | null) =>
  n == null ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// ---------- navegação entre abas (CRM -> Entrega) ----------
export type DeliveryIntent = { contactId?: string; deliveryId?: string };
let pending: DeliveryIntent | null = null;
const intentListeners = new Set<(i: DeliveryIntent) => void>();
const tabListeners = new Set<() => void>();
export function openDelivery(intent: DeliveryIntent) {
  pending = intent;
  tabListeners.forEach((fn) => fn());
  intentListeners.forEach((fn) => fn(intent));
}
export function takePendingIntent() {
  const p = pending;
  pending = null;
  return p;
}
export function onDeliveryIntent(fn: (i: DeliveryIntent) => void) {
  intentListeners.add(fn);
  return () => { intentListeners.delete(fn); };
}
export function onDeliveryTabRequest(fn: () => void) {
  tabListeners.add(fn);
  return () => { tabListeners.delete(fn); };
}
