-- Entrega ao cliente: checklist (modelo + cópia por entrega), notas, contrato gerado, modelos para download e mensagens prontas.
-- Mesmo padrão de catalog_items/ops_tasks/crm_contacts: RLS ativo, sem policies, sem grants para anon/authenticated.
-- Só a Edge Function ops-api (service_role) lê e escreve. Nunca guardar senhas de clientes em nenhuma destas tabelas.

-- ---------- modelo do checklist ----------
create table if not exists public.delivery_templates (
  id              uuid primary key default gen_random_uuid(),
  phase           integer not null check (phase between 1 and 20),
  phase_title     text not null check (char_length(phase_title) between 2 and 80),
  position        integer not null default 0,
  product_code    text check (product_code is null or product_code in ('00', '01', '02', '03', '04')),
  title           text not null check (char_length(title) between 2 and 300),
  description     text check (description is null or char_length(description) <= 1000),
  owner_hint      text check (owner_hint is null or char_length(owner_hint) <= 40),
  due_offset_days integer check (due_offset_days is null or due_offset_days between 0 and 365),
  doc_slug        text,
  message_key     text,
  action          text check (action is null or action in ('contrato')),
  recurring       boolean not null default false,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists delivery_templates_phase_position_idx on public.delivery_templates (phase, position);

-- ---------- entregas ----------
create table if not exists public.deliveries (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid not null references public.crm_contacts (id) on delete restrict,
  title               text not null check (char_length(title) between 2 and 120),
  product_codes       text[] not null default '{}'::text[],
  status              text not null default 'ativa' check (status in ('ativa', 'pausada', 'concluida')),
  status_detail       text check (status_detail is null or char_length(status_detail) <= 80),
  owner_id            uuid,
  started_at          date not null default current_date,
  min_term_months     integer not null default 3 check (min_term_months between 1 and 60),
  contract_data       jsonb,
  last_interaction_at timestamptz not null default now(),
  notes               text check (notes is null or char_length(notes) <= 2000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint deliveries_products_ck check (product_codes <@ array['00', '01', '02', '03', '04', '05']::text[] and cardinality(product_codes) >= 1)
);
create index if not exists deliveries_status_idx on public.deliveries (status);
create index if not exists deliveries_owner_idx on public.deliveries (owner_id);
create index if not exists deliveries_contact_idx on public.deliveries (contact_id);

-- ---------- itens do checklist de cada entrega (cópia do modelo no momento da criação) ----------
create table if not exists public.delivery_items (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references public.deliveries (id) on delete cascade,
  template_id  uuid references public.delivery_templates (id) on delete set null,
  phase        integer not null,
  phase_title  text not null,
  position     integer not null default 0,
  product_code text,
  title        text not null,
  description  text,
  owner_hint   text,
  recurring    boolean not null default false,
  done         boolean not null default false,
  done_at      timestamptz,
  done_by      uuid,
  assignee_id  uuid,
  due_date     date,
  note         text check (note is null or char_length(note) <= 1000),
  task_id      uuid references public.ops_tasks (id) on delete set null,
  doc_slug     text,
  message_key  text,
  action       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists delivery_items_delivery_idx on public.delivery_items (delivery_id, phase, position);
create index if not exists delivery_items_open_due_idx on public.delivery_items (due_date) where done = false;
create index if not exists delivery_items_assignee_idx on public.delivery_items (assignee_id);

-- ---------- linha do tempo de notas ----------
create table if not exists public.delivery_notes (
  id          uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists delivery_notes_delivery_idx on public.delivery_notes (delivery_id, created_at desc);

-- ---------- contratos gerados (um registro por geração) ----------
create table if not exists public.delivery_contracts (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references public.deliveries (id) on delete cascade,
  data         jsonb not null,
  file_name    text not null,
  generated_by uuid,
  generated_at timestamptz not null default now()
);
create index if not exists delivery_contracts_delivery_idx on public.delivery_contracts (delivery_id, generated_at desc);

-- ---------- modelos para download (arquivos no bucket privado modelos-entrega) ----------
create table if not exists public.delivery_docs (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  title        text not null check (char_length(title) between 2 and 120),
  description  text check (description is null or char_length(description) <= 500),
  kind         text not null check (kind in ('pdf', 'docx', 'json')),
  audience     text not null default 'equipe' check (audience in ('equipe', 'admin')),
  position     integer not null default 0,
  storage_path text not null,
  file_name    text not null,
  mime         text not null,
  size_bytes   bigint,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- mensagens prontas ----------
create table if not exists public.delivery_messages (
  key        text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  title      text not null check (char_length(title) between 2 and 80),
  body       text not null check (char_length(body) between 2 and 2000),
  position   integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------- segurança: só service_role ----------
do $$
declare t text;
begin
  foreach t in array array['delivery_templates', 'deliveries', 'delivery_items', 'delivery_notes', 'delivery_contracts', 'delivery_docs', 'delivery_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ---------- bucket privado (sem policies: só service_role lê/escreve; download por URL assinada) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('modelos-entrega', 'modelos-entrega', false, 10485760,
        array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/json'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------- seed: modelos ----------
insert into public.delivery_docs (slug, title, description, kind, audience, position, storage_path, file_name, mime) values
('boas-vindas', 'Boas-vindas', 'Guia de boas-vindas para enviar ao cliente na ativação.', 'pdf', 'equipe', 0,
 'boas-vindas/KRIVO_Boas-vindas.pdf', 'KRIVO_Boas-vindas.pdf', 'application/pdf'),
('guia-acessos', 'Guia de acessos', 'Passo a passo dos acessos por produto, com ficha de dados do cliente.', 'pdf', 'equipe', 1,
 'guia-acessos/KRIVO_Guia-de-acessos.pdf', 'KRIVO_Guia-de-acessos.pdf', 'application/pdf'),
('contrato-modelo-pdf', 'Contrato modelo (PDF)', 'Versão de leitura do contrato, com 19 cláusulas e Anexo I por produto.', 'pdf', 'equipe', 2,
 'contrato-modelo-pdf/KRIVO_Contrato-modelo.pdf', 'KRIVO_Contrato-modelo.pdf', 'application/pdf'),
('contrato-modelo-docx', 'Contrato modelo (Word)', 'Versão editável, com os campos em amarelo, para quem preferir preencher no Word.', 'docx', 'equipe', 3,
 'contrato-modelo-docx/KRIVO_Contrato-modelo.docx', 'KRIVO_Contrato-modelo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
('contrato-template-docx', 'Template do gerador de contrato', 'Template com tags usado pelo gerador de contrato. Não altere as tags entre chaves.', 'docx', 'equipe', 4,
 'contrato-template-docx/KRIVO_Contrato-template.docx', 'KRIVO_Contrato-template.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
('contrato-campos-json', 'Campos do formulário do contrato', 'Especificação dos campos do formulário do contrato.', 'json', 'equipe', 5,
 'contrato-campos-json/KRIVO_Contrato-campos.json', 'KRIVO_Contrato-campos.json', 'application/json')
on conflict (slug) do nothing;

-- ---------- seed: mensagens prontas ----------
insert into public.delivery_messages (key, title, body, position) values
('abertura', 'Abertura',
 'Oi, {{nome}}! Seja muito bem-vindo(a) à KRIVO. Eu sou {{sócio}} e vou acompanhar o seu projeto de perto. Criei este grupo para a gente conversar por aqui. Vou te mandar agora um guia rápido de como vamos trabalhar. Qualquer dúvida, é só chamar.', 0),
('agendar_alinhamento', 'Agendar o alinhamento',
 '{{nome}}, vamos marcar a nossa conversa de alinhamento? É ela que define por onde começamos. Pode ser amanhã às ___ ou ___? Te mando o convite com o link.', 1),
('acessos', 'Acessos',
 '{{nome}}, para começar o seu {{produto}}, preciso de alguns acessos. O guia que enviei explica cada passo e é tudo por convite, sem você passar senha. Se preferir, a gente faz junto numa chamada rápida. Consegue liberar até {{data}}?', 2),
('plano_7_dias', 'Plano de 7 dias',
 '{{nome}}, obrigado pela conversa. Aqui vai o plano dos próximos 7 dias: {{itens}}. O que depende de você está marcado. Qualquer ajuste, me avise.', 3),
('cobrar_acessos', 'Cobrar pendência de acesso',
 '{{nome}}, passando para ver como estão os acessos. Faltam: {{lista}}. Se quiser, a gente faz junto agora, leva poucos minutos.', 4)
on conflict (key) do nothing;

-- ---------- seed: modelo do checklist ----------
-- product_code: null = geral; '00' Diagnóstico, '01' Social, '02' Local, '03' Site, '04' Atende.
-- Só semeia se a tabela estiver vazia (permite rodar a migração de novo sem duplicar).
insert into public.delivery_templates (phase, phase_title, position, product_code, title, description, owner_hint, due_offset_days, doc_slug, message_key, action, recurring)
select * from (values
-- Fase 1 · Fechamento e contrato
(1, 'Fechamento e contrato', 0, null::text, 'Confirmar produtos, valores e condições', 'Confirmar com o cliente os produtos, os valores (setup e mensal), a forma de pagamento e a fidelidade de 3 meses. Registrar no card.', 'Sócio responsável', 0, null::text, null::text, null::text, false),
(1, 'Fechamento e contrato', 1, null, 'Pedir os dados do contrato', 'Nome ou razão social, CPF/CNPJ, endereço com CEP, e-mail e WhatsApp, pelo canal combinado ou pela ficha do Guia de Acessos.', 'Sócio responsável', 1, 'guia-acessos', null, null, false),
(1, 'Fechamento e contrato', 2, null, 'Preencher o contrato e gerar o Word', 'Preencher o formulário do contrato na plataforma (partes, produtos, valores, datas) e gerar o Word.', 'Sócio responsável', 1, 'contrato-modelo-docx', null, 'contrato', false),
(1, 'Fechamento e contrato', 3, null, 'Revisão cruzada do contrato', 'Um segundo sócio confere valores, datas e escopo antes de enviar.', 'Outro sócio', 2, null, null, null, false),
(1, 'Fechamento e contrato', 4, null, 'Enviar para assinatura eletrônica', 'Confirmar nome e e-mail do cliente em voz alta ou por mensagem e enviar para assinatura eletrônica.', 'Sócio responsável', 2, null, null, null, false),
(1, 'Fechamento e contrato', 5, null, 'Salvar o contrato assinado', 'Salvar o contrato assinado na pasta do cliente e anexar ao card.', 'Sócio responsável', null, null, null, null, false),
(1, 'Fechamento e contrato', 6, null, 'Registrar a primeira cobrança', 'Registrar a primeira cobrança (Pix ou boleto) e agendar a nota fiscal.', 'Financeiro', 2, null, null, null, false),
-- Fase 2 · Ativação
(2, 'Ativação', 0, null, 'Criar o grupo de WhatsApp do cliente', 'Com o sócio responsável e o executor. Meta: até 1 dia após a assinatura.', 'Sócio responsável', 1, null, null, null, false),
(2, 'Ativação', 1, null, 'Enviar a mensagem de abertura e o PDF de boas-vindas', null, 'Sócio responsável', 1, 'boas-vindas', 'abertura', null, false),
(2, 'Ativação', 2, null, 'Enviar o Guia de Acessos', 'Combinar o prazo para o cliente liberar os acessos.', 'Sócio responsável', 1, 'guia-acessos', 'acessos', null, false),
(2, 'Ativação', 3, null, 'Marcar a conversa de alinhamento', 'Criar o convite no Google Agenda com o título padrão: [KRIVO][Nome do cliente][dd.mm.aa] Alinhamento.', 'Sócio responsável', 1, null, 'agendar_alinhamento', null, false),
(2, 'Ativação', 4, null, 'Criar a pasta do cliente no Drive', 'Pastas: contrato, materiais, relatórios.', 'Sócio responsável', 1, null, null, null, false),
(2, 'Ativação', 5, null, 'Definir executores e criar as tarefas', 'Definir o executor de cada produto e criar as tarefas no módulo Tarefas.', 'Sócio responsável', 1, null, null, null, false),
(2, 'Ativação', 6, null, 'Atualizar o status: aguardando acessos', 'Status da entrega: "Ativo, aguardando acessos".', 'Sócio responsável', 1, null, null, null, false),
-- Fase 3 · Acessos e materiais
(3, 'Acessos e materiais', 0, '01', 'Meta Business: convite aceito', 'Conta profissional e ligada a uma Página; verificação em duas etapas conferida.', 'Executor', 7, null, null, null, false),
(3, 'Acessos e materiais', 1, '01', 'Materiais do Social recebidos', 'Logotipo, fotos, 2 ou 3 perfis de referência, autorização de uso de imagem.', 'Executor', 7, null, null, null, false),
(3, 'Acessos e materiais', 2, '02', 'Perfil no Google: convite de gerente aceito', 'Ou dados recebidos para criar o perfil.', 'Executor', 7, null, null, null, false),
(3, 'Acessos e materiais', 3, '03', 'Domínio definido', 'Já existente (onde está e quem é o titular) ou a registrar em nome do cliente com os dados do titular.', 'Executor', 7, null, null, null, false),
(3, 'Acessos e materiais', 4, '03', 'Hospedagem na Cloudflare', 'Opção A: cliente cria a conta e nos convida como administrador. Opção B: nós criamos com o e-mail do cliente e ele define a senha pelo link. Registrar qual foi usada. Sem senha em texto.', 'Executor', 7, null, null, null, false),
(3, 'Acessos e materiais', 5, '03', 'Materiais do Site recebidos', 'Logotipo, cores, fotos, serviços, horários, WhatsApp do botão. Acesso ao Google Analytics e ao Search Console, se existirem.', 'Executor', 7, null, null, null, false),
(3, 'Acessos e materiais', 6, '04', 'Atende: canal, acessos e informações', 'Canal e número definidos; Meta Business por convite; perguntas frequentes, preços, horários e políticas recebidos; responsável pelas transferências definido; tom de voz alinhado.', 'Executor', 7, null, null, null, false),
(3, 'Acessos e materiais', 7, '00', 'Diagnóstico: acessos de leitura', 'Acesso de leitura ao Instagram, ao perfil no Google e ao site.', 'Executor', 3, null, null, null, false),
(3, 'Acessos e materiais', 8, null, 'Cobrar pendências de acesso', 'Após 3 dias úteis sem resposta (sugestão). Registrar na linha do tempo.', 'Sócio responsável', 4, null, 'cobrar_acessos', null, false),
(3, 'Acessos e materiais', 9, null, 'Acessos completos', 'Marcar "Acessos completos" e atualizar o status para "Ativo".', 'Sócio responsável', 7, null, null, null, false),
-- Fase 4 · Alinhamento
(4, 'Alinhamento', 0, null, 'Fazer a conversa de alinhamento', 'O que o negócio vende, para quem, diferenciais, tom de voz, concorrentes e referências, restrições (o que não pode aparecer) e o que o cliente espera dos primeiros 90 dias.', 'Sócio responsável', 5, null, null, null, false),
(4, 'Alinhamento', 1, null, 'Registrar a ata e a meta combinada', 'Ata curta no card e a meta combinada, sem prometer resultado.', 'Sócio responsável', 5, null, null, null, false),
(4, 'Alinhamento', 2, null, 'Enviar o plano dos próximos 7 dias', 'Em até 1 dia depois da conversa.', 'Sócio responsável', 6, null, 'plano_7_dias', null, false),
(4, 'Alinhamento', 3, null, 'Combinar o jeito de aprovação', 'O cliente aprova no grupo. Prazo de resposta da Cláusula 7ª do contrato (sugestão: 2 dias úteis).', 'Sócio responsável', 5, null, null, null, false),
-- Fase 5 · Montagem (setup) por produto
(5, 'Montagem por produto', 0, '00', 'Auditar Instagram, Google, site e atendimento', 'Inclui SEO básico do site.', 'Executor', 7, null, null, null, false),
(5, 'Montagem por produto', 1, '00', 'Montar o relatório do diagnóstico', 'Nota por pilar e prioridades.', 'Executor', 10, null, null, null, false),
(5, 'Montagem por produto', 2, '00', 'Fazer a devolutiva e registrar a proposta', 'Indicar o produto recomendado e registrar a proposta no CRM.', 'Sócio responsável', 12, null, null, null, false),
(5, 'Montagem por produto', 10, '01', 'Otimizar o perfil do Instagram', 'Nome, bio, link, destaques.', 'Executor', 10, null, null, null, false),
(5, 'Montagem por produto', 11, '01', 'Definir a linha visual e de conteúdo', 'Na identidade KRIVO e do cliente.', 'Executor', 10, null, null, null, false),
(5, 'Montagem por produto', 12, '01', 'Aprovar o calendário do primeiro mês', null, 'Executor', 12, null, null, null, false),
(5, 'Montagem por produto', 13, '01', 'Aprovar as primeiras peças', null, 'Executor', 14, null, null, null, false),
(5, 'Montagem por produto', 14, '01', 'Publicar o primeiro post', null, 'Executor', 15, null, null, null, false),
(5, 'Montagem por produto', 15, '01', 'Configurar o relatório mensal do Social', null, 'Executor', 15, null, null, null, false),
(5, 'Montagem por produto', 20, '02', 'Auditar o perfil no Google', 'Categorias, serviços, descrição, horários, fotos, contatos.', 'Executor', 8, null, null, null, false),
(5, 'Montagem por produto', 21, '02', 'Ajustar o perfil no Google', null, 'Executor', 10, null, null, null, false),
(5, 'Montagem por produto', 22, '02', 'Checar nome, endereço e telefone nos diretórios', null, 'Executor', 12, null, null, null, false),
(5, 'Montagem por produto', 23, '02', 'Fazer a primeira publicação no perfil', null, 'Executor', 12, null, null, null, false),
(5, 'Montagem por produto', 24, '02', 'Orientar o cliente a pedir avaliações', 'Inclusive com a placa NFC, se for o caso.', 'Sócio responsável', 14, null, null, null, false),
(5, 'Montagem por produto', 30, '03', 'Pesquisa de palavras-chave e estrutura de páginas', null, 'Executor', 10, null, null, null, false),
(5, 'Montagem por produto', 31, '03', 'Domínio e Cloudflare configurados', null, 'Executor', 10, null, null, null, false),
(5, 'Montagem por produto', 32, '03', 'Layout aprovado pelo cliente', null, 'Executor', 17, null, null, null, false),
(5, 'Montagem por produto', 33, '03', 'Textos do site', null, 'Executor', 21, null, null, null, false),
(5, 'Montagem por produto', 34, '03', 'Desenvolvimento e versão mobile', null, 'Executor', 30, null, null, null, false),
(5, 'Montagem por produto', 35, '03', 'SEO técnico', 'Títulos, descrições, velocidade, sitemap, dados estruturados.', 'Executor', 32, null, null, null, false),
(5, 'Montagem por produto', 36, '03', 'Integrar Google Meu Negócio', null, 'Executor', 32, null, null, null, false),
(5, 'Montagem por produto', 37, '03', 'Cadastrar a propriedade no GA4 da aba Métricas', null, 'Executor', 32, null, null, null, false),
(5, 'Montagem por produto', 38, '03', 'Rodadas de revisão do cliente', 'Número de rodadas definido no contrato.', 'Executor', 37, null, null, null, false),
(5, 'Montagem por produto', 39, '03', 'Publicar o site', null, 'Executor', 40, null, null, null, false),
(5, 'Montagem por produto', 40, '03', 'Entregar e orientar o cliente', null, 'Sócio responsável', 42, null, null, null, false),
(5, 'Montagem por produto', 50, '04', 'Levantar perguntas e fluxo de atendimento', null, 'Executor', 10, null, null, null, false),
(5, 'Montagem por produto', 51, '04', 'Configurar o atendente de IA', 'Com o tom e as regras do negócio.', 'Executor', 14, null, null, null, false),
(5, 'Montagem por produto', 52, '04', 'Regras de transferência para humano', null, 'Executor', 14, null, null, null, false),
(5, 'Montagem por produto', 53, '04', 'Testes internos', null, 'Executor', 18, null, null, null, false),
(5, 'Montagem por produto', 54, '04', 'Go-live do atendente', null, 'Executor', 21, null, null, null, false),
(5, 'Montagem por produto', 55, '04', 'Monitorar a primeira semana', null, 'Executor', 28, null, null, null, false),
-- Fase 6 · Primeiros 90 dias
(6, 'Primeiros 90 dias', 0, null, 'Check-in da primeira semana', 'No grupo: o que já saiu, o que falta do cliente.', 'Sócio responsável', 7, null, null, null, false),
(6, 'Primeiros 90 dias', 1, null, 'Relatório do mês 1 e checkpoint de 30 dias', 'Números reais, sem promessa. O que funcionou, o que ajustar.', 'Sócio responsável', 30, null, null, null, false),
(6, 'Primeiros 90 dias', 2, null, 'Pedir avaliação no Google e permissão para o portfólio', 'Quando fizer sentido.', 'Sócio responsável', 35, null, null, null, false),
(6, 'Primeiros 90 dias', 3, null, 'Pedir indicação', 'De forma natural, sem tom de venda.', 'Sócio responsável', 45, null, null, null, false),
(6, 'Primeiros 90 dias', 4, null, 'Checkpoint de 60 dias', null, 'Sócio responsável', 60, null, null, null, false),
(6, 'Primeiros 90 dias', 5, null, 'Conversa de renovação', 'Cerca de 30 dias antes do fim da fidelidade: resultados, continuidade e ajustes de escopo.', 'Sócio responsável', 60, null, null, null, false),
(6, 'Primeiros 90 dias', 6, null, 'Fim do prazo mínimo', 'Confirmar a continuidade ou o aviso prévio e registrar.', 'Sócio responsável', 90, null, null, null, false),
-- Fase 7 · Rotina contínua (regras)
(7, 'Rotina contínua', 0, null, 'Responder o grupo do cliente no mesmo dia útil', 'Sugestão a validar: definir o prazo.', null, null, null, null, null, true),
(7, 'Rotina contínua', 1, null, 'Cliente sem interação há mais de 5 dias', 'O sócio responsável chama no grupo (reativação).', 'Sócio responsável', null, null, null, null, true),
(7, 'Rotina contínua', 2, null, 'Escalar insatisfação, bloqueio ou mudança de escopo', 'Insatisfação, dúvida que trava a entrega ou pedido de mudança de escopo: escalar para um sócio e registrar.', null, null, null, null, null, true),
(7, 'Rotina contínua', 3, null, 'Pedido fora do escopo vira proposta à parte', 'Cláusulas 3ª e 16ª do contrato.', null, null, null, null, null, true),
-- Fase 8 · Financeiro (recorrente)
(8, 'Financeiro', 0, null, 'Conferir o recebimento da mensalidade', 'No dia do vencimento.', 'Financeiro', null, null, null, null, true),
(8, 'Financeiro', 1, null, 'Atraso de pagamento', 'Contato 2 dias depois, com tom de ajuda. Se persistir, seguir o contrato (cláusula 8.3, multa de 2% e juros de 1% ao mês) e chamar um sócio.', 'Financeiro', null, null, null, null, true),
(8, 'Financeiro', 2, null, 'Emitir a nota fiscal do mês', null, 'Financeiro', null, null, null, null, true)
) as v(phase, phase_title, position, product_code, title, description, owner_hint, due_offset_days, doc_slug, message_key, action, recurring)
where not exists (select 1 from public.delivery_templates);
