import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
};
const DAYS_ALLOWED = [7, 14, 28, 90];
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

// ---------- limite de requisições ----------
// Contador atômico no Postgres (função ga4_rate_hit), compartilhado entre todas as instâncias.
const LIMITS = {
  ip: { limit: 120, window: 60 },     // por IP, antes de autenticar (também freia tentativas com token falso)
  user: { limit: 60, window: 60 },    // por usuário, leituras gerais
  metrics: { limit: 20, window: 60 }, // por usuário, consultas ao Google Analytics (cota externa)
  write: { limit: 20, window: 60 },   // por usuário, create/update/delete
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
  if (wait > 0) {
    throw new AppError(429, "muitas_requisicoes", `Muitas requisições. Aguarde ${wait} segundo${wait === 1 ? "" : "s"} e tente de novo.`, wait);
  }
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

// ---------- Google auth ----------
let cached: { token: string; exp: number } | null = null;
const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  bytes.forEach((c) => (s += String.fromCharCode(c)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function serviceAccount() {
  const raw = Deno.env.get("GA4_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new AppError(500, "config", "Credencial do Google não configurada no servidor.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(500, "config", "Credencial do Google inválida no servidor.");
  }
}
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claim}.${b64url(sig)}`,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new AppError(502, "google_auth", "O Google recusou a credencial do servidor.");
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}
async function ga(pid: string, method: string, body: unknown) {
  const token = await accessToken();
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return await r.json();
  if (r.status === 403) {
    throw new AppError(422, "sem_acesso",
      "A conta de serviço não tem acesso a essa propriedade. No Google Analytics, adicione o e-mail da conta de serviço como Leitor (Viewer).");
  }
  if (r.status === 400 || r.status === 404) {
    console.error("ga_error", method, r.status, await r.text());
    throw new AppError(422, "propriedade_invalida", "O Google não reconheceu esse ID de propriedade GA4.");
  }
  throw new AppError(502, "google_erro", "Erro ao consultar o Google Analytics. Tente novamente.");
}

// ---------- helpers ----------
const rows = (rep: any) =>
  (rep?.rows ?? []).map((r: any) => ({
    d: r.dimensionValues.map((x: any) => x.value as string),
    m: r.metricValues.map((x: any) => Number(x.value)),
  }));
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const isoDate = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

function cleanPropertyId(v: unknown) {
  const s = String(v ?? "").trim().replace(/^properties\//i, "");
  if (!/^\d{6,12}$/.test(s)) {
    throw new AppError(400, "validacao", "O ID da propriedade GA4 deve ter só números (6 a 12 dígitos).");
  }
  return s;
}
function cleanName(v: unknown) {
  const s = String(v ?? "").trim();
  if (s.length < 2 || s.length > 80) throw new AppError(400, "validacao", "O nome deve ter entre 2 e 80 caracteres.");
  return s;
}
function cleanCta(v: unknown) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(s)) {
    throw new AppError(400, "validacao", "O evento do botão deve usar só letras minúsculas, números e _ (ex.: clique_whatsapp).");
  }
  return s;
}
function cleanCtaLabel(v: unknown) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (s.length < 2 || s.length > 80) throw new AppError(400, "validacao", "O nome do botão deve ter entre 2 e 80 caracteres.");
  return s;
}
function cleanNotes(v: unknown) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s.length > 500) throw new AppError(400, "validacao", "As observações aceitam até 500 caracteres.");
  return s || null;
}
function cleanKind(v: unknown) {
  const s = String(v ?? "client");
  if (s !== "client") throw new AppError(400, "validacao", "Só é possível cadastrar propriedades do tipo cliente.");
  return s;
}
async function getProp(id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, "validacao", "ID inválido.");
  const { data, error } = await sb.from("ga4_properties").select("*").eq("id", id).maybeSingle();
  if (error) throw new AppError(500, "db", "Erro ao ler o cadastro.");
  if (!data) throw new AppError(404, "nao_encontrado", "Propriedade não encontrada.");
  return data;
}

// ---------- helpers de metas ----------
const round2 = (n: number) => Math.round(n * 100) / 100;
function cleanGoalTitle(v: unknown) {
  const s = String(v ?? "").trim();
  if (s.length < 2 || s.length > 80) throw new AppError(400, "validacao", "O título da meta deve ter entre 2 e 80 caracteres.");
  return s;
}
function cleanGoalNumber(v: unknown, label: string, positive: boolean) {
  const ok = (typeof v === "number") || (typeof v === "string" && v.trim() !== "");
  const n = ok ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new AppError(400, "validacao", `${label} deve ser um número.`);
  const r = round2(n);
  if (positive ? r <= 0 : r < 0) {
    throw new AppError(400, "validacao", positive ? `${label} deve ser maior que zero.` : `${label} não pode ser negativo.`);
  }
  return r;
}
function cleanGoalId(id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError(400, "validacao", "ID da meta inválido.");
  }
  return id;
}

// ---------- actions ----------
async function info() {
  return { service_account_email: serviceAccount().client_email, days_allowed: DAYS_ALLOWED };
}
async function list() {
  const { data, error } = await sb.from("ga4_properties").select("*").order("kind", { ascending: true }).order("name");
  if (error) throw new AppError(500, "db", "Erro ao listar.");
  return { properties: data };
}
async function create(i: any) {
  const row = {
    name: cleanName(i.name),
    property_id: cleanPropertyId(i.property_id),
    kind: cleanKind(i.kind),
    cta_event: cleanCta(i.cta_event),
    cta_label: cleanCtaLabel(i.cta_label),
    notes: cleanNotes(i.notes),
  };
  await ga(row.property_id, "runReport", {
    dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }],
    metrics: [{ name: "sessions" }],
  });
  const { data, error } = await sb.from("ga4_properties").insert(row).select().single();
  if (error) {
    if (error.code === "23505") throw new AppError(409, "duplicado", "Essa propriedade GA4 já está cadastrada.");
    throw new AppError(500, "db", "Erro ao salvar.");
  }
  return { property: data };
}
async function update(i: any) {
  const cur = await getProp(i.id);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (i.name !== undefined) patch.name = cleanName(i.name);
  if (i.cta_event !== undefined) patch.cta_event = cleanCta(i.cta_event);
  if (i.cta_label !== undefined) patch.cta_label = cleanCtaLabel(i.cta_label);
  if (i.notes !== undefined) patch.notes = cleanNotes(i.notes);
  if (i.active !== undefined) {
    if (typeof i.active !== "boolean") throw new AppError(400, "validacao", "Campo ativo inválido.");
    if (cur.kind === "own" && i.active === false) throw new AppError(409, "regra", "A propriedade da KRIVO não pode ser desativada.");
    patch.active = i.active;
  }
  const { data, error } = await sb.from("ga4_properties").update(patch).eq("id", cur.id).select().single();
  if (error) throw new AppError(500, "db", "Erro ao atualizar.");
  return { property: data };
}
async function remove(i: any) {
  const cur = await getProp(i.id);
  if (cur.kind === "own") throw new AppError(409, "regra", "A propriedade da KRIVO não pode ser removida.");
  const { error } = await sb.from("ga4_properties").delete().eq("id", cur.id);
  if (error) throw new AppError(500, "db", "Erro ao remover.");
  return { ok: true };
}
async function goalsList() {
  const { data, error } = await sb.from("ga4_goals").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw new AppError(500, "db", "Erro ao listar as metas.");
  return { goals: data };
}
async function goalCreate(i: any) {
  const title = cleanGoalTitle(i.title);
  const target = cleanGoalNumber(i.target, "A meta (target)", true);
  const current = i.current === undefined || i.current === null ? 0 : cleanGoalNumber(i.current, "O valor atual (current)", false);
  const achieved_at = current >= target ? new Date().toISOString() : null;
  const { data, error } = await sb.from("ga4_goals").insert({ title, target, current, achieved_at }).select().single();
  if (error) throw new AppError(500, "db", "Erro ao salvar a meta.");
  return { goal: data };
}
async function goalUpdate(i: any) {
  const id = cleanGoalId(i.id);
  const { data: cur, error: e1 } = await sb.from("ga4_goals").select("*").eq("id", id).maybeSingle();
  if (e1) throw new AppError(500, "db", "Erro ao ler a meta.");
  if (!cur) throw new AppError(404, "nao_encontrado", "Meta não encontrada.");
  const title = i.title !== undefined ? cleanGoalTitle(i.title) : cur.title;
  const target = i.target !== undefined ? cleanGoalNumber(i.target, "A meta (target)", true) : Number(cur.target);
  const current = i.current !== undefined ? cleanGoalNumber(i.current, "O valor atual (current)", false) : Number(cur.current);
  const achieved_at = current >= target ? (cur.achieved_at ?? new Date().toISOString()) : null;
  const { data, error } = await sb.from("ga4_goals")
    .update({ title, target, current, achieved_at, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new AppError(500, "db", "Erro ao atualizar a meta.");
  return { goal: data };
}
async function goalDelete(i: any) {
  const id = cleanGoalId(i.id);
  const { error } = await sb.from("ga4_goals").delete().eq("id", id);
  if (error) throw new AppError(500, "db", "Erro ao remover a meta.");
  return { ok: true };
}
const METRICS_CACHE_MS = 10 * 60_000;
const REALTIME_CACHE_MS = 20_000;
const metricsCache = new Map<string, { data: unknown; exp: number }>();
const realtimeCache = new Map<string, { data: unknown; exp: number }>();

async function metrics(i: any) {
  const prop = await getProp(i.id);
  if (!prop.active) throw new AppError(409, "inativo", "Essa propriedade está desativada.");
  const days = Number(i.days ?? 28);
  if (!DAYS_ALLOWED.includes(days)) throw new AppError(400, "validacao", `Período inválido. Use: ${DAYS_ALLOWED.join(", ")}.`);
  const cacheKey = `${prop.id}:${days}`;
  if (!i.force) {
    const hit = metricsCache.get(cacheKey);
    if (hit && hit.exp > Date.now()) return hit.data;
  }
  const pid = prop.property_id;
  const cta: string | null = prop.cta_event;
  const range = [{ startDate: `${days}daysAgo`, endDate: "yesterday" }];
  const M = [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }, { name: "eventCount" }];
  const requests: any[] = [
    { dateRanges: range, dimensions: [{ name: "date" }], metrics: M, metricAggregations: ["TOTAL"],
      orderBys: [{ dimension: { dimensionName: "date" } }], limit: 200 },
    { dateRanges: range, dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 15 },
    { dateRanges: range, dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 10 },
    { dateRanges: range, dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }], orderBys: [{ metric: { metricName: "eventCount" }, desc: true }], limit: 25 },
  ];
  if (cta) {
    requests.push({
      dateRanges: range,
      dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: cta } } },
      limit: 25,
    });
  }
  const campaignRequests: any[] = [
    {
      dateRanges: range,
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
        { name: "sessionManualAdContent" },
      ],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 30,
    },
  ];
  if (cta) {
    campaignRequests.push({
      dateRanges: range,
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
        { name: "sessionManualAdContent" },
      ],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: cta } } },
      limit: 30,
    });
  }
  const [batch, prev, campBatch] = await Promise.all([
    ga(pid, "batchRunReports", { requests }),
    ga(pid, "runReport", {
      dateRanges: [{ startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` }],
      metrics: M,
    }),
    ga(pid, "batchRunReports", { requests: campaignRequests }),
  ]);
  const reps = batch.reports ?? [];
  const daily = rows(reps[0]).map((r: any) => ({
    date: isoDate(r.d[0]), sessions: r.m[0], users: r.m[1], pageviews: r.m[2], events: r.m[3],
  }));
  const tv = reps[0]?.totals?.[0]?.metricValues?.map((x: any) => Number(x.value));
  const tot = tv ?? [
    daily.reduce((a: number, d: any) => a + d.sessions, 0), daily.reduce((a: number, d: any) => a + d.users, 0),
    daily.reduce((a: number, d: any) => a + d.pageviews, 0), daily.reduce((a: number, d: any) => a + d.events, 0),
  ];
  const pv = prev?.rows?.[0]?.metricValues?.map((x: any) => Number(x.value)) ?? [0, 0, 0, 0];
  const events = rows(reps[3]).map((r: any) => ({ name: r.d[0], count: r.m[0], users: r.m[1] }));
  const ctaEv = cta ? events.find((e: any) => e.name === cta) : null;
  const ctaClicks = ctaEv?.count ?? 0;
  const ctaUsers = ctaEv?.users ?? 0;
  const ctaBySrc: Record<string, number> = {};
  if (cta) for (const r of rows(reps[4])) ctaBySrc[`${r.d[0]}|${r.d[1]}`] = r.m[0];
  const sources = rows(reps[1]).map((r: any) => ({
    source: r.d[0], medium: r.d[1], sessions: r.m[0], users: r.m[1],
    share: tot[0] ? Math.round((r.m[0] / tot[0]) * 1000) / 10 : 0,
    cta_clicks: cta ? (ctaBySrc[`${r.d[0]}|${r.d[1]}`] ?? 0) : null,
  }));
  const pages = rows(reps[2]).map((r: any) => ({ path: r.d[0], views: r.m[0], users: r.m[1] }));
  const scroll = events.find((e: any) => e.name === "scroll");
  const funnel = [
    { key: "visitantes", label: "Visitantes", users: tot[1] },
    { key: "engajados", label: "Rolaram a página", users: scroll?.users ?? 0 },
  ];
  if (cta) funnel.push({ key: "cta", label: "Clicaram no botão", users: ctaUsers });
  const campReps = campBatch?.reports ?? [];
  const ctaByCamp: Record<string, number> = {};
  if (cta) {
    for (const r of rows(campReps[1])) ctaByCamp[`${r.d[0]}|${r.d[1]}|${r.d[2]}|${r.d[3]}`] = r.m[0];
  }
  const IGNORED_CAMP = new Set(["(not set)", "(direct)", "(organic)", "(referral)", "(none)", ""]);
  const IGNORED_CONT = new Set(["(not set)", "(none)", ""]);
  const campaigns = rows(campReps[0])
    .filter((r: any) => !IGNORED_CAMP.has(r.d[0]) || !IGNORED_CONT.has(r.d[3]))
    .map((r: any) => ({
      campaign: r.d[0],
      source: r.d[1],
      medium: r.d[2],
      content: IGNORED_CONT.has(r.d[3]) ? null : r.d[3],
      sessions: r.m[0],
      users: r.m[1],
      share: tot[0] ? Math.round((r.m[0] / tot[0]) * 1000) / 10 : 0,
      cta_clicks: cta ? (ctaByCamp[`${r.d[0]}|${r.d[1]}|${r.d[2]}|${r.d[3]}`] ?? 0) : null,
    }));
  const end = new Date(Date.now() - 864e5);
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  const payload = {
    property: { id: prop.id, name: prop.name, kind: prop.kind, property_id: pid, cta_event: cta, cta_label: prop.cta_label ?? null },
    days,
    range: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    generated_at: new Date().toISOString(),
    totals: {
      sessions: tot[0], users: tot[1], pageviews: tot[2], events: tot[3],
      cta_clicks: cta ? ctaClicks : null, cta_users: cta ? ctaUsers : null,
      cta_rate: cta && tot[1] ? Math.round((ctaUsers / tot[1]) * 1000) / 10 : null,
    },
    previous: { sessions: pv[0], users: pv[1], pageviews: pv[2], events: pv[3] },
    change_pct: { sessions: pct(tot[0], pv[0]), users: pct(tot[1], pv[1]), pageviews: pct(tot[2], pv[2]) },
    daily, sources, campaigns, pages, events, funnel,
  };
  metricsCache.set(cacheKey, { data: payload, exp: Date.now() + METRICS_CACHE_MS });
  return payload;
}

async function realtime(i: any) {
  const prop = await getProp(i.id);
  if (!prop.active) throw new AppError(409, "inativo", "Essa propriedade está desativada.");
  const hit = realtimeCache.get(prop.id);
  if (!i.force && hit && hit.exp > Date.now()) return hit.data;
  const pid = prop.property_id;
  const [totRep, pagesRep, evRep] = await Promise.all([
    ga(pid, "runRealtimeReport", {
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }, { name: "eventCount" }],
      metricAggregations: ["TOTAL"],
    }),
    ga(pid, "runRealtimeReport", {
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      limit: 8,
    }),
    ga(pid, "runRealtimeReport", {
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      limit: 10,
    }),
  ]);
  const totVals = totRep?.totals?.[0]?.metricValues?.map((x: any) => Number(x.value));
  const devRows = rows(totRep);
  const activeUsers = totVals?.[0] ?? devRows.reduce((a: number, r: any) => a + r.m[0], 0);
  const pageviews = totVals?.[1] ?? devRows.reduce((a: number, r: any) => a + r.m[1], 0);
  const events = totVals?.[2] ?? devRows.reduce((a: number, r: any) => a + r.m[2], 0);
  const rtPayload = {
    generated_at: new Date().toISOString(),
    window_minutes: 30,
    active_users: activeUsers,
    pageviews,
    events,
    pages: rows(pagesRep).map((r: any) => ({ title: r.d[0], users: r.m[0], views: r.m[1] })),
    top_events: rows(evRep).map((r: any) => ({ name: r.d[0], count: r.m[0], users: 0 })),
  };
  realtimeCache.set(prop.id, { data: rtPayload, exp: Date.now() + REALTIME_CACHE_MS });
  return rtPayload;
}

const WRITE_ACTIONS = ["create", "update", "delete", "goal_create", "goal_update", "goal_delete"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method !== "POST") throw new AppError(405, "metodo", "Método não permitido. Use POST.");
    await rateLimit(`ip:${clientIp(req)}`, LIMITS.ip);
    const user = await authenticate(req);
    let input: any;
    try { input = await req.json(); } catch { throw new AppError(400, "validacao", "Corpo da requisição inválido."); }
    const action = input?.action;
    if (action === "metrics" || action === "realtime") await rateLimit(`metrics:${user.id}`, LIMITS.metrics);
    else if (WRITE_ACTIONS.includes(action)) await rateLimit(`write:${user.id}`, LIMITS.write);
    else await rateLimit(`user:${user.id}`, LIMITS.user);
    switch (action) {
      case "me": return json({ user: { id: user.id, email: user.email, role: user.role } });
      case "info": return json(await info());
      case "list": return json(await list());
      case "metrics": return json(await metrics(input));
      case "realtime": return json(await realtime(input));
      case "create": needAdmin(user); return json(await create(input), 201);
      case "update": needAdmin(user); return json(await update(input));
      case "delete": needAdmin(user); return json(await remove(input));
      case "goals_list": return json(await goalsList());
      case "goal_create": needAdmin(user); return json(await goalCreate(input), 201);
      case "goal_update": needAdmin(user); return json(await goalUpdate(input));
      case "goal_delete": needAdmin(user); return json(await goalDelete(input));
      default: throw new AppError(400, "acao_invalida", "Ação inválida. Use: me, info, list, metrics, realtime, create, update, delete, goals_list, goal_create, goal_update, goal_delete.");
    }
  } catch (e) {
    if (e instanceof AppError) {
      return json({ error: { code: e.code, message: e.message } }, e.status, e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {});
    }
    console.error(e);
    return json({ error: { code: "interno", message: "Erro interno." } }, 500);
  }
});
