-- Catálogo de produtos da KRIVO (produtos + regras comuns), editável pela plataforma.
-- Mesmo padrão de ops_tasks/crm_contacts: RLS ativo, sem policies, sem grants para anon/authenticated.
-- Só a Edge Function ops-api (service_role) lê e escreve, e só para administradores.
create table if not exists public.catalog_items (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'product' check (kind in ('product', 'rule')),
  position      integer not null default 0,
  code          text,
  name          text not null check (char_length(name) between 2 and 80),
  tagline       text,
  billing       text,
  summary       text,
  price_upfront numeric(12,2) check (price_upfront is null or price_upfront >= 0),
  upfront_label text,
  price_monthly numeric(12,2) check (price_monthly is null or price_monthly >= 0),
  has_monthly   boolean not null default true,
  details       jsonb not null default '[]'::jsonb,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists catalog_items_kind_position_idx on public.catalog_items (kind, position);

alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from anon, authenticated;
grant select, insert, update, delete on public.catalog_items to service_role;

-- Conteúdo inicial: catálogo de produtos (rascunho, novembro de 2026). Preços ainda não definidos (null).
insert into public.catalog_items (kind, position, code, name, tagline, billing, summary, upfront_label, has_monthly, details) values
('product', 0, '00', 'KRIVO Diagnóstico', 'Porta de entrada', 'Pontual',
 'O Diagnóstico mostra ao cliente o que está faltando no digital dele e indica qual produto resolve. É pago e pontual, para filtrar curiosos e já gerar caixa.',
 'Pontual', false,
 $j$[
  {"label":"Para quem","text":"Negócio que sabe que o digital está fraco, mas não sabe por onde começar."},
  {"label":"O que entrega","text":"Auditoria de Instagram, Google Meu Negócio, site (incluindo SEO básico) e atendimento ao cliente; relatório com nota por pilar, principais problemas e prioridades; reunião de devolutiva; recomendação de qual produto contratar."},
  {"label":"Fora do escopo","text":"Execução de qualquer correção. O diagnóstico aponta, os outros produtos executam."},
  {"label":"Prazo de entrega","text":"A definir (sugestão: poucos dias úteis após receber os acessos)."},
  {"label":"Cobrança","text":"Pontual. Ideia a avaliar: abater o valor se o cliente contratar um produto em até 30 dias."},
  {"label":"Pré-requisito do cliente","text":"Acesso de leitura ao Instagram, ao Google Meu Negócio e ao site."}
 ]$j$::jsonb),

('product', 1, '01', 'KRIVO Social', 'Pilar: Instagram, posts e vídeo', 'Mensal',
 'O KRIVO Social cuida do Instagram do cliente de ponta a ponta, com calendário fixo e uma identidade que o público reconhece. Os números são sugestão de partida, a ajustar pela capacidade do time.',
 null, true,
 $j$[
  {"label":"Para quem","text":"Negócio com perfil parado, sem padrão visual ou sem constância."},
  {"label":"O que entrega por mês","text":"Planejamento de conteúdo; 12 posts de feed (imagem ou carrossel) com arte e legenda; 4 Reels com roteiro e edição; hashtags por post; relatório mensal de alcance, saves, compartilhamentos e seguidores."},
  {"label":"Na entrada (uma vez)","text":"Otimização do perfil (nome, bio, link, destaques) e definição da linha visual e de conteúdo."},
  {"label":"Fora do escopo","text":"Captação presencial de vídeo e foto (o cliente envia o material bruto), tráfego pago, atendimento de mensagens e comentários."},
  {"label":"Aprovação","text":"O cliente aprova o calendário e cada peça antes de publicar. Prazo de resposta: a definir; sem resposta, a peça não entra no mês."},
  {"label":"Cobrança","text":"Mensal, com contrato mínimo."}
 ]$j$::jsonb),

('product', 2, '02', 'KRIVO Local', 'Pilar: Google Meu Negócio', 'Setup + mensal',
 'O KRIVO Local deixa o perfil do cliente no Google completo, atualizado e pronto para ser encontrado por quem busca perto dele. Funciona sozinho ou junto com o KRIVO Site.',
 'Setup', true,
 $j$[
  {"label":"Para quem","text":"Negócio com endereço ou área de atendimento definida, que depende de busca local para vender."},
  {"label":"No setup (uma vez)","text":"Criação ou recuperação do perfil; auditoria e ajuste de categorias, serviços, descrição, horários, fotos e contatos; checagem de consistência de nome, endereço e telefone nos principais diretórios."},
  {"label":"Por mês","text":"Publicações no perfil; atualização de informações e fotos; resposta às avaliações; orientação ao cliente para pedir avaliações; relatório de visualizações, cliques, ligações e pedidos de rota."},
  {"label":"Fora do escopo","text":"Anúncios no Google, produção de site (ver KRIVO Site), fotografia profissional."},
  {"label":"Pré-requisito do cliente","text":"Acesso de gerenciamento ao perfil ou dados para criá-lo, e verificação do local quando o Google exigir."},
  {"label":"Cobrança","text":"Setup único + mensalidade, com contrato mínimo."}
 ]$j$::jsonb),

('product', 3, '03', 'KRIVO Site', 'Pilar: site com SEO', 'Projeto + mensalidade',
 'O KRIVO Site entrega um site rápido, claro e construído para ser achado no Google, já alinhado ao perfil do Google Meu Negócio. O desenvolvimento é projeto; a manutenção e o SEO viram a parte recorrente.',
 'Projeto', true,
 $j$[
  {"label":"Para quem","text":"Negócio sem site, ou com site antigo, lento ou que não aparece nas buscas."},
  {"label":"No projeto (uma vez)","text":"Estrutura de páginas definida por pesquisa de palavras-chave (número de páginas: a definir por faixa); design na identidade do cliente; versão mobile; textos orientados a busca; SEO técnico básico (títulos, descrições, velocidade, sitemap, dados estruturados); botão de contato e WhatsApp; integração com Google Meu Negócio e Google Analytics."},
  {"label":"Por mês","text":"Hospedagem e atualizações; ajustes de conteúdo; monitoramento de posições e tráfego; relatório mensal. Textos novos por mês: a definir."},
  {"label":"Fora do escopo","text":"Loja virtual completa, sistemas sob medida, anúncios, redesenho total fora das revisões combinadas."},
  {"label":"Revisões","text":"Número de rodadas de ajuste no projeto: a definir. Rodadas extras são cobradas à parte."},
  {"label":"Cobrança","text":"Projeto (parte na assinatura, parte na entrega) + mensalidade de manutenção e SEO."},
  {"label":"Atenção ao prometer","text":"SEO leva tempo e não se garante posição. O contrato fala em entregas e acompanhamento, não em colocação no Google."}
 ]$j$::jsonb),

('product', 4, '04', 'KRIVO Atende', 'Pilar: atendimento com IA', 'Setup + mensal',
 'O KRIVO Atende responde o cliente do negócio na hora, inclusive fora do horário comercial, e passa para uma pessoa quando precisa. Mostra que a KRIVO vai além do marketing: a tecnologia ajuda a não perder venda por demora no atendimento.',
 'Setup', true,
 $j$[
  {"label":"Para quem","text":"Negócio que recebe muitas mensagens repetidas (preço, horário, endereço, agendamento) ou perde contatos por não responder rápido."},
  {"label":"No setup (uma vez)","text":"Levantamento das perguntas mais comuns e do fluxo de atendimento; configuração do atendente de IA com o tom e as regras do negócio; conexão com o canal principal (a definir, por exemplo WhatsApp ou Instagram); regras de transferência para atendimento humano; testes antes de entrar no ar."},
  {"label":"Por mês","text":"Monitoramento das conversas; ajustes de respostas e de fluxo; relatório de atendimentos, contatos qualificados e pontos de melhoria."},
  {"label":"Fora do escopo","text":"Integrações com sistemas de gestão sob medida, vários canais no plano base, custos de plataforma e de mensagens (repassados ao cliente, valor a definir)."},
  {"label":"Pré-requisito do cliente","text":"Informações do negócio (serviços, preços, políticas) e alguém que receba os atendimentos transferidos."},
  {"label":"Cobrança","text":"Setup único + mensalidade, com contrato mínimo."},
  {"label":"Atenção ao prometer","text":"Não prometer aumento de vendas em números. O produto promete atendimento rápido e organizado."}
 ]$j$::jsonb),

('product', 5, '05', 'Metodologia KRIVO', 'Todos os pilares juntos', 'Setup + mensal',
 'A Metodologia KRIVO é o produto completo: estrutura o digital do negócio inteiro em uma sequência única, em vez de o cliente contratar peças soltas. Nome provisório.',
 'Setup', true,
 $j$[
  {"label":"Para quem","text":"Negócio desestruturado no digital, que precisa de presença completa e quer um único parceiro."},
  {"label":"O que inclui","text":"Diagnóstico no início, KRIVO Local, KRIVO Site, KRIVO Social e KRIVO Atende."},
  {"label":"Como roda","text":"Em fases. Primeiro o diagnóstico e a base (Google Meu Negócio e site), depois a presença social e o atendimento com IA. Duração de cada fase: a definir."},
  {"label":"Vantagem para o cliente","text":"Um único contrato, uma única reunião mensal de resultados, preço menor do que a soma dos avulsos e peças pensadas para funcionar juntas: o site e o Google se reforçam, o Instagram leva para ambos, o atendimento responde quem chega."},
  {"label":"Cobrança","text":"Setup + mensalidade, com contrato mínimo maior que o dos avulsos. Desconto sobre a soma dos pilares."},
  {"label":"Versão enxuta (a avaliar)","text":"Uma segunda versão com três pilares, para negócios que ainda não comportam o pacote inteiro."}
 ]$j$::jsonb);

insert into public.catalog_items (kind, position, name, summary, has_monthly) values
('rule', 0, 'Contrato mínimo', 'Sugestão de 3 a 6 meses para os produtos mensais, porque nenhum desses pilares mostra resultado em 30 dias.', false),
('rule', 1, 'Escopo escrito', 'Cada produto tem uma lista do que entra e do que não entra. Pedido fora da lista vira proposta à parte.', false),
('rule', 2, 'Sem promessa de resultado', 'O contrato fala em entregas e acompanhamento, nunca em número de vendas, seguidores ou posição no Google.', false),
('rule', 3, 'Poucas versões', 'Uma por produto no começo. Mais de uma só quando houver demanda real.', false),
('rule', 4, 'Lançamento em etapas', 'Vender primeiro o Diagnóstico e os produtos que o time já sabe entregar bem; os outros entram conforme aparecer cliente.', false);
