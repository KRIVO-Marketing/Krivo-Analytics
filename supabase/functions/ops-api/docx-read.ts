// Lê o contrato preenchido (.docx) e devolve só o conteúdo: parágrafos, tabelas e o texto do rodapé.
// A aparência do PDF fica em docx-pdf.ts. Recurso que o PDF não reproduz (imagem, lista automática,
// cabeçalho…) gera erro, para nada sumir do contrato sem aviso.
// Código puro (sem Deno/Node específico); PizZip é recebido de fora, como em contract.ts.
import { ContractError } from "./contract.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type Run = { text: string; bold: boolean; italic: boolean; underline: boolean; color: string | null; size: number };
export type Piece = { type: "text"; run: Run } | { type: "line" } | { type: "page" };
export type Para = { type: "p"; pieces: Piece[]; align: "left" | "center" | "right" | "both" };
export type Cell = { width: number; fill: string | null; blocks: Block[] };
export type Table = { type: "tbl"; rows: { header: boolean; cells: Cell[] }[] };
export type Block = Para | Table;
export type Docx = { body: Block[]; footer: string; page: { width: number; height: number; left: number; right: number } };

// ---------- XML ----------
type Node = { tag: string; attrs: Record<string, string>; children: Node[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (all, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? all);

function parseXml(xml: string): Node {
  const root: Node = { tag: "", attrs: {}, children: [], text: "" };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<[?!][^>]*>|<\/[^>]+>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = token.exec(xml); m; m = token.exec(xml)) {
    const [all, tag, attrs, selfClosing, text] = m;
    if (text !== undefined) stack[stack.length - 1].text += decode(text);
    else if (tag) {
      const node: Node = { tag, attrs: {}, children: [], text: "" };
      for (const a of attrs.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decode(a[2] ?? a[3]);
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (all.startsWith("</")) stack.pop();
  }
  return root;
}
const child = (n: Node | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
const kids = (n: Node | undefined, tag: string) => n?.children.filter((c) => c.tag === tag) ?? [];
const val = (n: Node | undefined) => n?.attrs["w:val"];
// medidas do Word: twips (1/20 de ponto)
const pt = (v: string | undefined, fallback = 0) => (v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v) / 20);
const isOn = (n: Node) => !["0", "false", "off", "none"].includes(val(n) ?? "");
const hex = (v: string | undefined) => (/^[0-9a-f]{6}$/i.test(v ?? "") ? v!.toUpperCase() : null);

export const unsupported = (what: string): never => {
  throw new ContractError(`O modelo do contrato usa um recurso que o PDF não reproduz (${what}). Peça para um admin remover do arquivo em Modelos.`);
};

const FORBIDDEN: Record<string, string> = {
  "w:drawing": "imagem ou desenho", "w:pict": "imagem ou desenho", "w:object": "objeto incorporado",
  "w:footnoteReference": "nota de rodapé", "w:endnoteReference": "nota de fim", "w:sym": "símbolo inserido pelo menu Símbolo",
  "mc:AlternateContent": "caixa de texto ou forma", "m:oMath": "equação", "m:oMathPara": "equação",
  "w:numPr": "lista numerada ou com marcadores automáticos",
};
// elementos que só embrulham conteúdo; w:del (texto apagado em revisão) fica de fora de propósito
const WRAPPERS = new Set(["w:hyperlink", "w:ins", "w:smartTag", "w:sdt", "w:sdtContent", "w:fldSimple", "w:customXml"]);

// ---------- estilos ----------
type Fmt = Omit<Run, "text">;
function applyRun(f: Fmt, rPr: Node | undefined) {
  for (const c of rPr?.children ?? []) {
    if (c.tag === "w:b") f.bold = isOn(c);
    else if (c.tag === "w:i") f.italic = isOn(c);
    else if (c.tag === "w:u") f.underline = isOn(c);
    else if (c.tag === "w:sz") f.size = Number(val(c)) / 2 || f.size;
    else if (c.tag === "w:color") f.color = hex(val(c));
  }
}

function styleResolver(stylesXml: string) {
  const root = child(parseXml(stylesXml), "w:styles");
  const defaults = child(root, "w:docDefaults");
  const styles = kids(root, "w:style");
  const byId = new Map(styles.map((s) => [s.attrs["w:styleId"], s]));
  const normal = styles.find((s) => s.attrs["w:type"] === "paragraph" && s.attrs["w:default"] === "1");
  const chain = (s: Node | undefined): Node[] => {
    const out: Node[] = [];
    for (let i = 0; s && i < 12; i++) { out.unshift(s); s = byId.get(val(child(s, "w:basedOn")) ?? ""); }
    return out;
  };
  return {
    paragraph(id: string | undefined) {
      const list = chain(byId.get(id ?? "") ?? normal);
      return {
        p: [child(child(defaults, "w:pPrDefault"), "w:pPr"), ...list.map((s) => child(s, "w:pPr"))],
        r: [child(child(defaults, "w:rPrDefault"), "w:rPr"), ...list.map((s) => child(s, "w:rPr"))],
      };
    },
    run: (id: string | undefined) => chain(byId.get(id ?? "")).map((s) => child(s, "w:rPr")),
  };
}
type Styles = ReturnType<typeof styleResolver>;

// ---------- documento ----------
function readPara(p: Node, styles: Styles): Para {
  const pPr = child(p, "w:pPr");
  const style = styles.paragraph(val(child(pPr, "w:pStyle")));
  let align: Para["align"] = "left";
  const pieces: Piece[] = [];
  for (const x of [...style.p, pPr]) {
    if (!x) continue;
    if (child(x, "w:numPr")) unsupported(FORBIDDEN["w:numPr"]);
    const jc = val(child(x, "w:jc"));
    if (jc) align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "both" : "left";
    const before = child(x, "w:pageBreakBefore");
    if (before && isOn(before)) pieces.push({ type: "page" });
  }
  const base: Fmt = { bold: false, italic: false, underline: false, color: null, size: 10 };
  for (const x of style.r) applyRun(base, x);

  // campos do Word (número de página etc.): o resultado gravado é ignorado, quem numera é o PDF
  let inField = 0;
  const walk = (n: Node) => {
    for (const c of n.children) {
      if (FORBIDDEN[c.tag]) unsupported(FORBIDDEN[c.tag]);
      if (c.tag === "w:fldSimple" && /^\s*(NUM)?PAGES?\b/.test(c.attrs["w:instr"] ?? "")) continue;
      if (WRAPPERS.has(c.tag)) { walk(c); continue; }
      if (c.tag !== "w:r") continue;
      const rPr = child(c, "w:rPr");
      const f = { ...base };
      for (const x of styles.run(val(child(rPr, "w:rStyle")))) applyRun(f, x);
      applyRun(f, rPr);
      const text = (t: string) => pieces.push({ type: "text", run: { ...f, text: t } });
      for (const e of c.children) {
        if (FORBIDDEN[e.tag]) unsupported(FORBIDDEN[e.tag]);
        if (e.tag === "w:fldChar") {
          const kind = e.attrs["w:fldCharType"];
          if (kind === "begin") inField++;
          else if (kind === "end") inField = Math.max(0, inField - 1);
        } else if (inField) continue;
        else if (e.tag === "w:t") text(e.text);
        else if (e.tag === "w:noBreakHyphen") text("-");
        else if (e.tag === "w:tab") text(" ");
        else if (e.tag === "w:br" || e.tag === "w:cr") pieces.push({ type: e.attrs["w:type"] === "page" ? "page" : "line" });
      }
    }
  };
  walk(p);
  return { type: "p", pieces, align };
}

function readTable(t: Node, styles: Styles): Table {
  const grid = kids(child(t, "w:tblGrid"), "w:gridCol").map((g) => pt(g.attrs["w:w"]));
  const rows = kids(t, "w:tr").map((tr) => {
    let col = 0;
    const cells = kids(tr, "w:tc").map((tc) => {
      const tcPr = child(tc, "w:tcPr");
      if (child(tcPr, "w:vMerge")) unsupported("células mescladas na vertical");
      const span = Number(val(child(tcPr, "w:gridSpan"))) || 1;
      const tcW = child(tcPr, "w:tcW");
      const width = tcW?.attrs["w:type"] === "dxa" && pt(tcW.attrs["w:w"]) > 0
        ? pt(tcW.attrs["w:w"])
        : grid.slice(col, col + span).reduce((a, b) => a + b, 0) || 100;
      col += span;
      return { width, fill: hex(child(tcPr, "w:shd")?.attrs["w:fill"]), blocks: readBlocks(tc, styles) };
    });
    return { header: !!child(child(tr, "w:trPr"), "w:tblHeader"), cells };
  });
  return { type: "tbl", rows };
}
function readBlocks(parent: Node, styles: Styles): Block[] {
  const out: Block[] = [];
  for (const c of parent.children) {
    if (FORBIDDEN[c.tag]) unsupported(FORBIDDEN[c.tag]);
    if (c.tag === "w:p") out.push(readPara(c, styles));
    else if (c.tag === "w:tbl") out.push(readTable(c, styles));
    else if (WRAPPERS.has(c.tag)) out.push(...readBlocks(c, styles));
  }
  return out;
}

export const plainText = (blocks: Block[]): string =>
  blocks.map((b) => (b.type === "p"
    ? b.pieces.map((x) => (x.type === "text" ? x.run.text : " ")).join("")
    : b.rows.map((r) => r.cells.map((c) => plainText(c.blocks)).join(" ")).join(" "))).join(" ");

export function readDocx(PizZip: Any, docx: Uint8Array): Docx {
  const zip = new PizZip(docx);
  const read = (name: string): string => zip.file(name)?.asText() ?? "";
  const styles = styleResolver(read("word/styles.xml"));
  const body = child(child(parseXml(read("word/document.xml")), "w:document"), "w:body");
  if (!body) unsupported("documento sem conteúdo");
  const sect = child(body, "w:sectPr");
  if (kids(sect, "w:headerReference").length) unsupported("cabeçalho");
  if (body!.children.some((c) => child(child(c, "w:pPr"), "w:sectPr"))) unsupported("quebra de seção");

  const rels = child(parseXml(read("word/_rels/document.xml.rels")), "Relationships");
  const id = kids(sect, "w:footerReference").find((f) => f.attrs["w:type"] === "default")?.attrs["r:id"];
  const target = rels?.children.find((r) => r.attrs.Id === id)?.attrs.Target;
  const footerXml = target ? read(`word/${target.replace(/^\/?(word\/)?/, "")}`) : "";
  const footer = footerXml ? plainText(readBlocks(child(parseXml(footerXml), "w:ftr")!, styles)).trim() : "";

  const size = child(sect, "w:pgSz")?.attrs ?? {}, mar = child(sect, "w:pgMar")?.attrs ?? {};
  return {
    body: readBlocks(body!, styles),
    footer,
    page: { width: pt(size["w:w"], 595.3), height: pt(size["w:h"], 841.9), left: pt(mar["w:left"], 68), right: pt(mar["w:right"], 68) },
  };
}
