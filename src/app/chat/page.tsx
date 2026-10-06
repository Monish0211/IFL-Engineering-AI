'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { ChatInput, SuggestionChips } from '@/components/chat/chat-input';
import {
  DocumentMessageContent,
  FileMessageContent,
  FormattedMessageContent,
  MessageSources,
  ProviderNotice,
  StreamingMessageContent,
  UserMessageContent,
} from '@/components/chat/message-content';
import { AlertIcon, DownloadIcon, RefreshIcon, StopIcon } from '@/components/icons';
import { ApiError, streamChatCompletion } from '@/lib/api/chat';
import { deleteDocument, getKnowledgeStatus, listDocuments, uploadDocument } from '@/lib/api/documents';
import {
  buildFileAttachmentHtml,
  citedSources,
  createConversation,
  loadChatHistory,
  loadTheme,
  saveChatHistory,
  saveTheme,
  sortedConversationIds,
  titleFromFirstMessage,
  type ChatFileAttachment,
  type ChatHistory,
  type ChatMessage,
} from '@/lib/chat-data';
import { fallbackNotice, type IndexedDocumentSummary, type RagSource } from '@/lib/rag-types';
import cssModule from './chat.module.css';

const styles = cssModule as Record<string, string>;

/**
 * IFLCHAT — standalone template, adapted from the Engineering-Talent-
 * Platform version. What changed to make it drop into any fresh Next.js
 * project:
 * - No auth gate (the original checked a mock session and redirected to
 *   its own login page) — add your own guard here if this project needs
 *   one (e.g. a middleware.ts check, or wrap this page in your auth
 *   provider's server-side check).
 * - No Sidebar/Header/Breadcrumb chrome — this renders as a full-page app
 *   on its own. Drop it into your own layout's content area instead if
 *   you have one.
 * - Calls this project's own `/api/chat` (same origin) instead of a
 *   separate NestJS backend — see app/api/chat/route.ts.
 *
 * Everything else — streaming, markdown/code rendering, local chat
 * history, file attach, dark mode, export — is unchanged.
 *
 * Engineering AI Assistant (Phase 1) additions:
 * - Attaching a PDF/DOCX/TXT uploads it to /api/documents, where it is
 *   indexed locally for retrieval; the conversation gets an upload notice.
 * - Each answer carries the sources the server retrieved for it (from the
 *   stream's leading sources event) and shows the cited ones under it.
 * - The sidebar lists the knowledge base and indexed project documents.
 */
export default function ChatPage() {
  const [history, setHistory] = useState<ChatHistory>({});
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isTyping, setIsTyping] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [, forceRerender] = useState(0);
  const [ready, setReady] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [documents, setDocuments] = useState<IndexedDocumentSummary[]>([]);
  const [knowledgeArticleCount, setKnowledgeArticleCount] = useState<number | null>(null);
  const [liveProviderNotice, setLiveProviderNotice] = useState<string | null>(null);

  const liveTextRef = useRef('');
  const sourcesRef = useRef<RagSource[]>([]);
  const providerNoticeRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = loadChatHistory();
    setHistory(loaded);
    setTheme(loadTheme());

    const ids = sortedConversationIds(loaded);
    const firstId = ids[0];
    if (firstId) {
      setCurrentChatId(firstId);
    } else {
      const fresh = createConversation();
      setHistory({ [fresh.id]: fresh });
      setCurrentChatId(fresh.id);
    }
    setReady(true);

    // Warm up the server-side knowledge index (and local embedding model) and load the document list.
    getKnowledgeStatus()
      .then((status) => setKnowledgeArticleCount(status.knowledge.documents.length))
      .catch(() => setKnowledgeArticleCount(0));
    listDocuments()
      .then(setDocuments)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [history, currentChatId, isTyping, uploadingName]);

  function persist(next: ChatHistory) {
    setHistory(next);
    saveChatHistory(next);
  }

  function handleNewChat() {
    const fresh = createConversation();
    persist({ ...history, [fresh.id]: fresh });
    setCurrentChatId(fresh.id);
    setStreamError(null);
  }

  function handleSelectChat(id: string) {
    setCurrentChatId(id);
    setStreamError(null);
  }

  function handleDeleteChat(id: string) {
    const next = { ...history };
    delete next[id];
    if (currentChatId === id) {
      const fresh = createConversation();
      next[fresh.id] = fresh;
      setCurrentChatId(fresh.id);
    }
    persist(next);
  }

  function handleRenameChat(id: string, newTitle: string) {
    if (!history[id]) return;
    persist({ ...history, [id]: { ...history[id], title: newTitle } });
  }

  function handleClearHistory() {
    if (!confirm('Are you sure you want to clear all chat history? This cannot be undone.')) return;
    const fresh = createConversation();
    persist({ [fresh.id]: fresh });
    setCurrentChatId(fresh.id);
  }

  function handleToggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveTheme(next);
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  const runCompletion = useCallback(
    async (chatId: string, messages: ChatMessage[]) => {
      setStreamError(null);
      setIsTyping(true);
      liveTextRef.current = '';
      sourcesRef.current = [];
      providerNoticeRef.current = null;
      setLiveProviderNotice(null);
      forceRerender((n) => n + 1);

      const controller = new AbortController();
      abortRef.current = controller;

      await streamChatCompletion(
        messages,
        {
          onSources: (sources) => {
            sourcesRef.current = sources;
          },
          onProvider: (event) => {
            providerNoticeRef.current = fallbackNotice(event);
            setLiveProviderNotice(providerNoticeRef.current);
          },
          onDelta: (textSoFar) => {
            liveTextRef.current = textSoFar;
          },
          onDone: (finalText) => {
            setIsTyping(false);
            abortRef.current = null;
            if (!finalText) {
              // Nothing arrived at all (and the user didn't press Stop) — say so instead of leaving the question unanswered.
              if (!controller.signal.aborted) setStreamError('The AI provider returned an empty response. Please try again.');
              return;
            }
            const sources = sourcesRef.current;
            const providerNotice = providerNoticeRef.current;
            setHistory((prev) => {
              const conv = prev[chatId];
              if (!conv) return prev;
              const reply: ChatMessage = {
                role: 'assistant',
                content: finalText,
                ...(sources.length ? { sources } : {}),
                ...(providerNotice ? { providerNotice } : {}),
              };
              const next = { ...prev, [chatId]: { ...conv, messages: [...conv.messages, reply] } };
              saveChatHistory(next);
              return next;
            });
          },
          onError: (error: ApiError) => {
            setIsTyping(false);
            abortRef.current = null;
            setStreamError(error.message);
          },
        },
        controller.signal,
      );
    },
    [],
  );

  async function handleUploadAndSend(message: string, file: File) {
    if (!currentChatId) return;
    const chatId = currentChatId;
    setStreamError(null);
    setUploadingName(file.name);
    let doc: IndexedDocumentSummary;
    try {
      doc = await uploadDocument(file);
    } catch (error) {
      setUploadingName(null);
      setStreamError(`Could not index "${file.name}": ${error instanceof ApiError ? error.message : 'unexpected error.'}`);
      return;
    }
    setUploadingName(null);
    setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);

    const conv = history[chatId] ?? createConversation();
    const notice: ChatMessage = {
      role: 'user',
      content: `[Uploaded project document "${doc.filename}" — indexed for retrieval${doc.pages ? `, ${doc.pages} pages` : ''}]`,
      document: { id: doc.id, filename: doc.filename, pages: doc.pages, chunkCount: doc.chunkCount },
    };
    const messages: ChatMessage[] = [...conv.messages, notice, ...(message ? [{ role: 'user' as const, content: message }] : [])];
    const title = conv.messages.length === 0 ? (message ? titleFromFirstMessage(message) : doc.filename) : conv.title;
    persist({ ...history, [chatId]: { ...conv, messages, title } });

    if (message) void runCompletion(chatId, messages);
  }

  async function handleDeleteDocument(doc: IndexedDocumentSummary) {
    if (!confirm(`Remove "${doc.filename}" from the project documents? It will no longer be used to answer questions.`)) return;
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (error) {
      setStreamError(`Could not remove "${doc.filename}": ${error instanceof ApiError ? error.message : 'unexpected error.'}`);
    }
  }

  function handleSend(message: string, file: ChatFileAttachment | null) {
    if (isTyping || uploadingName || !currentChatId) return;
    if (file?.upload) {
      void handleUploadAndSend(message, file.upload);
      return;
    }
    let conv = history[currentChatId];
    if (!conv) {
      conv = createConversation();
    }

    let messages = conv.messages;
    if (message) {
      messages = [...messages, { role: 'user', content: message }];
    }
    if (file) {
      messages = [...messages, { role: 'user', content: buildFileAttachmentHtml(file), file }];
    }

    const isFirstMessage = conv.messages.length === 0 && message.length > 0;
    const updatedConv = {
      ...conv,
      messages,
      title: isFirstMessage ? titleFromFirstMessage(message) : conv.title,
    };
    persist({ ...history, [currentChatId]: updatedConv });

    void runCompletion(
      currentChatId,
      messages.map((m) => ({ role: m.role, content: m.content })),
    );
  }

  function handleRegenerate() {
    if (!currentChatId || isTyping) return;
    const conv = history[currentChatId];
    if (!conv || conv.messages.length === 0) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'assistant') return;

    const trimmedMessages = conv.messages.slice(0, -1);
    persist({ ...history, [currentChatId]: { ...conv, messages: trimmedMessages } });
    void runCompletion(currentChatId, trimmedMessages);
  }

  function handleExport() {
    const conv = currentChatId ? history[currentChatId] : undefined;
    if (!conv) return;
    let exportText = `# ${conv.title}\n\n`;
    for (const m of conv.messages) {
      exportText += `## ${m.role === 'user' ? 'You' : 'IFL Engineering AI'}:\n${m.content}\n\n`;
      const { list } = citedSources(m.content, m.sources);
      if (list.length) exportText += `Sources:\n${list.map((s) => `- [${s.n}] ${s.label}`).join('\n')}\n\n`;
    }
    const blob = new Blob([exportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[^\w\s]/gi, '')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (!ready) return null;

  const currentConv = currentChatId ? history[currentChatId] : null;
  const lastMessageIsAssistant = currentConv?.messages[currentConv.messages.length - 1]?.role === 'assistant';

  return (
    <div className={`${styles.page} ${theme === 'dark' ? styles.darkMode : ''}`} style={{ height: '100vh' }}>
      <div className={styles.container}>
        <div className={styles.appContainer}>
          <ChatSidebar
            history={history}
            currentChatId={currentChatId}
            theme={theme}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
            onClearHistory={handleClearHistory}
            onToggleTheme={handleToggleTheme}
            onDeleteChat={handleDeleteChat}
            onRenameChat={handleRenameChat}
            documents={documents}
            knowledgeArticleCount={knowledgeArticleCount}
            onDeleteDocument={(doc) => void handleDeleteDocument(doc)}
          />

          <div className={styles.chatContainer}>
            <div className={styles.chatHeader}>
              <div className={styles.currentChatTitle}>{currentConv?.title ?? 'New Conversation'}</div>
              <div className={styles.headerActions}>
                {isTyping ? (
                  <button type="button" title="Stop generating" onClick={handleStop}>
                    <StopIcon />
                  </button>
                ) : (
                  <button type="button" title="Regenerate response" onClick={handleRegenerate} disabled={!lastMessageIsAssistant}>
                    <RefreshIcon />
                  </button>
                )}
                <button type="button" title="Export conversation" onClick={handleExport}>
                  <DownloadIcon />
                </button>
              </div>
            </div>

            <div className={styles.messages}>
              {(!currentConv || currentConv.messages.length === 0) && !isTyping && (
                <div className={styles.introMessage}>
                  <h1>IFL Engineering AI Assistant</h1>
                  <p>
                    Ask engineering questions, or attach a PDF, DOCX or TXT document and ask about it. Answers based on the engineering knowledge base
                    or your documents list their sources.
                  </p>
                  <SuggestionChips onPick={(text) => handleSend(text, null)} />
                </div>
              )}

              {currentConv?.messages.map((m, i) => (
                <div key={i} className={`${styles.message} ${m.role === 'user' ? styles.messageUser : styles.messageAi}`}>
                  {m.role === 'user' ? (
                    m.document ? (
                      <DocumentMessageContent document={m.document} />
                    ) : m.file ? (
                      <FileMessageContent html={m.content} />
                    ) : (
                      <UserMessageContent content={m.content} />
                    )
                  ) : (
                    <div className={styles.aiMessageBody}>
                      {m.providerNotice && <ProviderNotice text={m.providerNotice} />}
                      <FormattedMessageContent content={m.content} />
                      <MessageSources content={m.content} sources={m.sources} />
                    </div>
                  )}
                </div>
              ))}

              {isTyping && (
                <div className={`${styles.message} ${styles.messageAi}`}>
                  <div className={styles.aiMessageBody}>
                    {liveProviderNotice && <ProviderNotice text={liveProviderNotice} />}
                    <StreamingMessageContent liveTextRef={liveTextRef} active={isTyping} />
                  </div>
                </div>
              )}

              {uploadingName && (
                <div className={`${styles.message} ${styles.messageAi}`}>
                  <div className={styles.messageContent}>
                    Indexing <strong>{uploadingName}</strong> — extracting text, chunking and embedding locally…
                  </div>
                </div>
              )}

              {streamError && (
                <div className={`${styles.message} ${styles.messageAi}`}>
                  <div className={styles.messageContent}>
                    <AlertIcon style={{ marginRight: 6, display: 'inline', height: 16, width: 16, color: '#e11d48' }} />
                    Sorry, I encountered an error: {streamError}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <ChatInput disabled={isTyping || uploadingName !== null} onSend={handleSend} />
          </div>
        </div>
      </div>
    </div>
  );
}
