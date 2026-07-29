'use client';

import type { ReactNode } from 'react';
import type { SearchHit, StudyTask, TaskStatus } from '@/types/learning';

/** Shared progress bar using CSS tokens. */
export function ProgressBar({
  value,
  max = 100,
  label,
  className = '',
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={className}>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <span className="font-zh text-xs text-[var(--text-secondary)]">
            {label}
          </span>
          <span className="font-tech text-xs text-[var(--text-muted)]">{pct}%</span>
        </div>
      )}
      <div
        className="h-1.5 w-full bg-[var(--bg-tertiary)] border border-[var(--border-20)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progress'}
      >
        <div
          className="h-full bg-[var(--accent)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; className: string }> = {
    pending_suggestion: {
      label: '待确认',
      className: 'text-[var(--text-muted)] border-[var(--border)] bg-[var(--bg-tertiary)]/50',
    },
    confirmed: {
      label: '已确认',
      className: 'text-[var(--accent)] border-[var(--accent)]/40 bg-[var(--accent)]/10',
    },
    scheduled: {
      label: '已排程',
      className: 'text-[var(--state-executing)] border-[var(--state-executing-border)] bg-[var(--state-executing-bg)]',
    },
    in_progress: {
      label: '进行中',
      className:
        'text-[var(--state-executing)] border-[var(--state-executing-border)] bg-[var(--state-executing-bg)]',
    },
    done: {
      label: '已完成',
      className:
        'text-[var(--state-done)] border-[var(--state-done-border)] bg-[var(--state-done-bg)]',
    },
    pending: {
      label: '待开始',
      className: 'text-[var(--text-muted)] border-[var(--border)] bg-[var(--bg-tertiary)]/50',
    },
    completed: {
      label: '已完成',
      className:
        'text-[var(--state-done)] border-[var(--state-done-border)] bg-[var(--state-done-bg)]',
    },
  };
  const cfg = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 border font-zh text-[11px] ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Tasks scheduled or due today (local), excluding terminal statuses. */
export function tasksForToday(tasks: StudyTask[], now = new Date()): StudyTask[] {
  const start = startOfLocalDay(now).getTime();
  const end = endOfLocalDay(now).getTime();
  return tasks.filter((t) => {
    if (t.status === 'completed' || t.status === 'done') return false;
    const points = [t.scheduledStart, t.scheduledEnd, t.deadline]
      .filter(Boolean)
      .map((s) => Date.parse(s!));
    if (points.length === 0) return false;
    return points.some((ms) => ms >= start && ms <= end);
  });
}

/** Tasks that are confirmed by the user but not yet scheduled for today. */
export function confirmedTasks(tasks: StudyTask[], now = new Date()): StudyTask[] {
  const todayIds = new Set(tasksForToday(tasks, now).map((t) => t.id));
  return tasks.filter((t) => t.status === 'confirmed' && !todayIds.has(t.id));
}

/** Tasks that are still pending suggestions (awaiting user confirm/reject). */
export function pendingSuggestions(tasks: StudyTask[]): StudyTask[] {
  return tasks.filter((t) => t.status === 'pending_suggestion');
}

/** Upcoming incomplete tasks with deadline or schedule after today. */
export function upcomingTasks(tasks: StudyTask[], now = new Date(), days = 7): StudyTask[] {
  const endToday = endOfLocalDay(now).getTime();
  const horizon = endToday + days * 24 * 60 * 60 * 1000;
  return tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'done')
    .filter((t) => {
      const points = [t.deadline, t.scheduledStart]
        .filter(Boolean)
        .map((s) => Date.parse(s!));
      if (points.length === 0) return false;
      const soonest = Math.min(...points);
      return soonest > endToday && soonest <= horizon;
    })
    .sort((a, b) => {
      const da = Date.parse(a.deadline || a.scheduledStart || '') || Infinity;
      const db = Date.parse(b.deadline || b.scheduledStart || '') || Infinity;
      return da - db;
    });
}

export function courseProgress(tasks: StudyTask[]): { done: number; total: number; pct: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'completed' || t.status === 'done').length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * Extract Definition / Example / Pitfall cards ONLY from real search hit text.
 * Never fabricates content — returns only keys present in snippets.
 */
export type KnowledgeCardKind = 'definition' | 'example' | 'pitfall';

export type KnowledgeCard = {
  kind: KnowledgeCardKind;
  title: string;
  body: string;
  sourceTitle: string;
};

const CARD_PATTERNS: Array<{ kind: KnowledgeCardKind; title: string; re: RegExp }> = [
  {
    kind: 'definition',
    title: 'Definition',
    re: /(?:^|\n)\s*(?:#{1,3}\s*)?(?:定义|definition|defn\.?)\s*[:：]?\s*([\s\S]{10,400}?)(?=\n\s*(?:#{1,3}\s*)?(?:例子|示例|example|陷阱|pitfall|注意|note)|$)/i,
  },
  {
    kind: 'example',
    title: 'Example',
    re: /(?:^|\n)\s*(?:#{1,3}\s*)?(?:例子|示例|example|eg\.?)\s*[:：]?\s*([\s\S]{10,400}?)(?=\n\s*(?:#{1,3}\s*)?(?:定义|definition|陷阱|pitfall|注意|note)|$)/i,
  },
  {
    kind: 'pitfall',
    title: 'Pitfall',
    re: /(?:^|\n)\s*(?:#{1,3}\s*)?(?:陷阱|pitfall|误区|常见错误|caution)\s*[:：]?\s*([\s\S]{10,400}?)(?=\n\s*(?:#{1,3}\s*)?(?:定义|definition|例子|示例|example)|$)/i,
  },
];

export function extractKnowledgeCards(hits: SearchHit[]): KnowledgeCard[] {
  if (!hits.length) return [];

  const found = new Map<KnowledgeCardKind, KnowledgeCard>();

  for (const hit of hits) {
    for (const pattern of CARD_PATTERNS) {
      if (found.has(pattern.kind)) continue;
      const m = hit.snippet.match(pattern.re);
      if (m?.[1]) {
        const body = m[1].trim().replace(/\s+/g, ' ');
        if (body.length >= 10) {
          found.set(pattern.kind, {
            kind: pattern.kind,
            title: pattern.title,
            body,
            sourceTitle: hit.title,
          });
        }
      }
    }
    if (found.size === 3) break;
  }

  // Fallback: if a hit's title or snippet explicitly labels a kind in a short line
  for (const hit of hits) {
    const lower = hit.snippet.toLowerCase();
    if (!found.has('definition') && (lower.includes('定义') || lower.includes('definition'))) {
      found.set('definition', {
        kind: 'definition',
        title: 'Definition',
        body: hit.snippet.trim(),
        sourceTitle: hit.title,
      });
    }
    if (!found.has('example') && (lower.includes('示例') || lower.includes('例子') || lower.includes('example'))) {
      found.set('example', {
        kind: 'example',
        title: 'Example',
        body: hit.snippet.trim(),
        sourceTitle: hit.title,
      });
    }
    if (
      !found.has('pitfall') &&
      (lower.includes('陷阱') || lower.includes('pitfall') || lower.includes('误区'))
    ) {
      found.set('pitfall', {
        kind: 'pitfall',
        title: 'Pitfall',
        body: hit.snippet.trim(),
        sourceTitle: hit.title,
      });
    }
  }

  const order: KnowledgeCardKind[] = ['definition', 'example', 'pitfall'];
  return order.map((k) => found.get(k)).filter((c): c is KnowledgeCard => Boolean(c));
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14 animate-fade-in">
      <div className="w-14 h-14 mb-4 rounded-2xl bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] shadow-sm">
        {icon}
      </div>
      <h3 className="font-zh text-xl font-bold text-[var(--text-primary)] mb-2">
        {title}
      </h3>
      <p className="font-zh text-sm text-[var(--text-secondary)] max-w-md leading-relaxed mb-6">
        {description}
      </p>
      {action}
    </div>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl px-4 py-3 border border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error)]"
    >
      <p className="flex-1 font-zh text-sm">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[32px] rounded-lg px-2 font-zh text-xs hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          关闭
        </button>
      )}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh font-bold text-sm shadow-sm hover:opacity-90 hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex min-h-[36px] items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 border border-[var(--border-20)] bg-[var(--surface)] text-[var(--text-secondary)] font-zh text-sm hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] hover:border-[var(--border)] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      {children}
    </button>
  );
}

export function DestructiveButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 border border-[var(--error-border)] bg-[var(--bg-tertiary)] text-[var(--error)] font-zh text-sm hover:bg-[var(--error-bg)] hover:text-[var(--error)] hover:border-[var(--error)] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--error)] ${className}`}
    >
      {children}
    </button>
  );
}
