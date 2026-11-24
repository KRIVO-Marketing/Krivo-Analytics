import { opsCall } from "./api";
import { downloadUrl } from "./delivery";
// Tipos, categorias e cálculos do fluxo de caixa. Regras de validação ficam na função ops-api; aqui só apresentação.
export type FinKind = "in" | "out";
export type FinStatus = "pending" | "paid";

export type FinAttachment = { id: string; entry_id: string; file_name: string; mime: string; size_bytes: number; created_at: string };

export type FinEntry = {
  id: string; kind: FinKind; description: string; category: string; counterparty: string | null;
  amount: number | string; entry_date: string; status: FinStatus; paid_at: string | null;
  series_id: string | null; notes: string | null; created_at: string; updated_at: string;
  attachments?: FinAttachment[];
};

export const FIN_CATEGORIES: Record<FinKind, { id: string; label: string }[]> = {
  in: [
    { id: "mensalidade", label: "Mensalidade de cliente" },
    { id: "setup", label: "Setup / projeto" },
    { id: "diagnostico", label: "Diagnóstico" },
    { id: "outras_entradas", label: "Outras entradas" },
  ],
  out: [
    { id: "plataformas", label: "Plataformas e ferramentas" },
    { id: "anuncios", label: "Anúncios e tráfego" },
    { id: "equipe", label: "Equipe e pró-labore" },
    { id: "impostos", label: "Impostos e taxas" },
    { id: "estrutura", label: "Estrutura (internet, escritório)" },
    { id: "marketing", label: "Marketing próprio" },
    { id: "outras_saidas", label: "Outras saídas" },
  ],
};
export const categoryLabel = (id: string) =>
  [...FIN_CATEGORIES.in, ...FIN_CATEGORIES.out].find((c) => c.id === id)?.label ?? id;

export const amountOf = (e: Pick<FinEntry, "amount">) => Number(e.amount) || 0;
export const monthOf = (iso: string) => iso.slice(0, 7); // "2026-11"

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGO = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const monthShort = (ym: string) => MESES[Number(ym.slice(5, 7)) - 1];
export const monthLong = (ym: string) => `${MESES_LONGO[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
export const shiftMonth = (ym: string, n: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const currentMonth = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
};

export type Totals = { in: number; out: number; balance: number; pendingIn: number; pendingOut: number };
export function totalsFor(entries: FinEntry[]): Totals {
  const t: Totals = { in: 0, out: 0, balance: 0, pendingIn: 0, pendingOut: 0 };
  for (const e of entries) {
    const v = amountOf(e);
    if (e.status === "paid") (e.kind === "in" ? (t.in += v) : (t.out += v));
    else (e.kind === "in" ? (t.pendingIn += v) : (t.pendingOut += v));
  }
  t.balance = t.in - t.out;
  return t;
}

// Série dos últimos `count` meses terminando em `end`: realizado (pago) de cada mês e saldo acumulado até o fim do mês.
export type MonthPoint = { ym: string; in: number; out: number; balance: number; cumulative: number };
export function monthlySeries(entries: FinEntry[], end: string, count = 12): MonthPoint[] {
  const months = Array.from({ length: count }, (_, i) => shiftMonth(end, i - (count - 1)));
  const first = months[0];
  const by = new Map<string, { in: number; out: number }>();
  let before = 0; // saldo realizado antes da janela
  for (const e of entries) {
    if (e.status !== "paid") continue;
    const v = amountOf(e);
    const ym = monthOf(e.entry_date);
    if (ym < first) { before += e.kind === "in" ? v : -v; continue; }
    const m = by.get(ym) ?? { in: 0, out: 0 };
    m[e.kind] += v;
    by.set(ym, m);
  }
  let acc = before;
  return months.map((ym) => {
    const m = by.get(ym) ?? { in: 0, out: 0 };
    acc += m.in - m.out;
    return { ym, in: m.in, out: m.out, balance: m.in - m.out, cumulative: acc };
  });
}

export function byCategory(entries: FinEntry[], kind: FinKind) {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== kind || e.status !== "paid") continue;
    map.set(e.category, (map.get(e.category) ?? 0) + amountOf(e));
  }
  return [...map.entries()].map(([id, value]) => ({ id, label: categoryLabel(id), value })).sort((a, b) => b.value - a.value);
}

// ---------- anexos ----------
export const ATTACH_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx";
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACH_MAX_FILES = 10;

// 1) pede a URL de envio, 2) envia direto ao Storage, 3) o servidor confere o conteúdo e registra.
export async function uploadAttachment(entryId: string, f: File): Promise<FinAttachment> {
  if (f.size > ATTACH_MAX_BYTES) throw new Error(`“${f.name}” passa de 10 MB.`);
  const up = await opsCall<{ path: string; signed_url: string; mime: string }>({ action: "finance_attach_upload_url", entry_id: entryId, file_name: f.name, size_bytes: f.size });
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", new File([f], f.name, { type: up.mime }));
  const res = await fetch(up.signed_url, { method: "PUT", body, credentials: "omit" });
  if (!res.ok) throw new Error(`Não foi possível enviar “${f.name}”. Tente de novo.`);
  const r = await opsCall<{ attachment: FinAttachment }>({ action: "finance_attach_confirm", entry_id: entryId, path: up.path, file_name: f.name });
  return r.attachment;
}
export async function openAttachment(id: string) {
  const r = await opsCall<{ url: string }>({ action: "finance_attach_url", id });
  downloadUrl(r.url);
}
export const removeAttachment = (id: string) => opsCall<{ ok: true }>({ action: "finance_attach_delete", id });
