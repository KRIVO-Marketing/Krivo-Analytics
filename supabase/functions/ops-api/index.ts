// ops-api: Tarefas (Kanban) e CRM da KRIVO.
// Toda autenticação, permissão, validação e regra de negócio fica aqui. O front-end só apresenta.
// As tabelas têm RLS ativo e nenhum grant para anon/authenticated: só esta função (service_role) acessa.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "npm:jose@5";
import PizZip from "npm:pizzip@3.3.0";
import Docxtemplater from "npm:docxtemplater@3.71.1";
import CONTRACT_SPEC from "./contract-fields.json" with { type: "json" };
import {
  buildRenderData, checkContract, cleanContractData, CODE_TO_KEY, ContractError, contractFileName, renderDocx, type Spec,
} from "./contract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*", // autenticação é por Bearer (sem cookies), então não há risco de CSRF
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
  "Access-Control-Max-Age": "86400",
};
const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class AppError extends Error {
  details?: string[];
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
const tokenCache = new Map<string, { id: string; email: string; expMs: number }>();

async function verifyToken(token: string): Promise<{ id: string; email: string }> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    throw new AppError(401, "sessao_invalida", "Sua sessão expirou. Entre novamente.");
  }

  if (alg === "HS256" && !JWT_SECRET) {
    const now = Date.now();
    const cached = tokenCache.get(token);
    if (cached && cached.expMs > now) return { id: cached.id, email: cached.email };

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) throw new AppError(401, "sessao_invalida", "Sua sessão expirou. Entre novamente.");
    if (tokenCache.size >= 200) tokenCache.clear();
    tokenCache.set(token, { id: data.user.id, email: data.user.email ?? "", expMs: now + 60_000 });
    return { id: data.user.id, email: data.user.email ?? "" };
  }

  try {
    const key = alg === "HS256" ? new TextEncoder().encode(JWT_SECRET) : JWKS;
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    if (typeof payload.sub !== "string") throw new Error("missing_sub");
    return { id: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
  } catch {
    throw new AppError(401, "sessao_invalida", "Sua sessão expirou. Entre novamente.");
  }
}

async function authorizeRequest(req: Request, token: string, isWrite: boolean): Promise<Member> {
  const authUser = await verifyToken(token);
  const [, memberRes] = await Promise.all([
    rateLimit(`ops-ip:${clientIp(req)}`, LIMITS.ip),
    sb.from("ga4_members").select("role").eq("user_id", authUser.id).maybeSingle(),
    rateLimit(`ops-${isWrite ? "w" : "r"}:${authUser.id}`, isWrite ? LIMITS.write : LIMITS.read),
  ]);
  if (memberRes.error) throw new AppError(500, "db", "Erro ao verificar permissão.");
  if (!memberRes.data) throw new AppError(403, "sem_permissao", "Seu usuário não tem acesso a esta plataforma.");
  return { id: authUser.id, email: authUser.email, role: memberRes.data.role };
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
// Lista de responsáveis (1 ou mais). Aceita assignee_ids (lista) ou assignee_id (legado).
async function checkAssignees(i: any): Promise<string[]> {
  const raw = i.assignee_ids !== undefined ? i.assignee_ids : (i.assignee_id ? [i.assignee_id] : []);
  if (raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw bad("Responsáveis inválidos.");
  const out: string[] = [];
  for (const v of raw) {
    const id = await checkAssignee(v);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
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

// ---------- Resend (e-mails) ----------
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Krivo Analytics <onboarding@resend.dev>";
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function userName(u: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const n = typeof u.user_metadata?.name === "string" ? u.user_metadata.name.trim() : "";
  return n || (u.email ?? "").split("@")[0] || "Equipe";
}

function appUrlFromReq(req: Request) {
  if (APP_URL) return APP_URL;
  const origin = req.headers.get("origin");
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, "");
  return "https://krivo-analytics.vercel.app";
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; warning?: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, warning: "RESEND_API_KEY não configurada na função ops-api; e-mail não enviado." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("resend_error", res.status, txt);
      return { ok: false, warning: `Resend retornou ${res.status}. Verifique domínio remetente ou destinatário de teste.` };
    }
    return { ok: true };
  } catch (e) {
    console.error("resend_fetch", e);
    return { ok: false, warning: "Não foi possível contatar a API da Resend agora." };
  }
}

function genTempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `Krivo#${hex}`;
}

async function sendInviteEmail(params: { to: string; name: string; actionLink: string; tempPassword?: string; appUrl: string }) {
  const { to, name, actionLink, tempPassword, appUrl } = params;
  const passBlock = tempPassword
    ? `<p style="margin:12px 0;color:#475569;font-size:14px;">Se preferir entrar primeiro pelo painel (<a href="${escHtml(appUrl)}">${escHtml(appUrl)}</a>), use a senha temporária: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-weight:600;">${escHtml(tempPassword)}</code> (você deverá trocá-la no primeiro login).</p>`
    : "";
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a;">
      <h2 style="margin:0 0 12px;font-size:20px;">Bem-vindo à Krivo Analytics, ${escHtml(name)}!</h2>
      <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.5;">
        Seu acesso de sócio foi criado. Clique no botão abaixo para definir sua senha pessoal e entrar na plataforma:
      </p>
      <p style="margin:20px 0;">
        <a href="${escHtml(actionLink)}" style="display:inline-block;background:#3f51ff;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px;">
          Definir minha senha
        </a>
      </p>
      ${passBlock}
      <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;">Krivo Marketing · Acesso exclusivo da equipe</p>
    </div>
  `;
  return sendEmail(to, "Seu acesso à Krivo Analytics — defina sua senha", html);
}

async function notifyTaskAssignee(params: {
  assigneeId: string;
  taskTitle: string;
  status: string;
  dueDate: string | null;
  contactId: string | null;
  actorEmail: string;
  appUrl: string;
}): Promise<{ emailSent: boolean; emailWarning?: string }> {
  const { data: userData, error: uErr } = await sb.auth.admin.getUserById(params.assigneeId);
  if (uErr || !userData?.user?.email) {
    return { emailSent: false, emailWarning: "Não foi possível localizar o e-mail do responsável." };
  }
  const to = userData.user.email;
  const name = userName(userData.user);
  let contactName = "";
  if (params.contactId) {
    const { data: c } = await sb.from("crm_contacts").select("name,company").eq("id", params.contactId).maybeSingle();
    if (c) contactName = c.company ? `${c.name} (${c.company})` : c.name;
  }
  const statusLabels: Record<string, string> = {
    a_fazer: "A fazer",
    em_andamento: "Em andamento",
    em_revisao: "Em revisão",
    concluida: "Concluída",
  };
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a;">
      <p style="margin:0 0 8px;color:#3f51ff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Nova tarefa atribuída</p>
      <h2 style="margin:0 0 12px;font-size:18px;">${escHtml(params.taskTitle)}</h2>
      <p style="margin:0 0 12px;color:#475569;font-size:14px;">Olá, <strong>${escHtml(name)}</strong>! ${escHtml(params.actorEmail)} atribuiu esta tarefa para você.</p>
      <ul style="margin:0 0 18px;padding-left:18px;color:#334155;font-size:14px;line-height:1.6;">
        <li><strong>Status:</strong> ${escHtml(statusLabels[params.status] ?? params.status)}</li>
        ${contactName ? `<li><strong>Cliente:</strong> ${escHtml(contactName)}</li>` : ""}
        ${params.dueDate ? `<li><strong>Prazo:</strong> ${escHtml(params.dueDate)}</li>` : ""}
      </ul>
      <a href="${escHtml(params.appUrl)}" style="display:inline-block;background:#3f51ff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px;">
        Abrir na Krivo Analytics
      </a>
    </div>
  `;
  const res = await sendEmail(to, `Tarefa atribuída: ${params.taskTitle}`, html);
  return { emailSent: res.ok, emailWarning: res.warning };
}

// ---------- ações: equipe ----------
async function team() {
  const [{ data: rows, error: mErr }, res] = await Promise.all([
    sb.from("ga4_members").select("user_id,role"),
    sb.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);
  if (mErr || res.error) throw dbErr("Erro ao ler a equipe.");
  const roleById = new Map((rows ?? []).map((r) => [r.user_id as string, r.role as "admin" | "viewer"]));
  const members = res.data.users
    .filter((u) => roleById.has(u.id))
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      name: userName(u),
      role: roleById.get(u.id) ?? "admin",
      must_reset_password: Boolean(u.user_metadata?.must_reset_password),
      created_at: u.created_at,
    }));
  return { members };
}

async function teamInvite(i: any, req: Request) {
  const name = str(i.name, "O nome", 2, 80);
  const email = str(i.email, "O e-mail", 5, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("E-mail inválido.");

  const tempPassword = genTempPassword();
  const appUrl = appUrlFromReq(req);

  const listRes = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listRes.error) throw dbErr("Erro ao consultar usuários.");
  let user = listRes.data.users.find((u) => (u.email ?? "").toLowerCase() === email);

  if (!user) {
    const created = await sb.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name, must_reset_password: true },
    });
    if (created.error || !created.data.user) {
      throw bad(created.error?.message || "Não foi possível criar o usuário.");
    }
    user = created.data.user;
  } else {
    const updated = await sb.auth.admin.updateUserById(user.id, {
      password: tempPassword,
      email_confirm: true,
      user_metadata: { ...(user.user_metadata ?? {}), name, must_reset_password: true },
    });
    if (updated.error || !updated.data.user) throw dbErr("Erro ao atualizar o usuário.");
    user = updated.data.user;
  }

  const { error: memErr } = await sb.from("ga4_members").upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id" });
  if (memErr) throw dbErr("Erro ao salvar permissão do membro.");

  const linkRes = await sb.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: appUrl },
  });
  const actionLink = linkRes.data?.properties?.action_link ?? appUrl;
  const emailRes = await sendInviteEmail({ to: email, name, actionLink, tempPassword, appUrl });

  return {
    member: {
      id: user.id,
      email: user.email ?? email,
      name,
      role: "admin" as const,
      must_reset_password: true,
      created_at: user.created_at,
    },
    tempPassword,
    emailSent: emailRes.ok,
    emailWarning: emailRes.warning,
  };
}

async function teamResendReset(i: any, req: Request) {
  const id = uuid(i.id, "ID do membro");
  const { data: userData, error } = await sb.auth.admin.getUserById(id);
  if (error || !userData?.user?.email) throw new AppError(404, "nao_encontrado", "Membro não encontrado.");
  const u = userData.user;
  const appUrl = appUrlFromReq(req);
  const linkRes = await sb.auth.admin.generateLink({
    type: "recovery",
    email: u.email!,
    options: { redirectTo: appUrl },
  });
  if (linkRes.error || !linkRes.data?.properties?.action_link) {
    throw dbErr("Erro ao gerar link de redefinição.");
  }
  const emailRes = await sendInviteEmail({
    to: u.email!,
    name: userName(u),
    actionLink: linkRes.data.properties.action_link,
    appUrl,
  });
  return { emailSent: emailRes.ok, emailWarning: emailRes.warning };
}

async function teamRemove(i: any, actor: Member) {
  const id = uuid(i.id, "ID do membro");
  if (id === actor.id) throw bad("Você não pode remover o seu próprio acesso.");
  const { error } = await sb.from("ga4_members").delete().eq("user_id", id);
  if (error) throw dbErr("Erro ao remover o membro da equipe.");
  return { ok: true };
}

async function passwordResetComplete(actor: Member) {
  const { data: cur } = await sb.auth.admin.getUserById(actor.id);
  const meta = cur?.user?.user_metadata ?? {};
  const { error } = await sb.auth.admin.updateUserById(actor.id, {
    user_metadata: { ...meta, must_reset_password: false },
  });
  if (error) throw dbErr("Erro ao atualizar status da senha.");
  return { ok: true };
}

// ---------- ações: tarefas ----------
// Avisa por e-mail só quem foi adicionado agora (não estava em `before`).
async function notifyTaskAssignees(task: any, before: string[], u: Member, req: Request) {
  const added = ((task.assignee_ids as string[] | null) ?? []).filter((id) => !before.includes(id));
  let emailSent = false;
  let emailWarning: string | undefined;
  for (const id of added) {
    const n = await notifyTaskAssignee({
      assigneeId: id,
      taskTitle: task.title,
      status: task.status,
      dueDate: task.due_date,
      contactId: task.contact_id,
      actorEmail: u.email,
      appUrl: appUrlFromReq(req),
    });
    emailSent = emailSent || n.emailSent;
    if (n.emailWarning) emailWarning = n.emailWarning;
  }
  return { emailSent, emailWarning };
}
async function tasksList() {
  const { data, error } = await sb.from("ops_tasks").select("*").order("position", { ascending: true }).order("created_at", { ascending: false }).limit(1000);
  if (error) throw dbErr("Erro ao listar as tarefas.");
  return { tasks: data };
}
async function topPosition(status: string) {
  const { data } = await sb.from("ops_tasks").select("position").eq("status", status).order("position", { ascending: true }).limit(1);
  return data && data.length ? Number(data[0].position) - 1 : 0;
}
async function taskCreate(i: any, u: Member, req: Request) {
  const status = i.status === undefined ? "a_fazer" : oneOf(i.status, TASK_STATUS, "Status");
  const row = {
    title: str(i.title, "O título", 2, 120),
    description: optStr(i.description, "A descrição", 2000),
    status,
    ...(await (async () => { const ids = await checkAssignees(i); return { assignee_ids: ids, assignee_id: ids[0] ?? null }; })()),
    due_date: cleanDate(i.due_date, "O prazo"),
    tags: cleanTags(i.tags),
    contact_id: await checkContact(i.contact_id),
    position: await topPosition(status),
    completed_at: status === "concluida" ? new Date().toISOString() : null,
    created_by: u.id,
  };
  const { data, error } = await sb.from("ops_tasks").insert(row).select().single();
  if (error) throw dbErr("Erro ao salvar a tarefa.");
  const n = await notifyTaskAssignees(data, [], u, req);
  return { task: data, emailSent: n.emailSent, emailWarning: n.emailWarning };
}
async function taskUpdate(i: any, u: Member, req: Request) {
  const id = uuid(i.id, "ID da tarefa");
  const { data: cur, error: e1 } = await sb.from("ops_tasks").select("*").eq("id", id).maybeSingle();
  if (e1) throw dbErr("Erro ao ler a tarefa.");
  if (!cur) throw new AppError(404, "nao_encontrado", "Tarefa não encontrada.");
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (i.title !== undefined) p.title = str(i.title, "O título", 2, 120);
  if (i.description !== undefined) p.description = optStr(i.description, "A descrição", 2000);
  if (i.assignee_ids !== undefined || i.assignee_id !== undefined) {
    const ids = await checkAssignees(i);
    p.assignee_ids = ids;
    p.assignee_id = ids[0] ?? null;
  }
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
  const n = await notifyTaskAssignees(data, (cur.assignee_ids as string[] | null) ?? (cur.assignee_id ? [cur.assignee_id] : []), u, req);
  return { task: data, emailSent: n.emailSent, emailWarning: n.emailWarning };
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
async function bootstrap(u: Member) {
  const [t, tasks, contacts] = await Promise.all([team(), tasksList(), contactsList()]);
  const meMember = t.members.find((m) => m.id === u.id);
  return {
    user: {
      id: u.id,
      email: u.email,
      name: meMember?.name,
      role: u.role,
      must_reset_password: meMember?.must_reset_password ?? false,
    },
    members: t.members,
    tasks: tasks.tasks,
    contacts: contacts.contacts,
  };
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

// ---------- ações: catálogo de produtos (somente administradores: contém preços) ----------
const CATALOG_KINDS = ["product", "rule"];
function cleanDetails(v: unknown) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 12) throw bad("Use no máximo 12 tópicos de detalhe.");
  return v.map((d) => {
    if (!d || typeof d !== "object") throw bad("Tópico de detalhe inválido.");
    return { label: str((d as any).label, "O título do tópico", 1, 60), text: str((d as any).text, "O texto do tópico", 1, 800) };
  });
}
function cleanBool(v: unknown, label: string) {
  if (typeof v !== "boolean") throw bad(`${label} inválido.`);
  return v;
}
async function catalogList() {
  const { data, error } = await sb.from("catalog_items").select("*").order("kind", { ascending: true }).order("position", { ascending: true }).order("created_at", { ascending: true }).limit(200);
  if (error) throw dbErr("Erro ao ler o catálogo.");
  return { items: data };
}
async function catalogFields(i: any, partial: boolean) {
  const p: Record<string, unknown> = {};
  const has = (k: string) => !partial || i[k] !== undefined;
  if (has("name")) p.name = str(i.name, "O nome", 2, 80);
  if (has("code")) p.code = optStr(i.code, "O código", 8);
  if (has("tagline")) p.tagline = optStr(i.tagline, "A descrição curta", 120);
  if (has("billing")) p.billing = optStr(i.billing, "A cobrança", 40);
  if (has("summary")) p.summary = optStr(i.summary, "O resumo", 1000);
  if (has("price_upfront")) p.price_upfront = cleanMoney(i.price_upfront);
  if (has("upfront_label")) p.upfront_label = optStr(i.upfront_label, "O nome da cobrança inicial", 30);
  if (has("price_monthly")) p.price_monthly = cleanMoney(i.price_monthly);
  if (has("has_monthly")) p.has_monthly = cleanBool(i.has_monthly, "Mensalidade");
  if (has("details")) p.details = cleanDetails(i.details);
  return p;
}
async function catalogCreate(i: any, u: Member) {
  const kind = oneOf(i.kind ?? "product", CATALOG_KINDS, "Tipo");
  const p = await catalogFields(i, false);
  const { data: last } = await sb.from("catalog_items").select("position").eq("kind", kind).order("position", { ascending: false }).limit(1);
  const position = last && last.length ? Number(last[0].position) + 1 : 0;
  const { data, error } = await sb.from("catalog_items").insert({ ...p, kind, position, created_by: u.id, updated_by: u.id }).select().single();
  if (error) throw dbErr("Erro ao salvar o item do catálogo.");
  return { item: data };
}
async function catalogUpdate(i: any, u: Member) {
  const id = uuid(i.id, "ID do item");
  const p = await catalogFields(i, true);
  const { data, error } = await sb.from("catalog_items").update({ ...p, updated_by: u.id, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) throw dbErr("Erro ao atualizar o item do catálogo.");
  if (!data) throw new AppError(404, "nao_encontrado", "Item do catálogo não encontrado.");
  return { item: data };
}
async function catalogDelete(i: any) {
  const id = uuid(i.id, "ID do item");
  const { error } = await sb.from("catalog_items").delete().eq("id", id);
  if (error) throw dbErr("Erro ao remover o item do catálogo.");
  return { ok: true };
}

// ---------- ações: fluxo de caixa (somente administradores: contém valores da empresa) ----------
const FIN_KINDS = ["in", "out"];
const FIN_STATUS = ["pending", "paid"];
const FIN_CATEGORIES: Record<string, string[]> = {
  in: ["mensalidade", "setup", "diagnostico", "outras_entradas"],
  out: ["plataformas", "anuncios", "equipe", "impostos", "estrutura", "marketing", "outras_saidas"],
};
const FIN_MAX_REPEAT = 36;
// Soma meses mantendo o dia; em meses mais curtos usa o último dia (31/jan + 1 mês = 28/fev).
function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + n;
  const yy = y + Math.floor(total / 12);
  const mm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
function finCategory(kind: string, v: unknown) {
  const c = oneOf(v ?? (kind === "in" ? "outras_entradas" : "outras_saidas"), FIN_CATEGORIES[kind], "Categoria");
  return c;
}
const FIN_BUCKET = "financeiro-anexos";
const FIN_MAX_FILES = 10;
const FIN_FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const FIN_ATT_COLS = "id,entry_id,file_name,mime,size_bytes,created_at";
async function withAttachments(rows: any[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const out: Record<string, any[]> = {};
  // em blocos para não estourar o tamanho da URL da consulta
  for (let k = 0; k < ids.length; k += 200) {
    const { data, error } = await sb.from("finance_attachments").select(FIN_ATT_COLS).in("entry_id", ids.slice(k, k + 200)).order("created_at", { ascending: true });
    if (error) throw dbErr("Erro ao ler os anexos.");
    for (const a of data ?? []) (out[a.entry_id] ??= []).push(a);
  }
  return rows.map((r) => ({ ...r, attachments: out[r.id] ?? [] }));
}
async function financeList() {
  const { data, error } = await sb.from("finance_entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(5000);
  if (error) throw dbErr("Erro ao ler o fluxo de caixa.");
  return { entries: await withAttachments(data ?? []) };
}
async function financeCreate(i: any, u: Member) {
  const kind = oneOf(i.kind, FIN_KINDS, "Tipo");
  const date = cleanDate(i.entry_date, "A data");
  if (!date) throw bad("Informe a data do lançamento.");
  const amount = cleanMoney(i.amount);
  if (amount === null || amount <= 0) throw bad("Informe um valor maior que zero.");
  const status = oneOf(i.status ?? "pending", FIN_STATUS, "Situação");
  const repeat = i.repeat_months === undefined || i.repeat_months === null || i.repeat_months === "" ? 1 : Number(i.repeat_months);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > FIN_MAX_REPEAT) throw bad(`A repetição deve ser de 1 a ${FIN_MAX_REPEAT} meses.`);
  const base = {
    kind,
    description: str(i.description, "A descrição", 2, 120),
    category: finCategory(kind, i.category),
    counterparty: optStr(i.counterparty, "O nome", 80),
    amount,
    notes: optStr(i.notes, "A observação", 500),
    created_by: u.id,
    updated_by: u.id,
  };
  const series_id = repeat > 1 ? crypto.randomUUID() : null;
  // Na série, só a primeira parcela pode nascer paga; as seguintes ficam pendentes.
  const rows = Array.from({ length: repeat }, (_, n) => ({
    ...base,
    series_id,
    entry_date: addMonths(date, n),
    status: n === 0 ? status : "pending",
    paid_at: n === 0 && status === "paid" ? new Date().toISOString() : null,
  }));
  const { data, error } = await sb.from("finance_entries").insert(rows).select();
  if (error) throw dbErr("Erro ao salvar o lançamento.");
  return { entries: (data ?? []).map((r) => ({ ...r, attachments: [] })) };
}
async function financeUpdate(i: any, u: Member) {
  const id = uuid(i.id, "ID do lançamento");
  const { data: cur, error: e0 } = await sb.from("finance_entries").select("kind,status").eq("id", id).maybeSingle();
  if (e0) throw dbErr("Erro ao ler o lançamento.");
  if (!cur) throw notFound("Lançamento não encontrado.");
  const p: Record<string, unknown> = {};
  const kind = i.kind !== undefined ? oneOf(i.kind, FIN_KINDS, "Tipo") : cur.kind;
  if (i.kind !== undefined) p.kind = kind;
  if (i.category !== undefined || i.kind !== undefined) p.category = finCategory(kind, i.category);
  if (i.description !== undefined) p.description = str(i.description, "A descrição", 2, 120);
  if (i.counterparty !== undefined) p.counterparty = optStr(i.counterparty, "O nome", 80);
  if (i.notes !== undefined) p.notes = optStr(i.notes, "A observação", 500);
  if (i.amount !== undefined) {
    const a = cleanMoney(i.amount);
    if (a === null || a <= 0) throw bad("Informe um valor maior que zero.");
    p.amount = a;
  }
  if (i.entry_date !== undefined) {
    const d = cleanDate(i.entry_date, "A data");
    if (!d) throw bad("Informe a data do lançamento.");
    p.entry_date = d;
  }
  if (i.status !== undefined) {
    const s = oneOf(i.status, FIN_STATUS, "Situação");
    p.status = s;
    if (s !== cur.status) p.paid_at = s === "paid" ? new Date().toISOString() : null;
  }
  const { data, error } = await sb.from("finance_entries").update({ ...p, updated_by: u.id, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) throw dbErr("Erro ao atualizar o lançamento.");
  if (!data) throw notFound("Lançamento não encontrado.");
  return { entry: (await withAttachments([data]))[0] };
}
// scope "one" apaga só este lançamento; "following" apaga este e os próximos da mesma série (assinatura recorrente).
async function financeDelete(i: any) {
  const id = uuid(i.id, "ID do lançamento");
  const scope = oneOf(i.scope ?? "one", ["one", "following"], "Escopo");
  const { data: cur, error: e0 } = await sb.from("finance_entries").select("series_id,entry_date").eq("id", id).maybeSingle();
  if (e0) throw dbErr("Erro ao ler o lançamento.");
  if (!cur) return { ids: [id] };
  let q = sb.from("finance_entries").delete();
  q = scope === "following" && cur.series_id ? q.eq("series_id", cur.series_id).gte("entry_date", cur.entry_date) : q.eq("id", id);
  // guarda os caminhos dos anexos antes: as linhas somem em cascata, os arquivos do Storage precisam ser removidos à parte
  let sel = sb.from("finance_entries").select("id");
  sel = scope === "following" && cur.series_id ? sel.eq("series_id", cur.series_id).gte("entry_date", cur.entry_date) : sel.eq("id", id);
  const { data: targets } = await sel;
  const tids = (targets ?? []).map((r: { id: string }) => r.id);
  const { data: files } = tids.length ? await sb.from("finance_attachments").select("storage_path").in("entry_id", tids) : { data: [] as { storage_path: string }[] };
  const { data, error } = await q.select("id");
  if (error) throw dbErr("Erro ao remover o lançamento.");
  const paths = (files ?? []).map((f: { storage_path: string }) => f.storage_path);
  if (paths.length) await sb.storage.from(FIN_BUCKET).remove(paths);
  return { ids: (data ?? []).map((r: { id: string }) => r.id) };
}

// ---- anexos: 1) pede URL de envio, 2) o navegador envia direto ao Storage, 3) o servidor confere o conteúdo e registra ----
function finExt(name: string) {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  if (!FIN_FILE_TYPES[ext]) throw bad("Tipo de arquivo não aceito. Use PDF, imagem (PNG, JPG, WEBP), Excel (.xlsx) ou Word (.docx).");
  return ext;
}
function finMagicOk(ext: string, b: Uint8Array) {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (ext === ".pdf") return at(0, 0x25, 0x50, 0x44, 0x46);
  if (ext === ".png") return at(0, 0x89, 0x50, 0x4e, 0x47);
  if (ext === ".jpg" || ext === ".jpeg") return at(0, 0xff, 0xd8);
  if (ext === ".webp") return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  return at(0, 0x50, 0x4b); // xlsx / docx são ZIP
}
async function financeAttachUploadUrl(i: any) {
  const entryId = uuid(i.entry_id, "ID do lançamento");
  const name = str(i.file_name, "O nome do arquivo", 3, 120);
  const ext = finExt(name);
  const size = Number(i.size_bytes);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_DOC_BYTES) throw bad("O arquivo deve ter no máximo 10 MB.");
  const { data: e, error: e0 } = await sb.from("finance_entries").select("id").eq("id", entryId).maybeSingle();
  if (e0) throw dbErr("Erro ao ler o lançamento.");
  if (!e) throw notFound("Lançamento não encontrado.");
  const { count } = await sb.from("finance_attachments").select("id", { count: "exact", head: true }).eq("entry_id", entryId);
  if ((count ?? 0) >= FIN_MAX_FILES) throw bad(`Cada lançamento aceita até ${FIN_MAX_FILES} anexos.`);
  const path = `${entryId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeFileName(name)}`;
  const { data, error } = await sb.storage.from(FIN_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw dbErr("Não foi possível preparar o envio do arquivo.");
  return { path, signed_url: data.signedUrl, mime: FIN_FILE_TYPES[ext] };
}
async function financeAttachConfirm(i: any, u: Member) {
  const entryId = uuid(i.entry_id, "ID do lançamento");
  const path = str(i.path, "O caminho", 3, 240);
  if (!path.startsWith(`${entryId}/`) || path.includes("..")) throw bad("Caminho do arquivo inválido.");
  const fileName = str(i.file_name, "O nome do arquivo", 3, 120).replace(/[\\/:*?"<>|]+/g, "-");
  const ext = finExt(fileName);
  const { data: blob, error } = await sb.storage.from(FIN_BUCKET).download(path);
  if (error || !blob) throw bad("Arquivo enviado não encontrado. Tente enviar de novo.");
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf.byteLength > MAX_DOC_BYTES || !finMagicOk(ext, buf)) {
    await sb.storage.from(FIN_BUCKET).remove([path]);
    throw bad(buf.byteLength > MAX_DOC_BYTES ? "O arquivo deve ter no máximo 10 MB." : "O conteúdo do arquivo não corresponde ao tipo informado.");
  }
  const { data, error: insErr } = await sb.from("finance_attachments").insert({
    entry_id: entryId, storage_path: path, file_name: fileName, mime: FIN_FILE_TYPES[ext], size_bytes: buf.byteLength, created_by: u.id,
  }).select(FIN_ATT_COLS).single();
  if (insErr) {
    await sb.storage.from(FIN_BUCKET).remove([path]);
    throw dbErr("Erro ao registrar o anexo.");
  }
  return { attachment: data };
}
async function financeAttachUrl(i: any) {
  const id = uuid(i.id, "ID do anexo");
  const { data, error } = await sb.from("finance_attachments").select("storage_path,file_name").eq("id", id).maybeSingle();
  if (error) throw dbErr("Erro ao ler o anexo.");
  if (!data) throw notFound("Anexo não encontrado.");
  const signed = await sb.storage.from(FIN_BUCKET).createSignedUrl(data.storage_path, SIGNED_URL_SECONDS, { download: data.file_name });
  if (signed.error || !signed.data?.signedUrl) throw new AppError(404, "arquivo_ausente", "O arquivo deste anexo não foi encontrado.");
  return { url: signed.data.signedUrl, file_name: data.file_name, expires_in: SIGNED_URL_SECONDS };
}
async function financeAttachDelete(i: any) {
  const id = uuid(i.id, "ID do anexo");
  const { data, error } = await sb.from("finance_attachments").delete().eq("id", id).select("storage_path").maybeSingle();
  if (error) throw dbErr("Erro ao remover o anexo.");
  if (data?.storage_path) await sb.storage.from(FIN_BUCKET).remove([data.storage_path]);
  return { ok: true };
}

// ---------- ações: entrega (checklist, modelos, mensagens e contrato) ----------
// Escrita segue a regra das Tarefas: qualquer membro marca item, cria nota e gera contrato.
// Modelo do checklist, arquivos, mensagens e exclusão de entrega: só administradores.
const SPEC = CONTRACT_SPEC as unknown as Spec;
const BUCKET = "modelos-entrega";
const DELIVERY_STATUS = ["ativa", "pausada", "concluida"];
// Produtos válidos vêm do catálogo (catalog_items.kind = 'product' com código). "05" é a Metodologia (pacote): não tem itens próprios no modelo.
const BUNDLE_CODE = "05";
async function productCodes() {
  const { data, error } = await sb.from("catalog_items").select("code").eq("kind", "product").not("code", "is", null).limit(100);
  if (error) throw dbErr("Erro ao ler os produtos do catálogo.");
  const codes = (data ?? []).map((r: any) => String(r.code).trim()).filter(Boolean);
  return { all: [...new Set(codes)], template: [...new Set(codes)].filter((c) => c !== BUNDLE_CODE) };
}
async function productsList() {
  const { data, error } = await sb.from("catalog_items").select("code,name,tagline").eq("kind", "product").not("code", "is", null).order("position").order("created_at").limit(100);
  if (error) throw dbErr("Erro ao ler os produtos do catálogo.");
  return { products: data };
}
const METODOLOGIA_CODES = ["00", "01", "02", "03", "04"];
const SLUG = /^[a-z0-9-]{2,60}$/;
const MSG_KEY = /^[a-z0-9_]{2,40}$/;
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_KINDS: Record<string, { mime: string; ext: string }> = {
  pdf: { mime: "application/pdf", ext: ".pdf" },
  docx: { mime: DOCX_MIME, ext: ".docx" },
  json: { mime: "application/json", ext: ".json" },
};
const SIGNED_URL_SECONDS = 60;
const nowIso = () => new Date().toISOString();
// mensagens do item do modelo: lista nova, ou a chave única antiga enquanto a lista estiver vazia
const templateKeys = (t: { message_keys?: string[] | null; message_key?: string | null }) =>
  t.message_keys?.length ? t.message_keys : t.message_key ? [t.message_key] : [];
const notFound = (m: string) => new AppError(404, "nao_encontrado", m);

async function cleanCodes(v: unknown) {
  if (!Array.isArray(v) || !v.length || v.length > 30) throw bad("Escolha pelo menos 1 produto.");
  const valid = (await productCodes()).all;
  const out = new Set<string>();
  for (const c of v) out.add(oneOf(c, valid, "Produto"));
  return [...out].sort();
}
// Metodologia (05) aplica os itens de Diagnóstico, Social, Local, Site e Atende
const expandCodes = (codes: string[]) => (codes.includes("05") ? [...new Set([...codes, ...METODOLOGIA_CODES])] : codes);
function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
const todayIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // America/Sao_Paulo
function contractError(e: unknown): never {
  if (e instanceof ContractError) {
    const err = bad(e.message);
    err.details = e.problems;
    throw err;
  }
  throw e;
}

async function getDelivery(id: string) {
  const { data, error } = await sb.from("deliveries").select("*").eq("id", id).maybeSingle();
  if (error) throw dbErr("Erro ao ler a entrega.");
  if (!data) throw notFound("Entrega não encontrada.");
  return data;
}
const touchDelivery = (id: string, u: Member) =>
  sb.from("deliveries").update({ last_interaction_at: nowIso(), updated_at: nowIso(), updated_by: u.id }).eq("id", id);

// resumo de progresso por entrega (itens recorrentes não contam)
type ItemLite = { delivery_id: string; phase: number; phase_title: string; position: number; done: boolean; due_date: string | null; recurring: boolean };
function summarize(items: ItemLite[]) {
  const today = todayIso();
  const open = items.filter((i) => !i.recurring && !i.done).sort((a, b) => a.phase - b.phase || a.position - b.position);
  const total = items.filter((i) => !i.recurring).length;
  return {
    total,
    done: total - open.length,
    overdue: open.filter((i) => i.due_date && i.due_date < today).length,
    current_phase: open[0] ? { phase: open[0].phase, title: open[0].phase_title } : null,
  };
}

async function deliveriesList() {
  const [dRes, iRes] = await Promise.all([
    sb.from("deliveries").select("id,contact_id,title,product_codes,status,status_detail,owner_id,started_at,min_term_months,last_interaction_at,contract_data,created_at,updated_at,crm_contacts(name,company)").order("updated_at", { ascending: false }).limit(500),
    sb.from("delivery_items").select("delivery_id,phase,phase_title,position,done,due_date,recurring").limit(20000),
  ]);
  if (dRes.error || iRes.error) throw dbErr("Erro ao listar as entregas.");
  const byDelivery = new Map<string, ItemLite[]>();
  for (const it of (iRes.data ?? []) as ItemLite[]) {
    const arr = byDelivery.get(it.delivery_id) ?? [];
    arr.push(it);
    byDelivery.set(it.delivery_id, arr);
  }
  const deliveries = (dRes.data ?? []).map((d: any) => {
    const { contract_data, crm_contacts, ...rest } = d;
    return {
      ...rest,
      contact_name: crm_contacts?.name ?? null,
      contact_company: crm_contacts?.company ?? null,
      has_contract_data: !!contract_data && Object.keys(contract_data).length > 0,
      ...summarize(byDelivery.get(d.id) ?? []),
    };
  });
  return { deliveries };
}

// pré-preenchimento do formulário a partir do contato e da entrega
function contractPrefill(d: any, contact: any) {
  const produtos = (d.product_codes as string[]).map((c) => CODE_TO_KEY[c] ?? c);
  return {
    nome_contratante: contact?.company || contact?.name || "",
    tipo_pessoa: contact?.company ? "pessoa jurídica" : "pessoa física",
    doc_tipo: contact?.company ? "CNPJ" : "CPF",
    whatsapp: contact?.phone ?? "",
    produtos,
    data_inicio: d.started_at,
  };
}

async function deliveryGet(i: any) {
  const id = uuid(i.id, "ID da entrega");
  const d = await getDelivery(id);
  const [contact, items, notes, contracts] = await Promise.all([
    sb.from("crm_contacts").select("id,name,company,phone,instagram,stage,owner_id").eq("id", d.contact_id).maybeSingle(),
    sb.from("delivery_items").select("*").eq("delivery_id", id).order("phase").order("position"),
    sb.from("delivery_notes").select("*").eq("delivery_id", id).order("created_at", { ascending: false }).limit(200),
    sb.from("delivery_contracts").select("id,file_name,generated_by,generated_at,size_bytes").eq("delivery_id", id).order("generated_at", { ascending: false }).limit(50),
  ]);
  if (contact.error || items.error || notes.error || contracts.error) throw dbErr("Erro ao ler a entrega.");
  const status = contracts.data?.length ? "gerado" : d.contract_data && Object.keys(d.contract_data).length ? "preenchido" : "nao_iniciado";
  return {
    delivery: { ...d, ...summarize(items.data as ItemLite[]) },
    contact: contact.data,
    items: items.data,
    notes: notes.data,
    contracts: contracts.data,
    contract_status: status,
    contract_prefill: contractPrefill(d, contact.data),
  };
}

async function deliveryCreate(i: any, u: Member) {
  const contact_id = await checkContact(i.contact_id);
  if (!contact_id) throw bad("Escolha o cliente.");
  const codes = await cleanCodes(i.product_codes);
  const owner_id = await checkAssignee(i.owner_id);
  const started_at = cleanDate(i.started_at, "A data de início") ?? todayIso();
  const { data: contact } = await sb.from("crm_contacts").select("name,company").eq("id", contact_id).maybeSingle();
  const { data: open } = await sb.from("deliveries").select("id").eq("contact_id", contact_id).in("status", ["ativa", "pausada"]).limit(1);
  if (open?.length) throw new AppError(409, "ja_existe", "Este cliente já tem uma entrega em andamento.");
  const title = i.title !== undefined && i.title !== null && String(i.title).trim()
    ? str(i.title, "O título", 2, 120)
    : (contact?.company || contact?.name || "Entrega").slice(0, 120);

  const templateCodes = (await productCodes()).template;
  const tplCodes = expandCodes(codes).filter((c) => templateCodes.includes(c));
  const { data: tpls, error: tErr } = await sb.from("delivery_templates").select("*").order("phase").order("position");
  if (tErr) throw dbErr("Erro ao ler o modelo do checklist.");
  const chosen = (tpls ?? []).filter((t: any) => t.product_code === null || tplCodes.includes(t.product_code));

  const { data: d, error } = await sb.from("deliveries").insert({
    contact_id, title, product_codes: codes, status: "ativa", owner_id, started_at,
    min_term_months: 3, created_by: u.id, updated_by: u.id,
  }).select().single();
  if (error) throw dbErr("Erro ao criar a entrega.");

  const rows = chosen.map((t: any) => ({
    delivery_id: d.id, template_id: t.id, phase: t.phase, phase_title: t.phase_title, position: t.position,
    product_code: t.product_code, title: t.title, description: t.description, owner_hint: t.owner_hint,
    recurring: t.recurring, due_date: t.due_offset_days === null || t.recurring ? null : addDays(started_at, t.due_offset_days),
    doc_slug: t.doc_slug, message_keys: templateKeys(t), action: t.action,
  }));
  if (rows.length) {
    const { error: iErr } = await sb.from("delivery_items").insert(rows);
    if (iErr) {
      await sb.from("deliveries").delete().eq("id", d.id);
      throw dbErr("Erro ao criar o checklist da entrega.");
    }
  }
  await sb.from("crm_interactions").insert({ contact_id, kind: "nota", body: `Entrega iniciada (${rows.filter((r) => !r.recurring).length} itens).`, created_by: u.id });
  return { delivery: d, items_created: rows.length };
}

async function deliveryUpdate(i: any, u: Member) {
  const id = uuid(i.id, "ID da entrega");
  await getDelivery(id);
  const p: Record<string, unknown> = { updated_at: nowIso(), updated_by: u.id };
  if (i.title !== undefined) p.title = str(i.title, "O título", 2, 120);
  if (i.status !== undefined) p.status = oneOf(i.status, DELIVERY_STATUS, "Status");
  if (i.status_detail !== undefined) p.status_detail = optStr(i.status_detail, "A situação", 80);
  if (i.owner_id !== undefined) p.owner_id = await checkAssignee(i.owner_id);
  if (i.notes !== undefined) p.notes = optStr(i.notes, "As observações", 2000);
  if (i.started_at !== undefined) {
    const v = cleanDate(i.started_at, "A data de início");
    if (!v) throw bad("Informe a data de início.");
    p.started_at = v;
  }
  if (i.contract_data !== undefined) {
    try { p.contract_data = cleanContractData(i.contract_data, await contractSpec()); } catch (e) { contractError(e); }
  }
  const { data, error } = await sb.from("deliveries").update(p).eq("id", id).select().single();
  if (error) throw dbErr("Erro ao atualizar a entrega.");
  return { delivery: data };
}

async function deliveryDelete(i: any) {
  const id = uuid(i.id, "ID da entrega");
  const { data: files } = await sb.from("delivery_contracts").select("storage_path").eq("delivery_id", id);
  const { error } = await sb.from("deliveries").delete().eq("id", id);
  if (error) throw dbErr("Erro ao remover a entrega.");
  const paths = (files ?? []).map((f: any) => f.storage_path).filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  return { ok: true };
}

async function deliveryItemUpdate(i: any, u: Member) {
  const id = uuid(i.id, "ID do item");
  const { data: cur, error: e1 } = await sb.from("delivery_items").select("id,delivery_id,done,note").eq("id", id).maybeSingle();
  if (e1) throw dbErr("Erro ao ler o item.");
  if (!cur) throw notFound("Item não encontrado.");
  const p: Record<string, unknown> = { updated_at: nowIso() };
  let interaction = false;
  if (i.done !== undefined) {
    const done = cleanBool(i.done, "Feito");
    if (done !== cur.done) {
      p.done = done;
      p.done_at = done ? nowIso() : null;
      p.done_by = done ? u.id : null;
      interaction = true;
    }
  }
  if (i.assignee_id !== undefined) p.assignee_id = await checkAssignee(i.assignee_id);
  if (i.due_date !== undefined) p.due_date = cleanDate(i.due_date, "O prazo");
  if (i.note !== undefined) {
    p.note = optStr(i.note, "A nota", 1000);
    if (p.note && p.note !== cur.note) interaction = true;
  }
  const { data, error } = await sb.from("delivery_items").update(p).eq("id", id).select().single();
  if (error) throw dbErr("Erro ao atualizar o item.");
  if (interaction) await touchDelivery(cur.delivery_id, u);
  else await sb.from("deliveries").update({ updated_at: nowIso() }).eq("id", cur.delivery_id);
  return { item: data };
}

async function deliveryNoteAdd(i: any, u: Member) {
  const delivery_id = uuid(i.delivery_id, "ID da entrega");
  await getDelivery(delivery_id);
  const { data, error } = await sb.from("delivery_notes").insert({ delivery_id, body: str(i.body, "A nota", 1, 1000), created_by: u.id }).select().single();
  if (error) throw dbErr("Erro ao salvar a nota.");
  await touchDelivery(delivery_id, u);
  return { note: data };
}

async function deliveryItemToTask(i: any, u: Member, req: Request) {
  const id = uuid(i.id, "ID do item");
  const { data: it } = await sb.from("delivery_items").select("*").eq("id", id).maybeSingle();
  if (!it) throw notFound("Item não encontrado.");
  if (it.task_id) {
    const { data: t } = await sb.from("ops_tasks").select("id").eq("id", it.task_id).maybeSingle();
    if (t) throw new AppError(409, "ja_existe", "Este item já tem uma tarefa.");
  }
  const d = await getDelivery(it.delivery_id);
  const desc = [it.description, `Entrega: ${d.title} · Fase ${it.phase}: ${it.phase_title}`, it.note ? `Nota: ${it.note}` : null].filter(Boolean).join("\n\n");
  const { task, emailSent, emailWarning } = await taskCreate({
    title: String(it.title).slice(0, 120),
    description: desc.slice(0, 2000),
    assignee_id: i.assignee_id !== undefined ? i.assignee_id : it.assignee_id,
    due_date: it.due_date,
    contact_id: d.contact_id,
    tags: ["entrega"],
  }, u, req);
  const { data: item, error } = await sb.from("delivery_items").update({ task_id: task.id, updated_at: nowIso() }).eq("id", id).select().single();
  if (error) throw dbErr("Tarefa criada, mas não foi possível ligá-la ao item.");
  return { task, item, emailSent, emailWarning };
}

// ---------- modelo do checklist (admin) ----------
async function templatesList() {
  const { data, error } = await sb.from("delivery_templates").select("*").order("phase").order("position").limit(500);
  if (error) throw dbErr("Erro ao ler o modelo do checklist.");
  return { templates: data };
}
async function templateFields(i: any, partial: boolean) {
  const p: Record<string, unknown> = {};
  const has = (k: string) => !partial || i[k] !== undefined;
  if (has("phase")) {
    const n = Number(i.phase);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw bad("Fase inválida (1 a 20).");
    p.phase = n;
  }
  if (has("phase_title")) p.phase_title = str(i.phase_title, "O nome da fase", 2, 80);
  if (has("title")) p.title = str(i.title, "O título", 2, 300);
  if (has("description")) p.description = optStr(i.description, "A descrição", 1000);
  if (has("owner_hint")) p.owner_hint = optStr(i.owner_hint, "O responsável sugerido", 40);
  if (has("product_code")) p.product_code = i.product_code === null || i.product_code === "" || i.product_code === undefined ? null : oneOf(i.product_code, (await productCodes()).template, "Produto");
  if (has("due_offset_days")) {
    if (i.due_offset_days === null || i.due_offset_days === "" || i.due_offset_days === undefined) p.due_offset_days = null;
    else {
      const n = Number(i.due_offset_days);
      if (!Number.isInteger(n) || n < 0 || n > 365) throw bad("Prazo sugerido inválido (0 a 365 dias).");
      p.due_offset_days = n;
    }
  }
  if (has("doc_slug")) {
    const s = optStr(i.doc_slug, "O modelo", 60);
    if (s && !SLUG.test(s)) throw bad("Modelo inválido.");
    p.doc_slug = s;
  }
  if (i.message_keys !== undefined || (!partial && i.message_key !== undefined)) {
    // lista de mensagens do item (aceita message_key único por compatibilidade)
    const raw = i.message_keys !== undefined ? i.message_keys : (i.message_key ? [i.message_key] : []);
    if (!Array.isArray(raw) || raw.length > 6) throw bad("Escolha até 6 mensagens.");
    const keys = [...new Set(raw.map((k) => (typeof k === "string" ? k.trim() : "")))].filter(Boolean);
    if (keys.some((k) => !MSG_KEY.test(k))) throw bad("Mensagem inválida.");
    p.message_keys = keys;
    p.message_key = null;
  }
  if (has("action")) p.action = i.action === null || i.action === "" || i.action === undefined ? null : oneOf(i.action, ["contrato"], "Ação");
  if (has("recurring")) p.recurring = i.recurring === undefined ? false : cleanBool(i.recurring, "Recorrente");
  if (i.position !== undefined) {
    const n = Number(i.position);
    if (!Number.isInteger(n) || Math.abs(n) > 100000) throw bad("Posição inválida.");
    p.position = n;
  }
  return p;
}
async function templateCreate(i: any, u: Member) {
  const p = await templateFields(i, false);
  if (p.position === undefined) {
    const { data: last } = await sb.from("delivery_templates").select("position").eq("phase", p.phase as number).order("position", { ascending: false }).limit(1);
    p.position = last?.length ? Number(last[0].position) + 1 : 0;
  }
  const { data, error } = await sb.from("delivery_templates").insert({ ...p, created_by: u.id, updated_by: u.id }).select().single();
  if (error) throw dbErr("Erro ao salvar o item do modelo.");
  return { template: data };
}
async function templateUpdate(i: any, u: Member) {
  const id = uuid(i.id, "ID do item do modelo");
  const p = await templateFields(i, true);
  const { data, error } = await sb.from("delivery_templates").update({ ...p, updated_by: u.id, updated_at: nowIso() }).eq("id", id).select().maybeSingle();
  if (error) throw dbErr("Erro ao atualizar o item do modelo.");
  if (!data) throw notFound("Item do modelo não encontrado.");
  return { template: data };
}
async function templateDelete(i: any) {
  const id = uuid(i.id, "ID do item do modelo");
  const { error } = await sb.from("delivery_templates").delete().eq("id", id);
  if (error) throw dbErr("Erro ao remover o item do modelo.");
  return { ok: true };
}

// ---------- modelos para download ----------
async function docsList() {
  const { data, error } = await sb.from("delivery_docs").select("id,slug,title,description,kind,audience,position,file_name,mime,size_bytes,updated_by,updated_at").order("position").limit(100);
  if (error) throw dbErr("Erro ao listar os modelos.");
  return { docs: data };
}
async function getDoc(slugRaw: unknown) {
  if (typeof slugRaw !== "string" || !SLUG.test(slugRaw)) throw bad("Modelo inválido.");
  const { data, error } = await sb.from("delivery_docs").select("*").eq("slug", slugRaw).maybeSingle();
  if (error) throw dbErr("Erro ao ler o modelo.");
  if (!data) throw notFound("Modelo não encontrado.");
  return data;
}
async function signedDownload(path: string, fileName: string) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS, { download: fileName });
  if (error || !data?.signedUrl) throw new AppError(404, "arquivo_ausente", "O arquivo deste modelo ainda não foi enviado. Peça para um admin usar Substituir arquivo.");
  return data.signedUrl;
}
async function docUrl(i: any) {
  const doc = await getDoc(i.slug);
  return { url: await signedDownload(doc.storage_path, doc.file_name), file_name: doc.file_name, expires_in: SIGNED_URL_SECONDS };
}
const safeFileName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
// 1) admin pede uma URL de envio assinada; 2) o navegador envia o arquivo direto ao Storage; 3) doc_replace confere e troca.
async function docUploadUrl(i: any) {
  const doc = await getDoc(i.slug);
  const name = str(i.file_name, "O nome do arquivo", 3, 120);
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  const kind = Object.entries(DOC_KINDS).find(([, v]) => v.ext === ext)?.[0];
  if (!kind || (kind === "json" && doc.kind !== "json") || (doc.kind === "json" && kind !== "json")) throw bad(doc.kind === "json" ? "Envie um arquivo .json." : "Envie um arquivo PDF ou DOCX.");
  const size = Number(i.size_bytes);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_DOC_BYTES) throw bad("O arquivo deve ter no máximo 10 MB.");
  const path = `${doc.slug}/${Date.now()}-${safeFileName(name)}`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw dbErr("Não foi possível preparar o envio do arquivo.");
  return { path, token: data.token, signed_url: data.signedUrl, mime: DOC_KINDS[kind].mime };
}
async function docReplace(i: any, u: Member) {
  const doc = await getDoc(i.slug);
  const path = str(i.path, "O caminho", 3, 200);
  if (!path.startsWith(`${doc.slug}/`) || path.includes("..")) throw bad("Caminho do arquivo inválido.");
  const fileName = str(i.file_name, "O nome do arquivo", 3, 120);
  const { data: blob, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !blob) throw bad("Arquivo enviado não encontrado. Tente enviar de novo.");
  const buf = new Uint8Array(await blob.arrayBuffer());
  const reject = async (m: string) => { await sb.storage.from(BUCKET).remove([path]); throw bad(m); };
  if (buf.byteLength > MAX_DOC_BYTES) await reject("O arquivo deve ter no máximo 10 MB.");
  const head = new TextDecoder().decode(buf.slice(0, 5));
  let kind: string;
  if (head.startsWith("%PDF")) kind = "pdf";
  else if (buf[0] === 0x50 && buf[1] === 0x4b) {
    kind = "docx";
    try {
      const zip = new PizZip(buf);
      if (!zip.file("word/document.xml")) throw new Error("not docx");
      if (doc.slug === "contrato-template-docx") new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
    } catch {
      await reject(doc.slug === "contrato-template-docx" ? "O template tem tags inválidas ou não é um Word válido." : "O arquivo não é um Word (.docx) válido.");
    }
  } else {
    try { JSON.parse(new TextDecoder().decode(buf)); kind = "json"; } catch { kind = "outro"; }
  }
  if (kind! !== doc.kind) await reject(`Tipo de arquivo errado: este modelo espera ${doc.kind.toUpperCase()}.`);
  const { data, error: upErr } = await sb.from("delivery_docs").update({
    storage_path: path, file_name: fileName.replace(/[\\/:*?"<>|]+/g, "-"), mime: DOC_KINDS[doc.kind].mime, size_bytes: buf.byteLength,
    updated_by: u.id, updated_at: nowIso(),
  }).eq("id", doc.id).select("id,slug,title,description,kind,audience,position,file_name,mime,size_bytes,updated_by,updated_at").single();
  if (upErr) throw dbErr("Erro ao atualizar o modelo.");
  if (doc.storage_path && doc.storage_path !== path) await sb.storage.from(BUCKET).remove([doc.storage_path]);
  if (doc.slug === "contrato-template-docx") templateCache = null;
  return { doc: data };
}
async function docUpdate(i: any, u: Member) {
  const doc = await getDoc(i.slug);
  const p: Record<string, unknown> = { updated_by: u.id, updated_at: nowIso() };
  if (i.title !== undefined) p.title = str(i.title, "O título", 2, 120);
  if (i.description !== undefined) p.description = optStr(i.description, "A descrição", 500);
  const { data, error } = await sb.from("delivery_docs").update(p).eq("id", doc.id).select("id,slug,title,description,kind,audience,position,file_name,mime,size_bytes,updated_by,updated_at").single();
  if (error) throw dbErr("Erro ao atualizar o modelo.");
  return { doc: data };
}

// ---------- mensagens prontas ----------
async function messagesList() {
  const { data, error } = await sb.from("delivery_messages").select("*").order("position");
  if (error) throw dbErr("Erro ao ler as mensagens.");
  return { messages: data };
}
async function messageUpdate(i: any, u: Member) {
  if (typeof i.key !== "string" || !MSG_KEY.test(i.key)) throw bad("Mensagem inválida.");
  const p: Record<string, unknown> = { updated_by: u.id, updated_at: nowIso() };
  if (i.title !== undefined) p.title = str(i.title, "O título", 2, 80);
  if (i.body !== undefined) p.body = str(i.body, "O texto", 2, 2000);
  const { data, error } = await sb.from("delivery_messages").update(p).eq("key", i.key).select().maybeSingle();
  if (error) throw dbErr("Erro ao atualizar a mensagem.");
  if (!data) throw notFound("Mensagem não encontrada.");
  return { message: data };
}

// ---------- contrato ----------
let templateCache: { path: string; updatedAt: string; buf: Uint8Array } | null = null;
async function contractTemplate() {
  const doc = await getDoc("contrato-template-docx");
  if (templateCache && templateCache.path === doc.storage_path && templateCache.updatedAt === doc.updated_at) return templateCache.buf;
  const { data, error } = await sb.storage.from(BUCKET).download(doc.storage_path);
  if (error || !data) throw new AppError(503, "template_ausente", "O template do contrato ainda não foi enviado. Peça para um admin enviar em Modelos.");
  const buf = new Uint8Array(await data.arrayBuffer());
  templateCache = { path: doc.storage_path, updatedAt: doc.updated_at, buf };
  return buf;
}
// Produtos do contrato: os do modelo (fixos) + os que existirem no catálogo (ex.: KRIVO Eventos), sem precisar mexer no código.
async function contractSpec(): Promise<Spec> {
  const { data, error } = await sb.from("catalog_items").select("code,name").eq("kind", "product").not("code", "is", null).limit(100);
  if (error) throw dbErr("Erro ao ler os produtos do catálogo.");
  const extra: Record<string, string> = {};
  for (const r of data ?? []) {
    const code = String(r.code).trim();
    if (code && !(code in CODE_TO_KEY)) extra[code] = String(r.name);
  }
  const fields = SPEC.fields.map((f) =>
    f.key === "produtos" && Object.keys(extra).length ? { ...f, type: `${f.type}|${Object.keys(extra).join("|")}` } : f);
  return { ...SPEC, fields, extra };
}
async function contractFields() {
  const spec = await contractSpec();
  return { fields: spec.fields, computed: spec.computed, product_codes: CODE_TO_KEY };
}
async function contractSave(i: any, u: Member) {
  const id = uuid(i.delivery_id, "ID da entrega");
  await getDelivery(id);
  let data: Record<string, unknown>;
  const spec = await contractSpec();
  try { data = cleanContractData(i.data, spec); } catch (e) { contractError(e); }
  const { error } = await sb.from("deliveries").update({ contract_data: data!, updated_at: nowIso(), updated_by: u.id }).eq("id", id);
  if (error) throw dbErr("Erro ao salvar o rascunho do contrato.");
  return { ok: true, check: checkContract(data!, spec), saved_at: nowIso() };
}
async function contractGenerate(i: any, u: Member) {
  const id = uuid(i.delivery_id, "ID da entrega");
  const d = await getDelivery(id);
  const spec = await contractSpec();
  let data: Record<string, unknown>;
  try { data = cleanContractData(i.data !== undefined ? i.data : d.contract_data, spec); } catch (e) { contractError(e); }
  const check = checkContract(data!, spec);
  if (check.errors.length) {
    const err = bad("Faltam dados para gerar o contrato.");
    err.details = check.errors;
    throw err;
  }
  const template = await contractTemplate();
  let out: Uint8Array;
  try { out = renderDocx(PizZip, Docxtemplater, template, buildRenderData(data!, spec)); } catch (e) { contractError(e); }
  const fileName = contractFileName(String(data!.nome_contratante ?? d.title), todayIso());
  const path = `gerados/${id}/${crypto.randomUUID()}.docx`;
  const up = await sb.storage.from(BUCKET).upload(path, out!, { contentType: DOCX_MIME, upsert: false });
  if (up.error) throw dbErr("Erro ao guardar o contrato gerado.");
  const { data: rec, error } = await sb.from("delivery_contracts").insert({
    delivery_id: id, data: data!, file_name: fileName, storage_path: path, size_bytes: out!.byteLength, generated_by: u.id,
  }).select("id,file_name,generated_by,generated_at,size_bytes").single();
  if (error) throw dbErr("Erro ao registrar o contrato gerado.");
  await sb.from("deliveries").update({ contract_data: data!, updated_at: nowIso(), updated_by: u.id, last_interaction_at: nowIso() }).eq("id", id);
  return { contract: rec, url: await signedDownload(path, fileName), file_name: fileName, warnings: check.warnings, expires_in: SIGNED_URL_SECONDS };
}
async function contractHistory(i: any) {
  const id = uuid(i.delivery_id, "ID da entrega");
  const { data, error } = await sb.from("delivery_contracts").select("id,file_name,generated_by,generated_at,size_bytes").eq("delivery_id", id).order("generated_at", { ascending: false }).limit(50);
  if (error) throw dbErr("Erro ao ler o histórico de contratos.");
  return { contracts: data };
}
async function contractUrl(i: any) {
  const id = uuid(i.id, "ID do contrato");
  const { data, error } = await sb.from("delivery_contracts").select("storage_path,file_name").eq("id", id).maybeSingle();
  if (error) throw dbErr("Erro ao ler o contrato.");
  if (!data?.storage_path) throw notFound("Arquivo do contrato não encontrado.");
  return { url: await signedDownload(data.storage_path, data.file_name), file_name: data.file_name, expires_in: SIGNED_URL_SECONDS };
}

const WRITE = [
  "contract_save",
  "contract_generate",
  "delivery_create",
  "delivery_update",
  "delivery_delete",
  "delivery_item_update",
  "delivery_note_add",
  "delivery_item_to_task",
  "delivery_template_create",
  "delivery_template_update",
  "delivery_template_delete",
  "doc_upload_url",
  "doc_replace",
  "doc_update",
  "message_update",
  "catalog_create",
  "catalog_update",
  "catalog_delete",
  "finance_create",
  "finance_update",
  "finance_delete",
  "finance_attach_upload_url",
  "finance_attach_confirm",
  "finance_attach_delete",
  "task_create",
  "task_update",
  "task_delete",
  "contact_create",
  "contact_update",
  "contact_delete",
  "interaction_add",
  "team_invite",
  "team_resend_reset",
  "team_remove",
  "password_reset_complete",
];
const READ = [
  "me", "team", "team_list", "tasks_list", "contacts_list", "contact_get", "bootstrap", "catalog_list", "products_list", "finance_list", "finance_attach_url",
  "contract_fields", "contract_history", "contract_url", "deliveries_list", "delivery_get", "delivery_templates_list",
  "docs_list", "doc_url", "messages_list",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method !== "POST") throw new AppError(405, "metodo", "Método não permitido. Use POST.");
    const h = req.headers.get("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!token) throw new AppError(401, "nao_autenticado", "Faça login para continuar.");

    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 20000) throw new AppError(413, "grande_demais", "Requisição grande demais.");
    let input: any;
    try { input = await req.json(); } catch { throw bad("Corpo da requisição inválido."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("Corpo da requisição inválido.");
    const action = input.action;
    if (typeof action !== "string" || (!WRITE.includes(action) && !READ.includes(action))) {
      throw new AppError(400, "acao_invalida", "Ação inválida.");
    }

    const user = await authorizeRequest(req, token, WRITE.includes(action));
    switch (action) {
      case "me": return json({ user: { id: user.id, email: user.email, role: user.role } });
      case "bootstrap": return json(await bootstrap(user));
      case "team":
      case "team_list": return json(await team());
      case "team_invite": needAdmin(user); return json(await teamInvite(input, req), 201);
      case "team_resend_reset": needAdmin(user); return json(await teamResendReset(input, req));
      case "team_remove": needAdmin(user); return json(await teamRemove(input, user));
      case "password_reset_complete": return json(await passwordResetComplete(user));
      case "tasks_list": return json(await tasksList());
      case "task_create": return json(await taskCreate(input, user, req), 201);
      case "task_update": return json(await taskUpdate(input, user, req));
      case "task_delete": return json(await taskDelete(input, user));
      case "contacts_list": return json(await contactsList());
      case "contact_get": return json(await contactGet(input));
      case "contact_create": return json(await contactCreate(input, user), 201);
      case "contact_update": return json(await contactUpdate(input, user));
      case "contact_delete": needAdmin(user); return json(await contactDelete(input));
      case "interaction_add": return json(await interactionAdd(input, user), 201);
      case "products_list": return json(await productsList());
      case "catalog_list": needAdmin(user); return json(await catalogList());
      case "catalog_create": needAdmin(user); return json(await catalogCreate(input, user), 201);
      case "catalog_update": needAdmin(user); return json(await catalogUpdate(input, user));
      case "catalog_delete": needAdmin(user); return json(await catalogDelete(input));
      case "finance_list": needAdmin(user); return json(await financeList());
      case "finance_create": needAdmin(user); return json(await financeCreate(input, user), 201);
      case "finance_update": needAdmin(user); return json(await financeUpdate(input, user));
      case "finance_delete": needAdmin(user); return json(await financeDelete(input));
      case "finance_attach_upload_url": needAdmin(user); return json(await financeAttachUploadUrl(input));
      case "finance_attach_confirm": needAdmin(user); return json(await financeAttachConfirm(input, user), 201);
      case "finance_attach_url": needAdmin(user); return json(await financeAttachUrl(input));
      case "finance_attach_delete": needAdmin(user); return json(await financeAttachDelete(input));
      // entrega: leitura (qualquer membro)
      case "deliveries_list": return json(await deliveriesList());
      case "delivery_get": return json(await deliveryGet(input));
      case "delivery_templates_list": return json(await templatesList());
      case "docs_list": return json(await docsList());
      case "doc_url": return json(await docUrl(input));
      case "messages_list": return json(await messagesList());
      case "contract_fields": return json(await contractFields());
      case "contract_history": return json(await contractHistory(input));
      case "contract_url": return json(await contractUrl(input));
      // entrega: escrita (mesma regra das tarefas)
      case "delivery_create": return json(await deliveryCreate(input, user), 201);
      case "delivery_update": return json(await deliveryUpdate(input, user));
      case "delivery_item_update": return json(await deliveryItemUpdate(input, user));
      case "delivery_note_add": return json(await deliveryNoteAdd(input, user), 201);
      case "delivery_item_to_task": return json(await deliveryItemToTask(input, user, req), 201);
      case "contract_save": return json(await contractSave(input, user));
      case "contract_generate": return json(await contractGenerate(input, user), 201);
      // entrega: somente administradores
      case "delivery_delete": needAdmin(user); return json(await deliveryDelete(input));
      case "delivery_template_create": needAdmin(user); return json(await templateCreate(input, user), 201);
      case "delivery_template_update": needAdmin(user); return json(await templateUpdate(input, user));
      case "delivery_template_delete": needAdmin(user); return json(await templateDelete(input));
      case "doc_upload_url": needAdmin(user); return json(await docUploadUrl(input));
      case "doc_replace": needAdmin(user); return json(await docReplace(input, user));
      case "doc_update": needAdmin(user); return json(await docUpdate(input, user));
      case "message_update": needAdmin(user); return json(await messageUpdate(input, user));
    }
    throw new AppError(400, "acao_invalida", "Ação inválida.");
  } catch (e) {
    if (e instanceof AppError) {
      return json({ error: { code: e.code, message: e.message, ...(e.details?.length ? { details: e.details } : {}) } }, e.status, e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {});
    }
    console.error(e);
    return json({ error: { code: "interno", message: "Erro interno." } }, 500);
  }
});
