import { deleteUpload } from '@/lib/server/rag/documents';

/** DELETE /api/documents/:id — removes an uploaded document, its chunks/vectors and its stored original. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!/^doc_[0-9a-f-]{36}$/.test(params.id)) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } }, { status: 404 });
  }
  const removed = await deleteUpload(params.id);
  if (!removed) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } }, { status: 404 });
  }
  return Response.json({ deleted: true });
}
