import path from 'node:path';

/**
 * Server-only settings for the Engineering Knowledge / RAG layer. Nothing
 * here is secret — the only secrets in this app (OPENROUTER_API_KEY and
 * GEMINI_API_KEY) are read exclusively inside lib/server/ai/*-provider.ts.
 */

const root = process.cwd();

export const paths = {
  /** Curated, version-controlled Engineering Knowledge Base (markdown). */
  knowledgeDir: path.join(root, 'knowledge'),
  /** Local runtime data — vector index + uploaded originals. Git-ignored. */
  dataDir: process.env.IFLCHAT_DATA_DIR?.trim() || path.join(root, 'data'),
  /** Where the local embedding model is cached after its one-time download. */
  modelCacheDir: path.join(root, '.cache', 'models'),
};

export const indexPaths = {
  knowledge: path.join(paths.dataDir, 'index', 'knowledge.json'),
  uploads: path.join(paths.dataDir, 'index', 'uploads.json'),
  uploadedFiles: path.join(paths.dataDir, 'uploads'),
};

export const embeddingConfig = {
  /** Any ONNX feature-extraction model on the Hugging Face hub works; bge-small is a strong, 384-dim, ~33MB retrieval model. */
  model: process.env.EMBEDDING_MODEL?.trim() || 'Xenova/bge-small-en-v1.5',
  /** BGE models expect this instruction on queries (not on passages) for retrieval. */
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
  batchSize: 16,
};

export const chunkingConfig = {
  targetChars: 900,
  maxChars: 1400,
  overlapChars: 150,
};

/**
 * Retrieval gates — calibrated for bge-small-en-v1.5 cosine scores, where
 * unrelated text typically lands around 0.30–0.54 and a genuinely relevant
 * passage 0.60+. A chunk is only used as context if it clears one of the
 * two gates, so ordinary conversation gets no engineering context and no
 * citations at all.
 */
export const retrievalConfig = {
  /** Accept on meaning alone. */
  strongSimilarity: Number(process.env.RAG_STRONG_SIMILARITY) || 0.62,
  /** Accept a weaker semantic match only when key query terms literally appear in the chunk (acronyms like ITP/WPS/MTO). */
  weakSimilarity: Number(process.env.RAG_WEAK_SIMILARITY) || 0.56,
  minKeywordCoverage: 0.5,
  /** Drop hits far below the best one, so one strong match doesn't drag in loosely related filler. */
  maxScoreGapFromBest: 0.1,
  maxChunks: 6,
  maxChunksPerDocument: 3,
  /** Distinct documents per collection — keeps answers focused instead of citing everything vaguely related. */
  maxUploadDocuments: 3,
  maxKnowledgeDocuments: 2,
  maxContextChars: 9000,
};

export const uploadConfig = {
  maxBytes: 20 * 1024 * 1024,
  maxChunksPerDocument: 3000,
  allowedExtensions: ['.pdf', '.docx', '.txt', '.md'] as const,
};
