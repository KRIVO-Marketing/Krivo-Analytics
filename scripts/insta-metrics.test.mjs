// Teste das métricas contra o relatório real do Instascore (@catroniscorp_software, 24/11/2026).
// Rodar: node scripts/insta-metrics.test.mjs
import assert from "node:assert/strict";
import { computeMetrics, engagementBand } from "../lib/insta/metrics.ts";

const c = (type, likes, ts, caption = "") => ({ type, likes, comments: 0, timestamp: ts, caption });
const profile = {
  username: "catroniscorp_software", fullName: "Catronis Corp", biography: "Gestão transformada em +200 negócios 🚀\n🛒 Mercado, padaria, açougue e varejo\n💰Sistema inteligente, lucro garantido\nTransforme sua gestão AGORA ⤵️",
  followers: 1062, following: 925, postsCount: 506, externalUrl: "http://bit.ly/CatronisCorp", isBusiness: true, isVerified: false,
  posts: [
    c("carousel", 5, "2026-11-20T14:45:01Z", "Qual frase está faltando nessa lista? ⤵️"),
    c("carousel", 4, "2026-11-16T14:45:02Z", "E você, o que gostaria de antecipar na sua loja? Conta pra gente! 👇"),
    c("carousel", 5, "2026-11-11T14:25:02Z", "Me conta: qual dessas tarefas mais consome tempo no seu mercado? ⤵️"),
    c("carousel", 4, "2026-11-06T14:45:01Z", "Qual desses pontos mais exige atenção na sua loja? ⤵️"),
    c("video", 3, "2026-11-04T14:45:06Z", "O que você gostaria que a CatIA fizesse pela sua loja?"),
    c("image", 5, "2026-11-02T14:45:03Z", "Salve este checklist, organize sua operação"),
    c("carousel", 2, "2026-10-30T14:50:01Z", "Feliz Dia do Comerciário!"),
    c("video", 5, "2026-10-29T14:45:05Z", "qual pergunta você faria para a CatIA?"),
    c("image", 3, "2026-10-27T14:45:03Z", "Salva para fazer essa análise. 👀"),
    c("video", 3, "2026-10-26T14:45:05Z", "Qual já aconteceu aí? 1, 2 ou 3?"),
    c("carousel", 7, "2026-10-23T14:45:02Z", "Deslize e veja como funciona."),
    c("video", 7, "2026-10-22T14:45:06Z", "Você acompanha o giro dos produtos na sua loja? ⤵️"),
  ],
};

const m = computeMetrics(profile);
// Valores publicados pelo Instascore para este perfil
assert.equal(m.postsPerWeek, 2.9, "posts/semana");
assert.equal(m.windowDays, 29, "janela em dias");
// O Instascore mostra 0,47% porque arredonda a mediana das curtidas (4,5) para 5 antes de dividir; a conta exata é 0,42%.
assert.equal(m.medianLikes, 4.5, "mediana de curtidas");
assert.equal(m.engagementMedianPct, 0.42, "taxa típica (mediana, sem arredondar)");
assert.equal(m.engagementMeanPct, 0.42, "taxa média (gráfico raio-X)");
assert.equal(m.formats.carousel.share, 50);
assert.equal(m.formats.video.share, 33);
assert.equal(m.formats.image.share, 17);
assert.equal(m.formats.carousel.medianLikes, 4.5); // o Instascore exibe 5 (mediana arredondada)
assert.equal(m.caption.hashtagRate, 0, "hashtags em 0% dos posts");
assert.equal(m.tier, "nano");
assert.equal(engagementBand(m.engagementMedianPct, m.tier), "baixo");
assert.equal(m.zeroCommentShare, 100);
assert.equal(m.bio.hasLink, true);
console.log("ok — métricas batem com o Instascore:", { postsPerWeek: m.postsPerWeek, mediana: m.engagementMedianPct, media: m.engagementMeanPct, formatos: m.formats, legenda: m.caption, outlier: m.outlierShare });
