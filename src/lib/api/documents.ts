import type { IndexedDocumentSummary } from '../rag-types';
import { ApiError } from './chat';

/** Client for the local document / knowledge-base API routes (same origin, no keys involved). */

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!response.ok || !body) {
    throw new ApiError(response.status, body?.error?.code ?? 'INVALID_RESPONSE', body?.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return body;
}

export async function uploadDocument(file: File): Promise<IndexedDocumentSummary> {
  const form = new FormData();
  form.append('file', file);
  let response: Response;
  try {
    response = await fetch('/api/documents', { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.');
  }
  return (await parse<{ document: IndexedDocumentSummary }>(response)).document;
}

export async function listDocuments(): Promise<IndexedDocumentSummary[]> {
  return (await parse<{ documents: IndexedDocumentSummary[] }>(await fetch('/api/documents'))).documents;
}

export async function deleteDocument(id: string): Promise<void> {
  await parse(await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export type KnowledgeStatus = { knowledge: { documents: IndexedDocumentSummary[]; chunkCount: number } };

/** Also warms up the server: first call indexes the knowledge base and loads the local embedding model. */
export async function getKnowledgeStatus(): Promise<KnowledgeStatus> {
  return parse<KnowledgeStatus>(await fetch('/api/knowledge'));
}
