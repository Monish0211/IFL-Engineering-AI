import { marked } from 'marked';
import { sanitizeHtml } from './sanitize-html';

/**
 * Ported verbatim (logic-for-logic) from the NeoChat AI reference pen.
 * `getStableRendering` is used while a response is still streaming: if the
 * text so far has an odd number of ``` fences, the last one is still open,
 * so it's artificially closed before parsing — otherwise the in-progress
 * code block would render as plain text with stray backticks until the
 * closing fence actually arrives.
 */
export function getStableRendering(text: string): string {
  const parts = text.split('```');
  let html: string;
  if (parts.length % 2 === 1) {
    html = marked.parse(text, { async: false }) as string;
  } else {
    const closedPart = parts.slice(0, parts.length - 1).join('```');
    const openPart = parts[parts.length - 1];
    html =
      (marked.parse(closedPart, { async: false }) as string) +
      (marked.parse('```' + openPart + '\n```', { async: false }) as string);
  }
  return sanitizeHtml(html);
}

export type MarkdownSegment = { type: 'text'; content: string } | { type: 'code'; language: string; content: string };

/** Splits a finished message into plain-text/code segments so each code block can get its own <pre><code> + copy button, exactly like the reference pen's `addFormattedMessageToUI`. */
export function processMarkdownContent(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let currentPos = 0;
  const codeBlockRegex = /```([\w]*)\n([\s\S]*?)\n```/g;

  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > currentPos) {
      segments.push({ type: 'text', content: content.substring(currentPos, match.index) });
    }
    segments.push({ type: 'code', language: match[1] || 'plaintext', content: match[2] ?? '' });
    currentPos = match.index + match[0].length;
  }

  if (currentPos < content.length) {
    segments.push({ type: 'text', content: content.substring(currentPos) });
  }

  return segments;
}

export function renderMarkdown(content: string): string {
  return sanitizeHtml(marked.parse(content, { async: false }) as string);
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (m) => map[m] ?? m);
}
