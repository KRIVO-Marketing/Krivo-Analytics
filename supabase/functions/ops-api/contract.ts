// Gerador de contrato: validação dos campos (a partir de contract-fields.json), cálculos e renderização com docxtemplater.
// Código puro (sem Deno/Node específico) para poder ser testado fora da Edge Function.

export type FieldSpec = {
  group: string; key: string; label: string; type: string;
  default: unknown; required: boolean; help: string; when?: When;
};
// extra: produtos do catálogo que não têm bloco próprio no modelo (código -> nome). Entram na lista de produtos do contrato.
// when: o campo só vale em certos contratos. Produtos pontuais (Eventos e Diagnóstico), sozinhos ou juntos, têm contrato mais simples:
// a vigência vai até a entrega e o pagamento, sem prazo mínimo, aviso prévio, cancelamento, aprovação de peças nem parceria.
// Qualquer produto recorrente no contrato (Social, Local, Site, Atende, Metodologia) volta ao padrão completo.
export type When = "mensal" | "padrao";
const PONTUAIS = ["eventos", "diagnostico"];
export const onlyPontual = (selected: string[]) => selected.length > 0 && selected.every((k) => PONTUAIS.includes(k));
export function fieldApplies(f: { when?: string }, selected: string[], _on?: Record<string, boolean>) {
  return f.when ? !onlyPontual(selected) : true;
}
export type Spec = { fields: FieldSpec[]; computed: string[]; extra?: Record<string, string> };

export class ContractError extends Error {
  problems: string[];
  constructor(message: string, problems: string[] = []) { super(message); this.problems = problems; }
}

// Chaves que lembram senha nunca são aceitas, em nenhum nível.
const PASSWORD_KEY = /senha|password|passwd|pwd|secret|token/i;

export const PRODUCT_KEYS = ["diagnostico", "social", "local", "site", "atende", "metodologia", "eventos"] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];
export const PRODUCT_NAMES: Record<ProductKey, string> = {
  diagnostico: "KRIVO Diagnóstico",
  social: "KRIVO Social",
  local: "KRIVO Local",
  site: "KRIVO Site",
  atende: "KRIVO Atende",
  metodologia: "Metodologia KRIVO",
  eventos: "KRIVO Eventos",
};
// código do Catálogo <-> chave do contrato
export const CODE_TO_KEY: Record<string, ProductKey> = { "00": "diagnostico", "01": "social", "02": "local", "03": "site", "04": "atende", "05": "metodologia", "06": "eventos" };
// grupo do formulário que só aparece se o produto estiver marcado
export const GROUP_PRODUCT: Record<string, ProductKey> = {
  "Diagnóstico": "diagnostico", "Social": "social", "Local": "local", "Site": "site", "Atende": "atende", "Metodologia": "metodologia", "Eventos": "eventos",
};
const METODOLOGIA_INCLUI: ProductKey[] = ["diagnostico", "local", "site", "social", "atende"];

function parseType(t: string): { kind: string; options: string[] } {
  const [kind, rest] = t.split(":");
  return { kind, options: rest ? rest.split("|") : [] };
}

const MAX_TEXT = 400;
const MAX_TEXTAREA = 3000;
const MAX_ROWS = 24;
const MAX_CELL = 200;

// ---------- limpeza (rascunho): só tipos, tamanhos e chaves; nada obrigatório ----------
export function cleanContractData(input: unknown, spec: Spec): Record<string, unknown> {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ContractError("Dados do contrato inválidos.");
  const byKey = new Map(spec.fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (PASSWORD_KEY.test(k)) throw new ContractError("Este formulário não aceita senhas. Peça acesso por convite.");
    const f = byKey.get(k);
    if (!f) throw new ContractError(`Campo desconhecido no contrato: ${k.slice(0, 40)}.`);
    if (v === null || v === undefined) continue;
    const { kind, options } = parseType(f.type);
    switch (kind) {
      case "text": case "email": case "textarea": case "date_ptbr": {
        if (typeof v !== "string") throw new ContractError(`${f.label}: valor inválido.`);
        const max = kind === "textarea" ? MAX_TEXTAREA : MAX_TEXT;
        if (v.length > max) throw new ContractError(`${f.label}: aceita até ${max} caracteres.`);
        if (kind === "date_ptbr" && v.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) throw new ContractError(`${f.label}: use uma data válida.`);
        out[k] = v;
        break;
      }
      case "select":
        if (typeof v !== "string" || (v !== "" && !options.includes(v))) throw new ContractError(`${f.label}: opção inválida.`);
        out[k] = v;
        break;
      case "multiselect": {
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !options.includes(x))) throw new ContractError(`${f.label}: opção inválida.`);
        out[k] = [...new Set(v as string[])];
        break;
      }
      case "bool":
        if (typeof v !== "boolean") throw new ContractError(`${f.label}: valor inválido.`);
        out[k] = v;
        break;
      case "rows": {
        if (!Array.isArray(v) || v.length > MAX_ROWS) throw new ContractError(`${f.label}: use no máximo ${MAX_ROWS} linhas.`);
        out[k] = v.map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) throw new ContractError(`${f.label}: linha inválida.`);
          const r: Record<string, string> = {};
          for (const [rk, rv] of Object.entries(row as Record<string, unknown>)) {
            if (PASSWORD_KEY.test(rk)) throw new ContractError("Este formulário não aceita senhas. Peça acesso por convite.");
            if (!options.includes(rk)) throw new ContractError(`${f.label}: coluna desconhecida (${rk.slice(0, 20)}).`);
            if (rv === null || rv === undefined) continue;
            if (typeof rv !== "string" && typeof rv !== "number") throw new ContractError(`${f.label}: valor inválido.`);
            const s = String(rv);
            if (s.length > MAX_CELL) throw new ContractError(`${f.label}: cada célula aceita até ${MAX_CELL} caracteres.`);
            r[rk] = s;
          }
          return r;
        });
        break;
      }
      default:
        throw new ContractError(`Tipo de campo não suportado: ${f.type}.`);
    }
  }
  return out;
}

// ---------- documentos ----------
export const digits = (s: string) => s.replace(/\D/g, "");
export function validCPF(v: string) {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
export function validCNPJ(v: string) {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
export function fmtDoc(tipo: string, v: string) {
  const d = digits(v);
  if (tipo === "CPF" && d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (tipo === "CNPJ" && d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return v.trim();
}
export function fmtPhone(v: string) {
  let d = digits(v);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v.trim();
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- datas e valores por extenso ----------
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function dateExtenso(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.trim();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return iso.trim();
  return `${d} de ${MESES[mo - 1]} de ${y}`;
}

const UNI = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEN = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (c) parts.push(CEN[c]);
  if (r) {
    if (r < 20) parts.push(UNI[r]);
    else { const d = Math.floor(r / 10), u = r % 10; parts.push(u ? `${DEZ[d]} e ${UNI[u]}` : DEZ[d]); }
  }
  return parts.join(" e ");
}
// inteiro por extenso (até 999 bilhões)
export function intExtenso(n: number): string {
  if (n === 0) return "zero";
  const groups: number[] = [];
  let x = n;
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  const names = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const parts: { text: string; value: number }[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    let t: string;
    if (i === 0) t = ate999(g);
    else if (i === 1) t = g === 1 ? "mil" : `${ate999(g)} mil`;
    else t = `${ate999(g)} ${g === 1 ? names[i][0] : names[i][1]}`;
    parts.push({ text: t, value: g });
  }
  // "e" antes do último grupo quando ele é < 100 ou centena exata; senão, só espaço
  let out = parts[0].text;
  for (let i = 1; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const v = parts[i].value;
    out += last && (v < 100 || v % 100 === 0) ? ` e ${parts[i].text}` : ` ${parts[i].text}`;
  }
  return out;
}
export function moneyExtenso(value: number): string {
  const cents = Math.round(value * 100);
  const reais = Math.floor(cents / 100), cent = cents % 100;
  const parts: string[] = [];
  if (reais) {
    const exactMillions = reais >= 1_000_000 && reais % 1_000_000 === 0;
    parts.push(`${intExtenso(reais)}${exactMillions ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (cent) parts.push(`${intExtenso(cent)} ${cent === 1 ? "centavo" : "centavos"}`);
  return parts.length ? parts.join(" e ") : "zero real";
}
export const brl = (v: number) => "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
// "1500", "1.500,00", "1500.5" -> número; texto livre -> null
export function parseMoney(s: string): number | null {
  const t = s.trim().replace(/^R\$\s*/i, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(t)) return null;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
}
// "1500" -> "R$ 1.500,00 (mil e quinhentos reais)". Texto já com extenso fica como está.
export function moneyText(s: string) {
  if (/\(.+\)/.test(s)) return s.trim();
  const n = parseMoney(s);
  return n === null ? s.trim() : `${brl(n)} (${moneyExtenso(n)})`;
}

// ---------- produtos ----------
export function activeProducts(selected: string[]): Record<ProductKey, boolean> {
  const on = Object.fromEntries(PRODUCT_KEYS.map((k) => [k, selected.includes(k)])) as Record<ProductKey, boolean>;
  if (on.metodologia) for (const k of METODOLOGIA_INCLUI) on[k] = true;
  return on;
}
const joinPt = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);
export function productsList(selected: string[], extra: Record<string, string> = {}) {
  if (selected.includes("metodologia")) {
    return `${PRODUCT_NAMES.metodologia}, que inclui ${joinPt(METODOLOGIA_INCLUI.map((k) => PRODUCT_NAMES[k]))}`;
  }
  return joinPt([
    ...PRODUCT_KEYS.filter((k) => selected.includes(k)).map((k) => PRODUCT_NAMES[k]),
    ...Object.keys(extra).filter((c) => selected.includes(c)).map((c) => extra[c]),
  ]);
}

// ---------- valores padrão ----------
export function withDefaults(data: Record<string, unknown>, spec: Spec) {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) out[f.key] = data[f.key] !== undefined ? data[f.key] : f.default;
  return out;
}

// ---------- validação completa (antes de gerar) ----------
export type Check = { errors: string[]; warnings: string[] };
export function checkContract(raw: Record<string, unknown>, spec: Spec): Check {
  const d = withDefaults(raw, spec);
  const errors: string[] = [], warnings: string[] = [];
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  const produtos = (d.produtos as string[]) ?? [];
  const on = activeProducts(produtos);

  for (const f of spec.fields) {
    if (!f.required) continue;
    const prod = GROUP_PRODUCT[f.group];
    if (prod && !on[prod]) continue;
    if (!fieldApplies(f, produtos, on)) continue;
    const v = d[f.key];
    const kind = parseType(f.type).kind;
    if (kind === "bool") continue;
    if (kind === "multiselect" || kind === "rows") { if (!Array.isArray(v) || !v.length) errors.push(`${f.label}: obrigatório.`); continue; }
    if (typeof v !== "string" || !v.trim()) errors.push(`${f.label}: obrigatório.`);
  }
  if (!produtos.length) errors.push("Marque pelo menos 1 produto.");
  const rows = (d.parcelas as Record<string, string>[]) ?? [];
  if (!rows.length) errors.push("Inclua pelo menos 1 parcela.");
  rows.forEach((r, i) => {
    for (const c of ["item", "valor", "vencimento", "forma"]) if (!(r[c] ?? "").trim()) errors.push(`Parcela ${i + 1}: preencha ${c}.`);
  });

  const doc = s("doc_numero");
  if (doc) {
    if (s("doc_tipo") === "CPF" && !validCPF(doc)) errors.push("CPF inválido (confira os dígitos).");
    if (s("doc_tipo") === "CNPJ" && !validCNPJ(doc)) errors.push("CNPJ inválido (confira os dígitos).");
  }
  if (s("email") && !EMAIL.test(s("email"))) errors.push("E-mail inválido.");
  const wa = digits(s("whatsapp"));
  if (s("whatsapp") && (wa.length < 10 || wa.length > 13)) errors.push("WhatsApp inválido: use DDD e número.");
  if (fieldApplies({ when: "mensal" }, produtos, on) && s("data_inicio") && dateExtenso(s("data_inicio")) === s("data_inicio")) errors.push("Data de início inválida.");

  const pj = s("tipo_pessoa") === "pessoa jurídica";
  if (pj && s("doc_tipo") === "CPF") warnings.push("Pessoa jurídica com CPF: confira o tipo de documento.");
  if (!pj && s("doc_tipo") === "CNPJ") warnings.push("Pessoa física com CNPJ: confira o tipo de pessoa.");
  if (pj && !s("representante")) warnings.push("Pessoa jurídica: preencha o representante (nome, CPF e cargo).");
  if (d.solidaria === true && !s("representante")) warnings.push("Responsabilidade solidária só aparece no contrato se houver representante.");
  const padrao = fieldApplies({ when: "padrao" }, produtos, on);
  if (padrao && d.parceria === true && !s("texto_parceria")) errors.push("Parceria marcada: escreva o texto da parceria.");
  if (padrao && d.aprov_previa === true && !s("prazo_aprovacao")) errors.push("Informe o prazo de resposta às aprovações.");

  // campos do Anexo I vazios deixam a frase incompleta
  for (const f of spec.fields) {
    const prod = GROUP_PRODUCT[f.group];
    if (prod && on[prod] && !s(f.key)) warnings.push(`${f.group}: "${f.label}" está vazio e vai aparecer em branco no Anexo I.`);
  }
  return { errors, warnings };
}

// ---------- dados para o template ----------
export function buildRenderData(raw: Record<string, unknown>, spec: Spec) {
  const d = withDefaults(raw, spec);
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  const produtos = (d.produtos as string[]) ?? [];
  const on = activeProducts(produtos);
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const kind = parseType(f.type).kind;
    if (kind === "text" || kind === "email" || kind === "textarea" || kind === "select") out[f.key] = s(f.key);
  }
  out.doc_numero = fmtDoc(s("doc_tipo"), s("doc_numero"));
  out.whatsapp = fmtPhone(s("whatsapp"));
  out.email = s("email").toLowerCase();
  out.data_inicio = dateExtenso(s("data_inicio"));
  out.data_evento = dateExtenso(s("data_evento"));
  out.mensal = fieldApplies({ when: "mensal" }, produtos, on);
  const padrao = fieldApplies({ when: "padrao" }, produtos, on);
  out.parcelas = ((d.parcelas as Record<string, string>[]) ?? []).map((r) => ({
    item: (r.item ?? "").trim(),
    valor: moneyText(r.valor ?? ""),
    vencimento: dateExtenso(r.vencimento ?? ""),
    forma: (r.forma ?? "").trim(),
  }));
  out.representante = s("representante");
  out.solidaria = d.solidaria === true && !!s("representante");
  out.aprov_previa = padrao && d.aprov_previa !== false; // só Eventos: cobertura em tempo real, sem aprovação prévia
  out.parceria = padrao && d.parceria === true && !!s("texto_parceria");
  out.outra_forma = s("outra_forma");
  out.produtos_lista = productsList(produtos, spec.extra);
  for (const k of PRODUCT_KEYS) out[k] = on[k];
  delete out.produtos;
  return out;
}

// ---------- renderização e conferência ----------
// deno-lint-ignore no-explicit-any
type Ctor = any;
export function renderDocx(PizZip: Ctor, Docxtemplater: Ctor, template: Uint8Array, data: Record<string, unknown>): Uint8Array {
  let doc;
  try {
    const zip = new PizZip(template);
    doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
    doc.render(data);
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const errs = (e as any)?.properties?.errors as { properties?: { explanation?: string } }[] | undefined;
    const detail = errs?.map((x) => x.properties?.explanation).filter(Boolean).slice(0, 5) as string[] | undefined;
    throw new ContractError("O template do contrato tem um erro de tags. Peça para um admin conferir o arquivo.", detail ?? []);
  }
  const out: Uint8Array = doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
  const left = leftoverTags(PizZip, out);
  if (left.length) throw new ContractError("O contrato gerado ainda tem campos entre chaves. Nada foi baixado.", left);
  return out;
}
// texto visível de document/header/footer; procura { ou } sobrando
export function docText(PizZip: Ctor, buf: Uint8Array): string {
  const zip = new PizZip(buf);
  return Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .map((n) => zip.file(n).asText().replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, ""))
    .join("\n");
}
export function leftoverTags(PizZip: Ctor, buf: Uint8Array): string[] {
  const text = docText(PizZip, buf);
  const found = text.match(/[{}][^\n]{0,40}/g) ?? [];
  return [...new Set(found)].slice(0, 10);
}

// "Contrato KRIVO - Barbearia X - 2026-11-25.docx"
export function contractFileName(name: string, isoDate: string) {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Cliente";
  return `Contrato KRIVO - ${safe} - ${isoDate}.docx`;
}
