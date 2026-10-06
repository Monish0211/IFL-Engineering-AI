import type { ChatProvider, ChatTurn, ProviderResult } from './types';

/**
 * OpenRouter (primary provider). Same single-key request as before:
 * OPENROUTER_API_KEY + OPENROUTER_MODEL, OpenRouter's own SSE stream passed
 * through unchanged.
 *
 * Failures before the first token come in two shapes, both classified the same way:
 *   - a non-2xx HTTP status, or
 *   - HTTP 200 followed by an in-stream `data: {"error":{"code":503,…}}` event
 *     (e.g. "Upstream error from Nvidia: Service temporarily overloaded").
 * So the stream is read until the first real token (answer or reasoning text)
 * before it is accepted; bytes read meanwhile are replayed, nothing is lost.
 *   unavailable (fallback allowed): 402 credits/limit, 429 rate limit,
 *     408/502/503/504 timeout or provider down, network failure, no token in time
 *   rejected (no fallback): everything else — 400 bad request, 401/403 key
 *     problems, 404 unknown model, other errors
 */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
// Used when OPENROUTER_MODEL is empty. A free model, verified available and streaming on OpenRouter
// on 2026-10-06; free models change over time — check https://openrouter.ai/models?q=free.
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const UNAVAILABLE_STATUSES = new Set([402, 408, 429, 502, 503, 504]);
/** A request that is accepted but produces no token for this long (a stuck free endpoint) counts as unavailable. */
const FIRST_TOKEN_TIMEOUT_MS = 30_000;

function apiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

type FirstEvent = { kind: 'token' } | { kind: 'error'; status: number } | null;

/** Looks at complete SSE lines received so far for the first token or an error event. */
function inspect(text: string): FirstEvent {
  const lines = text.split('\n');
  lines.pop(); // possibly incomplete
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue; // ": OPENROUTER PROCESSING" keep-alives etc.
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return { kind: 'token' };
    try {
      const obj = JSON.parse(payload) as {
        error?: { code?: unknown };
        choices?: { delta?: { content?: string; reasoning?: string } }[];
      };
      if (obj.error) return { kind: 'error', status: Number(obj.error.code) || 0 };
      const delta = obj.choices?.[0]?.delta;
      if (delta?.content || delta?.reasoning) return { kind: 'token' };
    } catch {
      // ignore malformed line
    }
  }
  return null;
}

export const openRouterProvider: ChatProvider = {
  name: 'openrouter',

  isConfigured() {
    return apiKey() !== undefined;
  },

  async start(turns: ChatTurn[], signal: AbortSignal): Promise<ProviderResult> {
    const key = apiKey();
    if (!key) return { ok: false, reason: 'not-configured' };

    const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
    // Only overridable for local testing against an OpenAI-compatible mock.
    const baseUrl = (process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'IFL Engineering AI Assistant',
        },
        body: JSON.stringify({ model, messages: turns, stream: true }),
        signal,
      });
    } catch {
      if (signal.aborted) return { ok: false, reason: 'aborted' };
      return { ok: false, reason: 'unavailable' }; // DNS/connection failure
    }

    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined); // release the error body; never logged
      return { ok: false, reason: UNAVAILABLE_STATUSES.has(response.status) ? 'unavailable' : 'rejected', status: response.status };
    }

    // Wait for the first token (or an in-stream error) before committing to this provider.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const buffered: Uint8Array[] = [];
    let seen = '';
    const deadline = Date.now() + FIRST_TOKEN_TIMEOUT_MS;
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()));
      });
      let chunk: ReadableStreamReadResult<Uint8Array> | 'timeout';
      try {
        chunk = await Promise.race([reader.read(), timeout]);
      } catch {
        clearTimeout(timer);
        if (signal.aborted) return { ok: false, reason: 'aborted' };
        return { ok: false, reason: 'unavailable' };
      }
      clearTimeout(timer);
      if (chunk === 'timeout') {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'unavailable' };
      }
      if (chunk.done) break; // ended without a token — hand over what we have
      buffered.push(chunk.value);
      seen += decoder.decode(chunk.value, { stream: true });
      const first = inspect(seen);
      if (first?.kind === 'token') break;
      if (first?.kind === 'error') {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: UNAVAILABLE_STATUSES.has(first.status) ? 'unavailable' : 'rejected', status: first.status || undefined };
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const bytes of buffered) controller.enqueue(bytes);
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
      },
    });
    return { ok: true, stream };
  },
};
