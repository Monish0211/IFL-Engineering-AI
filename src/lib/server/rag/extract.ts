import path from 'node:path';
import type { HeadingMode, TextBlock } from './chunker';

/**
 * Text extraction for uploaded documents. Output is a list of blocks, one
 * per page where the format has pages (PDF) — that page number is what
 * ends up in citations, so it is only ever taken from the file itself.
 *
 * Scanned (image-only) PDFs have no text layer; they're rejected with a
 * clear message rather than silently indexed as empty (OCR is Phase 2).
 */

export class ExtractionError extends Error {}

export type Extracted = { blocks: TextBlock[]; pages: number | null; headingMode: HeadingMode };

type PdfItem = { str: string; x: number; y: number; width: number; height: number; fontSize: number; hasEOL: boolean };

/** Rebuilds visual lines from positioned PDF text items, so a datasheet row like "Rated flow ... 250 m³/h" stays on one line. */
function itemsToText(items: PdfItem[]): string {
  const rows: { y: number; items: PdfItem[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const tolerance = Math.max(2, (item.fontSize || item.height || 10) * 0.4);
    const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  // PDF y grows upward → top of the page first.
  rows.sort((a, b) => b.y - a.y);

  const lines: string[] = [];
  let previousY: number | null = null;
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let lastEnd: number | null = null;
    for (const item of row.items) {
      if (lastEnd !== null) {
        const gap = item.x - lastEnd;
        const size = item.fontSize || 10;
        // Wide gap = separate table column; small gap = next word.
        line += gap > size * 1.5 ? '   ' : gap > size * 0.1 ? ' ' : '';
      }
      line += item.str;
      lastEnd = item.x + item.width;
    }
    // A large vertical jump is a paragraph break.
    const lineHeight = row.items[0]?.fontSize || 10;
    if (previousY !== null && previousY - row.y > lineHeight * 2.2) lines.push('');
    lines.push(line.trim());
    previousY = row.y;
  }
  return lines.join('\n');
}

const PAGE_FOOTER = /^(page\s*)?\d+\s*(of|\/)\s*\d+$/i;

/**
 * Removes running headers/footers — lines repeated on most pages — from
 * pages 2+ (page 1 keeps them, since they usually identify the document),
 * plus "Page X of Y" lines. Otherwise every page yields a near-identical
 * boilerplate chunk that pollutes retrieval.
 */
function stripRunningHeaders(blocks: TextBlock[]): TextBlock[] {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    for (const line of new Set(block.text.split('\n').map((l) => l.trim()).filter(Boolean))) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const repeated = (line: string) => blocks.length >= 3 && (counts.get(line) ?? 0) >= Math.ceil(blocks.length * 0.6);
  return blocks.map((block, i) => ({
    page: block.page,
    text: block.text
      .split('\n')
      .filter((raw) => {
        const line = raw.trim();
        return !PAGE_FOOTER.test(line) && !(i > 0 && repeated(line));
      })
      .join('\n'),
  }));
}

async function extractPdf(buffer: Buffer): Promise<Extracted> {
  const { extractTextItems, getDocumentProxy } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch {
    throw new ExtractionError('This PDF could not be opened. It may be corrupted or password-protected.');
  }
  const { totalPages, items } = await extractTextItems(pdf);
  const blocks = stripRunningHeaders(items.map((pageItems, i) => ({ page: i + 1, text: itemsToText(pageItems as PdfItem[]) })));
  const textChars = blocks.reduce((sum, b) => sum + b.text.replace(/\s/g, '').length, 0);
  if (textChars < 20) {
    throw new ExtractionError(
      'No selectable text was found in this PDF — it looks like a scanned image. OCR for scanned documents is not supported yet.',
    );
  }
  return { blocks, pages: totalPages, headingMode: 'plain' };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** DOCX via mammoth's HTML output (not raw text) so Word headings survive as section names. DOCX has no fixed pages, so page stays null. */
async function extractDocx(buffer: Buffer): Promise<Extracted> {
  const mammoth = await import('mammoth');
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer })).value;
  } catch {
    throw new ExtractionError('This DOCX file could not be read. It may be corrupted or not a real Word document.');
  }
  const text = decodeEntities(
    html
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '')}\n\n`)
      .replace(/<\/(td|th)>/gi, ' | ')
      .replace(/<\/(p|li|tr)>/gi, '\n')
      .replace(/<(table|ul|ol)[^>]*>/gi, '\n')
      .replace(/<\/(table|ul|ol)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
  return { blocks: [{ page: null, text }], pages: null, headingMode: 'markdown' };
}

export async function extractDocument(filename: string, buffer: Buffer): Promise<Extracted> {
  const ext = path.extname(filename).toLowerCase();
  let result: Extracted;
  if (ext === '.pdf') {
    result = await extractPdf(buffer);
  } else if (ext === '.docx') {
    result = await extractDocx(buffer);
  } else if (ext === '.txt' || ext === '.md') {
    // Form feeds are the one page marker plain text has; honor them if present.
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const mode: HeadingMode = ext === '.md' ? 'markdown' : 'plain';
    const pages = text.split('\f');
    result =
      pages.length > 1
        ? { blocks: pages.map((p, i) => ({ page: i + 1, text: p })), pages: pages.length, headingMode: mode }
        : { blocks: [{ page: null, text }], pages: null, headingMode: mode };
  } else {
    throw new ExtractionError(`Unsupported file type "${ext}".`);
  }
  if (!result.blocks.some((b) => b.text.trim().length > 0)) {
    throw new ExtractionError('No readable text was found in this document.');
  }
  return result;
}
