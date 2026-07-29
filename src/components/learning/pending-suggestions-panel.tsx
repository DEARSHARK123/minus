'use client';

/**
 * B06 — Confirmable pending suggestions for Library & Calendar.
 * Surfaces task pending_suggestion + import assist suggestions (not Feed-only).
 */

import { useMemo } from 'react';
import type { ImportSuggestion, StudyTask } from '@/types/learning';
import { importActionLabel } from '@/lib/learning/import-assist';
import { PrimaryButton, SecondaryButton, StatusBadge } from './shared';

export type PendingSuggestionsPanelProps = {
  tasks: StudyTask[];
  importSuggestions?: ImportSuggestion[];
  courseId?: string | null;
  onConfirmTask: (taskId: string) => void | Promise<void>;
  onRejectTask: (taskId: string) => void | Promise<void>;
  onConfirmImport?: (suggestionId: string) => void | Promise<void>;
  onRejectImport?: (suggestionId: string) => void | Promise<void>;
  loading?: boolean;
  /** Compact mode for calendar sidebar. */
  compact?: boolean;
  title?: string;
  /**
   * UX05: natural Chinese helper without propose≠commit / engineering terms.
   * Default true for compact calendar; set false to keep legacy technical hint.
   */
  naturalCopy?: boolean;
};

export function PendingSuggestionsPanel({
  tasks,
  importSuggestions = [],
  courseId,
  onConfirmTask,
  onRejectTask,
  onConfirmImport,
  onRejectImport,
  loading = false,
  compact = false,
  title = '待确认建议',
  naturalCopy = true,
}: PendingSuggestionsPanelProps) {
  const pendingTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status !== 'pending_suggestion') return false;
      if (courseId && t.courseId !== courseId) return false;
      return true;
    });
  }, [tasks, courseId]);

  const pendingImports = useMemo(() => {
    return importSuggestions.filter((s) => {
      if (s.status !== 'pending') return false;
      if (courseId && s.courseId !== courseId) return false;
      return true;
    });
  }, [importSuggestions, courseId]);

  const empty = pendingTasks.length === 0 && pendingImports.length === 0;

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3
          className={
            compact
              ? 'font-zh text-xs font-bold text-[var(--text-primary)]'
              : 'font-classic text-sm tracking-widest uppercase text-[var(--text-primary)]'
          }
        >
          {title}
        </h3>
        <span className="font-tech text-[10px] text-[var(--text-muted)]">
          {pendingTasks.length + pendingImports.length}
        </span>
      </div>

      <p className="font-zh text-[11px] text-[var(--text-muted)] leading-relaxed">
        {naturalCopy
          ? '这些建议需要你确认后才会保存到课程或日程。'
          : '建议需你确认后才会写入课程/任务/日程。'}
      </p>

      {empty ? (
        <p className="font-zh text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-20)] px-3 py-4 text-center">
          暂无待确认建议
        </p>
      ) : (
        <ul className="space-y-2">
          {pendingImports.map((s) => (
            <li
              key={s.id}
              className="border border-[var(--border-20)] bg-[var(--bg-primary)]/50 px-3 py-2 space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-zh text-sm font-bold text-[var(--text-primary)]">
                  {s.title || importActionLabel(s.action)}
                </span>
                <span className="font-tech text-[10px] uppercase px-1.5 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/10">
                  导入 · {s.action}
                </span>
              </div>
              <p className="font-zh text-xs text-[var(--text-secondary)] leading-relaxed">
                {s.reason}
              </p>
              {s.summary && !compact && (
                <p className="font-zh text-[11px] text-[var(--text-muted)] line-clamp-2">
                  摘要：{s.summary}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {onConfirmImport && (
                  <PrimaryButton
                    className="text-xs"
                    disabled={loading}
                    onClick={() => void onConfirmImport(s.id)}
                    aria-label={`确认建议：${s.title}`}
                  >
                    确认
                  </PrimaryButton>
                )}
                {onRejectImport && (
                  <SecondaryButton
                    className="text-xs"
                    disabled={loading}
                    onClick={() => void onRejectImport(s.id)}
                    aria-label={`拒绝建议：${s.title}`}
                  >
                    拒绝
                  </SecondaryButton>
                )}
              </div>
            </li>
          ))}

          {pendingTasks.map((t) => (
            <li
              key={t.id}
              className="border border-[var(--border-20)] bg-[var(--bg-primary)]/50 px-3 py-2 space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                  {t.title}
                </span>
                <StatusBadge status={t.status} />
              </div>
              {t.description && (
                <p className="font-zh text-xs text-[var(--text-secondary)] line-clamp-2">
                  {t.description}
                </p>
              )}
              <div className="font-tech text-[10px] text-[var(--text-muted)]">
                {t.estimatedMinutes} 分钟
              </div>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton
                  className="text-xs"
                  disabled={loading}
                  onClick={() => void onConfirmTask(t.id)}
                  aria-label={`确认任务：${t.title}`}
                >
                  确认
                </PrimaryButton>
                <SecondaryButton
                  className="text-xs"
                  disabled={loading}
                  onClick={() => void onRejectTask(t.id)}
                  aria-label={`拒绝任务：${t.title}`}
                >
                  拒绝
                </SecondaryButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
