-- Duas mensagens de coleta de dados do contrato (PF e PJ) ligadas ao item "Pedir os dados do contrato".
-- Um item agora pode ter mais de uma mensagem: nova coluna message_keys (lista). A coluna message_key antiga
-- continua existindo só para compatibilidade com a versão anterior da função; o app lê message_keys.
-- Idempotente: pode rodar de novo sem duplicar nem sobrescrever marcações (done), notas, responsáveis ou prazos.

alter table public.delivery_templates add column if not exists message_keys text[] not null default '{}'::text[];
alter table public.delivery_items     add column if not exists message_keys text[] not null default '{}'::text[];

-- 1) leva a mensagem única que já existia para a lista (só onde a lista ainda está vazia)
update public.delivery_templates set message_keys = array[message_key]
 where message_key is not null and message_keys = '{}'::text[];
update public.delivery_items set message_keys = array[message_key]
 where message_key is not null and message_keys = '{}'::text[];

-- 2) mensagens novas, no fim da lista (posições 5 e 6)
insert into public.delivery_messages (key, title, body, position) values
('coleta_contrato_pf', 'Coleta de dados do contrato (pessoa física)',
'Olá, {{nome}}! Para preparar o seu contrato, precisamos de alguns dados. Pode nos enviar, por favor?

1. Nome completo
2. CPF
3. Endereço completo, com CEP
4. E-mail
5. WhatsApp
6. Quem aprova o conteúdo, caso não seja você

Assim que recebermos, enviamos o contrato para assinatura eletrônica.', 5),
('coleta_contrato_pj', 'Coleta de dados do contrato (pessoa jurídica)',
'Olá, {{nome}}! Para preparar o contrato, precisamos dos dados da empresa. Pode nos enviar, por favor?

1. Razão social e nome fantasia
2. CNPJ
3. Endereço completo da empresa, com CEP
4. E-mail e WhatsApp para contato
5. Representante que assina o contrato: nome completo, CPF e cargo
6. Quem aprova o conteúdo, caso não seja o representante

Assim que recebermos, enviamos o contrato para assinatura eletrônica.', 6)
on conflict (key) do nothing;

-- 3) liga as duas ao item da Fase 1 no modelo e nas entregas já criadas (só a coluna message_keys muda)
update public.delivery_templates
   set message_keys = array['coleta_contrato_pf', 'coleta_contrato_pj'], message_key = null
 where phase = 1 and title = 'Pedir os dados do contrato'
   and message_keys is distinct from array['coleta_contrato_pf', 'coleta_contrato_pj'];

update public.delivery_items i
   set message_keys = array['coleta_contrato_pf', 'coleta_contrato_pj']
 where i.phase = 1 and i.title = 'Pedir os dados do contrato'
   and i.message_keys is distinct from array['coleta_contrato_pf', 'coleta_contrato_pj'];
