# Prompt para o Claude Code: aba "Entrega" (checklist de entrega + modelos) no painel KRIVO

> Cole tudo abaixo no Claude Code, com a pasta `Krivo Analytics` aberta. Os arquivos de modelo já estão em `modelos-entrega/` na raiz do projeto.

---

## 0. Antes de escrever código

1. Leia o código existente para seguir exatamente os mesmos padrões: `components/App.tsx` (abas e navegação), `components/tasks/*` e `components/crm/*` (telas, folhas laterais, cards), `components/opsui.tsx` e `components/ui.tsx` (componentes de interface), `lib/ops.ts` e `lib/api.ts` (tipos e chamadas), `lib/data.ts` (cache), `supabase/functions/ops-api/index.ts` (ações, permissões, validação, limite de requisições) e `supabase/migrations/20261118_catalog_items.sql` (padrão de tabela: RLS ativo, sem policies, só `service_role`).
2. Não invente um padrão novo. Reuse componentes, cores, tokens (`--accent`, `--card`, `--line` etc.), tema claro/escuro e o estilo bento da sidebar.
3. Entregue em etapas pequenas e me mostre o resumo ao final de cada uma. Não faça commit nem push. Não imprima nem copie chaves, tokens ou o conteúdo de `.env.local`.

## 1. Contexto

A KRIVO é um ecossistema de marketing e tecnologia, com um mês de operação, equipe enxuta (os sócios), atendendo só pessoas que já conhecemos. Hoje o painel tem Home, Tarefas, CRM, KRIVO, Métricas, Catálogo e Equipe. Falta o que acontece **depois que o contato vira "Fechado" no CRM**: a entrega ao cliente. Queremos uma aba nova, **Entrega**, que guie a equipe passo a passo do contrato assinado até o acompanhamento mensal, e que tenha uma seção **Modelos** para a equipe baixar os PDFs e o contrato direto da plataforma.

Produtos do Catálogo (já existem em `catalog_items`): KRIVO Diagnóstico (00), Social (01), Local (02), Site (03), Atende (04) e Metodologia KRIVO (05, pacote com todos). O contrato tem **fidelidade mínima de 3 meses**.

Este checklist é uma adaptação enxuta de um playbook de entrega de agência. Não replique o playbook inteiro: não há reunião formal de boas-vindas, CS dedicado, NPS formal nem escada de produtos nesta fase. Mantenha só o que uma equipe de sócios consegue cumprir.

## 2. O que construir

### 2.1 Aba "Entrega" (grupo "Operação", logo depois de CRM)

- Id da aba: `entrega`. Ícone no mesmo estilo dos outros (SVG de linha, 18px). Sub: "Checklist de entrega e modelos".
- Visível para todos os membros (admin e viewer). Escrita segue a mesma regra das Tarefas (quem pode marcar tarefa pode marcar item de checklist). Não crie permissão nova sem eu pedir.
- Duas visões dentro da aba, com seletor no topo: **Clientes em entrega** e **Modelos**.

**Visão "Clientes em entrega"**
- Lista de entregas (cards) com: nome do cliente, produtos contratados (chips), barra de progresso (itens feitos / total), fase atual, responsável, itens atrasados, dias até o fim da fidelidade mínima de 3 meses (a partir de `started_at`) e selo "sem interação há mais de 5 dias" quando aplicável.
- Filtros: ativo / pausado / concluído, e por responsável.
- Botão **Iniciar entrega**: escolhe um contato do CRM (de preferência já em "Fechado"), os produtos contratados (a partir do Catálogo) e o responsável. Ao criar, clona do modelo os itens das fases gerais mais os itens de cada produto escolhido. Se escolher "Metodologia KRIVO", aplica os itens de Diagnóstico, Local, Site, Social e Atende.
- No CRM (`ContactSheet`), quando o estágio for "Fechado", mostre o botão **Iniciar entrega** (ou **Ver entrega** se já existir). Não altere o fluxo atual de estágios além disso.
- Ao abrir uma entrega (folha lateral ou página, siga o padrão de `TaskSheet`/`ContactSheet`):
  - Cabeçalho: cliente, produtos, status, responsável, data de início, fim da fidelidade.
  - Checklist agrupado por **fase**, recolhível, com checkbox, título, descrição curta, responsável (opcional), prazo (opcional) e campo de nota por item. Marcar registra quem e quando.
  - Cada item pode apontar para um modelo (ex.: "Enviar PDF de boas-vindas" tem o botão **Baixar modelo**) e para uma mensagem pronta (botão **Copiar mensagem**).
  - Bloco **Contrato**: abre o **formulário do contrato** (seção 2.3), mostra o status (não iniciado, preenchido, gerado) e o botão **Gerar contrato (Word)**. Não crie campos de senha em lugar nenhum.
  - Linha do tempo de notas da entrega (reaproveite o padrão de `crm_interactions`, se fizer sentido).
  - Botão **Criar tarefa** em qualquer item, que cria uma tarefa em Tarefas ligada ao contato (`contact_id`).
- **Aviso fixo, visível**: "Nunca guarde senhas de clientes aqui nem em notas. Peça acesso por convite."

**Visão "Modelos"**
- Lista de documentos com título, descrição, tipo e data de atualização, e botão **Baixar**. Ver seção 5.
- Subseção **Mensagens prontas** (textos para copiar), ver seção 4.
- Subseção **Padrões**: título de evento no Google Agenda `[KRIVO][Nome do cliente][dd.mm.aa] Tipo de reunião` (ex.: `[KRIVO][Barbearia X][25.11.26] Alinhamento`) e regras de rotina (ver seção 3, fase 7).

### 2.2 Home (opcional, só depois do resto pronto)
Um cartão pequeno na Home: entregas ativas, itens atrasados, entregas sem interação há mais de 5 dias. Se complicar o layout atual, deixe para depois e me avise.

### 2.3 Gerador de contrato (formulário que preenche e baixa o contrato pronto)

Objetivo: a equipe preenche um formulário dentro da entrega e, no fim, baixa o contrato **já com todas as variáveis preenchidas**, sem editar o Word à mão.

**Arquivos prontos (na pasta `modelos-entrega/`)**
- `KRIVO_Contrato-template.docx`: o contrato com tags do **docxtemplater** (`{nome_contratante}`, blocos `{#social}...{/social}`, linha de tabela repetível `{#parcelas}...{/parcelas}`). Não edite o texto jurídico sem eu pedir.
- `KRIVO_Contrato-campos.json`: a especificação de todos os campos do formulário (grupo, chave, rótulo, tipo, valor padrão, obrigatório, ajuda). **Use esse arquivo como fonte do formulário** em vez de redigitar os campos.
- `KRIVO_Contrato-exemplo-preenchido.docx`: exemplo de como o resultado deve ficar.

**Formulário**
- Dentro da entrega, botão **Preencher contrato** abre um formulário em etapas ou seções, na ordem dos grupos do JSON: Contratante, Produtos, Pagamento, Vigência, Condições e um grupo por produto (só aparece se o produto estiver marcado).
- Pré-preencher a partir do contato do CRM (nome, telefone, e-mail) e da entrega (produtos, data de início). Salvar rascunho a cada alteração em `contract_data` da entrega, para dar para voltar depois.
- Campos de tipo `select`, `multiselect`, `bool`, `rows` (linhas repetíveis, para as parcelas), `date_ptbr`, `textarea` e `text`, conforme o JSON.
- Validações: CPF e CNPJ com dígito verificador (o tipo do documento define qual validar); e-mail; campos obrigatórios; pelo menos 1 produto; pelo menos 1 parcela. Se `tipo_pessoa` for pessoa jurídica, sugerir preencher o representante.
- Auxílios: o campo de valor das parcelas aceita número e o app monta o texto `R$ 1.500,00 (mil e quinhentos reais)` (valor por extenso em pt-BR; use uma biblioteca pequena e confiável ou uma função própria testada). A data de início vira `25 de novembro de 2026`.
- **Pré-visualização** em texto antes de gerar, com o resumo: contratante, produtos, valores, vigência, e aviso quando faltar algo.
- Botão **Gerar contrato (Word)** baixa `Contrato KRIVO - {nome do cliente} - {AAAA-MM-DD}.docx`. Cada geração fica registrada (quem, quando, dados usados) em `delivery_contracts`.

**Como gerar (servidor)**
1. A geração acontece **no servidor**, nunca no navegador, com a mesma autenticação e limites das demais ações. Pode ser na Edge Function `ops-api` (Deno com `npm:docxtemplater` e `npm:pizzip`) ou em uma rota do Next.js: escolha a que combinar melhor com onde o app roda hoje e me explique a escolha em duas linhas.
2. O template é lido do Supabase Storage (bucket privado `modelos-entrega`, slug `contrato-template-docx`). Admin pode substituir o template pela plataforma, como os outros modelos.
3. Opções do docxtemplater: `paragraphLoop: true`, `linebreaks: true` e `nullGetter` devolvendo texto vazio.
4. O app **calcula** estes campos a partir do formulário: `produtos_lista` (ex.: `KRIVO Social, KRIVO Local e KRIVO Site`) e as chaves booleanas `diagnostico`, `social`, `local`, `site`, `atende`, `metodologia`. Se `metodologia` estiver marcada, liga também Diagnóstico, Local, Site, Social e Atende. Texto vazio em `representante` e `outra_forma` faz a frase sumir do contrato.
5. Antes de gerar, o servidor valida os dados de novo, recusa chaves desconhecidas e **nunca aceita senha** (rejeite chaves como `senha` e `password`).
6. Depois de gerar, abra o arquivo e confira: nenhuma chave `{` ou `}` sobrando, e os blocos dos produtos não marcados ausentes. Se sobrar tag, devolva erro claro em vez do arquivo.

Trecho de referência (já testado com o template):

```js
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
const zip = new PizZip(templateBuffer);
const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
doc.render(dados); // dados = campos do formulário + produtos_lista + chaves de produto
const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
```

**Fora desta etapa:** gerar o contrato em PDF. O Word é o formato de envio por enquanto, e a assinatura eletrônica continua na plataforma que a KRIVO já usa. Se eu pedir PDF depois, avalie um conversor no servidor e me diga o custo.

## 3. Modelo de checklist (conteúdo inicial, em português do Brasil)

Itens marcados **[tag]** aplicam-se só ao produto indicado. Itens sem tag valem para toda entrega. Responsável sugerido entre parênteses (campo `owner_hint`, texto livre: "Sócio responsável", "Executor", "Financeiro"). Prazos sugeridos em dias a partir do início (`due_offset_days`), todos editáveis.

**Fase 1 · Fechamento e contrato** (dias 0 a 2)
1. Confirmar com o cliente os produtos, os valores (setup e mensal), a forma de pagamento e a fidelidade de 3 meses. Registrar no card. (Sócio responsável)
2. Pedir os dados do contrato: nome ou razão social, CPF/CNPJ, endereço com CEP, e-mail e WhatsApp, por canal combinado ou pela ficha do Guia de Acessos. [Modelo: Guia de acessos] (Sócio responsável)
3. Preencher o formulário do contrato na plataforma (partes, produtos, valores, datas) e gerar o Word. [Botão: Preencher contrato] [Modelo: Contrato modelo (Word)] (Sócio responsável)
4. Revisão cruzada: um segundo sócio confere valores, datas e escopo antes de enviar. (Outro sócio)
5. Confirmar nome e e-mail do cliente em voz alta ou por mensagem e enviar para assinatura eletrônica. (Sócio responsável)
6. Salvar o contrato assinado na pasta do cliente e anexar ao card. (Sócio responsável)
7. Registrar a primeira cobrança (Pix ou boleto) e agendar a nota fiscal. (Financeiro)

**Fase 2 · Ativação** (até 1 dia após a assinatura; meta, não obrigação contratual)
1. Criar o grupo de WhatsApp do cliente com o sócio responsável e o executor. (Sócio responsável)
2. Enviar a mensagem de abertura e o PDF de boas-vindas. [Modelo: Boas-vindas] [Mensagem 1]
3. Enviar o Guia de Acessos e combinar o prazo para o cliente liberar os acessos. [Modelo: Guia de acessos] [Mensagem 3]
4. Marcar a conversa de alinhamento e criar o convite no Google Agenda com o título padrão. [Mensagem 2]
5. Criar a pasta do cliente no Drive (contrato, materiais, relatórios).
6. Definir o executor de cada produto e criar as tarefas no módulo Tarefas.
7. Atualizar o status da entrega: "Ativo, aguardando acessos".

**Fase 3 · Acessos e materiais** (dias 1 a 7)
1. **[Social]** Convite do Meta Business aceito; conta profissional e ligada a uma Página; verificação em duas etapas conferida.
2. **[Social]** Recebidos: logotipo, fotos, 2 ou 3 perfis de referência, autorização de uso de imagem.
3. **[Local]** Convite de gerente do perfil no Google aceito (ou dados recebidos para criar o perfil).
4. **[Site]** Domínio definido: já existente (onde está e quem é o titular) ou a registrar em nome do cliente com os dados do titular.
5. **[Site]** Hospedagem na Cloudflare: opção A (cliente cria a conta e nos convida como administrador) ou B (nós criamos com o e-mail do cliente e ele define a senha pelo link). Registrar qual foi usada. Sem senha em texto.
6. **[Site]** Recebidos: logotipo, cores, fotos, serviços, horários, WhatsApp do botão. Acesso ao Google Analytics e ao Search Console, se existirem.
7. **[Atende]** Canal e número definidos; Meta Business por convite; perguntas frequentes, preços, horários e políticas recebidos; responsável pelas transferências definido; tom de voz alinhado.
8. **[Diagnóstico]** Acesso de leitura ao Instagram, ao perfil no Google e ao site.
9. Cobrar pendências de acesso após 3 dias úteis sem resposta (sugestão) e registrar na linha do tempo.
10. Marcar "Acessos completos" e atualizar o status para "Ativo".

**Fase 4 · Alinhamento** (dias 2 a 7)
1. Fazer a conversa de alinhamento: o que o negócio vende, para quem, diferenciais, tom de voz, concorrentes e referências, restrições (o que não pode aparecer) e o que o cliente espera dos primeiros 90 dias.
2. Registrar uma ata curta no card e a meta combinada, sem prometer resultado.
3. Enviar ao cliente o plano dos próximos 7 dias em até 1 dia depois da conversa. [Mensagem 4]
4. Combinar o canal e o jeito de aprovação (o cliente aprova no grupo) e o prazo de resposta da Cláusula 7ª do contrato (sugestão: 2 dias úteis).

**Fase 5 · Montagem (setup) por produto**
- **[Diagnóstico]** Auditar Instagram, Google, site (SEO básico) e atendimento; montar o relatório com nota por pilar e prioridades; fazer a devolutiva; indicar o produto recomendado e registrar a proposta no CRM.
- **[Social]** Otimizar o perfil (nome, bio, link, destaques); definir a linha visual e de conteúdo na identidade KRIVO e do cliente; aprovar o calendário do primeiro mês; aprovar as primeiras peças; publicar o primeiro post; configurar o relatório mensal.
- **[Local]** Auditar o perfil (categorias, serviços, descrição, horários, fotos, contatos); ajustar; checar nome, endereço e telefone nos diretórios; fazer a primeira publicação; orientar o cliente a pedir avaliações (inclusive com a placa NFC, se for o caso).
- **[Site]** Pesquisa de palavras-chave e estrutura de páginas; domínio e Cloudflare configurados; layout aprovado pelo cliente; textos; desenvolvimento e versão mobile; SEO técnico (títulos, descrições, velocidade, sitemap, dados estruturados); integrar Google Meu Negócio; **cadastrar a propriedade no GA4 da aba Métricas**; rodadas de revisão do cliente (número do contrato); publicar; entregar e orientar o cliente.
- **[Atende]** Levantar perguntas e fluxo; configurar o atendente de IA com o tom e as regras; regras de transferência para humano; testes internos; go-live; monitorar a primeira semana.

**Fase 6 · Primeiros 90 dias** (fidelidade mínima)
1. Check-in da primeira semana no grupo (o que já saiu, o que falta do cliente).
2. Relatório do mês 1 enviado (números reais, sem promessa) e checkpoint de 30 dias: o que funcionou, o que ajustar.
3. Pedir avaliação no Google e permissão para citar no portfólio, quando fizer sentido.
4. Pedir indicação de forma natural, sem tom de venda.
5. Checkpoint de 60 dias.
6. Conversa de renovação a cerca de 30 dias do fim da fidelidade (dia 60): resultados, continuidade e ajustes de escopo.
7. Fim do prazo mínimo (dia 90): confirmar a continuidade ou o aviso prévio e registrar.

**Fase 7 · Rotina contínua** (itens recorrentes; mostrar como "regras", não como checkbox)
- Responder o grupo do cliente no mesmo dia útil (sugestão a validar: definir o prazo).
- Cliente sem interação há mais de 5 dias: o sócio responsável chama no grupo (reativação).
- Insatisfação, dúvida que trava a entrega ou pedido de mudança de escopo: escalar para um sócio e registrar.
- Pedido fora do escopo vira proposta à parte (Cláusulas 3ª e 16ª do contrato).

**Fase 8 · Financeiro** (recorrente)
1. Conferir o recebimento da mensalidade no dia do vencimento.
2. Atraso: contato 2 dias depois, com tom de ajuda. Se persistir, seguir o contrato (cláusula 8.3, multa de 2% e juros de 1% ao mês) e chamar um sócio.
3. Emitir a nota fiscal do mês.

## 4. Mensagens prontas (seed; editáveis por admin)

Use `{{nome}}` e `{{sócio}}` como variáveis simples substituídas no botão Copiar.

1. **Abertura:** "Oi, {{nome}}! Seja muito bem-vindo(a) à KRIVO. Eu sou {{sócio}} e vou acompanhar o seu projeto de perto. Criei este grupo para a gente conversar por aqui. Vou te mandar agora um guia rápido de como vamos trabalhar. Qualquer dúvida, é só chamar."
2. **Agendar o alinhamento:** "{{nome}}, vamos marcar a nossa conversa de alinhamento? É ela que define por onde começamos. Pode ser amanhã às ___ ou ___? Te mando o convite com o link."
3. **Acessos:** "{{nome}}, para começar o seu {{produto}}, preciso de alguns acessos. O guia que enviei explica cada passo e é tudo por convite, sem você passar senha. Se preferir, a gente faz junto numa chamada rápida. Consegue liberar até {{data}}?"
4. **Plano de 7 dias:** "{{nome}}, obrigado pela conversa. Aqui vai o plano dos próximos 7 dias: {{itens}}. O que depende de você está marcado. Qualquer ajuste, me avise."
5. **Cobrar pendência de acesso:** "{{nome}}, passando para ver como estão os acessos. Faltam: {{lista}}. Se quiser, a gente faz junto agora, leva poucos minutos."

## 5. Modelos (arquivos para download na plataforma)

Arquivos prontos em `modelos-entrega/` (na raiz do projeto). Os dois últimos não aparecem na lista de download da equipe; o JSON pode ficar também dentro do código, como fonte do formulário.

| Slug | Arquivo | Para que serve | Quem baixa |
|---|---|---|---|
| `boas-vindas` | `KRIVO_Boas-vindas.pdf` | Guia de boas-vindas para enviar ao cliente na ativação | Equipe |
| `guia-acessos` | `KRIVO_Guia-de-acessos.pdf` | Passo a passo dos acessos por produto, com ficha de dados | Equipe |
| `contrato-modelo-pdf` | `KRIVO_Contrato-modelo.pdf` | Versão de leitura do contrato (19 cláusulas, estrutura do contrato do DevFest) com Anexo I por produto | Equipe |
| `contrato-modelo-docx` | `KRIVO_Contrato-modelo.docx` | Versão editável (campos em amarelo), para quem preferir preencher no Word | Equipe |
| `contrato-template-docx` | `KRIVO_Contrato-template.docx` | Template com tags usado pelo gerador de contrato (seção 2.3) | Só o sistema e admin |
| `contrato-campos-json` | `KRIVO_Contrato-campos.json` | Especificação dos campos do formulário do contrato | Só o sistema e admin |

Requisitos:
- Guardar no **Supabase Storage**, em um bucket **privado** `modelos-entrega`. Não coloque esses arquivos em `public/` (o contrato e o guia não devem ter link aberto).
- Tabela `delivery_docs` (id, slug único, title, description, kind, storage_path, file_name, mime, size_bytes, updated_by, updated_at) seguindo o padrão do Catálogo (RLS ativo, sem policies, só `service_role`).
- Ação `docs_list` (qualquer membro) e `doc_url` (qualquer membro; devolve URL assinada de curta duração, por exemplo 60 segundos, e o nome do arquivo). O navegador baixa pela URL assinada. Valide o slug no servidor.
- **Admin** pode **Substituir arquivo** (upload) e editar título e descrição. Valide tipo (PDF e DOCX) e tamanho máximo (sugestão 10 MB). Ao substituir, atualize `updated_at`.
- Faça o seed: crie as 6 linhas e envie os 6 arquivos para o bucket com um script único (`scripts/seed-modelos.mjs` ou usando o CLI do Supabase), lendo as credenciais do ambiente, sem imprimir segredos. Documente no README como rodar.

## 6. Banco de dados (migração nova, ex.: `supabase/migrations/20261119_delivery.sql`)

Siga o padrão do Catálogo: RLS ativo, `revoke all` de anon/authenticated, `grant` só para `service_role`, `created_by/updated_by`, `created_at/updated_at`, índices pelas colunas de filtro.

- `delivery_templates`: id, phase (int), phase_title, position, product_code (null = geral; valores '00' a '04'), title, description, owner_hint, due_offset_days (int, null), doc_slug (null), message_key (null), recurring (bool, para a fase 7 e 8 mostrar como regra ou recorrência).
- `deliveries`: id, contact_id (fk crm_contacts), title, product_codes text[], status ('ativa' | 'pausada' | 'concluida'), owner_id, started_at (date), min_term_months (int, default 3), contract_data jsonb (respostas do formulário do contrato, conforme `KRIVO_Contrato-campos.json`, **sem senhas**), last_interaction_at, notes, created_by, created_at, updated_at.
- `delivery_items`: id, delivery_id (fk, on delete cascade), template_id, phase, phase_title, position, title, description, done (bool), done_at, done_by, assignee_id, due_date, note, task_id (null), doc_slug, message_key.
- `delivery_notes`: id, delivery_id, body, created_by, created_at.
- `delivery_contracts`: id, delivery_id, data jsonb (cópia dos dados usados), file_name, generated_by, generated_at. Um registro por geração.
- `delivery_docs` (seção 5) e `delivery_messages` (key, title, body, position), com o seed das mensagens da seção 4.
- Seed de `delivery_templates` com o checklist da seção 3.

Observação: `delivery_items` é uma **cópia** do modelo no momento da criação, para mudar o modelo depois sem alterar entregas já em andamento.

## 7. API (`ops-api`)

Adicione as ações abaixo na mesma função, usando a mesma autenticação, limites e validação já existentes. Leituras em `READ`, escritas em `WRITE`:

- Leitura: `contract_fields` (devolve a especificação dos campos), `contract_history`, `deliveries_list`, `delivery_get` (entrega + itens + notas), `delivery_templates_list`, `docs_list`, `doc_url`, `messages_list`.
- Escrita: `contract_save` (rascunho do formulário), `contract_generate` (valida, gera o Word e devolve o arquivo ou URL assinada de curta duração), `delivery_create` (clona itens do modelo conforme produtos), `delivery_update` (status, responsável, contract_data, notas), `delivery_item_update` (done, assignee, due_date, note), `delivery_note_add`, `delivery_item_to_task` (cria a tarefa e grava `task_id`).
- Só admin: `delivery_template_update/create/delete`, `doc_replace` (upload), `doc_update`, `message_update`, `delivery_delete`.

Regras no servidor: validar todos os campos (tamanhos, enums, uuids), atualizar `last_interaction_at` quando houver item marcado ou nota, nunca aceitar campo de senha em `contract_data` (rejeite chaves como `senha`, `password`), e registrar `done_by`.

## 8. Front-end

- Tipos e rótulos em `lib/ops.ts` (ou `lib/delivery.ts` se ficar grande). Cache e chaves em `lib/data.ts`, como as demais abas.
- Componentes em `components/delivery/` (`DeliveryTab`, `DeliveryCard`, `DeliverySheet`, `ChecklistPhase`, `ContractDataBlock`, `ModelosView`). Mesmo estilo visual, responsivo, tema claro/escuro, foco e teclado acessíveis (veja como `App.tsx` trata teclas e `aria`).
- Estado de carregamento, vazio ("Nenhuma entrega ainda. Quando um contato fechar, inicie a entrega por aqui.") e erro em português do Brasil, com o tom da KRIVO: direto, claro, sem jargão.
- Textos de interface sem travessão em excesso e sem emojis.
- Download pelo botão **Baixar** chamando `doc_url` e abrindo a URL assinada.

## 9. Critérios de aceite

1. A aba Entrega aparece em Operação, abre rápido e funciona em celular e desktop, nos dois temas.
2. Do CRM, em um contato "Fechado", consigo iniciar uma entrega escolhendo os produtos, e o checklist nasce com as fases certas (itens gerais mais os dos produtos).
3. Marcar um item atualiza a barra de progresso e mostra quem e quando. Itens com prazo vencido aparecem como atrasados.
4. Consigo baixar os 4 modelos da equipe pela aba Modelos com usuário comum, e um link assinado não funciona depois de expirar.
5. Admin consegue substituir um modelo, editar uma mensagem e ajustar o modelo de checklist. Usuário comum não consegue.
6. Nenhuma senha é aceita ou armazenada. O aviso fixo aparece.
7. Preencho o formulário de um cliente de teste, gero o contrato e o Word baixado vem com todas as variáveis certas, sem nenhuma chave `{ }` sobrando. Testar pelo menos: (a) pessoa jurídica com representante, 3 produtos, 2 parcelas, parceria ligada e aprovação prévia; (b) pessoa física, Diagnóstico e Atende, 1 parcela, sem parceria e com aprovação prévia dispensada. Comparar com `KRIVO_Contrato-exemplo-preenchido.docx`.
8. `npm run build` passa sem erros de tipo. Nenhuma chave em log nem no código.
9. Entrega em etapas: (a) migração e seed, (b) ações na `ops-api`, (c) aba Entrega com checklist, (d) Modelos e mensagens, (e) gerador de contrato, (f) botão no CRM, (g) cartão na Home, se couber.

## 10. Fora de escopo (por enquanto)

Contrato em PDF gerado pelo sistema, assinatura eletrônica dentro da plataforma, integração com Google Agenda, NPS e cobrança automática.
