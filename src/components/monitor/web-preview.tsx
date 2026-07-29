'use client';

import { useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { iconSizes } from '@/lib/icons';

interface WebPreviewProps {
  url: string;
  title?: string;
}

export function WebPreview({ url, title }: WebPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = () => {
    setLoading(false);
    setError(null);
  };

  const handleError = () => {
    setLoading(false);
    setError('无法加载页面');
  };

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
  };

  return (
    <div className="rounded-lg overflow-hidden border border-[var(--border)]">
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0 px-3 py-1 rounded bg-[var(--bg-secondary)] text-xs text-[var(--text-muted)] truncate">
            {url}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={handleRefresh}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-200"
          >
            <RefreshCw size={iconSizes.sm} />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-200"
          >
            <ExternalLink size={iconSizes.sm} />
          </a>
        </div>
      </div>

      <div className="relative bg-[var(--bg-primary)]" style={{ height: '280px' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-secondary)]">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-[var(--text-muted)]">加载中...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-secondary)]">
            <div className="text-center">
              <div className="text-4xl mb-2">🌐</div>
              <div className="text-sm text-[var(--text-secondary)]">{error}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">{url}</div>
            </div>
          </div>
        )}

        <iframe
          src={url}
          className="w-full h-full border-0"
          onLoad={handleLoad}
          onError={handleError}
          sandbox="allow-scripts allow-same-origin"
          title={title || '网页预览'}
        />
      </div>
    </div>
  );
}
