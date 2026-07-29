'use client';

import { useState } from 'react';
import { ERROR_UI, presentRecoverableError } from '@/lib/ui/error-presentation';

/**
 * UX07 — Recoverable error strip: friendly primary + optional tech behind 查看详情.
 * Never appends raw disconnect text to the primary message.
 */
export function RecoverableError({
  err,
  onRetry,
  className = '',
}: {
  err: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { primary, technicalDetail } = presentRecoverableError(err);

  return (
    <div
      className={`border border-[var(--error-border)] bg-[var(--error-bg)] p-3 space-y-2 ${className}`}
      role="alert"
      data-testid="recoverable-error"
    >
      <p className="font-zh text-sm text-[var(--text-primary)]">{primary}</p>
      <div className="flex flex-wrap items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[44px] px-3 py-1.5 text-xs font-zh font-medium border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {ERROR_UI.retry}
          </button>
        )}
        {technicalDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-zh text-[var(--text-muted)] hover:text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1"
            aria-expanded={open}
          >
            {open ? ERROR_UI.hideDetails : ERROR_UI.viewDetails}
          </button>
        )}
      </div>
      {open && technicalDetail && (
        <pre className="text-[11px] font-mono text-[var(--text-muted)] overflow-x-auto max-h-28 p-2 bg-[var(--bg-primary)]/60 border border-[var(--border-20)]">
          {technicalDetail}
        </pre>
      )}
    </div>
  );
}
