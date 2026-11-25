import { ApiError, diagCall } from "../api";
import { instaAnalyze } from "../insta/types";
import type { AnalysisResult, Dimension } from "../insta/types";

export type PillarKey = "instagram" | "google";
export const PILLAR_LABELS: Record<PillarKey, string> = { instagram: "Instagram", google: "Google Meu Negócio" };

export type GoogleDimension = Dimension;
export type GoogleData = {
  place: { name: string; category: string; city: string; address: string; rating: number | null; reviewsCount: number; photosCount: number; mapsUrl: string | null; website: string | null; phone: string | null } | null;
  metrics: {
    rating: number | null; reviewsCount: number; photosCount: number; sampleSize: number; repliedShare: number | null; negativeCount: number; negativeUnanswered: number;
    medianReplyDays: number | null; last90Days: number; daysSinceLastReview: number | null; replyGenericShare: number | null;
  };
  total_score: number;
  dimensions: Record<string, GoogleDimension>;
  result: { summary: string; niche: string; reviews_insight: string; reply_examples: { review: string; suggested_reply: string }[] };
};
export type Report = {
  verdict: string; summary: string;
  top_problems: { pillar: PillarKey; title: string; detail: string }[];
  priorities: { priority: "alta" | "media" | "baixa"; pillar: PillarKey; title: string; action: string; impact: string; effort: "baixo" | "medio" | "alto" }[];
  product: { code: string; name: string; why: string };
};
export type DiagBrief = {
  id: string; business_name: string; contact_id: string | null; instagram_username: string | null; google_input: string | null;
  status: "draft" | "ready"; overall_score: number | null; pillar_scores: Partial<Record<PillarKey, number>> | null; created_at: string; finished_at: string | null;
};
export type DiagInsta = {
  id: string; username: string | null; total_score: number; dimensions: Record<string, Dimension>; result: AnalysisResult | null;
  metrics: { followers?: number; postsPerWeek?: number | null; engagementMedianPct?: number | null } | null;
};
export type DiagFull = { report: DiagBrief & { google: GoogleData | null; report: Report | null }; insta: DiagInsta | null };

export const diagList = () => diagCall<{ reports: DiagBrief[] }>({ action: "diag_list" }).then((r) => r.reports);
export const diagGet = (id: string) => diagCall<DiagFull>({ action: "diag_get", id });
export const diagDelete = (id: string) => diagCall<{ ok: boolean }>({ action: "diag_delete", id });

// Limite de uso da IA (por minuto): espera e tenta de novo, em vez de derrubar o diagnóstico.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withAiRetry<T>(fn: () => Promise<T>, step: (label: string) => void, label: string): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "ia_limite" || i >= 3) throw e;
      for (let s = 65; s > 0; s--) { step(`A IA está no limite de uso por minuto. Retomando em ${s}s… (${label})`); await sleep(1000); }
      step(label);
    }
  }
}

export type RunInput = { business_name: string; contact_id: string | null; instagram_username: string; google_input: string };

// O navegador conduz as etapas (cada uma cabe no tempo limite da função): Instagram, Google, síntese.
// Se um pilar falhar, o relatório sai com os pilares que deram certo e o aviso aparece na tela.
export async function runDiagnostic(input: RunInput, step: (label: string) => void): Promise<{ full: DiagFull; warnings: string[] }> {
  const { report } = await diagCall<{ report: DiagBrief }>({
    action: "diag_create", business_name: input.business_name, contact_id: input.contact_id,
    instagram_username: input.instagram_username || null, google_input: input.google_input || null,
  });
  const warnings: string[] = [];
  let ok = 0;
  if (report.instagram_username) {
    step("Analisando o Instagram… (cerca de 1 minuto)");
    try {
      const d = await withAiRetry(() => instaAnalyze({ username: report.instagram_username as string, contact_id: input.contact_id }), step, "Analisando o Instagram…");
      await diagCall({ action: "diag_attach_instagram", id: report.id, analysis_id: d.analysis.id });
      ok++;
    } catch (e) { warnings.push(`Instagram: ${(e as Error).message}`); }
  }
  if (report.google_input) {
    step("Analisando o Google Meu Negócio e as avaliações… (cerca de 1 minuto)");
    try { await withAiRetry(() => diagCall({ action: "diag_run_google", id: report.id }), step, "Analisando o Google Meu Negócio…"); ok++; } catch (e) { warnings.push(`Google Meu Negócio: ${(e as Error).message}`); }
  }
  if (!ok) {
    await diagDelete(report.id).catch(() => undefined);
    throw new Error(warnings.join(" · ") || "Não foi possível analisar nenhum pilar.");
  }
  step("Montando o relatório…");
  const full = await withAiRetry(() => diagCall<DiagFull>({ action: "diag_finish", id: report.id }), step, "Montando o relatório…");
  return { full, warnings };
}

export const scoreLabel = (s: number) => (s >= 75 ? "Forte" : s >= 50 ? "Regular" : s >= 30 ? "Fraco" : "Crítico");
export const scoreColor = (s: number) => (s >= 75 ? "#2f8f4e" : s >= 50 ? "#b8861b" : "#b83a3a");
