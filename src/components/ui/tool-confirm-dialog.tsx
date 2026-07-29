'use client';

import { useRef, useState } from 'react';
import { useFocusTrap } from '@/lib/ui/use-focus-trap';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import type { PendingToolConfirm } from '@/lib/agents/types';
import { iconSizes } from '@/lib/icons';
import {
  HITL_UI_BUTTONS,
  hitlConfirmSummary,
  hitlConfirmTitle,
  resolveHitlActionKind,
} from '@/lib/ui/natural-copy';

export type HitlUiDecision =
  | { action: 'approve_once' }
  | { action: 'approve_category' }
  | { action: 'deny' }
  | { action: 'answer'; answerText: string }
  | { action: 'cancel' };

interface ToolConfirmDialogProps {
  pending: PendingToolConfirm;
  onDecision: (decision: HitlUiDecision) => void;
  busy?: boolean;
}

export function ToolConfirmDialog({
  pending,
  onDecision,
  busy = false,
}: ToolConfirmDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [answer, setAnswer] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, {
    enabled: true,
    onEscape: () => onDecision({ action: 'cancel' }),
  });
  const kind = resolveHitlActionKind(pending);
  const isQuestion = kind === 'question';
  const isTrust = kind === 'trust';
  const title = hitlConfirmTitle(pending);
  const summary = hitlConfirmSummary(pending);

  return (
    <div
      ref={dialogRef}
      className="border border-amber-500/40 bg-[var(--bg-primary)]/95 p-4 space-y-3 shadow-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hitl-confirm-title"
      data-testid="tool-confirm-dialog"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
          {isQuestion ? (
            <HelpCircle size={iconSizes.lg} className="text-amber-500" aria-hidden />
          ) : (
            <AlertTriangle size={iconSizes.lg} className="text-amber-500" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3
            id="hitl-confirm-title"
            className="text-sm font-semibold font-zh text-[var(--text-primary)]"
          >
            {title}
          </h3>
          <p className="text-xs font-zh text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
            {summary}
          </p>
        </div>
      </div>

      {isQuestion && (
        <div className="space-y-2">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="在此输入你的回答…"
            rows={3}
            disabled={busy}
            aria-label="你的回答"
            className="w-full text-sm font-zh p-2 border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:border-[var(--accent)] resize-y min-h-[72px]"
          />
        </div>
      )}

      {!isQuestion && (
        <>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs font-zh text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1"
            aria-expanded={showDetails}
          >
            {showDetails ? `▼ ${HITL_UI_BUTTONS.hideDetails}` : `▶ ${HITL_UI_BUTTONS.viewDetails}`}
          </button>
          {showDetails && (
            <div
              className="space-y-2 border border-[var(--border-20)] bg-[var(--bg-secondary)] p-3"
              data-testid="hitl-tech-details"
            >
              <p className="text-[10px] font-zh text-[var(--text-muted)]">
                技术详情（仅调试用）
              </p>
              <p className="text-xs font-mono text-[var(--text-secondary)] break-all">
                {pending.toolName}
              </p>
              <pre className="text-xs font-mono text-[var(--text-secondary)] overflow-x-auto max-h-40 overflow-y-auto">
                {JSON.stringify(pending.parameters, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-[var(--border-20)]">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision({ action: 'deny' })}
          className="min-h-[44px] px-3 py-1.5 text-xs font-zh font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-20)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          data-testid="hitl-deny"
        >
          {HITL_UI_BUTTONS.deny}
        </button>
        {!isQuestion && !isTrust && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision({ action: 'approve_category' })}
            className="min-h-[44px] px-3 py-1.5 text-xs font-zh font-medium border border-sky-500/40 text-sky-700 hover:bg-sky-500/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            title="本会话内同类操作自动允许（不写入全局授权）"
            data-testid="hitl-remember-session"
          >
            {HITL_UI_BUTTONS.rememberSession}
          </button>
        )}
        {isQuestion ? (
          <button
            type="button"
            disabled={busy || !answer.trim()}
            onClick={() =>
              onDecision({ action: 'answer', answerText: answer.trim() })
            }
            className="min-h-[44px] px-3 py-1.5 text-xs font-zh font-medium text-white bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            data-testid="hitl-answer"
          >
            {HITL_UI_BUTTONS.submitAnswer}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision({ action: 'approve_once' })}
            className="min-h-[44px] px-3 py-1.5 text-xs font-zh font-medium text-white bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            data-testid="hitl-allow-once"
          >
            {HITL_UI_BUTTONS.allowOnce}
          </button>
        )}
      </div>
      {isTrust && (
        <p className="text-[10px] font-zh text-[var(--text-muted)]">
          允许本机权限不会自动批准全部危险操作；后续敏感步骤仍会单独请你确认。
        </p>
      )}
    </div>
  );
}
