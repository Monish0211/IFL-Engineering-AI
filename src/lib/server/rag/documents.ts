import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IndexedDocumentSummary } from '@/lib/rag-types';
import { indexPaths, uploadConfig } from '../config';
import { chunkBlocks, embeddingText } from './chunker';
import { embedPassages } from './embeddings';
import { extractDocument, ExtractionError } from './extract';
import { getStores } from './stores';
import type { StoredChunk, StoredDocument } from './vector-store';

/**
 * Uploaded-document ingestion:
 *   validate → extract text (per page) → chunk → embed locally → store
 *   vectors + metadata → searchable immediately.
 */

export class UploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Keeps the original name for display/citations, minus anything path-like or control characters. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  return (cleaned || 'document').slice(0, 150);
}

function checkSignature(ext: string, buffer: Buffer): void {
  if (ext === '.pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new UploadError('INVALID_FILE', 'This file has a .pdf extension but is not a valid PDF.');
  }
  // DOCX is a ZIP container.
  if (ext === '.docx' && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    throw new UploadError('INVALID_FILE', 'This file has a .docx extension but is not a valid Word document.');
  }
  if ((ext === '.txt' || ext === '.md') && buffer.subarray(0, 8192).includes(0)) {
    throw new UploadError('INVALID_FILE', 'This text file appears to contain binary data.');
  }
}

export function toSummary(doc: StoredDocument): IndexedDocumentSummary {
  return {
    id: doc.id,
    kind: doc.kind,
    filename: doc.filename,
    title: doc.title,
    category: doc.category,
    pages: doc.pages,
    chunkCount: doc.chunkCount,
    sizeBytes: doc.sizeBytes,
    createdAt: doc.createdAt,
  };
}

export async function ingestUpload(originalName: string, buffer: Buffer): Promise<IndexedDocumentSummary> {
  const filename = sanitizeFilename(originalName);
  const ext = path.extname(filename).toLowerCase();
  if (!(uploadConfig.allowedExtensions as readonly string[]).includes(ext)) {
    throw new UploadError('UNSUPPORTED_TYPE', `Unsupported file type. Upload one of: ${uploadConfig.allowedExtensions.join(', ')}.`, 415);
  }
  if (buffer.byteLength === 0) throw new UploadError('EMPTY_FILE', 'The file is empty.');
  if (buffer.byteLength > uploadConfig.maxBytes) {
    throw new UploadError('FILE_TOO_LARGE', `File is larger than the ${uploadConfig.maxBytes / 1024 / 1024} MB limit.`, 413);
  }
  checkSignature(ext, buffer);

  let extracted;
  try {
    extracted = await extractDocument(filename, buffer);
  } catch (error) {
    if (error instanceof ExtractionError) throw new UploadError('EXTRACTION_FAILED', error.message, 422);
    throw error;
  }

  const pieces = chunkBlocks(extracted.blocks, extracted.headingMode);
  if (pieces.length === 0) throw new UploadError('NO_TEXT', 'No readable text was found in this document.', 422);
  if (pieces.length > uploadConfig.maxChunksPerDocument) {
    throw new UploadError('DOCUMENT_TOO_LARGE', 'This document is too large to index in the local demo store.', 413);
  }

  const title = path.basename(filename, ext);
  const vectors = await embedPassages(pieces.map((p) => embeddingText(title, p.section, p.content)));

  const id = `doc_${randomUUID()}`;
  const storedFile = `${id}${ext}`;
  await fs.mkdir(indexPaths.uploadedFiles, { recursive: true });
  await fs.writeFile(path.join(indexPaths.uploadedFiles, storedFile), buffer);

  const document: StoredDocument = {
    id,
    kind: 'upload',
    filename,
    title,
    category: null,
    pages: extracted.pages,
    chunkCount: pieces.length,
    sizeBytes: buffer.byteLength,
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    createdAt: new Date().toISOString(),
    storedFile,
  };
  const chunks: StoredChunk[] = pieces.map((p, i) => ({
    id: `${id}#${i}`,
    documentId: id,
    kind: 'upload',
    filename,
    title,
    category: null,
    page: p.page,
    section: p.section,
    chunkIndex: i,
    content: p.content,
    embedding: vectors[i]!,
  }));

  const { uploads } = await getStores();
  await uploads.upsert(document, chunks);
  return toSummary(document);
}

export async function listUploads(): Promise<IndexedDocumentSummary[]> {
  const { uploads } = await getStores();
  return uploads
    .listDocuments()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toSummary);
}

export async function deleteUpload(id: string): Promise<boolean> {
  const { uploads } = await getStores();
  const doc = uploads.getDocument(id);
  if (!doc) return false;
  await uploads.remove(id);
  if (doc.storedFile) {
    await fs.rm(path.join(indexPaths.uploadedFiles, path.basename(doc.storedFile)), { force: true });
  }
  return true;
}
