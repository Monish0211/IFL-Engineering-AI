import type { ChatProvider, ChatTurn, ProviderResult } from './types';

/**
 * Google Gemini (fallback provider) via Google's official Gen AI SDK
 * (`@google/genai`). Configured with GEMINI_API_KEY + GEMINI_MODEL.
 *
 * Receives exactly the same turns as OpenRouter: system turns (the
 * engineering prompt + RAG context) become Gemini's `systemInstruction`,
 * user/assistant turns become `user`/`model` contents. Gemini's streamed
 * chunks are re-emitted in the OpenAI-style SSE shape the browser parses.
 *
 * The first chunk is awaited before the stream is handed back, so quota /
 * model / request errors that surface on the first read are still reported
 * as a clean failure (JSON error), not as a half-started answer.
 */

// A stable Gemini Flash model at the time of writing; override with GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-3.5-flash';
// Tried in order after GEMINI_MODEL when it is out of quota / overloaded; override with GEMINI_FALLBACK_MODELS (comma-separated).
const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
// The SDK timeout also covers reading the streamed body, so it must exceed the longest answer.
const REQUEST_TIMEOUT_MS = 300_000;

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || undefined;
}

function geminiModels(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const configured = process.env.GEMINI_FALLBACK_MODELS?.split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([primary, ...(configured ?? DEFAULT_FALLBACK_MODELS)])];
}

type GeminiContent = { role: 'user' | 'model'; parts: { text: string }[] };

/** Maps chat turns to Gemini's shape, merging consecutive same-role turns (e.g. an upload notice followed by the question). */
function toGemini(turns: ChatTurn[]): { systemInstruction: string; contents: GeminiContent[] } {
  const system: string[] = [];
  const contents: GeminiContent[] = [];
  for (const turn of turns) {
    if (turn.role === 'system') {
      system.push(turn.content);
      continue;
    }
    const role = turn.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0]!.text += `\n\n${turn.content}`;
    else contents.push({ role, parts: [{ text: turn.content }] });
  }
  return { systemInstruction: system.join('\n\n'), contents };
}

function sse(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/** 429 (quota/rate limit) and 408/5xx (temporarily unavailable) may fall through; anything else is a real rejection. */
function classifyStatus(status: number): 'unavailable' | 'rejected' {
  return status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504 ? 'unavailable' : 'rejected';
}

async function classifyError(error: unknown, signal: AbortSignal): Promise<ProviderResult> {
  if (signal.aborted) return { ok: false, reason: 'aborted' };
  const { ApiError } = await import('@google/genai');
  if (error instanceof ApiError) return { ok: false, reason: classifyStatus(error.status), status: error.status };
  return { ok: false, reason: 'unavailable' }; // network/timeout
}

export const geminiProvider: ChatProvider = {
  name: 'gemini',

  isConfigured() {
    return apiKey() !== undefined;
  },

  async start(turns: ChatTurn[], signal: AbortSignal): Promise<ProviderResult> {
    const key = apiKey();
    if (!key) return { ok: false, reason: 'not-configured' };

    const { GoogleGenAI } = await import('@google/genai');
    const baseUrl = process.env.GEMINI_BASE_URL?.trim(); // only for local testing against a mock
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        timeout: REQUEST_TIMEOUT_MS,
        // Gemini models intermittently answer 503 "high demand"; retry the initial request briefly.
        // Only the request that opens the stream is retried, so no text is ever duplicated. 429 (quota) is not retried.
        retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 4, httpStatusCodes: [500, 502, 503, 504] },
        ...(baseUrl ? { baseUrl } : {}),
      },
    });
    const { systemInstruction, contents } = toGemini(turns);

    // Free-tier quota is counted per model, so a model that is out of quota (429) or overloaded (5xx)
    // hands over to the next one — still before any text has streamed.
    let generator: AsyncGenerator<{ text?: string }> | undefined;
    let first: IteratorResult<{ text?: string }> | undefined;
    let failure: ProviderResult = { ok: false, reason: 'unavailable' };
    const models = geminiModels();
    for (const [i, model] of models.entries()) {
      try {
        generator = await ai.models.generateContentStream({
          model,
          contents,
          config: { ...(systemInstruction ? { systemInstruction } : {}), abortSignal: signal },
        });
        first = await generator.next();
        break;
      } catch (error) {
        generator = undefined;
        failure = await classifyError(error, signal);
        if (failure.ok || failure.reason !== 'unavailable' || i === models.length - 1) return failure;
        console.warn(`[iflchat] Gemini model ${model} unavailable (${failure.status ? `HTTP ${failure.status}` : 'network error'}); trying ${models[i + 1]}.`);
      }
    }
    if (!generator || !first) return failure;
    const firstResult = first;
    const activeGenerator = generator;

    const encoder = new TextEncoder();
    let emittedText = false;
    const emit = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: { text?: string }) => {
      const text = chunk.text;
      if (!text) return;
      emittedText = true;
      controller.enqueue(encoder.encode(sse(text)));
    };
    const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (!emittedText) {
        // e.g. the response was blocked by Gemini's safety filters — say so instead of showing nothing.
        controller.enqueue(encoder.encode(sse('The AI provider returned an empty response for this question. Please rephrase it and try again.')));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (firstResult.done) finish(controller);
        else emit(controller, firstResult.value);
      },
      async pull(controller) {
        try {
          const next = await activeGenerator.next();
          if (next.done) finish(controller);
          else emit(controller, next.value);
        } catch (error) {
          // Mid-answer failure: same behavior as an OpenRouter stream breaking — the browser keeps the partial text and shows an error.
          controller.error(error);
        }
      },
      async cancel() {
        await activeGenerator.return(undefined).catch(() => undefined);
      },
    });
    return { ok: true, stream };
  },
};
