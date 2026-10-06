import { categoryLabel, type RagSource } from '@/lib/rag-types';
import { retrievalConfig } from '../config';
import { dot, embedQuery } from './embeddings';
import { ensureKnowledgeIndexed } from './knowledge-base';
import { getStores } from './stores';
import type { StoredChunk } from './vector-store';

/**
 * Hybrid retrieval over both collections (curated knowledge + uploads):
 *
 *   question → local query embedding → cosine similarity on every chunk
 *            + keyword coverage (IDF-weighted, whole-word) for exact
 *              engineering terms and acronyms embeddings handle poorly
 *            → relevance gates → top chunks → grouped into citable sources
 *
 * If nothing clears the gates, the result is empty: the chat route then
 * sends no context and the model is told there are no sources to cite.
 */

export type RetrievedChunk = { chunk: StoredChunk; similarity: number; keywordCoverage: number; score: number };
export type RetrievalResult = { chunks: RetrievedChunk[]; sources: RagSource[]; sourceChunks: Map<number, RetrievedChunk[]> };

const EMPTY: RetrievalResult = { chunks: [], sources: [], sourceChunks: new Map() };

const SMALL_TALK =
  /^(hi|hii+|hello|hey|yo|thanks|thank you|thx|ok|okay|cool|great|nice|bye|goodbye|good (morning|afternoon|evening|night)|how are you|who are you|what('s| is) your name|what can you do|help)\b[\s\w]{0,12}[!.?,\s]*$/i;

const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our please ' +
    'should so tell than that the their them then there these they this to us was we what when where which who why will with would you your ' +
    'explain describe define meaning mean means difference between differences compare vs versus about give list show find any some specified ' +
    'value values document documents doc per according'
  ).split(' '),
);

function queryTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9&\-/]*[a-z0-9]|[a-z0-9]/g) ?? [];
  return [...new Set(terms.filter((t) => t.length >= 2 && !STOPWORDS.has(t)))];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSmallTalk(query: string): boolean {
  const q = query.trim();
  return q.length < 3 || SMALL_TALK.test(q);
}

/** Scores every chunk (no gating) — best first. Also used by the /api/knowledge preview to show near-misses when tuning thresholds. */
export async function scoreAllChunks(query: string): Promise<RetrievedChunk[]> {
  await ensureKnowledgeIndexed();
  const { knowledge, uploads } = await getStores();
  const all = [...knowledge.allChunks(), ...uploads.allChunks()];
  if (all.length === 0) return [];

  const queryVector = await embedQuery(query);
  const terms = queryTerms(query);
  const patterns = terms.map((t) => new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}s?([^a-z0-9]|$)`, 'i'));
  const haystacks = all.map((c) => `${c.title}\n${c.section ?? ''}\n${c.content}`);

  // IDF weights so a rare term ("PQR") counts for more than a common one ("pump").
  const idf = patterns.map((p) => {
    const df = haystacks.reduce((n, h) => n + (p.test(h) ? 1 : 0), 0);
    return Math.log(1 + all.length / (1 + df));
  });
  const idfTotal = idf.reduce((a, b) => a + b, 0);

  const scored = all.map((chunk, i) => {
    const similarity = dot(queryVector, chunk.embedding);
    let matched = 0;
    patterns.forEach((p, j) => {
      if (p.test(haystacks[i]!)) matched += idf[j]!;
    });
    const keywordCoverage = idfTotal > 0 ? matched / idfTotal : 0;
    return { chunk, similarity, keywordCoverage, score: similarity + 0.15 * keywordCoverage };
  });
  return scored.sort((a, b) => b.score - a.score);
}

function passesGates(r: RetrievedChunk): boolean {
  return (
    r.similarity >= retrievalConfig.strongSimilarity ||
    (r.similarity >= retrievalConfig.weakSimilarity && r.keywordCoverage >= retrievalConfig.minKeywordCoverage)
  );
}

/** Gated, best-first selection within one collection, limited in chunks and in distinct documents. */
function selectFrom(scored: RetrievedChunk[], maxChunks: number, maxDocuments: number): RetrievedChunk[] {
  const passing = scored.filter(passesGates);
  const best = passing[0]?.score ?? 0;
  const perDocument = new Map<string, number>();
  const selected: RetrievedChunk[] = [];
  for (const r of passing) {
    if (best - r.score > retrievalConfig.maxScoreGapFromBest) break;
    const count = perDocument.get(r.chunk.documentId) ?? 0;
    if (count >= retrievalConfig.maxChunksPerDocument) continue;
    if (count === 0 && perDocument.size >= maxDocuments) continue;
    perDocument.set(r.chunk.documentId, count + 1);
    selected.push(r);
    if (selected.length >= maxChunks) break;
  }
  return selected;
}

/**
 * Uploaded documents and the curated knowledge base are ranked
 * separately, then merged with uploads first: a strongly-matching general
 * article ("design pressure" in Pressure Terminology) must not crowd out
 * the user's own datasheet row that actually answers the question.
 */
async function search(query: string): Promise<RetrievedChunk[]> {
  const scored = await scoreAllChunks(query);
  const fromUploads = selectFrom(
    scored.filter((r) => r.chunk.kind === 'upload'),
    retrievalConfig.maxChunks,
    retrievalConfig.maxUploadDocuments,
  );
  const fromKnowledge = selectFrom(
    scored.filter((r) => r.chunk.kind === 'knowledge'),
    retrievalConfig.maxChunks,
    retrievalConfig.maxKnowledgeDocuments,
  );

  const selected: RetrievedChunk[] = [];
  let contextChars = 0;
  for (const r of [...fromUploads, ...fromKnowledge]) {
    if (contextChars + r.chunk.content.length > retrievalConfig.maxContextChars) continue;
    contextChars += r.chunk.content.length;
    selected.push(r);
    if (selected.length >= retrievalConfig.maxChunks) break;
  }
  return selected;
}

function sourceLabel(chunk: StoredChunk): string {
  if (chunk.kind === 'knowledge') return `Engineering Knowledge — ${categoryLabel(chunk.category)} — ${chunk.title}`;
  return chunk.page !== null ? `${chunk.filename} — Page ${chunk.page}` : chunk.filename;
}

/** One citation per (document, page) — several chunks from the same page share a number. */
function groupIntoSources(chunks: RetrievedChunk[]): Pick<RetrievalResult, 'sources' | 'sourceChunks'> {
  const sources: RagSource[] = [];
  const sourceChunks = new Map<number, RetrievedChunk[]>();
  const keyToN = new Map<string, number>();
  for (const r of chunks) {
    const key = `${r.chunk.documentId}|${r.chunk.page ?? ''}`;
    let n = keyToN.get(key);
    if (n === undefined) {
      n = sources.length + 1;
      keyToN.set(key, n);
      sources.push({
        n,
        kind: r.chunk.kind,
        label: sourceLabel(r.chunk),
        documentId: r.chunk.documentId,
        title: r.chunk.title,
        filename: r.chunk.filename,
        category: r.chunk.category,
        page: r.chunk.page,
        sections: [],
      });
      sourceChunks.set(n, []);
    }
    const source = sources[n - 1]!;
    if (r.chunk.section && !source.sections.includes(r.chunk.section)) source.sections.push(r.chunk.section);
    sourceChunks.get(n)!.push(r);
  }
  for (const list of sourceChunks.values()) list.sort((a, b) => a.chunk.chunkIndex - b.chunk.chunkIndex);
  return { sources, sourceChunks };
}

/**
 * @param question the latest user message
 * @param previousQuestion the user message before it — only used as a fallback for short follow-ups ("and its material?") that retrieve nothing on their own
 */
export async function retrieve(question: string, previousQuestion?: string): Promise<RetrievalResult> {
  if (isSmallTalk(question)) return EMPTY;
  let chunks = await search(question);
  if (chunks.length === 0 && previousQuestion && question.trim().split(/\s+/).length <= 6 && !isSmallTalk(previousQuestion)) {
    chunks = await search(`${previousQuestion}\n${question}`);
  }
  if (chunks.length === 0) return EMPTY;
  return { chunks, ...groupIntoSources(chunks) };
}
