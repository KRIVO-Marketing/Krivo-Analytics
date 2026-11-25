// Síntese do Diagnóstico: junta os pilares disponíveis num relatório de estrutura fixa (problemas, prioridades, produto indicado).
// Nota geral, ordem dos pilares e produto indicado são regra em código; a IA só redige o texto.
import { groqJson, listOf, strOf } from "../insta-api/insta.ts";
import { GBP_RULES, GROQ_MODEL } from "./gbp.ts";

export type PillarKey = "instagram" | "google";
export const PILLAR_LABELS: Record<PillarKey, string> = { instagram: "Instagram", google: "Google Meu Negócio" };
export type PillarIn = { key: PillarKey; score: number; summary: string; dims: { label: string; score: number; max: number; improvements: string[] }[]; recommendations?: { title: string; description: string }[] };

export type Product = { code: "01" | "02" | "05"; name: string };
// Regra de indicação (o time pode ajustar aqui): pilar mais fraco decide; os dois abaixo de 60 pedem a Metodologia completa.
export function pickProduct(pillars: { key: PillarKey; score: number }[]): Product {
  const weak = pillars.filter((p) => p.score < 60);
  if (pillars.length > 1 && weak.length === pillars.length) return { code: "05", name: "Metodologia KRIVO" };
  const worst = [...pillars].sort((a, b) => a.score - b.score)[0];
  return worst?.key === "google" ? { code: "02", name: "KRIVO Local" } : { code: "01", name: "KRIVO Social" };
}
export const overallScore = (ps: { score: number }[]) => (ps.length ? Math.round(ps.reduce((a, p) => a + p.score, 0) / ps.length) : 0);
export const verdictFor = (s: number) => (s >= 75 ? "Presença forte, falta refinar" : s >= 50 ? "Tem potencial, mas deixa clientes na mesa" : s >= 30 ? "Presença fraca: está perdendo clientes" : "Presença crítica: urgente");

export type Report = {
  verdict: string; summary: string;
  top_problems: { pillar: PillarKey; title: string; detail: string }[];
  priorities: { priority: "alta" | "media" | "baixa"; pillar: PillarKey; title: string; action: string; impact: string; effort: "baixo" | "medio" | "alto" }[];
  product: Product & { why: string };
};

const SYSTEM = `${GBP_RULES}

Você escreve o relatório final do KRIVO Diagnóstico, produto de entrada vendido ao dono do negócio. O leitor NÃO é técnico: frases curtas, sem jargão, mostrando o que está custando clientes. Tom honesto e construtivo, sem alarmismo.
Use só o que está nos dados dos pilares. Cada problema e cada prioridade cita um número real vindo dos dados.
"top_problems": exatamente 5, do mais grave ao menos grave, cada um com "pillar" ("instagram" ou "google", só dos pilares presentes), "title" (até 80 caracteres), "detail" (1 a 2 frases com o número).
"priorities": exatamente 5 ações ordenadas, as 2 primeiras "alta", as 2 seguintes "media", a última "baixa"; "pillar", "title", "action" (o que fazer, concreto), "impact" (o que muda para o negócio), "effort" ("baixo","medio" ou "alto").
"summary": 3 a 4 frases para abrir o relatório. "product_why": 2 frases explicando por que o produto indicado resolve os problemas mais graves (o produto vem nos dados, não troque).
Formato exato: {"summary":"","top_problems":[{"pillar":"","title":"","detail":""}],"priorities":[{"priority":"alta","pillar":"","title":"","action":"","impact":"","effort":""}],"product_why":""}`;

function clean(j: any, present: PillarKey[], product: Product, verdict: string): Report {
  const pil = (v: unknown): PillarKey => (present.includes(v as PillarKey) ? (v as PillarKey) : present[0]);
  const problems = (Array.isArray(j?.top_problems) ? j.top_problems : []).slice(0, 5)
    .map((x: any) => ({ pillar: pil(x?.pillar), title: strOf(x?.title, 100), detail: strOf(x?.detail, 400) })).filter((x: any) => x.title && x.detail);
  const prio = ["alta", "alta", "media", "media", "baixa"] as const;
  const priorities = (Array.isArray(j?.priorities) ? j.priorities : []).slice(0, 5).map((x: any, i: number) => ({
    priority: prio[i], pillar: pil(x?.pillar), title: strOf(x?.title, 100), action: strOf(x?.action, 400), impact: strOf(x?.impact, 300),
    effort: (["baixo", "medio", "alto"].includes(x?.effort) ? x.effort : "medio") as "baixo" | "medio" | "alto",
  })).filter((x: any) => x.title && x.action);
  const summary = strOf(j?.summary, 900);
  const why = strOf(j?.product_why, 500);
  if (problems.length < 3 || priorities.length < 3 || !summary || !why) throw new Error("report");
  return { verdict, summary, top_problems: problems, priorities, product: { ...product, why } };
}

export async function buildReport(business: string, pillars: PillarIn[]): Promise<{ report: Report; model: string }> {
  const product = pickProduct(pillars);
  const verdict = verdictFor(overallScore(pillars));
  const data = {
    negocio: business,
    produto_indicado: product.name,
    pilares: pillars.map((p) => ({
      pilar: p.key, nota_0_a_100: p.score, resumo: p.summary,
      dimensoes: p.dims.map((d) => ({ nome: d.label, nota: `${d.score}/${d.max}`, a_melhorar: d.improvements })),
      recomendacoes: p.recommendations?.map((r) => `${r.title}: ${r.description}`) ?? [],
    })),
  };
  const j = await groqJson(SYSTEM, `<dados>\n${JSON.stringify(data)}\n</dados>`, 3500, (x) => void clean(x, pillars.map((p) => p.key), product, verdict));
  return { report: clean(j, pillars.map((p) => p.key), product, verdict), model: GROQ_MODEL };
}
export { listOf };
