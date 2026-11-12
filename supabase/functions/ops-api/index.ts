// ops-api: Tarefas (Kanban) e CRM da KRIVO.
// Toda autenticação, permissão, validação e regra de negócio fica aqui. O front-end só apresenta.
// As tabelas têm RLS ativo e nenhum grant para anon/authenticated: só esta função (service_role) acessa.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*", // autenticação é por Bearer (sem cookies), então não há risco de CSRF
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
};
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  });
const bad = (m: string) => new AppError(400, "validacao", m);

// ---------- limite de requisições ----------
const LIMITS = {
  ip: { limit: 120, window: 60 },
  read: { limit: 120, window: 60 },
  write: { limit: 90, window: 60 },
};
function clientIp(req: Request) {
  const raw = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "desconhecido";
  return raw.trim().slice(0, 64);
}
async function rateLimit(key: string, cfg: { limit: number; window: number }) {
  const { data, error } = await sb.rpc("ga4_rate_hit", { p_key: key, p_limit: cfg.limit, p_window_seconds: cfg.window });
  if (error) {
    console.error("rate_limit", error.code);
    throw new AppError(500, "db", "Erro ao verificar o limite de uso.");
  }
  const wait = Number(data) || 0;
  if (wait > 0) throw new AppError(429, "muitas_requisicoes", `Muitas requisições. Aguarde ${wait} segundo${wait === 1 ? "" : "s"} e tente de novo.`, wait);
}

// ---------- autenticação e permissão ----------
type Member = { id: string; email: string; role: "admin" | "viewer" };
async function authenticate(req: Request): Promise<Member> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) throw new AppError(401, "nao_autenticado", "Faça login para continuar.");
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new AppError(401, "sessao_invalida", "Sua sessão expirou. Entre novamente.");
  const { data: m, error: e2 } = await sb.from("ga4_members").select("role").eq("user_id", data.user.id).maybeSingle();
  if (e2) throw new AppError(500, "db", "Erro ao verificar permissão.");
  if (!m) throw new AppError(403, "sem_permissao", "Seu usuário não tem acesso a esta plataforma.");
  return { id: data.user.id, email: data.user.email ?? "", role: m.role };
}
function needAdmin(u: Member) {
  if (u.role !== "admin") throw new AppError(403, "somente_admin", "Somente administradores podem fazer essa alteração.");
}

// ---------- validação ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_STATUS = ["a_fazer", "em_andamento", "em_revisao", "concluida"];
const STAGES = ["triagem", "a_abordar", "abordado", "respondeu", "reuniao_marcada", "proposta_enviada", "fechado", "perdido"];
const KINDS = ["nota", "whatsapp", "ligacao", "reuniao", "email"];

const uuid = (v: unknown, label = "ID") => {
  if (typeof v !== "string" || !UUID.test(v)) throw bad(`${label} inválido.`);
  return v.toLowerCase();
};
const str = (v: unknown, label: string, min: number, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min || s.length > max) throw bad(min > 0 ? `${label} deve ter entre ${min} e ${max} caracteres.` : `${label} aceita até ${max} caracteres.`);
  return s;
};
// texto opcional: vazio/null vira null
const optStr = (v: unknown, label: string, max: number) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw bad(`${label} inválido.`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw bad(`${label} aceita até ${max} caracteres.`);
  return s;
};
const oneOf = (v: unknown, list: string[], label: string) => {
  if (typeof v !== "string" || !list.includes(v)) throw bad(`${label} inválido.`);
  return v;
};
function cleanPhone(v: unknown) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  let d = String(v).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d; // número brasileiro sem DDI
  if (d.length < 8 || d.length > 15) throw bad("O WhatsApp/telefone deve ter DDD e número (ex.: 19 99999-9999).");
  return d;
}
function cleanInstagram(v: unknown) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) throw bad("Instagram inválido. Use só o @usuario.");
  return s;
}
function cleanDate(v: unknown, label: string) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${label} inválida (use AAAA-MM-DD).`);
  return v;
}
function cleanMoney(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw bad("O valor deve ser um número maior ou igual a zero.");
  return Math.round(n * 100) / 100;
}
function cleanTags(v: unknown) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 5) throw bad("Use no máximo 5 etiquetas.");
  const out = new Set<string>();
  for (const t of v) {
    const s = typeof t === "string" ? t.trim().toLowerCase() : "";
    if (!/^[\p{L}\p{N}_-]{1,24}$/u.test(s)) throw bad("Etiqueta inválida (até 24 letras, números, - ou _).");
    out.add(s);
  }
  return [...out];
}
function cleanPosition(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw bad("Posição inválida.");
  return n;
}

// ---------- ajudantes de banco ----------
async function memberIds(): Promise<Set<string>> {
  const { data, error } = await sb.from("ga4_members").select("user_id");
  if (error) throw new AppError(500, "db", "Erro ao ler a equipe.");
  return new Set((data ?? []).map((r) => r.user_id as string));
}
async function checkAssignee(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const id = uuid(v, "Responsável");
  if (!(await memberIds()).has(id)) throw bad("Esse responsável não faz parte da equipe.");
  return id;
}
async function checkContact(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const id = uuid(v, "Cliente");
  const { data, error } = await sb.from("crm_contacts").select("id").eq("id", id).maybeSingle();
  if (error) throw new AppError(500, "db", "Erro ao verificar o cliente.");
  if (!data) throw new AppError(404, "nao_encontrado", "Cliente não encontrado.");
  return id;
}
const dbErr = (msg: string) => new AppError(500, "db", msg);

// ---------- ações: equipe ----------
async function team() {
  const ids = await memberIds();
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw dbErr("Erro ao ler a equipe.");
  const members = data.users.filter((u) => ids.has(u.id)).map((u) => ({ id: u.id, email: u.email ?? "" }));
  return { members };
}

// ---------- ações: tarefas ----------
async function tasksList() {
  const { data, error } = await sb.from("ops_tasks").select("*").order("position", { ascending: true }).order("created_at", { ascending: false }).limit(1000);
  if (error) throw dbErr("Erro ao listar as tarefas.");
  return { tasks: data };
}
async function topPosition(status: string) {
  const { data } = await sb.from("ops_tasks").select("position").eq("status", status).order("position", { ascending: true }).limit(1);
  return data && data.length ? Number(data[0].position) - 1 : 0;
}
async function taskCreate(i: any, u: Member) {
  const status = i.status === undefined ? "a_fazer" : oneOf(i.status, TASK_STATUS, "Status");
  const row = {
    title: str(i.title, "O título", 2, 120),
    description: optStr(i.description, "A descrição", 2000),
    status,
    assignee_id: await checkAssignee(i.assignee_id),
    due_date: cleanDate(i.due_date, "O prazo"),
    tags: cleanTags(i.tags),
    contact_id: await checkContact(i.contact_id),
    position: await topPosition(status),
    completed_at: status === "concluida" ? new Date().toISOString() : null,
    created_by: u.id,
  };
  const { data, error } = await sb.from("ops_tasks").insert(row).select().single();
  if (error) throw dbErr("Erro ao salvar a tarefa.");
  return { task: data };
}
async function taskUpdate(i: any) {
  const id = uuid(i.id, "ID da tarefa");
  const { data: cur, error: e1 } = await sb.from("ops_tasks").select("*").eq("id", id).maybeSingle();
  if (e1) throw dbErr("Erro ao ler a tarefa.");
  if (!cur) throw new AppError(404, "nao_encontrado", "Tarefa não encontrada.");
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (i.title !== undefined) p.title = str(i.title, "O título", 2, 120);
  if (i.description !== undefined) p.description = optStr(i.description, "A descrição", 2000);
  if (i.assignee_id !== undefined) p.assignee_id = await checkAssignee(i.assignee_id);
  if (i.due_date !== undefined) p.due_date = cleanDate(i.due_date, "O prazo");
  if (i.tags !== undefined) p.tags = cleanTags(i.tags);
  if (i.contact_id !== undefined) p.contact_id = await checkContact(i.contact_id);
  if (i.status !== undefined) {
    const status = oneOf(i.status, TASK_STATUS, "Status");
    if (status !== cur.status) {
      p.status = status;
      p.completed_at = status === "concluida" ? new Date().toISOString() : null;
      if (i.position === undefined) p.position = await topPosition(status);
    }
  }
  if (i.position !== undefined) p.position = cleanPosition(i.position);
  const { data, error } = await sb.from("ops_tasks").update(p).eq("id", id).select().single();
  if (error) throw dbErr("Erro ao atualizar a tarefa.");
  return { task: data };
}
async function taskDelete(i: any, u: Member) {
  const id = uuid(i.id, "ID da tarefa");
  const { data: cur } = await sb.from("ops_tasks").select("created_by").eq("id", id).maybeSingle();
  if (!cur) throw new AppError(404, "nao_encontrado", "Tarefa não encontrada.");
  if (u.role !== "admin" && cur.created_by !== u.id) {
    throw new AppError(403, "sem_permissao_item", "Só quem criou a tarefa (ou um administrador) pode apagá-la.");
  }
  const { error } = await sb.from("ops_tasks").delete().eq("id", id);
  if (error) throw dbErr("Erro ao remover a tarefa.");
  return { ok: true };
}

// ---------- ações: CRM ----------
async function contactsList() {
  const { data, error } = await sb.from("crm_contacts").select("*").order("updated_at", { ascending: false }).limit(1000);
  if (error) throw dbErr("Erro ao listar os contatos.");
  return { contacts: data };
}
async function contactGet(i: any) {
  const id = uuid(i.id, "ID do cliente");
  const { data: contact, error } = await sb.from("crm_contacts").select("*").eq("id", id).maybeSingle();
  if (error) throw dbErr("Erro ao ler o cliente.");
  if (!contact) throw new AppError(404, "nao_encontrado", "Cliente não encontrado.");
  const [inter, tasks] = await Promise.all([
    sb.from("crm_interactions").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(100),
    sb.from("ops_tasks").select("id,title,status,due_date").eq("contact_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (inter.error || tasks.error) throw dbErr("Erro ao ler o histórico do cliente.");
  return { contact, interactions: inter.data, tasks: tasks.data };
}
async function contactFields(i: any, partial: boolean) {
  const p: Record<string, unknown> = {};
  const has = (k: string) => !partial || i[k] !== undefined;
  if (has("name")) p.name = str(i.name, "O nome", 2, 80);
  if (has("company")) p.company = optStr(i.company, "A empresa", 80);
  if (has("phone")) p.phone = cleanPhone(i.phone);
  if (has("instagram")) p.instagram = cleanInstagram(i.instagram);
  if (has("niche")) p.niche = optStr(i.niche, "O nicho", 60);
  if (has("city")) p.city = optStr(i.city, "A cidade", 60);
  if (has("source")) p.source = optStr(i.source, "A origem", 60);
  if (has("loss_reason")) p.loss_reason = optStr(i.loss_reason, "O motivo da perda", 200);
  if (has("value")) p.value = cleanMoney(i.value);
  if (has("notes")) p.notes = optStr(i.notes, "As observações", 2000);
  if (has("next_contact_at")) p.next_contact_at = cleanDate(i.next_contact_at, "A data do próximo contato");
  if (has("owner_id")) p.owner_id = await checkAssignee(i.owner_id);
  if (i.stage !== undefined) p.stage = oneOf(i.stage, STAGES, "Estágio");
  return p;
}
async function contactCreate(i: any, u: Member) {
  const p = await contactFields(i, false);
  const { data, error } = await sb.from("crm_contacts").insert({ ...p, created_by: u.id }).select().single();
  if (error) throw dbErr("Erro ao salvar o cliente.");
  return { contact: data };
}
async function contactUpdate(i: any, u: Member) {
  const id = uuid(i.id, "ID do cliente");
  const { data: cur } = await sb.from("crm_contacts").select("stage").eq("id", id).maybeSingle();
  if (!cur) throw new AppError(404, "nao_encontrado", "Cliente não encontrado.");
  const p = await contactFields(i, true);
  if (p.stage && p.stage !== "perdido" && i.loss_reason === undefined) p.loss_reason = null; // saiu de "perdido": limpa o motivo
  const { data, error } = await sb.from("crm_contacts").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw dbErr("Erro ao atualizar o cliente.");
  if (p.stage && p.stage !== cur.stage) {
    // registra a mudança de estágio no histórico, automaticamente
    await sb.from("crm_interactions").insert({ contact_id: id, kind: "nota", body: `Estágio: ${cur.stage} → ${p.stage}`, created_by: u.id });
  }
  return { contact: data };
}
async function contactDelete(i: any) {
  const id = uuid(i.id, "ID do cliente");
  const { error } = await sb.from("crm_contacts").delete().eq("id", id);
  if (error) throw dbErr("Erro ao remover o cliente.");
  return { ok: true };
}
async function interactionAdd(i: any, u: Member) {
  const contact_id = uuid(i.contact_id, "ID do cliente");
  if (!(await checkContact(contact_id))) throw new AppError(404, "nao_encontrado", "Cliente não encontrado.");
  const row = {
    contact_id,
    kind: i.kind === undefined ? "nota" : oneOf(i.kind, KINDS, "Tipo"),
    body: str(i.body, "O registro", 1, 1000),
    created_by: u.id,
  };
  const { data, error } = await sb.from("crm_interactions").insert(row).select().single();
  if (error) throw dbErr("Erro ao salvar o registro.");
  await sb.from("crm_contacts").update({ updated_at: new Date().toISOString() }).eq("id", contact_id);
  return { interaction: data };
}

const WRITE = ["task_create", "task_update", "task_delete", "contact_create", "contact_update", "contact_delete", "interaction_add"];
const READ = ["me", "team", "tasks_list", "contacts_list", "contact_get"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method !== "POST") throw new AppError(405, "metodo", "Método não permitido. Use POST.");
    await rateLimit(`ops-ip:${clientIp(req)}`, LIMITS.ip);
    const user = await authenticate(req);
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 20000) throw new AppError(413, "grande_demais", "Requisição grande demais.");
    let input: any;
    try { input = await req.json(); } catch { throw bad("Corpo da requisição inválido."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("Corpo da requisição inválido.");
    const action = input.action;
    if (typeof action !== "string" || (!WRITE.includes(action) && !READ.includes(action))) {
      throw new AppError(400, "acao_invalida", "Ação inválida.");
    }
    await rateLimit(`ops-${WRITE.includes(action) ? "w" : "r"}:${user.id}`, WRITE.includes(action) ? LIMITS.write : LIMITS.read);
    switch (action) {
      case "me": return json({ user: { id: user.id, email: user.email, role: user.role } });
      case "team": return json(await team());
      case "tasks_list": return json(await tasksList());
      case "task_create": return json(await taskCreate(input, user), 201);
      case "task_update": return json(await taskUpdate(input));
      case "task_delete": return json(await taskDelete(input, user));
      case "contacts_list": return json(await contactsList());
      case "contact_get": return json(await contactGet(input));
      case "contact_create": return json(await contactCreate(input, user), 201);
      case "contact_update": return json(await contactUpdate(input, user));
      case "contact_delete": needAdmin(user); return json(await contactDelete(input));
      case "interaction_add": return json(await interactionAdd(input, user), 201);
    }
    throw new AppError(400, "acao_invalida", "Ação inválida.");
  } catch (e) {
    if (e instanceof AppError) {
      return json({ error: { code: e.code, message: e.message } }, e.status, e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {});
    }
    console.error(e);
    return json({ error: { code: "interno", message: "Erro interno." } }, 500);
  }
});
