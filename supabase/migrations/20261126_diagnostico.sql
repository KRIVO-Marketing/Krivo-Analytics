-- KRIVO Diagnóstico: um relatório padronizado por cliente, juntando os pilares (Instagram e Google Meu Negócio).
-- Mesmo padrão das demais tabelas: RLS ativo, sem policies, sem grants para anon/authenticated. Só a Edge Function diag-api (service_role) lê e escreve.
create table if not exists public.diag_reports (
  id                 uuid primary key default gen_random_uuid(),
  business_name      text not null check (char_length(business_name) between 2 and 120),
  contact_id         uuid references public.crm_contacts (id) on delete set null,
  instagram_username text check (instagram_username is null or instagram_username ~ '^[a-z0-9._]{1,30}$'),
  google_input       text check (google_input is null or char_length(google_input) <= 500),   -- link do Google Maps ou "nome + cidade"
  status             text not null default 'draft' check (status in ('draft', 'ready')),
  insta_analysis_id  uuid references public.insta_analyses (id) on delete set null,
  google             jsonb,   -- {place (dados brutos coletados), metrics (calculadas em código), total_score, dimensions, result}
  report             jsonb,   -- síntese: resumo, principais problemas, prioridades, produto recomendado
  overall_score      smallint check (overall_score between 0 and 100),
  pillar_scores      jsonb,   -- {instagram: 0-100, google: 0-100}
  rubric_version     text not null default 'v1',
  model              text,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create index if not exists diag_reports_created_idx on public.diag_reports (created_at desc);
create index if not exists diag_reports_contact_idx on public.diag_reports (contact_id) where contact_id is not null;

alter table public.diag_reports enable row level security;
revoke all on public.diag_reports from anon, authenticated;
grant select, insert, update, delete on public.diag_reports to service_role;
