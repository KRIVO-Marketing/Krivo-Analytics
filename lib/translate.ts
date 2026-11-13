// Tradução e agrupamento apenas de exibição (nomes técnicos do GA4 -> visão legível). Não é regra de negócio.
import type { Metrics } from "./types";

const EVENTS: Record<string, [string, string]> = {
  page_view: ["Visualização de página", "Alguém abriu uma página do site"],
  session_start: ["Início de sessão", "Uma nova visita começou"],
  first_visit: ["Primeira visita", "Pessoa que nunca tinha entrado no site"],
  user_engagement: ["Tempo de leitura", "Pessoa ficou com a página aberta e em uso"],
  scroll: ["Rolagem até o fim", "Pessoa rolou até o fim da página (90%)"],
  click: ["Clique em link externo", "Pessoa saiu do site por um link"],
  form_start: ["Início de formulário", "Pessoa começou a preencher um formulário"],
  form_submit: ["Envio de formulário", "Pessoa enviou um formulário"],
  file_download: ["Download de arquivo", "Pessoa baixou um arquivo"],
  view_search_results: ["Busca no site", "Pessoa usou a busca do site"],
  video_start: ["Início de vídeo", "Pessoa começou a assistir a um vídeo"],
  video_complete: ["Vídeo assistido até o fim", "Pessoa terminou um vídeo"],
  generate_lead: ["Contato gerado", "Pessoa deixou os dados de contato"],
};

const TECHNICAL_EVENTS = new Set(["page_view", "session_start", "first_visit", "user_engagement"]);

export const isTechnicalEvent = (name: string) => TECHNICAL_EVENTS.has(name);

export function eventInfo(name: string): { label: string; hint: string | null } {
  const e = EVENTS[name];
  return e ? { label: e[0], hint: e[1] } : { label: name.replace(/_/g, " "), hint: null };
}

const MEDIUMS: Record<string, string> = {
  "(none)": "acesso direto",
  "(not set)": "não identificado",
  organic: "busca orgânica",
  cpc: "anúncio pago",
  ppc: "anúncio pago",
  paid: "anúncio pago",
  referral: "link de referência",
  social: "rede social",
  email: "e-mail",
  bio: "link da bio",
  perfil: "link do perfil",
  display: "anúncio gráfico",
  affiliate: "afiliado",
};

const SOURCES: Record<string, string> = {
  "(direct)": "Direto",
  "(not set)": "Não identificado",
  ig: "Instagram",
  instagram: "Instagram",
  "instagram.com": "Instagram",
  "l.instagram.com": "Instagram",
  "m.instagram.com": "Instagram",
  fb: "Facebook",
  "m.facebook.com": "Facebook",
  "l.facebook.com": "Facebook",
  "lm.facebook.com": "Facebook",
  "facebook.com": "Facebook",
  linkedin: "LinkedIn",
  "linkedin.com": "LinkedIn",
  "www.linkedin.com": "LinkedIn",
  "lnkd.in": "LinkedIn",
  "l.wl.co": "WhatsApp",
  "wa.me": "WhatsApp",
  "api.whatsapp.com": "WhatsApp",
  whatsapp: "WhatsApp",
  threads: "Threads",
  "threads.net": "Threads",
  "l.threads.net": "Threads",
  tiktok: "TikTok",
  "tiktok.com": "TikTok",
  "vm.tiktok.com": "TikTok",
  google: "Google",
  bing: "Bing",
  youtube: "YouTube",
  "t.co": "X (Twitter)",
};

export function sourceInfo(source: string, medium: string): { label: string; detail: string } {
  const s = SOURCES[source.toLowerCase()] ?? source;
  const m = MEDIUMS[medium.toLowerCase()] ?? medium;
  if (source === "(direct)") return { label: "Direto", detail: "acesso direto ou favorito" };
  return { label: s, detail: m };
}

export type ChannelSubItem = {
  key: string;
  detail: string;
  sessions: number;
  users: number;
  cta_clicks: number | null;
  conversionRate: number | null;
};

export type ChannelGroup = {
  label: string;
  sessions: number;
  users: number;
  share: number;
  cta_clicks: number | null;
  conversionRate: number | null;
  items: ChannelSubItem[];
};

export function groupChannels(sources: Metrics["sources"]): ChannelGroup[] {
  const byLabel = new Map<string, ChannelGroup>();

  for (const s of sources) {
    const { label, detail } = sourceInfo(s.source, s.medium);
    let group = byLabel.get(label);
    if (!group) {
      group = { label, sessions: 0, users: 0, share: 0, cta_clicks: s.cta_clicks === null ? null : 0, conversionRate: null, items: [] };
      byLabel.set(label, group);
    }
    group.sessions += s.sessions;
    group.users += s.users;
    group.share += s.share;
    if (s.cta_clicks !== null) group.cta_clicks = (group.cta_clicks ?? 0) + s.cta_clicks;

    const existingItem = group.items.find((it) => it.detail === detail);
    if (existingItem) {
      existingItem.sessions += s.sessions;
      existingItem.users += s.users;
      if (s.cta_clicks !== null) existingItem.cta_clicks = (existingItem.cta_clicks ?? 0) + s.cta_clicks;
    } else {
      group.items.push({
        key: `${s.source}/${s.medium}`,
        detail,
        sessions: s.sessions,
        users: s.users,
        cta_clicks: s.cta_clicks,
        conversionRate: null,
      });
    }
  }

  const out = [...byLabel.values()];
  for (const g of out) {
    g.conversionRate = g.sessions > 0 && g.cta_clicks !== null ? (g.cta_clicks / g.sessions) * 100 : null;
    for (const it of g.items) {
      it.conversionRate = it.sessions > 0 && it.cta_clicks !== null ? (it.cta_clicks / it.sessions) * 100 : null;
    }
    g.items.sort((a, b) => b.sessions - a.sessions);
  }
  out.sort((a, b) => b.sessions - a.sessions);
  return out;
}

export function cleanPagePath(path: string): string {
  const base = path.split(/[?#]/)[0] || "/";
  return base.length > 1 ? base.replace(/\/+$/, "") : "/";
}

export function groupPages(pages: Metrics["pages"]): Metrics["pages"] {
  const byPath = new Map<string, { path: string; views: number; users: number }>();
  for (const p of pages) {
    const clean = cleanPagePath(p.path);
    const cur = byPath.get(clean);
    if (cur) {
      cur.views += p.views;
      cur.users += p.users;
    } else {
      byPath.set(clean, { path: clean, views: p.views, users: p.users });
    }
  }
  return [...byPath.values()].sort((a, b) => b.views - a.views);
}

export function pageLabel(path: string): string {
  const clean = cleanPagePath(path);
  if (clean === "/") return "Página inicial";
  return clean;
}
