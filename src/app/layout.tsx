import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IFL Engineering AI Assistant',
  description: 'Engineering AI assistant with a curated knowledge base and document Q&A (RAG).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
