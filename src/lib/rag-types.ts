/**
 * Types shared by the server-side RAG layer and the browser. Kept free of
 * any Node-only imports so client components can use them.
 */

export type SourceKind = 'knowledge' | 'upload';

/** One citable source attached to an answer — a knowledge-base article, or one page of an uploaded document. */
export type RagSource = {
  /** Citation number the model was told to use, e.g. [1]. */
  n: number;
  kind: SourceKind;
  /** Human-readable citation, e.g. "Engineering Knowledge — QA/QC — Inspection and Test Plan (ITP)" or "Pump_Datasheet.pdf — Page 3". */
  label: string;
  documentId: string;
  title: string;
  filename: string;
  category: string | null;
  /** Only set when the page is actually known (PDFs). Never guessed. */
  page: number | null;
  sections: string[];
};

export type IndexedDocumentSummary = {
  id: string;
  kind: SourceKind;
  filename: string;
  title: string;
  category: string | null;
  pages: number | null;
  chunkCount: number;
  sizeBytes: number | null;
  createdAt: string;
};

export const KNOWLEDGE_CATEGORY_LABELS: Record<string, string> = {
  'engineering-fundamentals': 'Engineering Fundamentals',
  mechanical: 'Mechanical',
  piping: 'Piping',
  process: 'Process',
  electrical: 'Electrical',
  instrumentation: 'Instrumentation',
  qaqc: 'QA/QC',
  'project-engineering': 'Project Engineering',
  procurement: 'Procurement',
  terminology: 'Terminology',
  calculations: 'Calculations',
};

export function categoryLabel(category: string | null): string {
  if (!category) return 'General';
  return KNOWLEDGE_CATEGORY_LABELS[category] ?? category;
}

/** The SSE event the chat route emits before the model's own stream, carrying the sources given to the model. */
export const SOURCES_EVENT_TYPE = 'iflchat.sources';

/** SSE event (after sources) naming the AI provider that answered — sent so the UI can say when the backup provider was used. Never contains keys. */
export const PROVIDER_EVENT_TYPE = 'iflchat.provider';

export type FallbackReason = 'credits' | 'rate-limit' | 'unavailable';

export type ProviderEvent = {
  provider: 'openrouter' | 'gemini';
  /** Set only when the primary provider could not answer and the backup did. */
  fallback?: { from: 'openrouter' | 'gemini'; reason: FallbackReason };
};

/** User-facing text for a fallback notice. */
export function fallbackNotice(event: ProviderEvent): string | null {
  if (!event.fallback) return null;
  const label = { openrouter: 'OpenRouter', gemini: 'Gemini' } as const;
  const from = label[event.fallback.from];
  const why =
    event.fallback.reason === 'credits'
      ? `${from} credit/usage limit reached`
      : event.fallback.reason === 'rate-limit'
        ? `${from} rate/quota limit reached`
        : `${from} temporarily unavailable`;
  return `${why} — switched to backup AI (${label[event.provider]}).`;
}
