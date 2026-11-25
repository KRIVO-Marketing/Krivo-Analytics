// diag-api: KRIVO Diagnóstico (relatório padronizado: Instagram + Google Meu Negócio). Só administradores.
// Função separada do ops-api porque as chamadas (coleta + IA) são longas. Toda autenticação, permissão, validação e regra
// de negócio fica aqui; o front-end só apresenta. A tabela diag_reports tem RLS ativo e nenhum grant para anon/authenticated.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "npm:jose@5";
import { InstaError } from "../insta-api/insta.ts";
import { collectPlace, computeGbp, GbpError, generateGoogleAssets, parseGoogleInput, scoreGbp } from "./gbp.ts";
import { buildReport, overallScore, PILLAR_LABELS, type PillarIn } from "./report.ts";

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
const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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
const dbErr = (msg: string) => new AppError(500, "db", msg);
const notFound = (m: string) => new AppError(404, "nao_encontrado", m);

// ---------- limite de requisições ----------
const LIMITS = { ip: { limit: 60, window: 60 }, user: { limit: 60, window: 60 } };
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

// ---------- autenticação (igual ao ops-api) ----------
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


// Só administradores usam a análise de Instagram (gera custo de coleta e de IA).
async function authorizeAdmin(req: Request, token: string): Promise<Member> {
  const authUser = await verifyToken(token);
  const [, memberRes] = await Promise.all([
    rateLimit(`diag-ip:${clientIp(req)}`, LIMITS.ip),
    sb.from("ga4_members").select("role").eq("user_id", authUser.id).maybeSingle(),
    rateLimit(`diag:${authUser.id}`, LIMITS.user),
  ]);
  if (memberRes.error) throw new AppError(500, "db", "Erro ao verificar permissão.");
  if (!memberRes.data) throw new AppError(403, "sem_permissao", "Seu usuário não tem acesso a esta plataforma.");
  if (memberRes.data.role !== "admin") throw new AppError(403, "somente_admin", "Somente administradores podem usar o Diagnóstico.");
  return { id: authUser.id, email: authUser.email, role: "admin" };
}

// ---------- validação ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, label = "ID") => {
  if (typeof v !== "string" || !UUID.test(v)) throw bad(`${label} inválido.`);
  return v.toLowerCase();
};
const optStr = (v: unknown, label: string, max: number) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw bad(`${label} inválido.`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw bad(`${label} aceita até ${max} caracteres.`);
  return s;
};

async function checkContact(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const id = uuid(v, "Cliente");
  const { data, error } = await sb.from("crm_contacts").select("id").eq("id", id).maybeSingle();
  if (error) throw new AppError(500, "db", "Erro ao verificar o cliente.");
  if (!data) throw new AppError(404, "nao_encontrado", "Cliente não encontrado.");
  return id;
}

// ---------- Diagnóstico ----------
const DIAG_LIMIT_HOUR = { limit: 20, window: 3600 }; // protege o crédito da coleta e o uso da IA
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InstaError || e instanceof GbpError) throw new AppError(e.status, e.code, e.message, e.retryAfter);
    throw e;
  }
}
async function clientName(contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await sb.from("crm_contacts").select("name,company").eq("id", contactId).maybeSingle();
  return data ? [data.name, data.company].filter(Boolean).join(" · ") : null;
}
async function load(id: string) {
  const { data, error } = await sb.from("diag_reports").select("*").eq("id", id).maybeSingle();
  if (error) throw dbErr("Erro ao ler o diagnóstico.");
  if (!data) throw notFound("Diagnóstico não encontrado.");
  return data;
}
// Junta o relatório com a análise de Instagram ligada a ele (a análise vive nas tabelas insta_*).
async function full(row: any) {
  let insta: any = null;
  if (row.insta_analysis_id) {
    const { data } = await sb.from("insta_analyses").select("id,profile_id,status,total_score,dimensions,metrics,result,created_at").eq("id", row.insta_analysis_id).maybeSingle();
    if (data) {
      const { data: prof } = await sb.from("insta_profiles").select("username").eq("id", data.profile_id).maybeSingle();
      insta = { ...data, username: prof?.username ?? row.instagram_username };
    }
  }
  let assets: any[] = [];
  if (row.insta_analysis_id) {
    const { data } = await sb.from("insta_assets").select("id,kind,position,payload").eq("analysis_id", row.insta_analysis_id).order("kind").order("position").limit(400);
    assets = data ?? [];
  }
  const g = row.google ? { ...row.google, place: row.google.place ? { ...row.google.place, reviews: undefined } : null } : null;
  return { report: { ...row, google: g }, insta, assets };
}
async function diagList() {
  const { data, error } = await sb.from("diag_reports")
    .select("id,business_name,contact_id,instagram_username,google_input,status,overall_score,pillar_scores,created_at,finished_at,tier:report->>tier")
    .order("created_at", { ascending: false }).limit(300);
  if (error) throw dbErr("Erro ao ler os diagnósticos.");
  return { reports: data ?? [] };
}
async function diagGet(i: any) {
  return full(await load(uuid(i.id, "ID do diagnóstico")));
}
async function diagCreate(i: any, u: Member) {
  const business = optStr(i.business_name, "O nome da empresa", 120);
  if (!business || business.length < 2) throw bad("Informe o nome da empresa.");
  let ig: string | null = null;
  if (i.instagram_username) {
    ig = String(i.instagram_username).trim().toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/[/?#].*$/, "").replace(/^@/, "");
    if (!/^[a-z0-9._]{1,30}$/.test(ig)) throw bad("Informe um @ de Instagram válido.");
  }
  let google: string | null = null;
  if (i.google_input) {
    try { google = parseGoogleInput(i.google_input).value; } catch (e) { if (e instanceof GbpError) throw bad(e.message); throw e; }
  }
  if (!ig && !google) throw bad("Informe o Instagram e/ou o Google Meu Negócio para gerar o diagnóstico.");
  const contact = await checkContact(i.contact_id);
  const { data, error } = await sb.from("diag_reports").insert({ business_name: business, contact_id: contact, instagram_username: ig, google_input: google, created_by: u.id }).select().single();
  if (error) throw dbErr("Erro ao criar o diagnóstico.");
  return { report: data };
}
// O Instagram é analisado pela insta-api (insta_analyze); aqui só ligamos a análise pronta ao diagnóstico.
async function diagAttachInstagram(i: any) {
  const row = await load(uuid(i.id, "ID do diagnóstico"));
  const aid = uuid(i.analysis_id, "ID da análise");
  const { data: a, error } = await sb.from("insta_analyses").select("id,status,total_score,profile_id").eq("id", aid).maybeSingle();
  if (error) throw dbErr("Erro ao ler a análise.");
  if (!a || a.status !== "ready" || a.total_score === null) throw new AppError(409, "analise_incompleta", "A análise do Instagram ainda não está pronta.");
  const { data: prof } = await sb.from("insta_profiles").select("username").eq("id", a.profile_id).maybeSingle();
  if (row.instagram_username && prof?.username && prof.username !== row.instagram_username) throw bad("Essa análise é de outro perfil.");
  const { error: e2 } = await sb.from("diag_reports").update({ insta_analysis_id: aid }).eq("id", row.id);
  if (e2) throw dbErr("Erro ao ligar a análise ao diagnóstico.");
  return { ok: true };
}
async function diagRunGoogle(i: any, u: Member) {
  const row = await load(uuid(i.id, "ID do diagnóstico"));
  if (!row.google_input) throw bad("Este diagnóstico não tem Google Meu Negócio.");
  await rateLimit(`diag-g:${u.id}`, DIAG_LIMIT_HOUR);
  const place = await collectPlace(parseGoogleInput(row.google_input));
  const metrics = computeGbp(place);
  const { scoring, model } = await scoreGbp(place, metrics, { clientName: await clientName(row.contact_id) });
  const google = { place, metrics, total_score: scoring.total_score, dimensions: scoring.dimensions, result: scoring.result };
  const { error } = await sb.from("diag_reports").update({ google, model }).eq("id", row.id);
  if (error) throw dbErr("Erro ao salvar a análise do Google.");
  return { ok: true, score: scoring.total_score };
}
async function diagGoogleAssets(i: any, u: Member) {
  const row = await load(uuid(i.id, "ID do diagnóstico"));
  if (!row.google?.place) throw bad("Este diagnóstico ainda não tem a análise do Google.");
  await rateLimit(`diag-ga:${u.id}`, DIAG_LIMIT_HOUR);
  const extras = await generateGoogleAssets(row.google.place, row.google.result?.summary ?? "", row.google.result?.reviews_insight ?? "");
  const { error } = await sb.from("diag_reports").update({ google: { ...row.google, extras } }).eq("id", row.id);
  if (error) throw dbErr("Erro ao salvar o pacote do Google.");
  return { ok: true };
}
async function diagFinish(i: any, u: Member) {
  const row = await load(uuid(i.id, "ID do diagnóstico"));
  const tier = i.tier === "completo" ? "completo" : "essencial";
  await rateLimit(`diag-f:${u.id}`, DIAG_LIMIT_HOUR);
  const pillars: PillarIn[] = [];
  if (row.insta_analysis_id) {
    const { data: a } = await sb.from("insta_analyses").select("status,total_score,dimensions,result").eq("id", row.insta_analysis_id).maybeSingle();
    if (a?.status === "ready" && a.total_score !== null) {
      pillars.push({
        key: "instagram", score: a.total_score, summary: a.result?.summary ?? "",
        dims: Object.values(a.dimensions ?? {}).map((d: any) => ({ label: d.label, score: d.score, max: d.max, improvements: d.improvements ?? [] })),
        recommendations: (a.result?.recommendations ?? []).slice(0, 5).map((r: any) => ({ title: r.title, description: r.description })),
      });
    }
  }
  if (row.google?.dimensions) {
    pillars.push({
      key: "google", score: row.google.total_score, summary: row.google.result?.summary ?? "",
      dims: Object.values(row.google.dimensions).map((d: any) => ({ label: d.label, score: d.score, max: d.max, improvements: d.improvements ?? [] })),
    });
  }
  if (!pillars.length) throw new AppError(409, "sem_pilares", "Nenhum pilar foi analisado ainda.");
  const { report, model } = await buildReport(row.business_name, pillars);
  const scores = Object.fromEntries(pillars.map((p) => [p.key, p.score]));
  const { error } = await sb.from("diag_reports").update({
    report: { ...report, tier }, overall_score: overallScore(pillars), pillar_scores: scores, status: "ready", model, finished_at: new Date().toISOString(),
  }).eq("id", row.id);
  if (error) throw dbErr("Erro ao salvar o relatório.");
  return full(await load(row.id));
}
async function diagDelete(i: any) {
  const { error } = await sb.from("diag_reports").delete().eq("id", uuid(i.id, "ID do diagnóstico"));
  if (error) throw dbErr("Erro ao excluir o diagnóstico.");
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method !== "POST") throw new AppError(405, "metodo", "Método não permitido. Use POST.");
    const h = req.headers.get("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!token) throw new AppError(401, "nao_autenticado", "Faça login para continuar.");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 4000) throw new AppError(413, "grande_demais", "Requisição grande demais.");
    let input: any;
    try { input = await req.json(); } catch { throw bad("Corpo da requisição inválido."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("Corpo da requisição inválido.");
    const user = await authorizeAdmin(req, token);
    switch (input.action) {
      case "diag_list": return json(await diagList());
      case "diag_get": return json(await diagGet(input));
      case "diag_create": return json(await diagCreate(input, user), 201);
      case "diag_attach_instagram": return json(await diagAttachInstagram(input));
      case "diag_run_google": return json(await guard(() => diagRunGoogle(input, user)));
      case "diag_google_assets": return json(await guard(() => diagGoogleAssets(input, user)));
      case "diag_finish": return json(await guard(() => diagFinish(input, user)));
      case "diag_delete": return json(await diagDelete(input));
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
