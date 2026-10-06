import { NextRequest } from 'next/server';
import { ingestUpload, listUploads, UploadError } from '@/lib/server/rag/documents';

/**
 * Uploaded engineering documents.
 *   GET  /api/documents          → indexed uploads
 *   POST /api/documents (multipart, field "file") → validate, extract, chunk, embed, index
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ documents: await listUploads() });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Expected a multipart form upload with a "file" field.' } }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Expected a multipart form upload with a "file" field.' } }, { status: 400 });
  }

  try {
    const document = await ingestUpload(file.name, Buffer.from(await file.arrayBuffer()));
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error('[iflchat] Document ingestion failed.', error);
    return Response.json({ error: { code: 'INGESTION_FAILED', message: 'The document could not be indexed. Please try again.' } }, { status: 500 });
  }
}
