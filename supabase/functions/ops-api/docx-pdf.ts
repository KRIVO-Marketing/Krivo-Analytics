// Monta o PDF do contrato com o visual da marca (o mesmo do KRIVO_Contrato-modelo.pdf), sem serviço externo:
// os dados do cliente não saem da função.
// O TEXTO vem sempre do .docx preenchido (editável por um admin). A APARÊNCIA é definida aqui: o formato de cada
// bloco é reconhecido pelo conteúdo (capa, título de cláusula, item numerado, quadro, tabela de valores,
// ficha de produto do Anexo I e assinaturas). Bloco não reconhecido sai como texto ou tabela simples.
// Código puro (sem Deno/Node específico); as bibliotecas são recebidas de fora, como em contract.ts.
import { ContractError } from "./contract.ts";
import { plainText, readDocx, unsupported, type Block, type Cell, type Para, type Run, type Table } from "./docx-read.ts";
import { COVER, FONTS } from "./pdf-assets.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export type PdfLibs = { PizZip: Any; pdfLib: Any; fontkit: Any };

const NAVY = "223862", MUTED = "626F94", ACCENT = "A4B2D4", TINT = "EEF1F8", LINE = "D9DFEE", WHITE = "FFFFFF";
const TOP = 62, BOTTOM = 86; // margens do texto; o rodapé fica dentro da margem de baixo
const ITEM = 31, SUBITEM = 18; // recuo do texto de "1.1." e, dentro dele, de "a)"
const BOXES = "☐☑☒"; // caixas de marcação: não existem na fonte, são desenhadas

type Font = keyof typeof FONTS;
type Style = { font: Font; size: number; color: string; tracking?: number; underline?: boolean };
type Span = Style & { text: string };
type Seg = Span & { width: number };
type Line = { segs: Seg[]; width: number; spaces: number; hard: boolean; size: number };
type Align = "left" | "center" | "right" | "both";
// faixa que não se divide entre páginas; keep = fica na mesma página que a faixa seguinte
type Item = { gap: number; h: number; keep?: boolean; repeat?: Item; draw: (page: Any, top: number) => void };
type Entry = Item | "page";

async function engine(libs: PdfLibs, width: number, height: number) {
  const { pdfLib, fontkit } = libs;
  const pdf = await pdfLib.PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const names = Object.keys(FONTS) as Font[];
  const embedded = await Promise.all(names.map((n) => pdf.embedFont(FONTS[n], { features: { liga: false } })));
  const fonts = Object.fromEntries(names.map((n, i) => [n, embedded[i]])) as Record<Font, Any>;
  const charset = new Set<number>(fonts.body.getCharacterSet());
  const bad = new Set<string>();
  const color = (h: string) =>
    pdfLib.rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);

  const printable = (text: string) => {
    const clean = text.normalize("NFC")
      .replace(/[\u200b-\u200f\u2028-\u202e\u2060\ufeff\u00ad\ufe0f]/g, "")
      .replace(/[\u2010\u2011\u2212]/g, "-")
      .replace(/[\t\r\n\u2000-\u200a\u202f\u205f\u3000]/g, " ");
    let out = "";
    for (const ch of clean) {
      if (BOXES.includes(ch) || charset.has(ch.codePointAt(0)!)) out += ch;
      else bad.add(ch);
    }
    return out;
  };

  const measure = (text: string, s: Style) => {
    if (BOXES.includes(text)) return s.size * 0.85;
    return fonts[s.font].widthOfTextAtSize(text, s.size) + (s.tracking ?? 0) * [...text].length;
  };

  // quebra em linhas; "\n" força uma linha nova
  function wrap(spans: Span[], max: number): Line[] {
    const lines: Line[] = [];
    let segs: Seg[] = [], word: Seg[] = [], used = 0;
    const flush = (hard: boolean) => {
      while (segs.length && segs[segs.length - 1].text === " ") used -= segs.pop()!.width;
      const size = Math.max(0, ...segs.map((s) => s.size)) || spans[0]?.size || 9.5;
      lines.push({ segs, width: used, spaces: segs.filter((s) => s.text === " ").length, hard, size });
      segs = [];
      used = 0;
    };
    const pushWord = () => {
      if (!word.length) return;
      const w = word.reduce((a, s) => a + s.width, 0);
      if (segs.some((s) => s.text !== " ") && used + w > max + 0.01) flush(false);
      if (w <= max) { segs.push(...word); used += w; }
      else {
        // palavra maior que a linha (ex.: link): quebra por caractere
        for (const s of word) {
          for (const ch of s.text) {
            const cw = measure(ch, s);
            if (segs.length && used + cw > max) flush(false);
            const last = segs[segs.length - 1];
            if (last && last.font === s.font && last.size === s.size && last.color === s.color) { last.text += ch; last.width += cw; }
            else segs.push({ ...s, text: ch, width: cw });
            used += cw;
          }
        }
      }
      word = [];
    };
    for (const span of spans) {
      const rows = span.text.split("\n");
      rows.forEach((row, i) => {
        if (i) { pushWord(); flush(true); }
        for (const part of printable(row).split(/( |[☐☑☒])/)) {
          if (!part) continue;
          const seg = { ...span, text: part, width: measure(part, span) };
          if (part === " ") { pushWord(); segs.push(seg); used += seg.width; }
          else word.push(seg);
        }
      });
    }
    pushWord();
    if (segs.length || !lines.length) flush(true);
    return lines;
  }

  function text(page: Any, t: string, x: number, y: number, s: Style, extra: Record<string, unknown> = {}) {
    if (s.tracking) page.pushOperators(pdfLib.setCharacterSpacing(s.tracking));
    page.drawText(t, { x, y, size: s.size, font: fonts[s.font], color: color(s.color), ...extra });
    if (s.tracking) page.pushOperators(pdfLib.setCharacterSpacing(0));
  }

  // top = alto da linha; a base do texto fica no meio da entrelinha
  function drawLine(page: Any, line: Line, x: number, top: number, w: number, lead: number, align: Align = "left") {
    const free = Math.max(0, w - line.width);
    let cx = x + (align === "center" ? free / 2 : align === "right" ? free : 0);
    // linha com sobra grande (ex.: antes da chave Pix, que não se parte) fica alinhada à esquerda, sem buracos
    const stretch = align === "both" && !line.hard && line.spaces > 0 ? free / line.spaces : 0;
    const justify = stretch <= line.size * 0.7 ? stretch : 0;
    const baseline = top - (lead + line.size * 0.7) / 2;
    // junta trechos de mesmo estilo para o texto copiado do PDF sair inteiro
    let run: Seg | null = null, runX = cx;
    const emit = () => {
      if (!run) return;
      text(page, run.text, runX, baseline, run);
      if (run.underline) page.drawLine({ start: { x: runX, y: baseline - 1.5 }, end: { x: runX + run.width, y: baseline - 1.5 }, thickness: run.size / 20, color: color(run.color) });
      run = null;
    };
    for (const s of line.segs) {
      if (BOXES.includes(s.text)) {
        emit();
        const side = s.size * 0.66, c = color(s.color);
        page.drawRectangle({ x: cx, y: baseline, width: side, height: side, borderColor: c, borderWidth: 0.8 });
        if (s.text !== "☐") {
          for (const [a, b] of [[0, 1], [1, 0]]) {
            page.drawLine({ start: { x: cx + 1.4, y: baseline + 1.4 + a * (side - 2.8) }, end: { x: cx + side - 1.4, y: baseline + 1.4 + b * (side - 2.8) }, thickness: 0.8, color: c });
          }
        }
      } else if (justify) {
        if (s.text !== " ") text(page, s.text, cx, baseline, s);
      } else {
        const r = run as Seg | null;
        if (r && r.font === s.font && r.size === s.size && r.color === s.color && r.underline === s.underline) { r.text += s.text; r.width += s.width; }
        else { emit(); run = { ...s }; runX = cx; }
      }
      cx += s.width + (s.text === " " ? justify : 0);
    }
    emit();
  }

  // parágrafo como faixas, deixando pelo menos 2 linhas de cada lado de uma quebra de página
  function paragraph(spans: Span[], o: { x: number; width: number; lead: number; gap: number; align?: Align; label?: { x: number; span: Span }; keep?: boolean }): Item[] {
    const lines = wrap(spans, o.width);
    const n = lines.length;
    return lines.map((line, i) => ({
      gap: i ? 0 : o.gap, h: o.lead,
      keep: o.keep || (n > 1 && (i === 0 || i === n - 2 || n === 3)) && i < n - 1,
      draw: (page: Any, top: number) => {
        if (!i && o.label) drawLine(page, wrap([o.label.span], 200)[0], o.label.x, top, 200, o.lead);
        drawLine(page, line, o.x, top, o.width, o.lead, o.align);
      },
    }));
  }

  // coluna de textos (dentro de quadros, células e fichas): devolve altura e função de desenho
  function column(paras: { spans: Span[]; lead: number; gap?: number; align?: Align }[], w: number) {
    const laid = paras.map((p) => ({ ...p, lines: wrap(p.spans, w) }));
    return {
      height: laid.reduce((a, p, i) => a + (i ? p.gap ?? 0 : 0) + p.lines.length * p.lead, 0),
      draw(page: Any, x: number, top: number) {
        let y = top;
        laid.forEach((p, i) => {
          if (i) y -= p.gap ?? 0;
          for (const line of p.lines) { drawLine(page, line, x, y, w, p.lead, p.align); y -= p.lead; }
        });
      },
    };
  }

  // retângulo de cantos arredondados; radius: [alto-esq, alto-dir, baixo-dir, baixo-esq]
  function round(page: Any, x: number, top: number, w: number, h: number, radius: number[], o: { fill?: string; border?: string; thickness?: number; open?: boolean }) {
    const [a, b, c, d] = radius;
    const path = o.open
      ? `M 0 0 L 0 ${h - d} Q 0 ${h} ${d} ${h} L ${w - c} ${h} Q ${w} ${h} ${w} ${h - c} L ${w} 0`
      : `M ${a} 0 L ${w - b} 0 Q ${w} 0 ${w} ${b} L ${w} ${h - c} Q ${w} ${h} ${w - c} ${h} L ${d} ${h} Q 0 ${h} 0 ${h - d} L 0 ${a} Q 0 0 ${a} 0 Z`;
    page.drawSvgPath(path, {
      x, y: top,
      ...(o.fill ? { color: color(o.fill) } : {}),
      ...(o.border ? { borderColor: color(o.border), borderWidth: o.thickness ?? 0.7 } : { borderWidth: 0 }),
    });
  }
  const rule = (page: Any, x1: number, x2: number, y: number, c: string, thickness: number) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: color(c) });

  // distribui as faixas nas páginas
  function paginate(entries: Entry[], newPage: () => Any) {
    let page = newPage(), y = height - TOP;
    const full = height - TOP - BOTTOM;
    const atTop = () => y >= height - TOP - 0.01;
    const turn = () => { page = newPage(); y = height - TOP; };
    let chained = false;
    entries.forEach((e, i) => {
      if (e === "page") { if (!atTop()) turn(); chained = false; return; }
      if (!chained) {
        // altura do grupo que precisa ficar junto, a partir desta faixa
        let need = e.h, j = i;
        while ((entries[j] as Item).keep) {
          const next = entries[j + 1];
          if (!next || next === "page") break;
          need += next.gap + next.h;
          j++;
        }
        if (!atTop() && e.gap + need > y - BOTTOM + 0.01 && need <= full) turn();
      }
      if (!atTop() && e.gap + e.h > y - BOTTOM + 0.01) turn();
      if (atTop()) {
        if (e.repeat) { e.repeat.draw(page, y); y -= e.repeat.h; }
      } else y -= e.gap;
      e.draw(page, y);
      y -= e.h;
      chained = !!e.keep;
    });
  }

  return { pdf, bad, color, measure, wrap, text, drawLine, paragraph, column, round, rule, paginate, width, height };
}
type Engine = Awaited<ReturnType<typeof engine>>;

// ---------- reconhecimento dos blocos ----------
const runsOf = (p: Para) => p.pieces.flatMap((x) => (x.type === "text" ? [x.run] : x.type === "line" ? [null] : []));
const textOf = (p: Para) => runsOf(p).map((r) => r?.text ?? "\n").join("");
const parasOf = (c: Cell) => c.blocks.flatMap((b) => (b.type === "p" ? [b] : unsupported("tabela dentro de tabela")));
const filled = (c: Cell) => parasOf(c).filter((p) => textOf(p).trim());
const isDark = (h: string | null) => !!h && parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16) < 270;
const isCover = (t: Table) => t.rows.length === 1 && t.rows[0].cells.length === 1 && isDark(t.rows[0].cells[0].fill);
const isSignature = (t: Table) =>
  t.rows.length === 1 && t.rows[0].cells.length > 1 && t.rows[0].cells.every((c) => /^_{5,}/.test(textOf(filled(c)[0] ?? { type: "p", pieces: [], align: "left" }).trim()));

// texto do Word -> trechos com o estilo da marca; mantém negrito, itálico, sublinhado e cor escolhida
function spans(runs: (Run | null)[], base: Style): Span[] {
  return runs.map((r) => {
    if (!r) return { ...base, text: "\n" };
    return {
      ...base, text: r.text, underline: r.underline,
      font: r.bold ? "bold" : r.italic ? "italic" : base.font,
      color: r.color && r.color !== "000000" ? r.color : base.color,
    };
  });
}
// tira os n primeiros caracteres (o número do item, desenhado à parte)
function dropStart(runs: (Run | null)[], n: number) {
  const out: (Run | null)[] = [];
  for (const r of runs) {
    const len = r?.text.length ?? 1;
    if (n >= len) { n -= len; continue; }
    out.push(r && n ? { ...r, text: r.text.slice(n) } : r);
    n = 0;
  }
  return out;
}

const BODY: Style = { font: "body", size: 9.5, color: NAVY };

function layout(g: Engine, body: Block[], left: number, width: number): Entry[] {
  const out: Entry[] = [];
  const starts: number[] = []; // onde começa cada bloco de texto, para manter o fecho junto das assinaturas
  let indent = 0; // recuo do último item numerado (a tabela de valores acompanha)
  const right = left + width;

  const clause = (label: string, title: string): Item => {
    const lines = g.wrap([{ font: "title", size: 14, color: NAVY, text: title }], width);
    return {
      gap: 20, h: 22 + lines.length * 19, keep: true,
      draw(page, top) {
        g.rule(page, left, right, top, NAVY, 1.1);
        g.text(page, label.toUpperCase(), left, top - 15, { font: "title", size: 7.5, color: MUTED, tracking: 0.9 });
        lines.forEach((l, i) => g.drawLine(page, l, left, top - 20 - i * 19, width, 19));
      },
    };
  };

  const box = (t: Table): Item[] => {
    const cell = t.rows[0].cells[0];
    const pad = 13;
    const col = g.column(filled(cell).map((p) => ({ spans: spans(runsOf(p), { ...BODY, size: 9.2 }), lead: 14, gap: 4, align: p.align })), width - pad * 2);
    const h = col.height + pad * 2 - 2;
    if (h > g.height - TOP - BOTTOM) return filled(cell).flatMap((p) => g.paragraph(spans(runsOf(p), BODY), { x: left, width, lead: 14.5, gap: 7, align: p.align }));
    return [{
      gap: 10, h,
      draw(page, top) {
        g.round(page, left, top, width, h, [8, 8, 8, 8], cell.fill ? { fill: cell.fill === TINT ? TINT : cell.fill } : { border: LINE, thickness: 0.9 });
        col.draw(page, left + pad, top - pad + 1);
      },
    }];
  };

  const grid = (t: Table): Item[] => {
    const x = left + indent, w = width - indent;
    const head = isDarkRow(t.rows[0]);
    let header: Item | undefined;
    const widths = columnWidths(t, w, head);
    return t.rows.map((row, r) => {
      const total = row.cells.reduce((a, c) => a + c.width, 0);
      const first = r === 0, last = r === t.rows.length - 1, isHead = head && first;
      const cols = row.cells.map((c, k) => {
        const cw = row.cells.length === widths.length ? widths[k] : (c.width / total) * w;
        const style: Style = isHead ? { font: "title", size: 8.3, color: WHITE } : { ...BODY, size: 8.8 };
        return { cw, col: g.column(filled(c).map((p) => ({ spans: spans(runsOf(p), style).map((s) => (isHead ? { ...s, font: "title" as Font, color: WHITE } : s)), lead: 12.5, gap: 2 })), cw - 16) };
      });
      const h = Math.max(...cols.map((c) => c.col.height), 12.5) + 12;
      const item: Item = {
        gap: first ? 9 : 0, h, keep: isHead && !last, repeat: !first ? header : undefined,
        draw(page, top) {
          if (isHead) g.round(page, x, top, w, h, [7, 7, last ? 7 : 0, last ? 7 : 0], { fill: row.cells[0].fill ?? NAVY });
          else {
            if (last) g.round(page, x, top, w, h, [0, 0, 7, 7], { border: LINE, open: true });
            else {
              g.rule(page, x, x + w, top - h, LINE, 0.7);
              for (const px of [x, x + w]) page.drawLine({ start: { x: px, y: top }, end: { x: px, y: top - h }, thickness: 0.7, color: g.color(LINE) });
            }
            if (first) g.rule(page, x, x + w, top, LINE, 0.7);
          }
          let cx = x;
          for (const c of cols) { c.col.draw(page, cx + 8, top - 6); cx += c.cw; }
        },
      };
      if (isHead) header = item;
      return item;
    });
  };

  // larguras do modelo, alargando a coluna onde uma palavra não caberia (ex.: "Transferência")
  const columnWidths = (t: Table, w: number, head: boolean) => {
    const base = t.rows[0].cells.map((c) => c.width);
    const sum = base.reduce((a, b) => a + b, 0);
    const out = base.map((b) => (b / sum) * w);
    const min = out.map(() => 0);
    t.rows.forEach((row, r) => {
      if (row.cells.length !== out.length) return;
      row.cells.forEach((c, k) => {
        const style: Style = head && !r ? { font: "title", size: 8.3, color: WHITE } : { ...BODY, size: 8.8 };
        for (const word of plainText(c.blocks).split(/\s+/)) min[k] = Math.max(min[k], Math.min(g.measure(word, style) + 17, w / out.length));
      });
    });
    const need = out.reduce((a, x, k) => a + Math.max(0, min[k] - x), 0);
    const spare = out.reduce((a, x, k) => a + Math.max(0, x - min[k]), 0);
    if (!need || need > spare) return out;
    return out.map((x, k) => (x < min[k] ? min[k] : x - ((x - min[k]) / spare) * need));
  };

  // ficha de produto do Anexo I: etiqueta, nome e linhas "assunto | texto"
  const card = (heading: Para | null, t: Table): Item[] => {
    const pad = 13, inner = width - pad * 2, labelW = inner * 0.27;
    const runs = heading ? runsOf(heading).filter((r): r is Run => !!r) : [];
    const small = runs.filter((r) => r.size <= 8.5 && r.text.trim());
    const tag = small.map((r) => r.text.trim()).join(" ");
    const name = runs.filter((r) => !small.includes(r)).map((r) => r.text).join("").trim();
    const nameLines = name ? g.wrap([{ font: "title", size: 12, color: NAVY, text: name }], inner) : [];
    const headH = (tag ? 12 : 0) + nameLines.length * 17 + (nameLines.length ? 5 : 0);
    const rows = t.rows.map((row) => {
      const [a, ...rest] = row.cells;
      const label = g.column(filled(a).map((p) => ({ spans: [{ font: "title" as Font, size: 7.8, color: NAVY, text: textOf(p) }], lead: 12.5 })), labelW - 10);
      const value = g.column(rest.flatMap(filled).map((p) => ({ spans: spans(runsOf(p), { ...BODY, size: 9 }), lead: 13, gap: 2 })), inner - labelW);
      return { label, value, h: Math.max(label.height, value.height) + 6 };
    });
    const drawHead = (page: Any, x: number, top: number) => {
      if (tag) g.text(page, tag.toUpperCase(), x, top - 7, { font: "title", size: 7.2, color: MUTED, tracking: 0.8 });
      nameLines.forEach((l, i) => g.drawLine(page, l, x, top - (tag ? 12 : 0) - i * 17, inner, 17));
    };
    const drawRow = (page: Any, row: (typeof rows)[number], x: number, top: number) => {
      row.label.draw(page, x, top - 3);
      row.value.draw(page, x + labelW, top - 3);
    };
    const h = pad * 2 - 4 + headH + rows.reduce((a, r) => a + r.h, 0);
    if (h <= g.height - TOP - BOTTOM) {
      return [{
        gap: 12, h,
        draw(page, top) {
          g.round(page, left, top, width, h, [9, 9, 9, 9], { border: LINE, thickness: 0.9 });
          drawHead(page, left + pad, top - pad + 2);
          let y = top - pad + 2 - headH;
          for (const r of rows) { drawRow(page, r, left + pad, y); y -= r.h; }
        },
      }];
    }
    // ficha maior que a página: sem a moldura, para poder continuar na seguinte
    return [
      { gap: 12, h: headH, keep: true, draw: (page, top) => drawHead(page, left, top) },
      ...rows.map((r): Item => ({ gap: 0, h: r.h, draw: (page, top) => drawRow(page, r, left, top) })),
    ];
  };

  const signature = (t: Table): Item => {
    const cells = t.rows[0].cells;
    const gutter = 28, cw = (width - gutter * (cells.length - 1)) / cells.length;
    const cols = cells.map((c) => {
      const [, role, ...rest] = filled(c);
      return g.column([
        ...(role ? [{ spans: [{ font: "title" as Font, size: 7.5, color: MUTED, tracking: 0.8, text: textOf(role) }], lead: 14 }] : []),
        ...rest.map((p) => ({ spans: spans(runsOf(p), { ...BODY, size: 8.8 }), lead: 12.5 })),
      ], cw);
    });
    const h = Math.max(...cols.map((c) => c.height)) + 8;
    return {
      gap: 52, h,
      draw(page, top) {
        cols.forEach((c, i) => {
          const x = left + i * (cw + gutter);
          g.rule(page, x, x + cw, top, NAVY, 0.9);
          c.draw(page, x, top - 6);
        });
      },
    };
  };

  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (b.type === "tbl") {
      const cols = Math.max(...b.rows.map((r) => r.cells.length));
      if (isSignature(b)) {
        // as assinaturas nunca ficam sozinhas: levam junto a última cláusula, o fecho e o local
        for (let j = starts[Math.max(0, starts.length - 3)] ?? out.length; j < out.length; j++) if (out[j] !== "page") (out[j] as Item).keep = true;
        out.push(signature(b));
      } else if (cols === 1 && b.rows.length === 1) out.push(...box(b));
      else if (isDarkRow(b.rows[0])) out.push(...grid(b));
      else if (cols === 2) out.push(...card(null, b));
      else out.push(...grid(b));
      continue;
    }
    // quebras de página dentro do parágrafo separam o texto em partes
    const parts: Para[] = [{ ...b, pieces: [] }];
    for (const piece of b.pieces) {
      if (piece.type === "page") parts.push({ ...b, pieces: [] });
      else parts[parts.length - 1].pieces.push(piece);
    }
    parts.forEach((p, n) => {
      if (n) { out.push("page"); indent = 0; }
      const full = textOf(p);
      if (!full.trim()) return;
      const runs = runsOf(p);
      const [firstRow, ...otherRows] = full.split("\n");
      const item = /^\s*(\d+(?:\.\d+)+\.?|[a-z]\))\s+/.exec(full);
      if (/^\s*(CLÁUSULA|ANEXO)\b/i.test(firstRow) && otherRows.join("").trim()) {
        indent = 0;
        out.push(clause(firstRow.trim(), otherRows.join(" ").trim()));
      } else if (/^\s*[☐☑☒]/.test(full)) {
        const next = body[i + 1];
        indent = 0;
        if (next?.type === "tbl" && Math.max(...next.rows.map((r) => r.cells.length)) === 2) { out.push(...card(p, next)); i++; }
        else out.push(...g.paragraph(spans(runs, { font: "title", size: 11.5, color: NAVY }), { x: left, width, lead: 17, gap: 12, keep: true }));
      } else if (runs.every((r) => !r || !r.text.trim() || r.size >= 15)) {
        indent = 0;
        out.push(...g.paragraph(spans(runs, { font: "title", size: 17, color: NAVY }), { x: left, width, lead: 23, gap: 18, keep: true }));
      } else if (item) {
        const label = item[1], sub = /\)$/.test(label);
        const x = left + (sub ? ITEM + SUBITEM : ITEM);
        starts.push(out.length);
        out.push(...g.paragraph(spans(dropStart(runs, item[0].length), BODY), {
          x, width: right - x, lead: 14.5, gap: sub ? 4 : 8, align: p.align,
          label: { x: left + (sub ? ITEM : 0), span: { font: "title", size: sub ? 8.8 : 8.2, color: MUTED, text: label } },
          keep: /:\s*$/.test(full), // "…:" fica junto da primeira alínea
        }));
        indent = ITEM;
      } else {
        indent = 0;
        starts.push(out.length);
        out.push(...g.paragraph(spans(runs, BODY), { x: left, width, lead: 14.5, gap: 9, align: p.align }));
      }
    });
  }
  return out;
}
const isDarkRow = (row: Table["rows"][number]) => row.cells.every((c) => isDark(c.fill));

// ---------- capa ----------
function drawCover(g: Engine, libs: PdfLibs, page: Any, table: Table, year: string) {
  const { pdfLib } = libs, { width: W, height: H, pdf } = g;
  const bytes = Uint8Array.from(atob(COVER.data), (c) => c.charCodeAt(0));
  const image = pdf.context.register(pdf.context.stream(bytes, {
    Type: "XObject", Subtype: "Image", Width: COVER.width, Height: COVER.height, BitsPerComponent: 2,
    ColorSpace: ["Indexed", "DeviceRGB", COVER.colors - 1, pdfLib.PDFHexString.of(COVER.palette)], Filter: "FlateDecode",
  }));
  const name = page.node.newXObject("Capa", image);
  page.pushOperators(pdfLib.pushGraphicsState(), pdfLib.concatTransformationMatrix(W, 0, 0, H, 0, 0), pdfLib.drawObject(name), pdfLib.popGraphicsState());

  const x = 62, right = W - 62;
  const paras = filled(table.rows[0].cells[0]);
  const sizeOf = (p: Para) => Math.max(0, ...runsOf(p).map((r) => r?.size ?? 0));
  const title = paras.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a), paras[0]);
  const at = paras.indexOf(title);

  // marca no alto (o que vier antes do título)
  paras.slice(0, at).forEach((p, i) => {
    const full = textOf(p).trim(), reg = full.endsWith("®");
    const line = g.wrap([{ font: "brand", size: 19, color: WHITE, tracking: 0.6, text: reg ? full.slice(0, -1) : full }], 300)[0];
    g.drawLine(page, line, x, H - 62 - i * 24, 300, 24);
    if (reg) g.text(page, "®", x + line.width + 2, H - 69 - i * 24, { font: "body", size: 7, color: WHITE });
  });
  const pill: Style = { font: "title", size: 6.8, color: WHITE, tracking: 0.9 };
  const pillText = "INSTRUMENTO PARTICULAR", pillW = g.measure(pillText, pill) + 22;
  g.round(page, right - pillW, H - 64, pillW, 18, [9, 9, 9, 9], { border: WHITE, thickness: 0.7 });
  g.text(page, pillText, right - pillW + 11, H - 75.5, pill);

  // título: a última palavra em destaque, inclinada, com ponto final (no pdf-lib é o ySkew que inclina a letra)
  const words = textOf(title ?? paras[0]).trim().replace(/\.$/, "").split(/\s+/);
  const last = words.pop() ?? "";
  const big: Style = { font: "light", size: 41, color: WHITE, tracking: -1.1 };
  let y = H - 318;
  for (const l of g.wrap([{ ...big, text: words.join(" ") }], 290)) {
    g.text(page, l.segs.map((s) => s.text).join(""), x, y, big);
    y -= 44;
  }
  g.text(page, `${last}.`, x, y, { ...big, color: ACCENT }, { ySkew: pdfLib.degrees(11) });

  y -= 26;
  paras.slice(at + 1).forEach((p, i) => {
    const style: Style = i ? { font: "body", size: 10, color: ACCENT } : { font: "body", size: 13, color: "E6EAF5" };
    for (const line of g.wrap([{ ...style, text: textOf(p).trim() }], 340)) {
      g.drawLine(page, line, x, y, 340, style.size * 1.5);
      y -= style.size * 1.5;
    }
    y -= 4;
  });

  const foot: Style = { font: "brand", size: 7.2, color: WHITE, tracking: 0.4 };
  g.text(page, "KRIVO", x, 56, foot);
  const yearW = g.measure(year, foot);
  g.text(page, year, right - yearW, 56, foot);
  g.rule(page, x + g.measure("KRIVO", foot) + 9, right - yearW - 9, 58.5, WHITE, 0.6);
}

export async function docxToPdf(libs: PdfLibs, docx: Uint8Array, meta: { title: string; date: string }): Promise<Uint8Array> {
  const doc = readDocx(libs.PizZip, docx);
  const g = await engine(libs, doc.page.width, doc.page.height);
  const { pdf } = g;
  pdf.setTitle(meta.title);
  pdf.setAuthor("KRIVO Marketing");
  pdf.setSubject("Contrato de prestação de serviços");
  pdf.setCreator("KRIVO");
  pdf.setLanguage("pt-BR");
  pdf.catalog.getOrCreateViewerPreferences().setDisplayDocTitle(true);

  const left = doc.page.left, width = doc.page.width - left - doc.page.right;
  const newPage = () => pdf.addPage([g.width, g.height]);
  let body = doc.body;
  const first = body[0];
  const hasCover = first?.type === "tbl" && isCover(first) && !!plainText([first]).trim();
  if (hasCover) {
    drawCover(g, libs, newPage(), first as Table, meta.date.slice(0, 4));
    body = body.slice(1);
  }
  const entries = layout(g, body, left, width);
  while (entries[0] === "page") entries.shift(); // a capa já termina a página
  g.paginate(entries, newPage);

  // rodapé com o total de páginas: ajuda a conferir que nenhuma folha foi retirada ou acrescentada
  const label = doc.footer.replace(/^KRIVO\s*®?\s*·?\s*/i, "").replace(/\s*·\s*$/, "").trim() || "Contrato de Prestação de Serviços";
  const pages = pdf.getPages();
  pages.forEach((page: Any, i: number) => {
    if (hasCover && i === 0) return;
    g.rule(page, left, left + width, 64, NAVY, 1.1);
    g.text(page, "KRIVO", left, 47, { font: "brand", size: 8.5, color: NAVY, tracking: 0.4 });
    const style: Style = { font: "title", size: 7.8, color: NAVY };
    const line = g.wrap([{ ...style, text: `${label} · ${i + 1} de ${pages.length}` }], width - 70)[0];
    g.drawLine(page, line, left + 70, 56, width - 70, 12, "right");
  });

  if (g.bad.size) {
    throw new ContractError(`Há caracteres que o PDF não aceita (emoji ou símbolo especial). Apague do formulário e gere de novo: ${[...g.bad].slice(0, 10).join(" ")}`);
  }
  return await pdf.save();
}
