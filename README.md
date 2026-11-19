# Krivo Analytics

Painel interno da KRIVO (Next.js + Supabase Edge Functions).

## Modelos de entrega (aba Entrega)

Os modelos (PDFs e contratos) ficam no bucket **privado** `modelos-entrega` do Supabase Storage, nunca em `public/`.
A tabela `delivery_docs` guarda título, descrição e caminho de cada arquivo. O download é sempre por URL assinada de curta duração.

1. Aplique a migração `supabase/migrations/20261119_delivery.sql` (cria tabelas, bucket e seed do checklist, mensagens e modelos).
2. Envie os arquivos da pasta `modelos-entrega/` para o bucket:

   ```bash
   SUPABASE_URL=https://<projeto>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service role> \
   node scripts/seed-modelos.mjs
   ```

   A chave `service_role` fica em Supabase > Project Settings > API. Não salve essa chave em arquivo do projeto nem cole em log.
   O script pode ser rodado de novo: ele substitui os arquivos e atualiza `updated_at`.

Depois disso, administradores podem substituir qualquer modelo pela própria plataforma (aba Entrega > Modelos).
