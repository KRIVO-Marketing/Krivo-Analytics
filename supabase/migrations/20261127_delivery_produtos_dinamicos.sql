-- Produtos da Entrega passam a vir do catálogo (catalog_items.code). O banco deixa de ter a lista fixa 00..05;
-- a validação do código existente fica na função ops-api.
alter table public.delivery_templates drop constraint if exists delivery_templates_product_code_check;
alter table public.delivery_templates add constraint delivery_templates_product_code_check
  check (product_code is null or product_code ~ '^[0-9A-Za-z_-]{1,8}$');

alter table public.deliveries drop constraint if exists deliveries_products_ck;
alter table public.deliveries add constraint deliveries_products_ck
  check (cardinality(product_codes) >= 1 and array_to_string(product_codes, ',') ~ '^[0-9A-Za-z_,-]+$');
