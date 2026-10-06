'use client';

import { useEffect, useRef, useState } from 'react';
import { PaperclipIcon, SendIcon } from '@/components/icons';
import { buildFileAttachmentHtml, INDEXABLE_EXTENSIONS, isIndexableDocument, readFileAsAttachment, type ChatFileAttachment } from '@/lib/chat-data';
import cssModule from '@/app/chat/chat.module.css';

const styles = cssModule as Record<string, string>;

type ChatInputProps = {
  disabled: boolean;
  onSend: (message: string, file: ChatFileAttachment | null) => void;
};

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [pendingFile, setPendingFile] = useState<ChatFileAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [value]);

  async function handleFileChange(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    // Engineering documents are uploaded and indexed server-side on send, not read into the browser.
    if (isIndexableDocument(file.name)) {
      setPendingFile({ name: file.name, type: file.type, content: '', upload: file });
      return;
    }
    try {
      setPendingFile(await readFileAsAttachment(file));
    } catch {
      setPendingFile(null);
    }
  }

  function handleSend() {
    if (disabled) return;
    const message = value.trim();
    if (!message && !pendingFile) return;
    onSend(message, pendingFile);
    setValue('');
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className={styles.inputArea}>
      <div className={styles.inputContainer}>
        <button type="button" className={styles.fileUploadButton} title="Attach an engineering document (PDF, DOCX, TXT)" onClick={() => fileInputRef.current?.click()}>
          <PaperclipIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={[...INDEXABLE_EXTENSIONS, 'image/*', '.json'].join(',')}
          style={{ display: 'none' }}
          onChange={(e) => void handleFileChange(e.target.files)}
        />
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder="Ask an engineering question, or attach a document..."
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button type="button" className={styles.sendButton} title="Send message" disabled={disabled} onClick={handleSend}>
          <SendIcon />
        </button>
      </div>

      {pendingFile &&
        (pendingFile.upload ? (
          <div className={`${styles.pendingFilePreview} ${styles.pendingDocument}`}>
            <span>
              <strong>{pendingFile.name}</strong> will be indexed as a project document when you send.
            </span>
            <button
              type="button"
              onClick={() => {
                setPendingFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className={styles.pendingFilePreview}>
            <div dangerouslySetInnerHTML={{ __html: buildFileAttachmentHtml(pendingFile, true) }} />
          </div>
        ))}

      <div className={styles.disclaimer}>
        AI answers may be inaccurate. Verify engineering decisions against the governing project specification and approved documents. Chats
        are stored locally.
      </div>
    </div>
  );
}

export function SuggestionChips({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = ['What is an ITP?', 'What is the difference between WPS and PQR?', 'What is MTO?', 'Explain NPSH for centrifugal pumps'];
  return (
    <div className={styles.suggestionChips}>
      {suggestions.map((s) => (
        <button key={s} type="button" className={styles.suggestionChip} onClick={() => onPick(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}
