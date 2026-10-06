import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SourceKind } from '@/lib/rag-types';
import { embeddingConfig } from '../config';

/**
 * A deliberately small, dependency-free vector store: one JSON file per
 * collection, fully loaded into memory, searched by brute-force dot
 * product. For a local demo (hundreds to low thousands of chunks) that's
 * a few milliseconds per query and needs no database server, native
 * module, or extra process. Embeddings are stored as base64 Float32 to
 * keep the file compact.
 *
 * If the corpus grows past ~50k chunks, swap this module for LanceDB or
 * sqlite-vec behind the same interface.
 */

export type StoredDocument = {
  id: string;
  kind: SourceKind;
  filename: string;
  title: string;
  category: string | null;
  pages: number | null;
  chunkCount: number;
  sizeBytes: number | null;
  contentHash: string;
  createdAt: string;
  /** Uploaded originals only — path relative to the data dir. */
  storedFile?: string;
};

export type StoredChunk = {
  id: string;
  documentId: string;
  kind: SourceKind;
  filename: string;
  title: string;
  category: string | null;
  page: number | null;
  section: string | null;
  chunkIndex: number;
  content: string;
  embedding: Float32Array;
};

type SerializedChunk = Omit<StoredChunk, 'embedding'> & { embedding: string };

type CollectionFile = {
  version: 1;
  embeddingModel: string;
  documents: StoredDocument[];
  chunks: SerializedChunk[];
};

function encode(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
}

function decode(value: string): Float32Array {
  const buf = Buffer.from(value, 'base64');
  const copy = new Uint8Array(buf); // aligned copy for the Float32 view
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

export class VectorCollection {
  private documents = new Map<string, StoredDocument>();
  private chunks: StoredChunk[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string) {}

  static async open(filePath: string): Promise<VectorCollection> {
    const collection = new VectorCollection(filePath);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as CollectionFile;
      // An index built with a different embedding model is meaningless — start clean and let it be rebuilt.
      if (raw.version === 1 && raw.embeddingModel === embeddingConfig.model) {
        for (const doc of raw.documents) collection.documents.set(doc.id, doc);
        collection.chunks = raw.chunks.map((c) => ({ ...c, embedding: decode(c.embedding) }));
      }
    } catch {
      // Missing or unreadable file → empty collection.
    }
    return collection;
  }

  listDocuments(): StoredDocument[] {
    return [...this.documents.values()];
  }

  getDocument(id: string): StoredDocument | undefined {
    return this.documents.get(id);
  }

  allChunks(): readonly StoredChunk[] {
    return this.chunks;
  }

  /** Replaces any existing document with the same id, then persists. */
  async upsert(document: StoredDocument, chunks: StoredChunk[]): Promise<void> {
    this.chunks = this.chunks.filter((c) => c.documentId !== document.id).concat(chunks);
    this.documents.set(document.id, document);
    await this.save();
  }

  async remove(documentId: string): Promise<boolean> {
    if (!this.documents.delete(documentId)) return false;
    this.chunks = this.chunks.filter((c) => c.documentId !== documentId);
    await this.save();
    return true;
  }

  /** Batch variant for the knowledge-base sync — one write instead of one per file. */
  async replaceMany(removeIds: string[], add: { document: StoredDocument; chunks: StoredChunk[] }[]): Promise<void> {
    const drop = new Set([...removeIds, ...add.map((a) => a.document.id)]);
    this.chunks = this.chunks.filter((c) => !drop.has(c.documentId));
    for (const id of removeIds) this.documents.delete(id);
    for (const { document, chunks } of add) {
      this.documents.set(document.id, document);
      this.chunks.push(...chunks);
    }
    await this.save();
  }

  /** Serialized, atomic (write temp file + rename) so a crash mid-write never leaves a truncated index. */
  private save(): Promise<void> {
    const snapshot: CollectionFile = {
      version: 1,
      embeddingModel: embeddingConfig.model,
      documents: this.listDocuments(),
      chunks: this.chunks.map((c) => ({ ...c, embedding: encode(c.embedding) })),
    };
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot));
      await fs.rename(tmp, this.filePath);
    });
    return this.writeQueue;
  }
}
