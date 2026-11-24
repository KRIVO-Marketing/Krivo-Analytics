-- Fluxo de caixa interno da KRIVO: entradas e saídas (assinaturas de plataformas, ferramentas, recebimentos de clientes etc.).
-- Mesmo padrão das demais tabelas: RLS ativo, sem policies, sem grants para anon/authenticated.
-- Só a Edge Function ops-api (service_role) lê e escreve, e só para administradores.
create table if not exists public.finance_entries (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('in', 'out')),
  description   text not null check (char_length(description) between 2 and 120),
  category      text not null default 'outros' check (char_length(category) between 2 and 40),
  counterparty  text check (counterparty is null or char_length(counterparty) <= 80),
  amount        numeric(12,2) not null check (amount > 0),
  entry_date    date not null,
  status        text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at       timestamptz,
  series_id     uuid,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists finance_entries_date_idx on public.finance_entries (entry_date desc);
create index if not exists finance_entries_series_idx on public.finance_entries (series_id) where series_id is not null;

alter table public.finance_entries enable row level security;
revoke all on public.finance_entries from anon, authenticated;
grant select, insert, update, delete on public.finance_entries to service_role;

-- ---------- anexos dos lançamentos (notas fiscais, comprovantes, boletos) ----------
create table if not exists public.finance_attachments (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.finance_entries(id) on delete cascade,
  storage_path text not null,
  file_name    text not null check (char_length(file_name) between 1 and 120),
  mime         text not null,
  size_bytes   integer not null check (size_bytes > 0),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists finance_attachments_entry_idx on public.finance_attachments (entry_id);

alter table public.finance_attachments enable row level security;
revoke all on public.finance_attachments from anon, authenticated;
grant select, insert, update, delete on public.finance_attachments to service_role;

-- bucket privado (sem policies: só service_role; envio e download por URL assinada)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('financeiro-anexos', 'financeiro-anexos', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
