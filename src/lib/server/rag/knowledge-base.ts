import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../config';
import { chunkBlocks, embeddingText } from './chunker';
import { embedPassages } from './embeddings';
import { getStores } from './stores';
import type { StoredChunk, StoredDocument } from './vector-store';

/**
 * Keeps the curated Engineering Knowledge Base (`knowledge/<category>/*.md`)
 * in sync with its vector index. Runs lazily on the first chat/knowledge
 * request after server start; only new or edited files are re-embedded
 * (content-hash comparison), so it's near-instant after the first run.
 *
 * Each markdown file may start with simple frontmatter:
 *   ---
 *   title: Inspection and Test Plan (ITP)
 *   ---
 */

/** Bump when chunking logic changes, to force a re-index of unchanged files. */
const CHUNKER_VERSION = '2';

type Frontmatter = { title?: string };

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta: Frontmatter = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv && kv[1] === 'title') meta.title = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: raw.slice(match[0].length) };
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name.toLowerCase() !== 'readme.md') files.push(full);
  }
  return files;
}

async function buildKnowledgeDocument(file: string, raw: string, hash: string) {
  const relative = path.relative(paths.knowledgeDir, file).split(path.sep).join('/');
  const category = relative.includes('/') ? relative.split('/')[0]! : null;
  const { meta, body } = parseFrontmatter(raw);
  const title = meta.title || path.basename(file, '.md').replace(/[-_]/g, ' ');
  const id = `kb:${relative}`;

  // Drop the document's own H1 so it doesn't become every chunk's "section".
  const cleaned = body.replace(/^#\s+.+\r?\n/, '');
  const pieces = chunkBlocks([{ page: null, text: cleaned }], 'markdown');
  const vectors = await embedPassages(pieces.map((p) => embeddingText(title, p.section, p.content)));

  const document: StoredDocument = {
    id,
    kind: 'knowledge',
    filename: relative,
    title,
    category,
    pages: null,
    chunkCount: pieces.length,
    sizeBytes: Buffer.byteLength(raw),
    contentHash: hash,
    createdAt: new Date().toISOString(),
  };
  const chunks: StoredChunk[] = pieces.map((p, i) => ({
    id: `${id}#${i}`,
    documentId: id,
    kind: 'knowledge',
    filename: relative,
    title,
    category,
    page: null,
    section: p.section,
    chunkIndex: i,
    content: p.content,
    embedding: vectors[i]!,
  }));
  return { document, chunks };
}

async function syncKnowledgeBase(): Promise<{ added: number; removed: number; total: number }> {
  const { knowledge } = await getStores();
  const files = await listMarkdownFiles(paths.knowledgeDir);

  const seen = new Set<string>();
  const changed: { document: StoredDocument; chunks: StoredChunk[] }[] = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const hash = createHash('sha256').update(CHUNKER_VERSION).update(raw).digest('hex');
    const id = `kb:${path.relative(paths.knowledgeDir, file).split(path.sep).join('/')}`;
    seen.add(id);
    if (knowledge.getDocument(id)?.contentHash === hash) continue;
    changed.push(await buildKnowledgeDocument(file, raw, hash));
  }
  const removed = knowledge.listDocuments().filter((d) => !seen.has(d.id)).map((d) => d.id);

  if (changed.length || removed.length) await knowledge.replaceMany(removed, changed);
  return { added: changed.length, removed: removed.length, total: seen.size };
}

const globalCache = globalThis as unknown as { __iflchatKbSync?: Promise<unknown>; __iflchatKbSyncedAt?: number };

/** Re-checks the folder at most every 30s, and never runs two syncs at once. */
export async function ensureKnowledgeIndexed(): Promise<void> {
  const fresh = globalCache.__iflchatKbSyncedAt && Date.now() - globalCache.__iflchatKbSyncedAt < 30_000;
  if (fresh) return;
  if (!globalCache.__iflchatKbSync) {
    globalCache.__iflchatKbSync = syncKnowledgeBase()
      .then((result) => {
        globalCache.__iflchatKbSyncedAt = Date.now();
        if (result.added || result.removed) {
          console.log(`[iflchat] Knowledge base indexed: ${result.added} updated, ${result.removed} removed, ${result.total} total.`);
        }
      })
      .finally(() => {
        globalCache.__iflchatKbSync = undefined;
      });
  }
  await globalCache.__iflchatKbSync;
}
