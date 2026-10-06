import { NextRequest } from 'next/server';
import { PROVIDER_EVENT_TYPE, SOURCES_EVENT_TYPE, type ProviderEvent, type RagSource } from '@/lib/rag-types';
import { isChatConfigured, startChatStream } from '@/lib/server/ai/chat-provider';
import { buildSystemPrompt } from '@/lib/server/rag/prompt';
import { retrieve, type RetrievalResult } from '@/lib/server/rag/retrieval';

/**
 * Streams chat completions from the AI provider layer (lib/server/ai):
 * a primary provider (OpenRouter by default, or Gemini via
 * AI_PRIMARY_PROVIDER) and the other one as a fallback when the primary is
 * unavailable (limit, rate limit, outage) before an answer starts. API keys are read only inside the server-side
 * provider modules and never reach the browser.
 *
 * Engineering RAG (Phase 1): before calling the provider, the latest user
 * question is run through local retrieval (lib/server/rag). Relevant
 * knowledge-base / uploaded-document passages are added to the system
 * prompt as numbered sources — the same prompt goes to whichever provider
 * answers. The response is the provider's OpenAI-style SSE stream, passed
 * through unchanged — preceded by one extra
 * `data: {"type":"iflchat.sources",...}` event so the UI can show
 * citations. Clients that don't know that event simply ignore it (it has
 * no `choices`), so the stream stays OpenAI-compatible.
 *
 * If retrieval itself fails (e.g. the embedding model can't load), chat
 * degrades to plain, uncited answers rather than failing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_CHARS = 20_000;
type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

function isValidMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 200 &&
    value.every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        ['system', 'user', 'assistant'].includes((m as { role?: unknown }).role as string) &&
        typeof (m as { content?: unknown }).content === 'string' &&
        (m as { content: string }).content.length <= MAX_CONTENT_CHARS,
    )
  );
}

function lastUserMessages(messages: ChatMessage[]): { question: string | null; previous: string | undefined } {
  const users = messages.filter((m) => m.role === 'user').map((m) => m.content.trim());
  return { question: users[users.length - 1] ?? null, previous: users[users.length - 2] };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' } }, { status: 400 });
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!isValidMessages(messages)) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: `Body must be { messages: { role, content }[] } (1-200 items, each at most ${MAX_CONTENT_CHARS} characters).`,
        },
      },
      { status: 400 },
    );
  }

  if (!isChatConfigured()) {
    return Response.json(
      { error: { code: 'CHAT_NOT_CONFIGURED', message: 'AI chat is not configured yet. Set OPENROUTER_API_KEY to enable it.' } },
      { status: 503 },
    );
  }

  let retrieval: RetrievalResult | null = null;
  const { question, previous } = lastUserMessages(messages);
  if (question) {
    try {
      retrieval = await retrieve(question, previous);
    } catch (error) {
      console.error('[iflchat] Retrieval failed; answering without engineering context.', error);
    }
  }
  const sources: RagSource[] = retrieval?.sources ?? [];

  // One provider request at a time: OpenRouter, then Gemini only if OpenRouter is unavailable before streaming.
  const result = await startChatStream(
    [{ role: 'system', content: buildSystemPrompt(retrieval) }, ...messages],
    request.signal,
  );

  if (!result.ok) {
    // The browser already went away (Stop / navigation); nobody reads this.
    if (result.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }

  const providerEvent: ProviderEvent = {
    provider: result.provider,
    ...(result.fallbackFrom && result.fallbackReason ? { fallback: { from: result.fallbackFrom, reason: result.fallbackReason } } : {}),
  };
  const upstreamReader = result.stream.getReader();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: SOURCES_EVENT_TYPE, sources })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: PROVIDER_EVENT_TYPE, ...providerEvent })}\n\n`));
    },
    async pull(controller) {
      try {
        const { done, value } = await upstreamReader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      // Client pressed Stop / navigated away — stop pulling from OpenRouter too.
      await upstreamReader.cancel(reason).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
