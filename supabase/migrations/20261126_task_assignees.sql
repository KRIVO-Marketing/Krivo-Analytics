-- Várias pessoas responsáveis por tarefa. assignee_id continua como "principal" (primeiro da lista) por compatibilidade.
alter table public.ops_tasks add column if not exists assignee_ids uuid[] not null default '{}';
update public.ops_tasks set assignee_ids = array[assignee_id] where assignee_id is not null and assignee_ids = '{}';
create index if not exists ops_tasks_assignee_ids_idx on public.ops_tasks using gin (assignee_ids);
