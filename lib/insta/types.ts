import { instaCall } from "../api";
import type { InstaMetrics, InstaProfile } from "./metrics";

export type AnalysisStatus = "queued" | "collecting" | "scoring" | "generating" | "ready" | "failed";
export type DimKey = "bio" | "consistencia" | "engajamento" | "conteudo" | "conversao";
export type Dimension = { score: number; max: number; label: string; feedback: string; positives: string[]; improvements: string[] };
export type Recommendation = { priority: "alta" | "media" | "baixa"; title: string; description: string; impact: string };
export type Solutions = {
  bio_rewritten: string; cadence: string; comment_hook: string; cta: string;
  post_ideas: { format: string; first_line: string; outline: string }[];
};
export type Comparison = {
  username: string; followers: number; you_ahead: string; them_ahead: string; what_to_copy: string[];
  stats: { cadence: { user: number | null; competitor: number | null; ratio: number | null }; engagement: { user: number | null; competitor: number | null } };
};
export type AnalysisResult = {
  summary: string; share_verdict: string; niche: string; recommendations: Recommendation[]; solutions: Solutions; comparisons?: Comparison[];
};

export type InstaProfileRow = {
  id: string; username: string; contact_id: string | null; is_internal: boolean; competitors: string[];
  goal: string | null; pain: string | null; notes: string | null; created_at: string; updated_at: string;
};
export type AnalysisBrief = { id: string; profile_id: string; status: AnalysisStatus; total_score: number | null; created_at: string; finished_at: string | null; error: string | null };
export type InstaListItem = InstaProfileRow & { contact_name: string | null; analyses: AnalysisBrief[] };

export type Analysis = AnalysisBrief & {
  dimensions: Record<DimKey, Dimension> | null; metrics: InstaMetrics | null; result: AnalysisResult | null; model: string | null; rubric_version: string;
};
export type AssetKind = "plan_post" | "bio" | "reel" | "sales_message";
export type AssetStatus = "draft" | "approved" | "published" | "discarded";
export type Asset = { id: string; analysis_id: string; kind: AssetKind; position: number; payload: any; status: AssetStatus };
export type AnalysisDetail = {
  analysis: Analysis; profile: InstaProfileRow; assets: Asset[];
  snapshot: { raw: InstaProfile; fetched_at: string; source: string } | null;
};

export const GOALS = ["Vender mais", "Agendar mais clientes", "Crescer a audiência", "Ser referência no nicho"];
export const PAINS = ["Não sabe o que postar", "Posta e ninguém vê", "Tem seguidores, mas não viram cliente", "O perfil não passa profissionalismo", "Não consegue manter o ritmo"];
export const DIM_ORDER: DimKey[] = ["bio", "consistencia", "engajamento", "conteudo", "conversao"];

// Análise e geração levam de 30 s a 2 min: sem limite curto de espera.
export const instaList = () => instaCall<{ profiles: InstaListItem[] }>({ action: "insta_list" }).then((r) => r.profiles);
export const instaGet = (analysis_id: string) => instaCall<AnalysisDetail>({ action: "insta_get", analysis_id });
export const instaAnalyze = (body: { username: string; contact_id?: string | null; is_internal?: boolean; goal?: string | null; pain?: string | null }) =>
  instaCall<AnalysisDetail>({ action: "insta_analyze", ...body });
export type AssetGroupKey = "plan" | "bios" | "reels" | "messages";
export const instaGenerate = (analysis_id: string, group: AssetGroupKey, part?: number) =>
  instaCall<{ kind: AssetKind; assets: Asset[] }>({ action: "insta_generate_assets", analysis_id, group, ...(part ? { part } : {}) });
// Plano (13 semanas) em 3 partes e Reels (20) em 2: cada parte cabe no tempo e no limite da IA, e a lista sai sempre completa.
export const GROUP_PARTS: Record<AssetGroupKey, number> = { plan: 3, reels: 2, bios: 1, messages: 1 };
export async function instaGenerateAll(analysis_id: string, group: AssetGroupKey, onPart?: (part: number, total: number) => void) {
  const total = GROUP_PARTS[group];
  let last: { kind: AssetKind; assets: Asset[] } | null = null;
  for (let part = 1; part <= total; part++) {
    onPart?.(part, total);
    last = await instaGenerate(analysis_id, group, total > 1 ? part : undefined);
  }
  return last as { kind: AssetKind; assets: Asset[] };
}
export const instaCompare = (analysis_id: string, username: string) =>
  instaCall<{ comparison: Comparison }>({ action: "insta_compare", analysis_id, username });
export const instaAssetStatus = (id: string, status: AssetStatus) => instaCall<{ asset: Asset }>({ action: "insta_asset_update", id, status });
export const instaDelete = (id: string) => instaCall<{ ok: boolean }>({ action: "insta_delete", id });

export const scoreTone = (s: number) => (s >= 75 ? "text-pos" : s >= 50 ? "text-ink" : "text-neg");
