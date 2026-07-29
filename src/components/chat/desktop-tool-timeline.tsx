'use client';

import { useState } from 'react';
import type { DesktopEvent, PendingToolConfirm } from '@/lib/agents/types';
import type { ExecutionStep } from '@/types/agent';
import { ExecutionTimeline } from '@/components/ui/execution-timeline';
import {
  ToolConfirmDialog,
  type HitlUiDecision,
} from '@/components/ui/tool-confirm-dialog';
import { LOADING_COPY } from '@/lib/ui/natural-copy';

/**
 * UX07 — Desktop activity strip.
 * Default: collapsed「正在处理」; expands for confirmation or user request.
 */
export function DesktopToolTimeline({
  events,
  steps,
  pendingConfirm,
  hitlBusy,
  onHitlDecision,
  onCancelTask,
}: {
  events: DesktopEvent[];
  steps: ExecutionStep[];
  pendingConfirm?: PendingToolConfirm | null;
  hitlBusy?: boolean;
  onHitlDecision?: (decision: HitlUiDecision) => void;
  onCancelTask?: () => void;
}) {
  const needsConfirm = Boolean(pendingConfirm && onHitlDecision);
  const [userExpanded, setUserExpanded] = useState(false);

  if (events.length === 0 && steps.length === 0 && !pendingConfirm) return null;

  // Confirm always expands; user toggle only when not forced by HITL.
  const expanded = needsConfirm || userExpanded;
  const hasDetail = events.length > 0 || steps.length > 0;

  return (
    <div
      className="w-full max-w-3xl mx-auto px-4 py-2 space-y-2 border-t border-[var(--border-20)]"
      data-testid="desktop-tool-timeline"
      data-expanded={expanded ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setUserExpanded((v) => !v)}
          className="flex items-center gap-2 font-zh text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1 py-0.5"
          aria-expanded={expanded}
          aria-label={expanded ? '收起处理详情' : '展开处理详情'}
          data-testid="timeline-toggle"
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] motion-safe:animate-pulse"
            aria-hidden
          />
          <span>{LOADING_COPY.processing}</span>
          {hasDetail && !needsConfirm && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {expanded ? '收起' : '展开'}
            </span>
          )}
        </button>
        {onCancelTask && (
          <button
            type="button"
            onClick={onCancelTask}
            className="text-[10px] font-zh px-2 py-0.5 border border-[var(--border-20)] text-[var(--text-muted)] hover:text-[var(--error)] hover:border-[var(--error)]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            取消任务
          </button>
        )}
      </div>

      {pendingConfirm && onHitlDecision && (
        <ToolConfirmDialog
          pending={pendingConfirm}
          onDecision={onHitlDecision}
          busy={hitlBusy}
        />
      )}

      {expanded && hasDetail && (
        <div className="space-y-2" data-testid="timeline-detail">
          {events.length > 0 && (
            <ul className="space-y-1" aria-label="处理步骤">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="font-zh text-xs text-[var(--text-muted)] border border-[var(--border-20)] px-2 py-1.5"
                >
                  <span className="text-[var(--text-secondary)]">
                    {e.content || e.result?.slice(0, 120) || e.toolName || '步骤完成'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ExecutionTimeline steps={steps} />
        </div>
      )}
    </div>
  );
}
