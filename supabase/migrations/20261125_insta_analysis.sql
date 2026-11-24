-- Análise de Instagram com IA (perfis de clientes e da própria KRIVO).
-- Mesmo padrão das demais tabelas: RLS ativo, sem policies, sem grants para anon/authenticated.
-- Só a Edge Function ops-api (service_role) lê e escreve.

-- Perfil acompanhado: um por @. Pode estar ligado a um cliente do CRM (contact_id) ou ser da própria KRIVO (is_internal).
create table if not exists public.insta_profiles (
  id          uuid primary key default gen_random_uuid(),
  username    text not null check (username ~ '^[a-z0-9._]{1,30}$'),
  contact_id  uuid references public.crm_contacts (id) on delete set null,
  is_internal boolean not null default false,
  competitors text[] not null default '{}' check (cardinality(competitors) <= 5),
  goal        text check (goal is null or char_length(goal) <= 200),   -- objetivo (vender, agendar, crescer...)
  pain        text check (pain is null or char_length(pain) <= 200),   -- maior dor do cliente hoje
  notes       text check (notes is null or char_length(notes) <= 1000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists insta_profiles_username_idx on public.insta_profiles (username);
create index if not exists insta_profiles_contact_idx on public.insta_profiles (contact_id) where contact_id is not null;

-- Foto do perfil e dados brutos coletados num momento (guarda o JSON exatamente como veio, para poder reanalisar sem coletar de novo).
create table if not exists public.insta_snapshots (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.insta_profiles (id) on delete cascade,
  source      text not null check (source in ('apify', 'manual', 'meta')),
  raw         jsonb not null,
  fetched_at  timestamptz not null default now(),
  created_by  uuid
);
create index if not exists insta_snapshots_profile_idx on public.insta_snapshots (profile_id, fetched_at desc);

-- Uma análise = nota + diagnóstico gerado a partir de um snapshot. Guarda a versão da rubrica e o modelo para poder comparar no tempo.
create table if not exists public.insta_analyses (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.insta_profiles (id) on delete cascade,
  snapshot_id    uuid references public.insta_snapshots (id) on delete set null,
  status         text not null default 'queued' check (status in ('queued', 'collecting', 'scoring', 'generating', 'ready', 'failed')),
  total_score    smallint check (total_score between 0 and 100),
  dimensions     jsonb,   -- {bio:{score,feedback,positives,improvements}, consistencia:..., engajamento:..., conteudo:..., conversao:...}
  metrics        jsonb,   -- saída de lib/insta/metrics.ts
  result         jsonb,   -- resumo, recomendações, soluções prontas
  rubric_version text not null default 'v1',
  model          text,
  error          text check (error is null or char_length(error) <= 500),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists insta_analyses_profile_idx on public.insta_analyses (profile_id, created_at desc);

-- Materiais gerados que a equipe aprova e acompanha: plano de 13 semanas, bios, Reels, mensagens de venda.
create table if not exists public.insta_assets (
  id          uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.insta_analyses (id) on delete cascade,
  kind        text not null check (kind in ('plan_post', 'bio', 'reel', 'sales_message')),
  position    integer not null default 0,
  payload     jsonb not null,
  status      text not null default 'draft' check (status in ('draft', 'approved', 'published', 'discarded')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists insta_assets_analysis_idx on public.insta_assets (analysis_id, kind, position);

alter table public.insta_profiles  enable row level security;
alter table public.insta_snapshots enable row level security;
alter table public.insta_analyses  enable row level security;
alter table public.insta_assets    enable row level security;
revoke all on public.insta_profiles, public.insta_snapshots, public.insta_analyses, public.insta_assets from anon, authenticated;
grant select, insert, update, delete on public.insta_profiles, public.insta_snapshots, public.insta_analyses, public.insta_assets to service_role;
