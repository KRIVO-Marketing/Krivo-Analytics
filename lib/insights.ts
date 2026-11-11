// Leitura em português dos números do período. Só apresentação: os números vêm prontos do back-end.
import type { Metrics } from "./types";
import { dec1, num } from "./format";
import { sourceInfo } from "./translate";

export type Insight = { tone: "good" | "warn" | "info"; title: string; text: string };

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function buildInsights(d: Metrics): Insight[] {
  const out: Insight[] = [];
  const t = d.totals;

  // 1) Tendência de visitas
  const chg = d.change_pct.sessions;
  if (chg !== null) {
    if (chg >= 10) out.push({ tone: "good", title: "Mais gente chegando", text: `As visitas cresceram ${dec1(chg)}% em relação ao período anterior. O que você está fazendo para divulgar está funcionando.` });
    else if (chg <= -10) out.push({ tone: "warn", title: "Menos visitas que antes", text: `As visitas caíram ${dec1(Math.abs(chg))}% em relação ao período anterior. Vale reforçar a divulgação ou conferir se algo mudou no site.` });
    else out.push({ tone: "info", title: "Visitas estáveis", text: `O número de visitas ficou parecido com o período anterior (${chg >= 0 ? "+" : "−"}${dec1(Math.abs(chg))}%).` });
  }

  // 2) Resultado: clique no botão
  if (t.cta_rate !== null && t.cta_users !== null) {
    const alvo = d.property.cta_label ? `em "${d.property.cta_label}"` : "no botão principal";
    if (t.cta_users === 0) out.push({ tone: "warn", title: "Ninguém clicou", text: `Nenhum visitante clicou ${alvo} neste período. Vale deixar o botão mais visível ou revisar a chamada.` });
    else out.push({ tone: t.cta_rate >= 3 ? "good" : "info", title: "Interesse em agir", text: `${num(t.cta_users)} ${t.cta_users === 1 ? "pessoa clicou" : "pessoas clicaram"} ${alvo}: a cada 100 visitantes, cerca de ${dec1(t.cta_rate)} clicaram. É o interesse, o clique em si; quantas viraram atendimento ou venda, só o controle interno de vocês mostra.` });
  }

  // 3) Qual origem traz mais cliques
  const withCta = d.sources.filter((s) => (s.cta_clicks ?? 0) > 0).sort((a, b) => (b.cta_clicks ?? 0) - (a.cta_clicks ?? 0));
  if (withCta[0]) {
    const s = withCta[0];
    const i = sourceInfo(s.source, s.medium);
    out.push({ tone: "good", title: "O que mais traz resultado", text: `${i.label} (${i.detail}) é a origem que mais gerou cliques: ${num(s.cta_clicks ?? 0)}. É onde vale investir mais.` });
  }
  const top = d.sources[0];
  if (top && t.cta_rate !== null && (top.cta_clicks ?? 0) === 0 && top.share >= 40 && d.sources.length > 1) {
    const i = sourceInfo(top.source, top.medium);
    out.push({ tone: "warn", title: "Muita visita, pouco clique", text: `${i.label} traz ${dec1(top.share)}% das visitas, mas nenhum clique. Esse público pode não estar encontrando o que procura.` });
  }

  // 4) Leitura da página
  const vis = d.funnel.find((f) => f.key === "visitantes");
  const eng = d.funnel.find((f) => f.key === "engajados");
  if (vis && eng && vis.users >= 20) {
    const r = (eng.users / vis.users) * 100;
    if (r < 30) out.push({ tone: "warn", title: "Poucos chegam ao fim da página", text: `Só ${dec1(r)}% dos visitantes rolaram até o fim. O conteúdo mais importante deve ficar no começo da página.` });
    else if (r >= 60) out.push({ tone: "good", title: "As pessoas leem até o fim", text: `${dec1(r)}% dos visitantes rolaram a página até o final. É um bom sinal de interesse.` });
  }

  // 5) Melhor dia da semana
  if (d.daily.length >= 14) {
    const soma = new Array(7).fill(0), qtd = new Array(7).fill(0);
    for (const x of d.daily) { const w = new Date(`${x.date}T12:00:00`).getDay(); soma[w] += x.sessions; qtd[w]++; }
    const med = soma.map((s, i) => (qtd[i] ? s / qtd[i] : 0));
    const best = med.indexOf(Math.max(...med));
    if (med[best] > 0) out.push({ tone: "info", title: "Melhor dia para publicar", text: `${DIAS[best][0].toUpperCase()}${DIAS[best].slice(1)} é o dia de maior movimento (em média ${num(Math.round(med[best]))} visitas). Bom momento para divulgar.` });
  }

  return out;
}
