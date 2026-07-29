'use client';

import { Copy, Check, Download } from 'lucide-react';
import { useState } from 'react';
import { iconSizes } from '@/lib/icons';

interface CodePreviewProps {
  code: string;
  language?: string;
  title?: string;
}

export function CodePreview({ code, language = 'text', title }: CodePreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title || 'code.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const highlightCode = (code: string, language: string) => {
    if (language === 'bash' || language === 'shell') {
      return code.split('\n').map((line) => {
        if (line.startsWith('#')) {
          return `<span class="text-green-400">${escapeHtml(line)}</span>`;
        }
        if (line.startsWith('$')) {
          return `<span class="text-[var(--accent)]">${escapeHtml(line)}</span>`;
        }
        return escapeHtml(line);
      }).join('\n');
    }
    return escapeHtml(code);
  };

  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  return (
    <div className="rounded-lg overflow-hidden border border-[var(--border)]">
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--code-header-bg)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="font-tech text-xs text-[var(--accent)] uppercase">
            {language}
          </span>
          {title && (
            <span className="font-tech text-xs text-[var(--text-muted)]">
              {title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-200"
            aria-label="Download file"
            title="下载"
          >
            <Download size={iconSizes.sm} aria-hidden />
          </button>
          <button
            onClick={handleCopy}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-200"
            aria-label={copied ? 'Copied' : 'Copy to clipboard'}
            title="复制"
          >
            {copied ? <Check size={iconSizes.sm} className="text-[var(--success)]" aria-hidden /> : <Copy size={iconSizes.sm} aria-hidden />}
          </button>
        </div>
      </div>

      <div className="p-4 bg-[var(--code-bg)] overflow-x-auto">
        <pre className="font-tech text-sm text-[var(--code-text)]">
          <code dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }} />
        </pre>
      </div>
    </div>
  );
}
