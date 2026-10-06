# IFL Engineering AI Assistant (IFLCHAT)

A standalone Next.js app: the IFLCHAT chat UI plus an **Engineering
Knowledge / RAG layer**. It answers:

1. General engineering questions — from a curated, local **Engineering Knowledge Base** (`knowledge/`).
2. Questions about **uploaded engineering documents** (PDF, DOCX, TXT) — with **document/page citations**.
3. Normal conversation — with no retrieval and no citations when nothing relevant is found.

Everything except the language model runs locally: embeddings, vector
search and document parsing. The language model is called only from the
server, through a **primary** provider with an automatic **fallback** provider.

```
User
 ↓
IFL Engineering AI            (chat UI, browser)
 ↓
Engineering RAG               (/api/chat on the server: local retrieval over knowledge/ + uploaded documents,
 ↓                             engineering system prompt + numbered sources)
Primary Provider              (AI_PRIMARY_PROVIDER: openrouter by default, or gemini)
 ↓  only if unavailable before the answer starts
Fallback Provider             (the other one)
 ↓
Streamed answer + Sources / citations in the UI
```

## Quick start (fresh clone)

Requirements: **Node.js 22 or newer** (required by `unpdf`; tested on Node 24)
and internet access for the first run.

```bash
git clone https://github.com/<your-account>/<repository-name>.git
cd IFLCHAT-template
npm install
```

(`cd` into whatever folder name the clone created.)

### Create `.env.local`

Copy the template and fill in your keys:

```bash
cp .env.example .env.local
```

(Windows Command Prompt: `copy .env.example .env.local`; PowerShell and Git Bash accept `cp`.)

Intended demo configuration — **Gemini answers first, OpenRouter is the backup**:

```
AI_PRIMARY_PROVIDER=gemini
GEMINI_API_KEY=<your Google AI Studio key>
GEMINI_MODEL=gemini-3.5-flash
OPENROUTER_API_KEY=<your OpenRouter key>
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

- Get a Gemini key at <https://aistudio.google.com/apikey> and an OpenRouter key at <https://openrouter.ai/keys>.
- The key of the **primary** provider is required; the other key is optional but enables the fallback.
- **Never commit `.env.local`** (it is git-ignored). Keys are read only on the server and never reach the browser.

### Run

Development (hot reload):

```bash
npm run dev
```

Presentation / production-style:

```bash
npm run build
npm run start
```

Then open <http://localhost:3000/chat> (`/` redirects to `/chat`). Port 3000
must be free — stop any other `npm run dev` first.

**First run:** the server downloads the local embedding model
(`Xenova/bge-small-en-v1.5`, ~34 MB, one time, into `.cache/models/` — needs
internet) and builds the knowledge index from the committed `knowledge/`
folder into `data/index/` (a few seconds). This happens automatically when the
chat page is first opened; no setup script is needed. Opening `/chat` once
before a demo makes the first answer fast.

## Demo script

1. Ask **"What is an ITP?"**, **"What is the difference between WPS and PQR?"**, **"What is MTO?"** →
   answers cite *Engineering Knowledge — QA/QC — …* / *— Procurement — …*.
2. Click the paperclip and attach `samples/Pump_Datasheet_P-101.pdf` (synthetic, 4 pages).
3. Ask **"What is the design pressure?"** (→ Page 2), **"What is the rated flow?"** (→ Page 2),
   **"What material is specified?"** (→ Page 3).
4. Also available: `samples/P-101_Scope_of_Supply.docx` and `samples/P-101_Vendor_Clarifications.txt`.
   Regenerate the samples with `npm run samples`.

All sample documents are **synthetic** — every value is fictional. Uploaded
documents are stored only on the machine running the app (`data/`), so after
a fresh clone you upload the samples again.

Free AI models may log prompts (including passages from uploaded documents) —
use only non-confidential documents with free models.

## Configuration (`.env.local`)

Every variable the source code reads:

| Variable | Default | Purpose |
|---|---|---|
| `AI_PRIMARY_PROVIDER` | `openrouter` | Which provider answers first: `openrouter` or `gemini`. The other is the fallback. |
| `GEMINI_API_KEY` | — | Google Gemini API key. Required when Gemini is primary; enables Gemini as fallback otherwise. Server-only. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Gemini model code (see <https://ai.google.dev/gemini-api/docs/models>). |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.5-flash-lite,gemini-3.1-flash-lite` | Comma-separated Gemini models tried next when `GEMINI_MODEL` is out of quota or overloaded (free-tier quota is per model). |
| `OPENROUTER_API_KEY` | — | OpenRouter API key. Required when OpenRouter is primary; enables OpenRouter as fallback otherwise. Server-only. |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter model id. Free (`:free`) models change over time — check <https://openrouter.ai/models?q=free>. |
| `EMBEDDING_MODEL` | `Xenova/bge-small-en-v1.5` | Local embedding model. Changing it triggers a full re-index automatically. |
| `IFLCHAT_DATA_DIR` | `./data` | Where the vector index and uploaded documents are stored. |
| `RAG_STRONG_SIMILARITY` / `RAG_WEAK_SIMILARITY` | `0.62` / `0.56` | Retrieval relevance gates. |

`OPENROUTER_BASE_URL` and `GEMINI_BASE_URL` also exist, for local testing
against mock servers only — leave them unset.

Without the primary provider's key the app still starts and shows a clean
"AI chat is not configured yet" message.

## AI providers and fallback

The primary provider is always tried first. The fallback provider is called
only if the primary is **unavailable before the answer starts streaming**:
HTTP 402 (credits / limit), 429 (rate limit / quota), 408/502/503/504, an
in-stream "overloaded" error before the first token, no token within 30 s
(OpenRouter), or a network failure. Within Gemini, an out-of-quota or
overloaded model first hands over to the next model in
`GEMINI_FALLBACK_MODELS`.

There is no fallback for a bad request (400), an invalid key/model
(401/403/404), a missing primary key, or when the user presses Stop.
Providers are tried one at a time and never switched mid-answer. Both receive
the same engineering prompt and retrieved sources and stream in the same
format, so citations and the UI work identically. When the fallback answers,
the UI shows a small notice above the answer (e.g. *"Gemini rate/quota limit
reached — switched to backup AI (OpenRouter)."*).

## What is (and isn't) in the Git repository

| In Git | Not in Git (git-ignored, created locally) |
|---|---|
| Source code, `knowledge/`, `samples/`, `scripts/`, `.env.example`, `package-lock.json` | `.env.local` (your keys), `node_modules/`, `.next/`, `.cache/` (embedding model), `data/` (vector index + uploaded documents), `*.tsbuildinfo` |

- The knowledge index is generated locally from the committed `knowledge/` content.
- Uploaded documents are local to the running instance and are never committed to GitHub.
- `data/` and `.cache/` are safe to delete; they are rebuilt automatically (uploads would need re-uploading).
- `.gitattributes` marks `*.pdf` and `*.docx` as binary so sample files are not altered by line-ending conversion.

## How it works

| Stage | Where | What happens |
|---|---|---|
| Extract | `src/lib/server/rag/extract.ts` | PDF via `unpdf` (pdf.js) **per page**, rebuilding table rows from text positions and stripping running headers/footers; DOCX via `mammoth` (headings kept as sections); TXT/MD as-is. Scanned PDFs are rejected with a clear message (no OCR yet). |
| Chunk | `chunker.ts` | ~900-char chunks with overlap, never crossing a page boundary; each chunk keeps its page and nearest heading (section). |
| Embed | `embeddings.ts` | `Xenova/bge-small-en-v1.5` (384-dim) via `@huggingface/transformers` on ONNX Runtime (CPU). No API key. |
| Store | `vector-store.ts` | One JSON file per collection in `data/index/` (embeddings as base64 Float32), loaded in memory, brute-force cosine search. No database. |
| Retrieve | `retrieval.ts` | Cosine similarity **plus** IDF-weighted keyword coverage (for acronyms like ITP/WPS/MTO). Relevance gates drop weak matches; uploads and knowledge are ranked separately so a project document isn't crowded out by a general article. Greetings/small talk skip retrieval. |
| Prompt | `prompt.ts` | Engineering system prompt (don't invent values/standards/clauses, state uncertainty, verify against project specs, plain-text/Markdown formatting) + numbered sources, or an explicit "no sources — don't cite" instruction. |
| Generate | `src/lib/server/ai/` | `chat-provider.ts` picks primary/fallback; `gemini-provider.ts` (official `@google/genai` SDK) and `openrouter-provider.ts` both stream OpenAI-style SSE. |
| Cite | `app/api/chat/route.ts`, `lib/chat-data.ts` | The route sends a `data: {"type":"iflchat.sources",…}` event (and an `iflchat.provider` event) before the answer stream. The UI shows the sources the answer cites with `[n]`; never sources it wasn't given, never invented pages. |

### API routes

| Route | Purpose |
|---|---|
| `POST /api/chat` | Chat completion (SSE). Request: `{ messages: [{ role, content }] }`. |
| `GET /api/documents` · `POST /api/documents` (multipart `file`) · `DELETE /api/documents/:id` | Uploaded document management. Max 20 MB; `.pdf .docx .txt .md`; file signatures checked. |
| `GET /api/knowledge` | Syncs/indexes the knowledge base; returns stats. |
| `POST /api/knowledge` `{ query }` | Retrieval preview — which passages/sources a question retrieves, with scores. Never calls the language model. |

## Engineering Knowledge Base

`knowledge/<category>/*.md` — see `knowledge/README.md` for content rules
(original, general content only; no copyrighted standards or proprietary
documents). Adding or editing a file is picked up automatically within
~30 seconds; only changed files are re-embedded.

## Security notes

- `GEMINI_API_KEY` / `OPENROUTER_API_KEY` are read only in `src/lib/server/ai/*-provider.ts` and never reach
  the browser; no `NEXT_PUBLIC_` variables are used. Server logs contain only provider names and HTTP statuses.
- All AI/markdown HTML is sanitized with DOMPurify before rendering.
- **There is no authentication.** Uploaded documents are shared by everyone
  who can reach the server. Run it on localhost / a trusted network only,
  or add auth before exposing it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | `next dev` — development server with hot reload (port 3000). |
| `npm run build` | `next build` — production build into `.next/`. |
| `npm run start` | `next start` — serves the production build (port 3000; `npm run start -- -p 3005` for another port). |
| `npm run samples` | Regenerates the synthetic files in `samples/`. |

## File map

```
knowledge/                     curated Engineering Knowledge Base (markdown)
samples/                       synthetic demo documents (+ scripts/generate-sample-docs.mjs)
src/app/api/chat/route.ts      retrieval + sources/provider events + provider stream
src/lib/server/ai/…            provider selection, Gemini and OpenRouter providers
src/app/api/documents/…        upload / list / delete
src/app/api/knowledge/route.ts knowledge stats + retrieval preview
src/app/chat/page.tsx          the chat app (state, streaming, uploads, citations, fallback notice)
src/components/chat/…          sidebar (incl. knowledge panel), input, message rendering (incl. sources)
src/lib/server/config.ts       RAG settings
src/lib/server/rag/…           extract, chunk, embed, vector store, knowledge sync, retrieval, prompt
src/lib/rag-types.ts           types shared by server and browser
```
