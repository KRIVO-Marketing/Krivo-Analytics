// ops-api: Tarefas (Kanban) e CRM da KRIVO.
// Toda autenticação, permissão, validação e regra de negócio fica aqui. O front-end só apresenta.
// As tabelas têm RLS ativo e nenhum grant para anon/authenticated: só esta função (service_role) acessa.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "npm:jose@5";

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
  let emailSent = false;
  let emailWarning: string | undefined;
  if (data.assignee_id) {
    const n = await notifyTaskAssignee({
      assigneeId: data.assignee_id,
      taskTitle: data.title,
      status: data.status,
      dueDate: data.due_date,
      contactId: data.contact_id,
      actorEmail: u.email,
      appUrl: appUrlFromReq(req),
    });
    emailSent = n.emailSent;
    emailWarning = n.emailWarning;
  }
  return { task: data, emailSent, emailWarning };
}
async function taskUpdate(i: any, u: Member, req: Request) {
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
  let emailSent = false;
  let emailWarning: string | undefined;
  if (data.assignee_id && data.assignee_id !== cur.assignee_id) {
    const n = await notifyTaskAssignee({
      assigneeId: data.assignee_id,
      taskTitle: data.title,
      status: data.status,
      dueDate: data.due_date,
      contactId: data.contact_id,
      actorEmail: u.email,
      appUrl: appUrlFromReq(req),
    });
    emailSent = n.emailSent;
    emailWarning = n.emailWarning;
  }
  return { task: data, emailSent, emailWarning };
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

const WRITE = [
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
const READ = ["me", "team", "team_list", "tasks_list", "contacts_list", "contact_get", "bootstrap"];

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
