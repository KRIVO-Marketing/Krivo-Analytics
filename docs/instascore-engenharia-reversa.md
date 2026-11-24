# Instascore — engenharia reversa e plano para o Krivo

Fonte: relatório público `instascore.com.br/r/udh1o2jcjk` (@catroniscorp_software, nota 57/100), aberto no Chrome em 24/11/2026.
Método: leitura da página renderizada, captura de rede e abertura direta do endpoint JSON que a própria página consome (`GET /api/analise/{id}`).

**Legenda:** [OBS] = observado direto · [VERIF] = conferi por conta (bate com os números) · [INF] = inferência, não confirmada.
**Não observável pelo front:** os prompts, o modelo de IA, a rubrica exata de pontuação e o provedor de scraping. Tudo isso roda no servidor.

---

## 1. Arquitetura

- [OBS] Next.js (Turbopack) em Vercel-like, PostHog, Meta Pixel e Google Ads. Feito pela Lume Tech, que usa o relatório como funil de venda de serviços.
- [OBS] A página `/r/{id}` é um shell. Os dados vêm de **um único endpoint**: `GET /api/analise/{id}`.
- [OBS] O mesmo JSON traz `teaser` (versão gratuita, textos cortados no meio da frase) e `full` (versão paga). O flag `paid: true` decide o que a UI mostra.
- [OBS] Blocos extras vendidos à parte (`bumps`): `competitors`, `contentPlan`, `bios`, `reels`, `ctas`.
- [OBS] Perguntas de entrada guardadas em `quizAnswers`: `goal`, `pain`, `stakes`. Também existe `profileType` (`negocio`). As páginas por profissão (`/nutricionista`, `/dentista`…) indicam prompt/benchmark por vertical [INF].

## 2. Dados coletados (só o que é público)

[OBS] Perfil: username, nome, bio, seguidores, seguindo, nº de posts, link externo, conta comercial, verificado.
[OBS] **Últimos 12 posts**: curtidas, comentários, legenda, timestamp, tipo (`image` | `video` | `carousel`).

Não usa alcance, impressões, salvamentos, compartilhamentos, nem olha imagem ou vídeo. A legenda é o proxy do gancho (o relatório diz isso explicitamente: "a 1ª linha da legenda é seu proxy").

## 3. Métricas determinísticas (calculadas em código, não pela IA)

Todas [VERIF] contra os dados brutos do relatório:

| Métrica | Fórmula | Exemplo (Catronis) |
|---|---|---|
| Posts/semana | `12 / dias entre o 1º e o último post × 7` | 12 em 29 dias → 2,9 |
| Engajamento "típico" (texto) | `mediana(curtidas+comentários) / seguidores`, **com a mediana arredondada para inteiro** | mediana 4,5 → 5; 5 / 1062 = 0,47% (a conta exata dá 0,42%) |
| Engajamento médio (gráfico raio-X) | `média(curtidas+comentários) / seguidores` | 4,42 / 1062 = 0,42% |
| Mix de formatos | contagem por tipo / 12 | 50% carrossel, 33% vídeo, 17% imagem |
| Engajamento por formato | mediana de curtidas por tipo | 4 / 5 / 5 |
| Legenda | tamanho médio, % de posts com hashtag, média de hashtags | 390 chars, 0% |

Atenção: o produto mostra **0,42% e 0,47%** na mesma tela. A diferença não é média vs. mediana (ambas dão 0,42%): é o arredondamento da mediana antes da divisão (correção feita ao testar o código). É um erro de precisão deles. No Krivo, escolher uma só e rotular.

Benchmark por porte [OBS]: faixa **Nano (<10 mil)** com cortes Baixo / Médio ≥1% / Bom ≥2,5% / Excelente ≥6%. Para 10–100 mil, o texto cita média de mercado entre 0,8% e 1,5%. Existe um alvo por dimensão ("nota recomendada 16/20").

## 4. Modelo de score

- [OBS] 5 dimensões × 20 pontos = 100. Soma conferida: 15+14+6+12+10 = **57**; concorrente 13+15+5+11+7 = **51**.
  1. Bio & Identidade — nicho, palavra-chave no Nome, promessa, prova, link
  2. Consistência — cadência, variedade/foco de formato, dias fixos
  3. Engajamento — taxa vs. benchmark do porte, comentários, formato que mais rende
  4. Qualidade do Conteúdo — gancho na 1ª linha, voz, dor real, entrega de valor, fecho
  5. Conversão & CTA — oferta, link, prova social, CTA repetido nos posts
- [INF] Engajamento e cadência parecem ancorados em números (6/20 com 0,47%; 5/20 com 0,11%). As outras três são julgamento do LLM sobre texto. **Não há evidência de fórmula fixa** — provavelmente o LLM recebe as métricas calculadas + a rubrica e devolve a nota. Isso explica por que um perfil com 0,11% e outro com 0,47% ficam próximos (5 vs 6).
- [OBS] Cada dimensão devolve: `score`, `maxScore`, `feedback` (1 parágrafo), `positives[2]`, `improvements[2]`.

## 5. Geração das estratégias

Formato [OBS] de cada saída:

- **Resumo + `shareVerdict`** (frase de compartilhamento, ex.: "Sistema bom, conversa morna: posta muito, para poucos.") e `niche`.
- **Hook em 3 partes**: `proof` (números do perfil) → `stakes` (custo de não agir) → `tease` (esconde a causa). É a engrenagem de conversão do teaser.
- **`recommendations[5]`**: `priority` (alta/média/baixa), `title`, `description`, `impact`. Sempre 2 altas, 2 médias, 1 baixa.
- **`solutions`** (1 por dimensão): ajuste pronto para colar (bio reescrita antes/depois, cadência fixa, frase de comentário, 3 ideias de post com 1ª linha, CTA com prova com colchetes).
- **Concorrente** (`competitors`): roda o mesmo pipeline no concorrente e gera `comparison` com `youAhead`, `themAhead`, `whatToCopy[4]` + `stats` numéricos.
- **Plano de conteúdo de 13 semanas** (`contentPlan.weeks[]`): cada semana tem `theme`, `goal` e 3 posts (`day`, `time`, `format`, `title`, `hook`, `script` por slide/cena, legenda e hashtags). A progressão é dor → autoridade → produto → estoque/caixa/preço → caso real → prova social → fiscal → compras → comparativo → oferta → chamada final. **Arco de funil, não posts soltos.**
- **10 bios**, cada uma com um ângulo (nicho claro, WhatsApp, oferta, autoridade, prova, conexão, benefício, CTA…).
- **30 Reels** (título, objetivo, roteiro em cenas, CTA com palavra-chave de comentário tipo "comenta BALANÇA").
- **5 mensagens de venda** por canal (bio, stories, reels…).
- **Ideias de serviço** (`lumeIdeas`) — o upsell da própria agência.

Padrões de prompt que dá para inferir [INF]:
- Recomendação sempre ancorada num dado do perfil ("12 em 29 dias", "mediana de 5 curtidas").
- Sempre cita a marca e o produto do cliente (CatIA) — o plano usa o contexto da bio.
- Sempre troca pergunta aberta por pergunta específica de resposta fácil; sempre propõe CTA com prova.
- Regras duras repetidas: posts/semana de 3 a 4, Reels como alavanca de descoberta para <10 mil.

## 4. Falhas do Instascore que o Krivo deve evitar

1. Placeholders `[INSIRA O LINK]`, `[NOME DO CLIENTE]`, `[X]%` espalhados pelas bios e CTAs → entrega incompleta. O Krivo já conhece o cliente (CRM), deve preencher.
2. Hashtags inconsistentes (`#dondemercado`, semana 6 sem `#`, semana 9 sem hashtags) → faltou validação.
3. Sugere "números reais de cliente" que o sistema não tem, em vez de buscá-los.
4. Duas taxas de engajamento diferentes na mesma tela.
5. Amostra de 12 posts e nenhuma métrica de alcance/salvamento: o diagnóstico "o alcance não chega" é presumido, não medido.
6. Rascunhos de plano genéricos por vertical; nenhuma conexão com a agenda real do cliente.
7. Dois concorrentes marcados `status: "failed"` sem tratamento na UI.

## 5. Como implementar no Krivo

**Vantagem estrutural:** o Instascore só vê o perfil público. O Krivo tem o cliente. Se o cliente conectar a conta (Meta Graph API / Instagram Insights), a análise ganha **alcance, impressões, salvamentos, compartilhamentos, retenção de Reels, demografia** — e passa a medir em vez de presumir. Para clientes sem conexão, cair no modo público igual ao Instascore.

### 5.1 Pipeline (4 etapas)

1. **Coleta** — perfil + últimos 12–30 posts (público via provedor de scraping; ou Graph API quando conectado). Guardar snapshot bruto.
2. **Métricas determinísticas** — módulo puro e testável (seção 3), mais tabela de benchmark por porte e por nicho. Nenhuma IA aqui.
3. **Julgamento por LLM com saída estruturada** — entrada: snapshot + métricas + rubrica + contexto do cliente do CRM (nicho, oferta, tom, concorrentes, metas). Saída: JSON Schema fixo (dimensões, recomendações, soluções).
4. **Geração de ativos** — plano de 13 semanas, bios, Reels, mensagens — chamadas separadas, com validação (hashtags, placeholders, comprimento da bio ≤150, formato por semana).

### 5.2 Onde encaixa na base atual

- Nova aba (ex.: "Análise IA") seguindo o padrão Catalog/Entrega.
- Novas actions no `ops-api` (`insta_analysis_*`), com a mesma regra de permissão do router.
- Tabelas sugeridas: `insta_profiles`, `insta_snapshots` (JSON bruto + `fetched_at`), `insta_analyses` (score, dimensões, JSON completo, versão do prompt/rubrica), `insta_assets` (plano/bios/reels com status: rascunho/aprovado/publicado), ligadas a `crm_contacts`.
- Reaproveitar a Entrega: aprovar um post do plano pode virar item de checklist/tarefa.
- Histórico por cliente: score ao longo do tempo (o Instascore não mostra evolução; é a melhor feature que dá para ter).

### 5.3 Uso interno (estratégia da própria Krivo)

Mesmo pipeline apontado para o perfil da Krivo e para os concorrentes diretos, em rotina mensal, com o plano de 13 semanas alimentando a agenda de conteúdo interna.

### 5.4 Decisões que dependem de você

- Provedor de coleta pública (scraper pago vs. só Graph API) e orçamento por análise.
- Qual modelo para o julgamento (qualidade) e qual para os ativos em volume (custo).
- Se o relatório será mostrado ao cliente final (precisa de versão com marca Krivo) ou só interno.
- Aviso legal: o scraping de perfis públicos tem risco de termos de uso da Meta. Graph API com consentimento do cliente é o caminho seguro.

## 6. O que ficou pendente

- Não vi os prompts nem o modelo: a rubrica acima é reconstruída pelos resultados. Para calibrar, vale rodar 10–20 perfis conhecidos pelo Instascore e comparar as notas com as do Krivo.
- Só analisei um relatório (+ um concorrente embutido). A variação por vertical (`/dentista` etc.) não foi testada.
- Não abri as 13 semanas, os 30 Reels e as 10 bios linha a linha; a estrutura e uma amostra de cada foram conferidas.

---

## 7. Fluxo do @ até a análise (testado com @krivo.mkt em 24/11/2026)

Passo a passo [OBS]:

1. **Home** `/`: um campo `@seuperfil` + botão "Ver minha nota agora". Promessa: grátis, sem senha, sem cadastro, só perfis públicos, "resultado na hora". Contador social ("3.632 perfis já analisados", vindo de `GET /api/analysis-count`) e 3 perfis de exemplo.
2. **Envio do formulário**: abre `/analisando?u=krivo.mkt` (nova aba no meu teste). Eventos de ads disparam já aqui (`form_start`, `form_submit`).
3. **Tela de espera `/analisando`** — "Analisando seu perfil enquanto você responde, normalmente fica pronto em ~1 minuto." Enquanto isso, **quiz de 3 perguntas** de múltipla escolha, com "Pular e ver meu resultado":
   - Q1 objetivo: Vender mais / Agendar mais clientes / Crescer audiência / Ser referência no nicho → `quizAnswers.goal`
   - Q2 dor: Não sei o que postar / Posto e ninguém para pra ver / Seguidores não viram cliente / Perfil não passa profissionalismo / Não consigo manter o ritmo → `quizAnswers.pain`
   - Q3 peso na renda: renda principal / complementa / ainda não vende mas quer / é pessoal → `quizAnswers.stakes`
   O quiz serve para (a) esconder a espera, (b) segmentar o lead e (c) alimentar o prompt com objetivo e dor.
4. **Redirecionamento** para `/r/{id}` (id curto aleatório, ex.: `e3is7cklj5`). Ao carregar: `GET /api/analise/{id}`, `GET /api/avatar?url=…` (proxy da foto do perfil, porque a CDN do Instagram bloqueia hotlink), `GET /api/library-teaser`.
5. **Conversão registrada** ao chegar no relatório: evento `Lead` no Meta (`content_name: free_score`, `content_category: negocio`) e conversão no Google Ads. Ou seja, o "lead" é o score gerado, não um e-mail.

Observações do tempo: terminei o quiz em poucos segundos e a análise já estava pronta, então o processamento levou menos que o "~1 minuto" prometido. A criação do job aconteceu no envio do formulário da home; não capturei essa chamada (o POST sai na aba anterior ao redirecionamento), então o contrato exato de criação **não é observado**. [INF] A página `/r/{id}` consulta `/api/analise/{id}` e o campo `status` (`ready` no relatório concluído) deve ser consultado até ficar pronto.

### Free vs. pago

Relatório grátis do @krivo.mkt (nota 63/100, 114 seguidores, 24 posts):
- Visível: foto, nome, números, nota, resumo, raio-X vs. porte, e **apenas 1 dimensão com texto completo** (a mais forte: Bio & Identidade 15/20, rotulada "seu ponto mais desenvolvido"). As outras 4 mostram só a nota e um trecho cortado no meio da frase.
- Bloqueado: soluções prontas, recomendações, concorrentes, plano de 13 semanas, bios, Reels, mensagens. Botão de desbloqueio **R$ 8,90** (não cliquei).
- No relatório pago (Catronis, `paid: true`) o mesmo JSON traz tudo. O que muda entre teaser e pago está no próprio payload (`teaser` vs `full`).

Exemplo da qualidade do texto gerado para o Krivo (resumo grátis): citou "114 seguidores, 24 posts, bio de 120 caracteres", "2,4 posts por semana", "Reels rendem 46 curtidas de mediana contra 14 do carrossel" e avisou que a taxa de 14,91% é inflada pela base pequena (dois posts puxaram o número). Isso confirma: **métricas calculadas em código entram no prompt, e o LLM interpreta e ressalva**.

### O que isso muda no desenho do Krivo

- **Assíncrono com estado**: `queued → collecting → scoring → generating_assets → ready/failed`, com polling ou realtime do Supabase.
- **Gerar em fases**: nota + 1 dimensão primeiro (rápido), o resto depois; o relatório inteiro não precisa estar pronto para a primeira tela.
- **Contexto de entrada** (objetivo, dor, peso na renda) deve vir do CRM/briefing do cliente, sem precisar de quiz. Para análise interna, usar as metas da Krivo.
- **Proxy da foto de perfil** (hotlink do Instagram falha) — armazenar a imagem no Storage.
- **Tratar falha de coleta** por perfil (o Instascore devolveu `status: "failed"` em 2 concorrentes vazios).
- O paywall deles é um modelo de negócio; no Krivo o equivalente é permissão por papel (admin vê tudo, cliente vê o que for liberado).
