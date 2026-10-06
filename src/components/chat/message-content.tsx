'use client';

import { useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import 'highlight.js/styles/atom-one-dark.css';

// Core + a deliberately small, common-cases language set — the reference
// pen loads highlight.js's full CDN bundle (every language), which would
// otherwise pull ~300KB into this one route for languages an engineering
// team is unlikely to ever paste.
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('sql', sql);
import { AlertIcon, BookIcon, DocumentIcon } from '@/components/icons';
import { citedSources, type ChatDocumentRef } from '@/lib/chat-data';
import { getStableRendering, processMarkdownContent, renderMarkdown } from '@/lib/chat-markdown';
import type { RagSource } from '@/lib/rag-types';
import cssModule from '@/app/chat/chat.module.css';

// Every class referenced below is genuinely defined in chat.module.css — this cast
// is just to get past `noUncheckedIndexedAccess` treating the CSS Module's index
// signature the same as a plain Record lookup.
const styles = cssModule as Record<string, string>;

/** Roughly matches the reference pen's own icon strokes (icons.tsx's CopyIcon/CheckCircleIcon) — built as raw markup since these buttons are created imperatively (document.createElement), not as JSX. */
const COPY_SVG =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect x="7.5" y="7.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 7.5V4.5a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 10.2l2.3 2.3 4.7-4.9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function attachCopyButton(preElement: HTMLPreElement, codeText: string) {
  const container = document.createElement('div');
  // `HTMLElement.className` (unlike JSX's `className` prop) requires a plain
  // `string`, so the `?? ''` fallback here — never actually undefined at
  // runtime, since every referenced class genuinely exists in the module.
  container.className = styles.codeCopyContainer ?? '';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = styles.codeCopyButton ?? '';
  button.title = 'Copy code';
  button.innerHTML = COPY_SVG;
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(codeText).then(() => {
      button.innerHTML = CHECK_SVG;
      button.classList.add('copied');
      setTimeout(() => {
        button.innerHTML = COPY_SVG;
        button.classList.remove('copied');
      }, 2000);
    });
  });
  container.appendChild(button);
  preElement.appendChild(container);
}

const TYPING_SPEED_MS = 8;

/**
 * The actively-streaming AI message. Renders imperatively via a ref
 * (bypassing React's diffing for this hot path) so the letter-by-letter
 * reveal is cheap — same technique the reference pen uses with direct DOM
 * manipulation, just wrapped so React still owns the surrounding message
 * list. `liveText` is read from a ref, not a prop, so new network chunks
 * arriving doesn't need to re-run this effect; the reveal loop just keeps
 * chasing whatever `liveTextRef.current` currently holds.
 */
export function StreamingMessageContent({ liveTextRef, active }: { liveTextRef: React.MutableRefObject<string>; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const revealedRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    revealedRef.current = 0;
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function tick() {
      if (stopped) return;
      const full = liveTextRef.current;
      if (revealedRef.current < full.length) {
        revealedRef.current += 1;
        if (containerRef.current) {
          containerRef.current.innerHTML = getStableRendering(full.slice(0, revealedRef.current));
        }
      }
      timeoutId = setTimeout(tick, TYPING_SPEED_MS);
    }
    tick();

    return () => {
      stopped = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return <div ref={containerRef} className={styles.messageContent} />;
}

/** A finished AI message — parsed into text/code segments so each code block gets syntax highlighting + its own copy button, exactly like the reference pen's `addFormattedMessageToUI`. */
export function FormattedMessageContent({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    for (const segment of processMarkdownContent(content)) {
      if (segment.type === 'code') {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        // Only tag with a language class hljs actually has registered (see
        // the small language set above) — an unregistered language name
        // would make highlightElement throw instead of just rendering
        // plain, unhighlighted code.
        const knownLanguage = hljs.getLanguage(segment.language) ? segment.language : undefined;
        code.className = knownLanguage ? `language-${knownLanguage} hljs` : 'hljs';
        code.textContent = segment.content;
        pre.appendChild(code);
        attachCopyButton(pre, segment.content);
        container.appendChild(pre);
        hljs.highlightElement(code);
      } else {
        const div = document.createElement('div');
        div.innerHTML = renderMarkdown(segment.content);
        while (div.firstChild) container.appendChild(div.firstChild);
      }
    }
  }, [content]);

  return <div ref={containerRef} className={styles.messageContent} />;
}

/** A plain user message — never markdown-rendered (matches the reference pen: user text is always `textContent`, only AI responses go through `marked`). */
export function UserMessageContent({ content }: { content: string }) {
  return <div className={styles.messageContent}>{content}</div>;
}

/** A user message with a file attachment preview (image data URL or escaped text excerpt) — content is pre-built safe HTML from lib/chat-data.ts's attachment handling. */
export function FileMessageContent({ html }: { html: string }) {
  // eslint-disable-next-line react/no-danger
  return <div className={styles.messageContent} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Small banner above an answer when the primary AI provider was unavailable and the backup answered. */
export function ProviderNotice({ text }: { text: string }) {
  return (
    <div className={styles.providerNotice} role="status">
      <AlertIcon />
      <span>{text}</span>
    </div>
  );
}

/** Upload notice for a document that was indexed for retrieval. Plain JSX text — no HTML injection path. */
export function DocumentMessageContent({ document }: { document: ChatDocumentRef }) {
  const details = [document.pages ? `${document.pages} page${document.pages === 1 ? '' : 's'}` : null, `${document.chunkCount} passage${document.chunkCount === 1 ? '' : 's'} indexed`]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={`${styles.messageContent} ${styles.documentNotice}`}>
      <DocumentIcon />
      <div>
        <div className={styles.documentNoticeName}>{document.filename}</div>
        <div className={styles.documentNoticeMeta}>Added to project documents · {details}</div>
      </div>
    </div>
  );
}

/**
 * The "Sources" list under an answer. Only ever shows sources the server
 * actually retrieved and gave the model (never model-invented ones), and
 * of those only the ones the answer cites — see citedSources().
 */
export function MessageSources({ content, sources }: { content: string; sources: RagSource[] | undefined }) {
  const { list, cited } = citedSources(content, sources);
  if (list.length === 0) return null;
  return (
    <div className={styles.sources}>
      <div className={styles.sourcesTitle}>{cited ? 'Sources' : 'Sources consulted'}</div>
      <ul>
        {list.map((s) => (
          <li key={s.n} title={s.sections.length ? `Section: ${s.sections.join('; ')}` : undefined}>
            <span className={styles.sourceNumber}>[{s.n}]</span>
            {s.kind === 'knowledge' ? <BookIcon /> : <DocumentIcon />}
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
