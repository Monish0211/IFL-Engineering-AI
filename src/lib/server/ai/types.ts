/**
 * Server-only AI provider contract.
 *
 * Every provider receives the SAME chat turns — the engineering system
 * prompt (with the retrieved RAG context and numbered sources) followed by
 * the conversation — and, on success, returns an SSE byte stream in the
 * OpenAI-compatible shape the browser already parses:
 *
 *   data: {"choices":[{"delta":{"content":"..."}}]}\n\n   …   data: [DONE]\n\n
 *
 * so neither the RAG layer nor the frontend knows which provider answered.
 * API keys live only inside the provider modules and are never returned.
 */

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };

export type ProviderName = 'openrouter' | 'gemini';

export type ProviderFailure = {
  ok: false;
  /**
   * - unavailable: limit/quota exhausted, rate-limited, or a temporary availability/network
   *   failure — the only kind that allows falling back to another provider.
   * - rejected: the provider refused the request itself (bad request, invalid key/model…) — no fallback.
   * - aborted: the user pressed Stop / left — no fallback.
   * - not-configured: no API key for this provider.
   */
  reason: 'unavailable' | 'rejected' | 'aborted' | 'not-configured';
  /** HTTP status when there was one (safe to log; never contains secrets). */
  status?: number;
};

export type ProviderResult = { ok: true; stream: ReadableStream<Uint8Array> } | ProviderFailure;

export interface ChatProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  /** Starts ONE streaming request. Resolves once a usable stream exists or the attempt has definitively failed. */
  start(turns: ChatTurn[], signal: AbortSignal): Promise<ProviderResult>;
}
