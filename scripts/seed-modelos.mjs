// Envia os 6 modelos de entrega (pasta modelos-entrega/) para o bucket privado "modelos-entrega"
// e atualiza a tabela delivery_docs (caminho, nome, tipo e tamanho).
//
// Uso (credenciais só pelo ambiente; nada é impresso):
//   SUPABASE_URL=https://<projeto>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-modelos.mjs
//
// Pré-requisito: a migração supabase/migrations/20261119_delivery.sql já aplicada (cria o bucket e as linhas).
// Rodar de novo é seguro: substitui os arquivos (upsert) e atualiza updated_at.
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente antes de rodar.");
  process.exit(1);
}

const BUCKET = "modelos-entrega";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILES = [
  { slug: "boas-vindas", file: "KRIVO_Boas-vindas.pdf", mime: "application/pdf" },
  { slug: "guia-acessos", file: "KRIVO_Guia-de-acessos.pdf", mime: "application/pdf" },
  { slug: "contrato-modelo-pdf", file: "KRIVO_Contrato-modelo.pdf", mime: "application/pdf" },
  { slug: "contrato-modelo-docx", file: "KRIVO_Contrato-modelo.docx", mime: DOCX },
  { slug: "contrato-template-docx", file: "KRIVO_Contrato-template.docx", mime: DOCX },
  { slug: "contrato-campos-json", file: "KRIVO_Contrato-campos.json", mime: "application/json" },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "modelos-entrega");
const sb = createClient(url, key, { auth: { persistSession: false } });

let failed = 0;
for (const f of FILES) {
  const path = join(root, f.file);
  const storagePath = `${f.slug}/${f.file}`;
  try {
    const [body, info] = await Promise.all([readFile(path), stat(path)]);
    const up = await sb.storage.from(BUCKET).upload(storagePath, body, { contentType: f.mime, upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const db = await sb
      .from("delivery_docs")
      .update({ storage_path: storagePath, file_name: f.file, mime: f.mime, size_bytes: info.size, updated_at: new Date().toISOString() })
      .eq("slug", f.slug)
      .select("slug");
    if (db.error) throw new Error(`delivery_docs: ${db.error.message}`);
    if (!db.data?.length) throw new Error("linha não encontrada em delivery_docs (a migração foi aplicada?)");
    console.log(`ok  ${f.slug}  (${Math.round(info.size / 1024)} KB)`);
  } catch (e) {
    failed++;
    console.error(`erro ${f.slug}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exit(failed ? 1 : 0);
