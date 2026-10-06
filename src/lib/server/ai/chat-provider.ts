import { geminiProvider } from './gemini-provider';
import { openRouterProvider } from './openrouter-provider';
import type { FallbackReason } from '@/lib/rag-types';
import type { ChatProvider, ChatTurn, ProviderName } from './types';

/**
 * Primary/fallback selection: the primary provider (AI_PRIMARY_PROVIDER —
 * OpenRouter by default, or Gemini) first; the other one only if the primary
 * is *unavailable* (limit/quota, rate limit, temporary outage, network)
 * BEFORE any answer has started streaming.
 *
 * - Strictly sequential: at most one provider request is in flight.
 * - Once a provider returns a stream it owns the answer; a later mid-stream
 *   failure is never retried on the other provider (no duplicated text).
 * - No fallback for a missing primary-provider key, a rejected request
 *   (400/401/403/404…), or user cancellation.
 *
 * Logs contain only provider names and HTTP statuses — never keys.
 */

export type ChatStreamOutcome =
  | { ok: true; provider: ProviderName; stream: ReadableStream<Uint8Array>; fallbackFrom?: ProviderName; fallbackReason?: FallbackReason }
  | { ok: false; aborted: true }
  | { ok: false; aborted?: false; status: number; code: string; message: string };

const UPSTREAM_ERROR = { status: 503, code: 'CHAT_UPSTREAM_ERROR', message: 'The AI provider returned an error. Please try again.' } as const;
const UNREACHABLE = { status: 503, code: 'CHAT_UPSTREAM_ERROR', message: 'Could not reach the AI provider. Please try again.' } as const;
const ALL_UNAVAILABLE = {
  status: 503,
  code: 'CHAT_PROVIDERS_UNAVAILABLE',
  message: 'AI service temporarily unavailable. The primary and backup AI providers could not answer right now. Please try again later.',
} as const;

function fallbackReason(status?: number): FallbackReason {
  return status === 402 ? 'credits' : status === 429 ? 'rate-limit' : 'unavailable';
}

function describe(status?: number): string {
  return status ? `HTTP ${status}` : 'network error';
}

const PROVIDERS: Record<ProviderName, ChatProvider> = { openrouter: openRouterProvider, gemini: geminiProvider };
const LABELS: Record<ProviderName, string> = { openrouter: 'OpenRouter', gemini: 'Gemini' };
const KEY_VARS: Record<ProviderName, string> = { openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY' };

/** AI_PRIMARY_PROVIDER=gemini answers with Gemini first and falls back to OpenRouter; default is OpenRouter first. */
function providerOrder(): [ProviderName, ProviderName] {
  return process.env.AI_PRIMARY_PROVIDER?.trim().toLowerCase() === 'gemini' ? ['gemini', 'openrouter'] : ['openrouter', 'gemini'];
}

export function isChatConfigured(): boolean {
  return PROVIDERS[providerOrder()[0]].isConfigured();
}

export async function startChatStream(turns: ChatTurn[], signal: AbortSignal): Promise<ChatStreamOutcome> {
  const [primaryName, backupName] = providerOrder();
  const primaryProvider = PROVIDERS[primaryName];
  const backupProvider = PROVIDERS[backupName];
  const [primaryLabel, backupLabel] = [LABELS[primaryName], LABELS[backupName]];

  if (!primaryProvider.isConfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'CHAT_NOT_CONFIGURED',
      message: `AI chat is not configured yet. Set ${KEY_VARS[primaryName]} to enable it.`,
    };
  }

  const primary = await primaryProvider.start(turns, signal);
  if (primary.ok) return { ok: true, provider: primaryName, stream: primary.stream };
  if (primary.reason === 'aborted') return { ok: false, aborted: true };
  if (primary.reason !== 'unavailable') {
    console.warn(`[iflchat] ${primaryLabel} request failed (${describe(primary.status)}); not eligible for fallback.`);
    return { ok: false, ...UPSTREAM_ERROR };
  }

  if (!backupProvider.isConfigured()) {
    console.warn(`[iflchat] ${primaryLabel} unavailable (${describe(primary.status)}); no fallback provider configured.`);
    return { ok: false, ...(primary.status ? UPSTREAM_ERROR : UNREACHABLE) };
  }

  console.warn(`[iflchat] ${primaryLabel} unavailable (${describe(primary.status)}); falling back to ${backupLabel}.`);
  const fallback = await backupProvider.start(turns, signal);
  if (fallback.ok) {
    return { ok: true, provider: backupName, stream: fallback.stream, fallbackFrom: primaryName, fallbackReason: fallbackReason(primary.status) };
  }
  if (fallback.reason === 'aborted') return { ok: false, aborted: true };

  console.warn(`[iflchat] ${backupLabel} fallback failed (${describe(fallback.status)}).`);
  return { ok: false, ...ALL_UNAVAILABLE };
}
