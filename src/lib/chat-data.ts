/**
 * Local-only chat history — ported from the NeoChat AI reference pen
 * (https://codepen.io/web-strategist/pen/qEBPQVv), same model: every
 * conversation and message lives in the browser's localStorage only, keyed
 * by a generated chat id. There is no backend chat-history storage in this
 * phase — only the AI completion call itself goes through the backend
 * (see lib/api/chat.ts), for the key-security reason documented there.
 */

import type { IndexedDocumentSummary, RagSource } from './rag-types';
import { sanitizeHtml } from './sanitize-html';

export type ChatRole = 'user' | 'assistant';

export type ChatFileAttachment = {
  name: string;
  type: string;
  /** Data URL for images, raw text otherwise — client-side preview only, never uploaded anywhere. */
  content: string;
  /** Set for engineering documents (PDF/DOCX/TXT/MD): the raw file, uploaded to /api/documents for indexing. Never persisted. */
  upload?: File;
};

/** A document that was uploaded and indexed from this conversation. */
export type ChatDocumentRef = Pick<IndexedDocumentSummary, 'id' | 'filename' | 'pages' | 'chunkCount'>;

export type ChatMessage = {
  role: ChatRole;
  content: string;
  file?: ChatFileAttachment;
  /** Assistant messages: the sources that were given to the model for this answer. */
  sources?: RagSource[];
  /** User messages: an upload notice for an indexed document. */
  document?: ChatDocumentRef;
  /** Assistant messages: shown above the answer when the backup AI provider answered. */
  providerNotice?: string;
};

export const INDEXABLE_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

export function isIndexableDocument(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return INDEXABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Which sources to display under an answer: the ones the answer actually
 * cites with [n] markers (only numbers that exist — a hallucinated [7] is
 * ignored). If the model cited none, every source it was given is shown
 * as "consulted" rather than hidden — never anything it wasn't given.
 */
export function citedSources(content: string, sources: RagSource[] | undefined): { list: RagSource[]; cited: boolean } {
  if (!sources?.length) return { list: [], cited: false };
  const valid = new Set(sources.map((s) => s.n));
  const cited = new Set<number>();
  for (const match of content.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)) {
    for (const part of match[1]!.split(',')) {
      const range = part.split(/[–-]/).map((n) => Number(n.trim()));
      const [from, to] = [range[0]!, range[range.length - 1]!];
      for (let n = from; n <= to && n - from < 20; n++) if (valid.has(n)) cited.add(n);
    }
  }
  if (cited.size === 0) return { list: sources, cited: false };
  return { list: sources.filter((s) => cited.has(s.n)), cited: true };
}

export type ChatConversation = {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatMessage[];
};

export type ChatHistory = Record<string, ChatConversation>;

const STORAGE_KEY = 'ife_chat_history';
const THEME_KEY = 'ife_chat_theme';

export function loadChatHistory(): ChatHistory {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatHistory) : {};
  } catch {
    return {};
  }
}

export function saveChatHistory(history: ChatHistory): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage full/unavailable (private window, quota) — the conversation still works for this session, it just won't persist across reloads.
  }
}

export function loadTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function saveTheme(theme: 'light' | 'dark'): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Same as above — non-fatal.
  }
}

export function createConversation(): ChatConversation {
  return {
    id: `chat_${Date.now()}`,
    title: 'New Conversation',
    timestamp: Date.now(),
    messages: [],
  };
}

export function sortedConversationIds(history: ChatHistory): string[] {
  // Non-null: `a`/`b` always come from Object.keys(history) itself, so the lookup can never miss.
  return Object.keys(history).sort((a, b) => history[b]!.timestamp - history[a]!.timestamp);
}

export function titleFromFirstMessage(message: string): string {
  const words = message.split(' ');
  return words.slice(0, 4).join(' ') + (words.length > 4 ? '...' : '');
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (m) => map[m] ?? m);
}

/** Reads a selected file into a `ChatFileAttachment` — images as a data URL (previewable inline), text/JSON as raw text (truncated for the preview), anything else just by name. Client-side only; the file is never uploaded anywhere. */
export function readFileAsAttachment(file: File): Promise<ChatFileAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, content: String(reader.result ?? '') });
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

/**
 * Builds the small safe-HTML preview shown for an attachment, both in the
 * pending-file preview area and once it's sent as a message. Every value
 * here is already either escaped or a browser-generated data: URL (never
 * raw, unescaped user/file content) — still routed through the same
 * `sanitizeHtml` as AI responses (see lib/sanitize-html.ts) for one
 * consistent, defense-in-depth rule: nothing reaches `innerHTML` /
 * `dangerouslySetInnerHTML` in this feature unsanitized, full stop.
 */
export function buildFileAttachmentHtml(file: ChatFileAttachment, truncate = false): string {
  if (file.type.startsWith('image/')) {
    return sanitizeHtml(`<img src="${file.content}" alt="${escapeHtml(file.name)}" style="max-width:100%;max-height:200px;border-radius:8px;" />`);
  }
  if (file.type.startsWith('text/') || file.type === 'application/json') {
    const content = truncate && file.content.length > 200 ? `${file.content.slice(0, 200)}...` : file.content;
    return sanitizeHtml(`<pre style="white-space:pre-wrap;font-size:12px;">${escapeHtml(content)}</pre>`);
  }
  return sanitizeHtml(`<div style="font-size:12px;">${escapeHtml(file.name)}</div>`);
}
