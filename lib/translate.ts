// Tradução apenas de exibição (nomes técnicos do GA4 -> português). Não é regra de negócio.
const EVENTS: Record<string, [string, string]> = {
  page_view: ["Visualização de página", "Alguém abriu uma página do site"],
  session_start: ["Início de sessão", "Uma nova visita começou"],
  first_visit: ["Primeira visita", "Pessoa que nunca tinha entrado no site"],
  user_engagement: ["Tempo de leitura", "Pessoa ficou com a página aberta e em uso"],
  scroll: ["Rolagem da página", "Pessoa rolou até o fim da página (90%)"],
  click: ["Clique em link externo", "Pessoa saiu do site por um link"],
  form_start: ["Início de formulário", "Pessoa começou a preencher um formulário"],
  form_submit: ["Envio de formulário", "Pessoa enviou um formulário"],
  file_download: ["Download de arquivo", "Pessoa baixou um arquivo"],
  view_search_results: ["Busca no site", "Pessoa usou a busca do site"],
  video_start: ["Início de vídeo", "Pessoa começou a assistir a um vídeo"],
  video_complete: ["Vídeo assistido até o fim", "Pessoa terminou um vídeo"],
  generate_lead: ["Contato gerado", "Pessoa deixou os dados de contato"],
};

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
  referral: "link de outro site",
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
  fb: "Facebook",
  "m.facebook.com": "Facebook",
  "l.facebook.com": "Facebook",
  "facebook.com": "Facebook",
  linkedin: "LinkedIn",
  "linkedin.com": "LinkedIn",
  "l.wl.co": "WhatsApp (link)",
  "wa.me": "WhatsApp",
  whatsapp: "WhatsApp",
  google: "Google",
  bing: "Bing",
  youtube: "YouTube",
  "t.co": "X (Twitter)",
};

export function sourceInfo(source: string, medium: string): { label: string; detail: string } {
  const s = SOURCES[source.toLowerCase()] ?? source;
  const m = MEDIUMS[medium.toLowerCase()] ?? medium;
  if (source === "(direct)") return { label: "Direto", detail: "digitou o endereço ou usou um favorito" };
  return { label: s, detail: m };
}

export function pageLabel(path: string): string {
  if (path === "/" || path === "") return "Página inicial";
  return path;
}
