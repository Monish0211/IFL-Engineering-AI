import type { ChatMessage } from '../chat-data';
import { PROVIDER_EVENT_TYPE, SOURCES_EVENT_TYPE, type ProviderEvent, type RagSource } from '../rag-types';

/**
 * Calls this project's OWN `/api/chat` route (same origin — see
 * app/api/chat/route.ts), never the AI provider directly. That route
 * holds the API key server-side; this client only ever sees the resulting
 * SSE stream.
 */

/** Thrown for every non-2xx response, and for a request that never reached the server at all (`status` is 0 for that case). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type StreamCallbacks = {
  /** Called once per incoming text chunk (may be more than one character) as it arrives. */
  onDelta: (textSoFar: string) => void;
  onDone: (finalText: string) => void;
  onError: (error: ApiError) => void;
  /** Called once, before any text, with the knowledge-base / document sources the answer was grounded on (empty when none were relevant). */
  onSources?: (sources: RagSource[]) => void;
  /** Called once with the provider that is answering (tells the UI when the backup provider took over). */
  onProvider?: (event: ProviderEvent) => void;
};

/**
 * Streams a chat completion. Parses the `data: {...}\n\n` / `data: [DONE]`
 * SSE shape OpenRouter sends and the API route forwards unchanged, plus
 * the route's own leading `iflchat.sources` event (see app/api/chat/route.ts).
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  { onDelta, onDone, onError, onSources, onProvider }: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal,
    });
  } catch {
    onError(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.'));
    return;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    const parsed = text ? (safeJsonParse(text) as { error?: { code: string; message: string } } | null) : null;
    if (parsed?.error) {
      onError(new ApiError(response.status, parsed.error.code, parsed.error.message));
    } else {
      onError(new ApiError(response.status, 'INVALID_RESPONSE', `Chat request failed with status ${response.status}.`));
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      // Stop button (AbortController) rejects the pending read — keep what already streamed, like a normal finish.
      if (signal?.aborted) break;
      onError(new ApiError(0, 'STREAM_INTERRUPTED', 'The connection was interrupted while the answer was streaming. Please try again.'));
      return;
    }
    const { done, value } = chunk;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice('data: '.length).trim();
      if (jsonStr === '[DONE]') continue;
      const obj = safeJsonParse(jsonStr) as
        | ({ type?: string; sources?: RagSource[]; error?: unknown; choices?: { delta?: { content?: string; reasoning?: string } }[] } & Partial<ProviderEvent>)
        | null;
      if (obj?.type === SOURCES_EVENT_TYPE) {
        onSources?.(Array.isArray(obj.sources) ? obj.sources : []);
        continue;
      }
      if (obj?.type === PROVIDER_EVENT_TYPE) {
        if (obj.provider) onProvider?.({ provider: obj.provider, ...(obj.fallback ? { fallback: obj.fallback } : {}) });
        continue;
      }
      // The provider reported an error inside the stream (e.g. it became overloaded mid-answer) — surface it instead of ending silently.
      if (obj?.error) {
        await reader.cancel().catch(() => undefined);
        onError(new ApiError(0, 'STREAM_ERROR', 'The AI provider stopped responding while answering. Please try again.'));
        return;
      }
      const delta = obj?.choices?.[0]?.delta;
      const text = (delta?.content ?? '') + (delta?.reasoning ?? '');
      if (text) {
        accumulated += text;
        onDelta(accumulated);
      }
    }
  }

  onDone(accumulated);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
