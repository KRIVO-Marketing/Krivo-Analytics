// insta-api: análise de Instagram com IA (nota, diagnóstico, plano de conteúdo). Só administradores.
// Função separada do ops-api porque as chamadas (coleta + IA) são longas. Toda autenticação, permissão, validação e regra
// de negócio fica aqui; o front-end só apresenta. As tabelas insta_* têm RLS ativo e nenhum grant para anon/authenticated.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "npm:jose@5";
import {
  ASSET_GROUPS, PLAN_PARTS, REEL_PARTS, collectProfile, compareProfiles, compareStats, computeMetrics, generateAssets, InstaError, normalizeUsername,
  RUBRIC_VERSION, scoreProfile, type AnalysisCtx, type AssetGroup, type InstaMetrics, type InstaProfile,
} from "./insta.ts";

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
    rateLimit(`insta-ip:${clientIp(req)}`, LIMITS.ip),
    sb.from("ga4_members").select("role").eq("user_id", authUser.id).maybeSingle(),
    rateLimit(`insta:${authUser.id}`, LIMITS.user),
  ]);
  if (memberRes.error) throw new AppError(500, "db", "Erro ao verificar permissão.");
  if (!memberRes.data) throw new AppError(403, "sem_permissao", "Seu usuário não tem acesso a esta plataforma.");
  if (memberRes.data.role !== "admin") throw new AppError(403, "somente_admin", "Somente administradores podem usar a análise de Instagram.");
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
const oneOf = (v: unknown, list: string[], label: string) => {
  if (typeof v !== "string" || !list.includes(v)) throw bad(`${label} inválido.`);
  return v;
};
async function checkContact(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const id = uuid(v, "Cliente");
  const { data, error } = await sb.from("crm_contacts").select("id").eq("id", id).maybeSingle();
  if (error) throw new AppError(500, "db", "Erro ao verificar o cliente.");
  if (!data) throw new AppError(404, "nao_encontrado", "Cliente não encontrado.");
  return id;
}

// ---------- Análise de Instagram (só admin) ----------
// Coleta pública (Apify) + métricas calculadas em código + diagnóstico e materiais pela IA (Groq). Ver insta.ts.
const INSTA_ASSET_STATUS = ["draft", "approved", "published", "discarded"];
const INSTA_LIMIT_HOUR = { limit: 40, window: 3600 }; // protege o crédito da coleta e o uso da IA
async function insta<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InstaError) throw new AppError(e.status, e.code, e.message, e.retryAfter);
    throw e;
  }
}
async function instaContext(profile: any): Promise<AnalysisCtx> {
  let clientName: string | null = null;
  if (profile.contact_id) {
    const { data } = await sb.from("crm_contacts").select("name,company").eq("id", profile.contact_id).maybeSingle();
    clientName = data ? [data.name, data.company].filter(Boolean).join(" · ") : null;
  }
  return { goal: profile.goal, pain: profile.pain, notes: profile.notes, isInternal: !!profile.is_internal, clientName };
}
async function instaList() {
  const [p, a] = await Promise.all([
    sb.from("insta_profiles").select("*").order("updated_at", { ascending: false }).limit(500),
    sb.from("insta_analyses").select("id,profile_id,status,total_score,created_at,finished_at,error").order("created_at", { ascending: false }).limit(3000),
  ]);
  if (p.error || a.error) throw dbErr("Erro ao ler as análises de Instagram.");
  const ids = [...new Set((p.data ?? []).map((r: any) => r.contact_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data } = await sb.from("crm_contacts").select("id,name,company").in("id", ids.slice(0, 200));
    for (const c of data ?? []) names[c.id] = [c.name, c.company].filter(Boolean).join(" · ");
  }
  const by: Record<string, any[]> = {};
  for (const r of a.data ?? []) (by[r.profile_id] ??= []).push(r);
  return { profiles: (p.data ?? []).map((r: any) => ({ ...r, contact_name: r.contact_id ? names[r.contact_id] ?? null : null, analyses: (by[r.id] ?? []).slice(0, 24) })) };
}
async function instaGet(i: any) {
  const id = uuid(i.analysis_id, "ID da análise");
  const { data: analysis, error } = await sb.from("insta_analyses").select("*").eq("id", id).maybeSingle();
  if (error) throw dbErr("Erro ao ler a análise.");
  if (!analysis) throw notFound("Análise não encontrada.");
  const [prof, snap, assets] = await Promise.all([
    sb.from("insta_profiles").select("*").eq("id", analysis.profile_id).maybeSingle(),
    analysis.snapshot_id ? sb.from("insta_snapshots").select("raw,fetched_at,source").eq("id", analysis.snapshot_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sb.from("insta_assets").select("*").eq("analysis_id", id).order("kind").order("position").limit(500),
  ]);
  if (prof.error || snap.error || assets.error) throw dbErr("Erro ao ler a análise.");
  return { analysis, profile: prof.data, snapshot: snap.data, assets: assets.data ?? [] };
}
async function instaAnalyze(i: any, u: Member) {
  const username = normalizeUsername(i.username);
  await rateLimit(`insta-an:${u.id}`, INSTA_LIMIT_HOUR);
  const patch: Record<string, unknown> = {};
  if (i.contact_id !== undefined) patch.contact_id = await checkContact(i.contact_id);
  if (i.is_internal !== undefined) patch.is_internal = i.is_internal === true;
  if (i.goal !== undefined) patch.goal = optStr(i.goal, "O objetivo", 200);
  if (i.pain !== undefined) patch.pain = optStr(i.pain, "A dor", 200);
  if (i.notes !== undefined) patch.notes = optStr(i.notes, "As observações", 1000);
  const { data: existing, error: e0 } = await sb.from("insta_profiles").select("*").eq("username", username).maybeSingle();
  if (e0) throw dbErr("Erro ao ler o perfil.");
  let profile: any = existing;
  if (!profile) {
    const ins = await sb.from("insta_profiles").insert({ username, ...patch, created_by: u.id }).select().single();
    if (ins.error) throw dbErr("Erro ao salvar o perfil.");
    profile = ins.data;
  } else if (Object.keys(patch).length) {
    const upd = await sb.from("insta_profiles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", profile.id).select().single();
    if (upd.error) throw dbErr("Erro ao atualizar o perfil.");
    profile = upd.data;
  }
  const an = await sb.from("insta_analyses").insert({ profile_id: profile.id, status: "collecting", rubric_version: RUBRIC_VERSION, created_by: u.id }).select().single();
  if (an.error) throw dbErr("Erro ao iniciar a análise.");
  const analysisId = an.data.id as string;
  const fail = async (e: unknown) => {
    const msg = e instanceof InstaError || e instanceof AppError ? e.message : "Erro inesperado na análise.";
    await sb.from("insta_analyses").update({ status: "failed", error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", analysisId);
  };
  try {
    const collected = await collectProfile(username);
    const snap = await sb.from("insta_snapshots").insert({ profile_id: profile.id, source: "apify", raw: collected, created_by: u.id }).select("id").single();
    if (snap.error) throw dbErr("Erro ao salvar os dados coletados.");
    await sb.from("insta_analyses").update({ status: "scoring", snapshot_id: snap.data.id }).eq("id", analysisId);
    const metrics = computeMetrics(collected);
    const { scoring, model } = await scoreProfile(collected, metrics, await instaContext(profile));
    const done = await sb.from("insta_analyses").update({
      status: "ready", total_score: scoring.total_score, dimensions: scoring.dimensions, metrics, result: scoring.result, model, finished_at: new Date().toISOString(),
    }).eq("id", analysisId);
    if (done.error) throw dbErr("Erro ao salvar a análise.");
  } catch (e) {
    await fail(e);
    if (e instanceof InstaError) throw new AppError(e.status, e.code, e.message, e.retryAfter);
    throw e;
  }
  return await instaGet({ analysis_id: analysisId });
}
async function instaLoadForAssets(analysisId: string) {
  const { analysis, profile, snapshot } = await instaGet({ analysis_id: analysisId });
  if (analysis.status !== "ready" || !snapshot?.raw) throw new AppError(409, "analise_incompleta", "A análise ainda não está pronta.");
  return { analysis, profile, collected: snapshot.raw as InstaProfile, metrics: analysis.metrics as InstaMetrics };
}
async function instaGenerateAssets(i: any, u: Member) {
  const id = uuid(i.analysis_id, "ID da análise");
  const group = oneOf(i.group, [...ASSET_GROUPS], "Tipo de material") as AssetGroup;
  // part (opcional): o plano sai em 3 partes e os Reels em 2. A parte 1 substitui o que existia; as demais acrescentam.
  let part: number | undefined;
  if (i.part !== undefined && i.part !== null) {
    const max = group === "plan" ? PLAN_PARTS.length : group === "reels" ? REEL_PARTS : 0;
    part = Number(i.part);
    if (!max || !Number.isInteger(part) || part < 1 || part > max) throw bad("Parte inválida.");
  }
  await rateLimit(`insta-as:${u.id}`, INSTA_LIMIT_HOUR);
  const { analysis, profile, collected, metrics } = await instaLoadForAssets(id);
  const r = analysis.result ?? {};
  const diagnosis = `${r.summary ?? ""} Prioridades: ${(r.recommendations ?? []).map((x: any) => x.title).join("; ")}`;
  const kindOf = group === "plan" ? "plan_post" : group === "reels" ? "reel" : group === "bios" ? "bio" : "sales_message";
  const { data: existing } = await sb.from("insta_assets").select("payload,position").eq("analysis_id", id).eq("kind", kindOf).order("position").limit(500);
  const keep = part && part > 1 ? existing ?? [] : [];
  let prior = "";
  if (keep.length) {
    if (group === "plan") {
      const seen = new Map<number, string>();
      for (const a of keep) seen.set(a.payload.week, a.payload.theme);
      prior = [...seen].map(([w, t]) => `semana ${w}: ${t}`).join("; ");
    } else prior = keep.map((a: any) => a.payload.title).join("; ");
  }
  const gen = await generateAssets(group, collected, metrics, await instaContext(profile), diagnosis, part, prior);
  if (!gen.payloads.length) throw new AppError(502, "ia_vazia", "A IA não gerou itens utilizáveis. Tente de novo.");
  if (!keep.length) {
    const del = await sb.from("insta_assets").delete().eq("analysis_id", id).eq("kind", gen.kind);
    if (del.error) throw dbErr("Erro ao substituir os materiais.");
  }
  const offset = keep.length;
  const ins = await sb.from("insta_assets").insert(gen.payloads.map((payload, position) => ({ analysis_id: id, kind: gen.kind, position: offset + position, payload }))).select();
  if (ins.error) throw dbErr("Erro ao salvar os materiais.");
  return { kind: gen.kind, assets: ins.data ?? [], part: part ?? null };
}
async function instaCompare(i: any, u: Member) {
  const id = uuid(i.analysis_id, "ID da análise");
  const username = normalizeUsername(i.username);
  await rateLimit(`insta-an:${u.id}`, INSTA_LIMIT_HOUR);
  const { analysis, profile, collected, metrics } = await instaLoadForAssets(id);
  if (username === profile.username) throw bad("Escolha um concorrente diferente do próprio perfil.");
  const them = await collectProfile(username);
  const tm = computeMetrics(them);
  const text = await compareProfiles(collected, metrics, them, tm, await instaContext(profile));
  const entry = { username, followers: them.followers, score_metrics: tm, stats: compareStats(metrics, tm), ...text, at: new Date().toISOString() };
  const prev = (analysis.result?.comparisons ?? []).filter((c: any) => c.username !== username);
  const comparisons = [...prev, entry].slice(-3);
  const upd = await sb.from("insta_analyses").update({ result: { ...(analysis.result ?? {}), comparisons } }).eq("id", id);
  if (upd.error) throw dbErr("Erro ao salvar a comparação.");
  const comps = [...new Set([...(profile.competitors ?? []), username])].slice(-5);
  await sb.from("insta_profiles").update({ competitors: comps }).eq("id", profile.id);
  return { comparison: entry };
}
async function instaProfileUpdate(i: any) {
  const id = uuid(i.id, "ID do perfil");
  const p: Record<string, unknown> = {};
  if (i.contact_id !== undefined) p.contact_id = await checkContact(i.contact_id);
  if (i.is_internal !== undefined) p.is_internal = i.is_internal === true;
  if (i.goal !== undefined) p.goal = optStr(i.goal, "O objetivo", 200);
  if (i.pain !== undefined) p.pain = optStr(i.pain, "A dor", 200);
  if (i.notes !== undefined) p.notes = optStr(i.notes, "As observações", 1000);
  if (!Object.keys(p).length) throw bad("Nada para atualizar.");
  const { data, error } = await sb.from("insta_profiles").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) throw dbErr("Erro ao atualizar o perfil.");
  if (!data) throw notFound("Perfil não encontrado.");
  return { profile: data };
}
async function instaAssetUpdate(i: any) {
  const id = uuid(i.id, "ID do material");
  const status = oneOf(i.status, INSTA_ASSET_STATUS, "Situação");
  const { data, error } = await sb.from("insta_assets").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) throw dbErr("Erro ao atualizar o material.");
  if (!data) throw notFound("Material não encontrado.");
  return { asset: data };
}
async function instaDelete(i: any) {
  const id = uuid(i.id, "ID do perfil");
  const { error } = await sb.from("insta_profiles").delete().eq("id", id);
  if (error) throw dbErr("Erro ao excluir o perfil.");
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
      case "insta_list": return json(await instaList());
      case "insta_get": return json(await instaGet(input));
      case "insta_analyze": return json(await insta(() => instaAnalyze(input, user)), 201);
      case "insta_generate_assets": return json(await insta(() => instaGenerateAssets(input, user)), 201);
      case "insta_compare": return json(await insta(() => instaCompare(input, user)), 201);
      case "insta_profile_update": return json(await instaProfileUpdate(input));
      case "insta_asset_update": return json(await instaAssetUpdate(input));
      case "insta_delete": return json(await instaDelete(input));
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
