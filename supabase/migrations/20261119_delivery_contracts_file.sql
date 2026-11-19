-- Contrato gerado fica guardado no bucket privado (pasta gerados/) para poder baixar de novo pelo histórico.
alter table public.delivery_contracts add column if not exists storage_path text;
alter table public.delivery_contracts add column if not exists size_bytes bigint;
