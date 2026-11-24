// Métricas determinísticas da análise de Instagram. Sem IA e sem imports: roda igual no navegador, no Node e na Edge Function (Deno).
// Reproduzem, conferidas contra dados reais, as contas que o Instascore mostra (ver docs/instascore-engenharia-reversa.md, seção 3).

export type PostType = "image" | "video" | "carousel";
export type InstaPost = {
  likes: number;
  comments: number;
  caption: string;
  timestamp: string; // ISO
  type: PostType;
};
export type InstaProfile = {
  username: string;
  fullName: string;
  biography: string;
  followers: number;
  following: number;
  postsCount: number;
  externalUrl: string | null;
  isBusiness: boolean;
  isVerified: boolean;
  posts: InstaPost[]; // mais recentes primeiro ou em qualquer ordem; a ordem é tratada aqui
};

export type SizeTier = "nano" | "micro" | "mid" | "macro";
export type FormatStats = { share: number; medianLikes: number; count: number };

export type InstaMetrics = {
  sampleSize: number;
  windowDays: number | null;
  postsPerWeek: number | null;
  tier: SizeTier;
  engagementMedianPct: number | null; // mediana((curtidas+comentários)/seguidores): o "típico"
  engagementMeanPct: number | null; // média: a que o gráfico do Instascore mostra
  medianLikes: number;
  medianComments: number;
  zeroCommentShare: number;
  formats: Record<PostType, FormatStats>;
  bestFormat: PostType | null;
  caption: { avgLength: number; hashtagRate: number; avgHashtags: number; questionRate: number; ctaRate: number };
  bio: { length: number; hasLink: boolean; hasCta: boolean; hasNumber: boolean };
  outlierShare: number; // fatia das interações totais concentrada nos 2 maiores posts (alerta de taxa inflada)
};

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function sizeTier(followers: number): SizeTier {
  if (followers < 10_000) return "nano";
  if (followers < 100_000) return "micro";
  if (followers < 1_000_000) return "mid";
  return "macro";
}

// Faixas de taxa de engajamento (%) por porte. "nano" vem do Instascore (Médio ≥1, Bom ≥2,5, Excelente ≥6); as demais são
// ponto de partida a calibrar com perfis reais (o Instascore só cita 0,8–1,5% como média para 10–100 mil).
export const ENGAGEMENT_BANDS: Record<SizeTier, { medium: number; good: number; excellent: number }> = {
  nano: { medium: 1, good: 2.5, excellent: 6 },
  micro: { medium: 0.8, good: 1.5, excellent: 3 },
  mid: { medium: 0.5, good: 1, excellent: 2 },
  macro: { medium: 0.3, good: 0.7, excellent: 1.5 },
};
export type EngagementBand = "baixo" | "medio" | "bom" | "excelente";
export function engagementBand(pct: number, tier: SizeTier): EngagementBand {
  const b = ENGAGEMENT_BANDS[tier];
  return pct >= b.excellent ? "excelente" : pct >= b.good ? "bom" : pct >= b.medium ? "medio" : "baixo";
}

const HASHTAG = /#[\p{L}\p{N}_]+/gu; // com g: só para match() (contagem)
const HAS_HASHTAG = /#[\p{L}\p{N}_]+/u; // sem g: para test() (sem estado entre chamadas)
// Convites de ação em português: "comenta", "salva", "link na bio", "chama no direct", "whatsapp", "agende"...
const CTA = /\b(coment[ae]\w*|salv[ae]\w*|compartilh\w+|link na bio|chama\w* (?:no|na) (?:direct|dm|whats\w*)|whats\w*|agende\w*|clique\w*|acesse\w*|manda\w* (?:um )?(?:direct|dm)|fale com)\b/iu;

export function computeMetrics(p: InstaProfile): InstaMetrics {
  const posts = [...p.posts].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  const n = posts.length;
  const tier = sizeTier(p.followers);

  let windowDays: number | null = null;
  let postsPerWeek: number | null = null;
  if (n >= 2) {
    // intervalo entre o post mais antigo e o mais recente da amostra; n posts em `windowDays` dias → n/dias*7
    windowDays = Math.max(1, Math.round((+new Date(posts[0].timestamp) - +new Date(posts[n - 1].timestamp)) / 86_400_000));
    postsPerWeek = round((n / windowDays) * 7, 1);
  }

  const inter = posts.map((x) => x.likes + x.comments);
  const per = (v: number) => (p.followers > 0 ? (v / p.followers) * 100 : null);
  const engagementMedianPct = n ? round(per(median(inter)) ?? 0) : null;
  const engagementMeanPct = n ? round(per(mean(inter)) ?? 0) : null;

  const formats = {} as Record<PostType, FormatStats>;
  (["image", "video", "carousel"] as PostType[]).forEach((t) => {
    const of = posts.filter((x) => x.type === t);
    formats[t] = { count: of.length, share: n ? round((of.length / n) * 100, 0) : 0, medianLikes: round(median(of.map((x) => x.likes)), 1) };
  });
  const withPosts = (Object.keys(formats) as PostType[]).filter((t) => formats[t].count >= 2);
  const bestFormat = withPosts.length ? withPosts.sort((a, b) => formats[b].medianLikes - formats[a].medianLikes)[0] : null;

  const tags = posts.map((x) => (x.caption.match(HASHTAG) ?? []).length);
  const top2 = [...inter].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
  const total = inter.reduce((a, b) => a + b, 0);
  const rate = (pred: (x: InstaPost) => boolean) => (n ? round((posts.filter(pred).length / n) * 100, 0) : 0);

  return {
    sampleSize: n,
    windowDays,
    postsPerWeek,
    tier,
    engagementMedianPct,
    engagementMeanPct,
    medianLikes: round(median(posts.map((x) => x.likes)), 1),
    medianComments: round(median(posts.map((x) => x.comments)), 1),
    zeroCommentShare: rate((x) => x.comments === 0),
    formats,
    bestFormat,
    caption: {
      avgLength: Math.round(mean(posts.map((x) => x.caption.length))),
      hashtagRate: rate((x) => HAS_HASHTAG.test(x.caption)),
      avgHashtags: round(mean(tags), 1),
      questionRate: rate((x) => x.caption.includes("?")),
      ctaRate: rate((x) => CTA.test(x.caption)),
    },
    bio: {
      length: p.biography.length,
      hasLink: !!p.externalUrl,
      hasCta: CTA.test(p.biography) || /[⤵👇⬇➡]/u.test(p.biography),
      hasNumber: /\d/.test(p.biography),
    },
    outlierShare: total > 0 && n > 4 ? round((top2 / total) * 100, 0) : 0,
  };
}
