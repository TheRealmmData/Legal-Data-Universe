/**
 * Minimal deterministic PDF writer for attorney-facing findings
 * memos. No dependency: Letter pages, Helvetica / Helvetica-Bold,
 * selectable text, uncompressed content streams. Input is a flat
 * styled-line sequence; all legal content decisions live in
 * findings-memo.ts.
 *
 * Served-module check (2026-11-03): the dev server once kept
 * serving a stale transform of this file whose undeclared
 * `lastFont` broke every Quest PDF/ZIP export while disk tests
 * passed. If exports fail on device but pass in tests, fetch
 * /src/export/pdf.ts from the dev server and compare.
 */
export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  align?: 'left' | 'center';
  indent?: number;
  gapBefore?: number;
  color?: [number, number, number];
  rule?: boolean;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP_Y = PAGE_H - 52;
const BOTTOM_Y = 58;

function sanitize(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/•/g, '-')
    .replace(/→/g, '->')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

function escapePdf(text: string): string {
  return sanitize(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapText(text: string, size: number, bold: boolean, indent = 0): string[] {
  const clean = sanitize(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const charW = size * (bold ? 0.56 : 0.52);
  const maxChars = Math.max(18, Math.floor((CONTENT_W - indent) / charW));
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      current = '';
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

interface Placed {
  text: string;
  size: number;
  bold: boolean;
  align: 'left' | 'center';
  indent: number;
  color: [number, number, number];
  rule: boolean;
  gapBefore: number;
}

function layout(lines: PdfLine[]): Placed[][] {
  const pages: Placed[][] = [[]];
  let y = TOP_Y;
  const push = (line: Placed) => {
    const height = line.gapBefore + line.size * 1.38;
    if (y - height < BOTTOM_Y && pages[pages.length - 1].length) {
      pages.push([]);
      y = TOP_Y;
    }
    y -= height;
    pages[pages.length - 1].push(line);
  };
  for (const input of lines) {
    const size = input.size ?? 10;
    const bold = Boolean(input.bold);
    const indent = input.indent ?? 0;
    if (input.rule) {
      push({
        text: '', size: 4, bold: false, align: 'left', indent: 0,
        color: input.color ?? [0.45, 0.38, 0.18], rule: true,
        gapBefore: input.gapBefore ?? 6,
      });
      continue;
    }
    const wrapped = wrapText(input.text, size, bold, indent);
    wrapped.forEach((text, i) => push({
      text,
      size,
      bold,
      align: input.align ?? 'left',
      indent,
      color: input.color ?? [0.08, 0.08, 0.08],
      rule: false,
      gapBefore: i === 0 ? (input.gapBefore ?? 0) : 0,
    }));
  }
  return pages;
}

function pageStream(page: Placed[], pageNo: number, pageCount: number): string {
  const ops: string[] = [];
  let y = TOP_Y;
  let lastColor = '';
  for (const line of page) {
    y -= line.gapBefore;
    if (line.rule) {
      const [r, g, b] = line.color;
      ops.push(`${r} ${g} ${b} RG 0.7 w ${MARGIN} ${y.toFixed(1)} m ${PAGE_W - MARGIN} ${y.toFixed(1)} l S`);
      y -= line.size * 1.38;
      continue;
    }
    const font = `${line.bold ? '/F2' : '/F1'} ${line.size}`;
    const color = line.color.map((c) => c.toFixed(3)).join(' ');
    if (color !== lastColor) { ops.push(`${color} rg`); lastColor = color; }
    const approxW = line.text.length * line.size * (line.bold ? 0.56 : 0.52);
    const x = line.align === 'center'
      ? Math.max(MARGIN, (PAGE_W - approxW) / 2)
      : MARGIN + line.indent;
    ops.push(`BT ${font} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${escapePdf(line.text)}) Tj ET`);
    y -= line.size * 1.38;
  }
  const footer = `Legal Data Universe - Attorney work product (synthetic demonstration) - Page ${pageNo} of ${pageCount}`;
  ops.push(`0.35 0.35 0.35 rg BT /F1 7.5 Tf ${MARGIN} 36 Td (${escapePdf(footer)}) Tj ET`);
  return ops.join('\n');
}

export function makePdfBytes(lines: PdfLine[]): Uint8Array {
  const pages = layout(lines);
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const boldFontId = 4;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = '';
  objects[fontId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[boldFontId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const pageIds: number[] = [];
  pages.forEach((page, index) => {
    const stream = pageStream(page, index + 1, pages.length);
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
      + `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  });
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets[i + 1] = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
