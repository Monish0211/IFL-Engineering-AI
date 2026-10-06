import { NextRequest } from 'next/server';
import { toSummary } from '@/lib/server/rag/documents';
import { ensureKnowledgeIndexed } from '@/lib/server/rag/knowledge-base';
import { isSmallTalk, retrieve, scoreAllChunks, type RetrievedChunk } from '@/lib/server/rag/retrieval';
import { getStores } from '@/lib/server/rag/stores';

/**
 * GET  /api/knowledge — syncs the curated knowledge base (first call also
 *      warms up the local embedding model) and returns index stats.
 * POST /api/knowledge { query } — retrieval preview: exactly which
 *      passages and sources a question would retrieve, with scores. Handy
 *      for demos and for tuning thresholds; it never calls the LLM.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureKnowledgeIndexed();
  } catch (error) {
    console.error('[iflchat] Knowledge base indexing failed.', error);
    return Response.json(
      { error: { code: 'KNOWLEDGE_INDEX_FAILED', message: 'The knowledge base could not be indexed. Check the server log (first run needs internet access to download the embedding model).' } },
      { status: 503 },
    );
  }
  const { knowledge, uploads } = await getStores();
  return Response.json({
    knowledge: {
      documents: knowledge.listDocuments().map(toSummary).sort((a, b) => a.filename.localeCompare(b.filename)),
      chunkCount: knowledge.allChunks().length,
    },
    uploads: { documentCount: uploads.listDocuments().length, chunkCount: uploads.allChunks().length },
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === 'string' ? body.query.slice(0, 2000) : '';
  if (!query.trim()) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Body must be { query: string }.' } }, { status: 400 });
  }
  const [result, candidates] = await Promise.all([retrieve(query), scoreAllChunks(query)]);
  const describe = (r: RetrievedChunk) => ({
    source: r.chunk.filename,
    page: r.chunk.page,
    section: r.chunk.section,
    similarity: Number(r.similarity.toFixed(3)),
    keywordCoverage: Number(r.keywordCoverage.toFixed(2)),
    preview: r.chunk.content.slice(0, 160),
  });
  return Response.json({
    query,
    smallTalk: isSmallTalk(query),
    sources: result.sources,
    chunks: result.chunks.map(describe),
    /** Top-ranked chunks per collection before relevance gating — shows near-misses. */
    topCandidates: [
      ...candidates.filter((r) => r.chunk.kind === 'upload').slice(0, 4),
      ...candidates.filter((r) => r.chunk.kind === 'knowledge').slice(0, 4),
    ].map(describe),
  });
}
