'use client';

import { useEffect, useRef, useState } from 'react';
import { BookIcon, CommentIcon, DocumentIcon, MoonIcon, MoreVerticalIcon, PlusIcon, RobotIcon, SunIcon, TrashIcon } from '@/components/icons';
import { sortedConversationIds, type ChatHistory } from '@/lib/chat-data';
import type { IndexedDocumentSummary } from '@/lib/rag-types';
import cssModule from '@/app/chat/chat.module.css';

const styles = cssModule as Record<string, string>;

type ChatSidebarProps = {
  history: ChatHistory;
  currentChatId: string | null;
  theme: 'light' | 'dark';
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onClearHistory: () => void;
  onToggleTheme: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  documents: IndexedDocumentSummary[];
  /** null while the knowledge base is still loading/indexing. */
  knowledgeArticleCount: number | null;
  onDeleteDocument: (doc: IndexedDocumentSummary) => void;
};

export function ChatSidebar({
  history,
  currentChatId,
  theme,
  onSelectChat,
  onNewChat,
  onClearHistory,
  onToggleTheme,
  onDeleteChat,
  onRenameChat,
  documents,
  knowledgeArticleCount,
  onDeleteDocument,
}: ChatSidebarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuId(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuId]);

  return (
    <div className={styles.sidebar}>
      <div className={styles.logo}>
        <RobotIcon />
        <span>IFL Engineering AI</span>
      </div>

      <button type="button" className={styles.newChatBtn} onClick={onNewChat}>
        <PlusIcon />
        <span>New Chat</span>
      </button>

      <div className={styles.historyContainer}>
        <h3>Chat History</h3>
        {sortedConversationIds(history).map((chatId) => {
          const chat = history[chatId];
          if (!chat) return null;
          return (
            <div
              key={chatId}
              className={`${styles.chatHistoryItem} ${chatId === currentChatId ? styles.active : ''}`}
              onClick={() => onSelectChat(chatId)}
            >
              <CommentIcon />
              <span>{chat.title}</span>
              <button
                type="button"
                className={styles.chatOptionsButton}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId((v) => (v === chatId ? null : chatId));
                }}
                aria-label="Chat options"
              >
                <MoreVerticalIcon />
              </button>
              {openMenuId === chatId && (
                <div className={styles.chatOptionsMenu} ref={menuRef} onClick={(e) => e.stopPropagation()}>
                  <div
                    className={styles.chatOptionsItem}
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this chat?')) onDeleteChat(chatId);
                      setOpenMenuId(null);
                    }}
                  >
                    Delete
                  </div>
                  <div
                    className={styles.chatOptionsItem}
                    onClick={() => {
                      const newName = prompt('Enter new name for this chat:', chat.title);
                      if (newName) onRenameChat(chatId, newName);
                      setOpenMenuId(null);
                    }}
                  >
                    Rename
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.knowledgePanel}>
        <h3>Knowledge</h3>
        <div className={styles.knowledgeBase} title="Curated general engineering knowledge (knowledge/ folder)">
          <BookIcon />
          <span>
            Engineering Knowledge Base
            <small>{knowledgeArticleCount === null ? 'Indexing…' : `${knowledgeArticleCount} articles`}</small>
          </span>
        </div>
        {documents.length === 0 ? (
          <p className={styles.knowledgeHint}>Attach a PDF, DOCX or TXT with the paperclip to ask questions about it.</p>
        ) : (
          documents.map((doc) => (
            <div key={doc.id} className={styles.documentItem} title={doc.filename}>
              <DocumentIcon />
              <span>
                {doc.filename}
                <small>{[doc.pages ? `${doc.pages} pages` : null, `${doc.chunkCount} passage${doc.chunkCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small>
              </span>
              <button type="button" aria-label={`Remove ${doc.filename}`} title="Remove document" onClick={() => onDeleteDocument(doc)}>
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>

      <div className={styles.settings}>
        <button type="button" onClick={onClearHistory}>
          <TrashIcon />
          <span>Clear History</span>
        </button>
        <button type="button" onClick={onToggleTheme}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      </div>
    </div>
  );
}
