import { chunkingConfig } from '../config';

/**
 * Splits extracted text into retrieval-sized chunks while keeping the two
 * pieces of provenance citations depend on:
 *
 * - page: chunks never cross a page boundary, so a chunk's page number is
 *   always exact (null when the format has no pages, e.g. DOCX/TXT).
 * - section: the nearest preceding heading (markdown `#` headings, or
 *   datasheet-style numbered / ALL-CAPS heading lines in PDFs).
 */

export type TextBlock = { page: number | null; text: string };
/** 'markdown': only # headings count (knowledge base, DOCX). 'plain': also infer datasheet-style headings (PDF/TXT). */
export type HeadingMode = 'markdown' | 'plain';
export type Chunk = { page: number | null; section: string | null; content: string };

const MARKDOWN_HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const NUMBERED_HEADING = /^(\d+(\.\d+)*\.?)\s+([A-Z][A-Za-z0-9 &/,()\-–]{2,70})$/;

function detectHeading(line: string, mode: HeadingMode): string | null {
  const md = MARKDOWN_HEADING.exec(line);
  if (md) return md[1]!.trim();
  if (mode === 'markdown' || line.length > 80 || line.includes('|')) return null;
  const letters = line.replace(/[^A-Za-z]/g, '');
  const mostlyUpper = letters.length > 0 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6;
  const numbered = NUMBERED_HEADING.exec(line);
  // "3.2 Design Conditions" / "4. MATERIALS" — but not a numbered sentence like "1. This is a note about…".
  if (numbered && !/\d\s*$/.test(line) && !/[:=]/.test(line) && (mostlyUpper || line.split(/\s+/).length <= 6)) return line.trim();
  if (letters.length >= 4 && letters === letters.toUpperCase() && !/[:=]/.test(line) && line.split(/\s+/).length <= 8) {
    return line.trim();
  }
  return null;
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= chunkingConfig.maxChars) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > chunkingConfig.targetChars) {
      parts.push(current);
      current = '';
    }
    // A single enormous "sentence" (e.g. a table flattened to one line) — hard-split it.
    if (sentence.length > chunkingConfig.maxChars) {
      for (let i = 0; i < sentence.length; i += chunkingConfig.targetChars) parts.push(sentence.slice(i, i + chunkingConfig.targetChars));
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) parts.push(current);
  return parts;
}

function tail(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const slice = text.slice(-chars);
  const firstSpace = slice.indexOf(' ');
  return firstSpace > 0 ? slice.slice(firstSpace + 1) : slice;
}

export function chunkBlocks(blocks: TextBlock[], mode: HeadingMode = 'plain'): Chunk[] {
  const chunks: Chunk[] = [];
  let section: string | null = null;

  for (const block of blocks) {
    // Paragraphs: split on blank lines; within a paragraph, heading lines start a new unit.
    const units: { heading?: string; text?: string }[] = [];
    let para: string[] = [];
    const flush = () => {
      if (para.length) units.push({ text: para.join('\n').trim() });
      para = [];
    };
    for (const rawLine of block.text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        flush();
        continue;
      }
      const heading = detectHeading(line, mode);
      if (heading) {
        flush();
        units.push({ heading });
      } else {
        para.push(line);
      }
    }
    flush();

    let current = '';
    let currentSection = section;
    const emit = () => {
      const content = current.trim();
      if (content.length >= 20) chunks.push({ page: block.page, section: currentSection, content });
      current = '';
    };

    for (const unit of units) {
      if (unit.heading) {
        // A new heading starts a new chunk, so each chunk has one clear section.
        if (current.trim()) emit();
        section = unit.heading;
        currentSection = section;
        continue;
      }
      for (const piece of splitLongParagraph(unit.text ?? '')) {
        if (current && current.length + piece.length + 2 > chunkingConfig.targetChars) {
          const overlap = tail(current, chunkingConfig.overlapChars);
          emit();
          current = overlap;
        }
        current = current ? `${current}\n\n${piece}` : piece;
        currentSection = section;
      }
    }
    if (current.trim()) emit();
  }

  return chunks;
}

/** Text actually embedded for a chunk: a short provenance header helps short chunks (e.g. a datasheet table row) match questions about their topic. */
export function embeddingText(title: string, section: string | null, content: string): string {
  return `${title}${section ? ` — ${section}` : ''}\n${content}`;
}
