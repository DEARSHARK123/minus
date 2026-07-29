'use client';

/**
 * UX06 — Learning history: user goals as titles, short outcomes, unfinished.
 * Resume = context only; never auto-replays tools. No Session ID / message counts.
 */

import { useMemo, useState } from 'react';
import { BookOpen, History as HistoryIcon } from 'lucide-react';
import { iconSizes } from '@/lib/icons';
import { useLearningStore } from '@/store/learning-store';
import { useUIStore } from '@/store/ui-store';
import {
  EmptyState,
  ErrorBanner,
  formatDateTime,
  PrimaryButton,
  SecondaryButton,
} from './shared';
import {
  assertSafeResume,
  buildSafeResumePayload,
  buildSessionIntelligence,
} from '@/lib/chat/history-intelligence';
import {
  selectContinuation,
  type ContinuationContext,
} from '@/lib/chat/continuation-selector';
import { appNavigate, coursePath } from '@/lib/navigation';
import type { LearningSession } from '@/types/learning';

export function LearningHistory() {
  const data = useLearningStore((s) => s.data);
  const error = useLearningStore((s) => s.error);
  const clearError = useLearningStore((s) => s.clearError);
  const createSession = useLearningStore((s) => s.createSession);
  const selectedCourseId = useLearningStore((s) => s.selectedCourseId);
  const setActiveTaskId = useLearningStore((s) => s.setActiveTaskId);
  const setActiveSession = useLearningStore((s) => s.setActiveSession);
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);

  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const sessions = useMemo(
    () =>
      [...data.sessions].sort(
        (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
      ),
    [data.sessions],
  );

  const courseTitle = (courseId: string) =>
    data.courses.find((c) => c.id === courseId)?.title || '课程';

  const taskTitle = (taskId?: string) => {
    if (!taskId) return null;
    return data.tasks.find((t) => t.id === taskId)?.title || null;
  };

  const sessionIntel = useMemo(
    () =>
      sessions.map((session) =>
        buildSessionIntelligence(session, {
          courseTitle: courseTitle(session.courseId),
          taskTitle: taskTitle(session.taskId) || undefined,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, data.courses, data.tasks],
  );

  const continuationCtx: ContinuationContext = useMemo(
    () => ({
      sessions: data.sessions.map((s) => ({
        id: s.id,
        courseId: s.courseId,
        taskId: s.taskId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
    }),
    [data.sessions],
  );

  const primaryContinuation = useMemo(
    () => selectContinuation(data.tasks, 'history', continuationCtx),
    [data.tasks, continuationCtx],
  );

  const courses = data.courses;
  const courseId = selectedCourseId || courses[0]?.id || null;

  const handleStartLearning = async () => {
    if (!courseId) {
      setActiveAppView('library');
      return;
    }
    const courseTasks = data.tasks.filter((t) => t.courseId === courseId);
    const task =
      courseTasks.find(
        (t) =>
          t.status !== 'done' &&
          t.status !== 'completed' &&
          t.status !== 'pending_suggestion',
      ) || null;
    try {
      const session = await createSession({
        courseId,
        taskId: task?.id,
        notes: task ? `Learning: ${task.title}` : 'Learning session',
      });
      setActiveSession(session);
      setActiveTaskId(task?.id ?? null);
      setActiveAppView('session', {
        courseId,
        sessionId: session.id,
      });
    } catch {
      /* error in store */
    }
  };

  /**
   * Safe resume: restore session context only.
   * Does NOT re-run tools, teach loops, or agent Desktop.
   */
  const handleResumeSession = (session: LearningSession) => {
    const intel = sessionIntel.find((i) => i.id === session.id);
    if (intel) {
      assertSafeResume(intel);
      const payload = buildSafeResumePayload(intel);
      if (payload.autoReplayTools !== false) return;
    }
    setActiveSession(session);
    setActiveTaskId(session.taskId ?? null);
    // Prefer course deep link for real entity navigation
    appNavigate(coursePath(session.courseId, session.id));
    setActiveAppView('session', {
      courseId: session.courseId,
      sessionId: session.id,
      fromRoute: true,
    });
  };

  const handlePrimaryContinue = () => {
    if (!primaryContinuation) return;
    const link = primaryContinuation.deepLink;
    if (link.courseId) {
      appNavigate(link.href);
      setActiveAppView('session', {
        courseId: link.courseId,
        sessionId: link.sessionId ?? null,
        fromRoute: true,
      });
      if (link.sessionId) {
        const session = data.sessions.find((s) => s.id === link.sessionId);
        if (session) {
          setActiveSession(session);
          setActiveTaskId(session.taskId ?? link.taskId ?? null);
        } else if (link.taskId) {
          setActiveTaskId(link.taskId);
        }
      } else if (link.taskId) {
        setActiveTaskId(link.taskId);
      }
      return;
    }
    setActiveAppView('home');
  };

  const empty = sessions.length === 0;

  if (empty) {
    return (
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        )}
        <EmptyState
          icon={<HistoryIcon size={iconSizes['2xl']} aria-hidden />}
          title="暂无学习记录"
          description="开始一次学习后，进度会显示在这里。"
          action={
            <div className="flex flex-wrap gap-2 justify-center">
              <PrimaryButton onClick={() => setActiveAppView('home')}>
                前往主页
              </PrimaryButton>
              <SecondaryButton onClick={() => setActiveAppView('library')}>
                前往资料库
              </SecondaryButton>
              {courseId && (
                <SecondaryButton onClick={() => void handleStartLearning()}>
                  开始学习
                </SecondaryButton>
              )}
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        <div>
          <h1 className="font-zh text-lg font-bold text-[var(--text-primary)]">
            学习记录
          </h1>
          <p className="font-zh text-sm text-[var(--text-secondary)] mt-1">
            按学习目标查看进度，可随时继续
          </p>
        </div>

        {primaryContinuation && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-4 py-3"
            data-testid="history-primary-continue"
          >
            <div className="min-w-0">
              <p className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                {primaryContinuation.label}
              </p>
              <p className="font-zh text-[11px] text-[var(--text-muted)] mt-0.5">
                打开对应课程继续
              </p>
            </div>
            <PrimaryButton onClick={handlePrimaryContinue}>继续</PrimaryButton>
          </div>
        )}

        <section>
          <h2 className="font-zh text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 mb-3">
            <BookOpen
              size={iconSizes.sm}
              className="text-[var(--accent)]"
              aria-hidden
            />
            近期学习
          </h2>
          <ul className="space-y-2">
            {sessionIntel.map((intel) => {
              const session = sessions.find((s) => s.id === intel.id)!;
              const open = expandedSession === session.id;
              // Suppress duplicate primary chip row — still list for resume
              const isPrimaryTask =
                primaryContinuation &&
                session.taskId &&
                session.taskId === primaryContinuation.task.id;

              return (
                <li
                  key={session.id}
                  className="border border-[var(--border-20)] bg-[var(--bg-primary)]/50"
                  data-primary-continuation={isPrimaryTask ? 'true' : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-tertiary)]/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] min-h-[44px]"
                      onClick={() =>
                        setExpandedSession(open ? null : session.id)
                      }
                      aria-expanded={open}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                          {intel.title}
                        </p>
                        <p className="font-zh text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-1">
                          {intel.summary}
                        </p>
                        <p className="font-zh text-[11px] text-[var(--text-muted)] mt-0.5">
                          {formatDateTime(session.startedAt)}
                          {!session.endedAt ? ' · 进行中' : ''}
                        </p>
                      </div>
                    </button>
                    {!session.endedAt && (
                      <div className="pr-3 shrink-0">
                        <SecondaryButton
                          onClick={() => handleResumeSession(session)}
                          aria-label={`继续：${intel.title}`}
                          className="min-h-[44px]"
                        >
                          继续
                        </SecondaryButton>
                      </div>
                    )}
                    {session.endedAt && session.courseId && (
                      <div className="pr-3 shrink-0">
                        <SecondaryButton
                          onClick={() => {
                            appNavigate(coursePath(session.courseId));
                            setActiveAppView('session', {
                              courseId: session.courseId,
                              fromRoute: true,
                            });
                          }}
                          aria-label={`打开课程：${intel.title}`}
                        >
                          打开课程
                        </SecondaryButton>
                      </div>
                    )}
                  </div>
                  {open && (
                    <div className="px-4 pb-4 border-t border-[var(--border-20)] pt-3 space-y-3">
                      {intel.incomplete.length > 0 && (
                        <div>
                          <p className="font-zh text-xs font-bold text-amber-600 mb-1">
                            未完成
                          </p>
                          <ul className="space-y-1">
                            {intel.incomplete.map((item) => (
                              <li
                                key={item.label}
                                className="font-zh text-xs text-[var(--text-secondary)]"
                              >
                                · {item.label}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {intel.decisions.length > 0 && (
                        <div>
                          <p className="font-zh text-xs font-bold text-[var(--text-muted)] mb-1">
                            学习结果
                          </p>
                          <ul className="space-y-1">
                            {intel.decisions.slice(0, 4).map((d) => (
                              <li
                                key={d.label}
                                className="font-zh text-xs text-[var(--text-secondary)]"
                              >
                                · {d.label}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {session.notes?.startsWith('[Minus 学习总结]') && (
                        <div className="soft-card p-3" data-testid="session-reflection">
                          <p className="font-zh text-xs font-bold text-[var(--text-primary)] mb-1.5">
                            已保存的学习总结
                          </p>
                          <p className="whitespace-pre-wrap font-zh text-xs leading-relaxed text-[var(--text-secondary)]">
                            {session.notes.replace('[Minus 学习总结]\n', '')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
