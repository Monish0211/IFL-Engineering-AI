import { embeddingConfig, paths } from '../config';

/**
 * Local embeddings via transformers.js (ONNX Runtime, CPU). No API key and
 * no network call per request — the model is downloaded once from the
 * Hugging Face hub into `.cache/models/` and loaded from disk after that.
 *
 * The pipeline is cached on `globalThis` so Next.js dev-mode hot reloads
 * don't load a second copy of the model.
 */

type Extractor = (
  texts: string | string[],
  options: { pooling: 'cls' | 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

const globalCache = globalThis as unknown as { __iflchatExtractor?: Promise<Extractor> };

async function loadExtractor(): Promise<Extractor> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = paths.modelCacheDir;
  env.allowLocalModels = true;
  const extractor = await pipeline('feature-extraction', embeddingConfig.model, { dtype: 'q8' });
  return extractor as unknown as Extractor;
}

function getExtractor(): Promise<Extractor> {
  if (!globalCache.__iflchatExtractor) {
    globalCache.__iflchatExtractor = loadExtractor().catch((error: unknown) => {
      // Don't cache a failed load (e.g. first-run download interrupted) — retry next time.
      globalCache.__iflchatExtractor = undefined;
      throw error;
    });
  }
  return globalCache.__iflchatExtractor;
}

/** BGE models are trained with CLS pooling; sentence-transformers models (e.g. all-MiniLM) with mean pooling. */
function pooling(): 'cls' | 'mean' {
  return /bge/i.test(embeddingConfig.model) ? 'cls' : 'mean';
}

/** Embeds passages (document chunks). Returns unit-length vectors, so cosine similarity is a plain dot product. */
export async function embedPassages(texts: string[]): Promise<Float32Array[]> {
  const extractor = await getExtractor();
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += embeddingConfig.batchSize) {
    const batch = texts.slice(i, i + embeddingConfig.batchSize);
    const result = await extractor(batch, { pooling: pooling(), normalize: true });
    for (const vector of result.tolist()) out.push(Float32Array.from(vector));
  }
  return out;
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const prefix = /bge/i.test(embeddingConfig.model) ? embeddingConfig.queryPrefix : '';
  const result = await extractor(prefix + text, { pooling: pooling(), normalize: true });
  return Float32Array.from(result.tolist()[0] ?? []);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}
