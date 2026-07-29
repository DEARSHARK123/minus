'use client';

/**
 * UX05 — Calendar dual-pane: ~300px companion + full-month grid.
 * Constraints live in Chat; this page views results and Accept/Edit.
 * No Agent brief / ContextPack / raw status / propose≠commit on primary surface.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLearningStore } from '@/store/learning-store';
import { useChatStore } from '@/store/chat-store';
import { useUIStore } from '@/store/ui-store';
import { LearningCalendar } from '@/components/learning/calendar';
import { ErrorBanner, PrimaryButton, SecondaryButton } from '@/components/learning/shared';
import { PendingSuggestionsPanel } from '@/components/learning/pending-suggestions-panel';
import { CalendarCompanionChat } from './calendar-companion-chat';
import PixelIcon from '@/components/icons/PixelIcon';
import type { CalendarBrief } from '@/lib/learning/calendar-companion';
import type { PlanProposal } from '@/types/learning';
import {
  CALENDAR_UI,
  confirmationCountLabel,
  formatDiffPreviewLine,
  naturalCompanionSummary,
} from '@/lib/learning/calendar-copy';
import {
  canAcceptProposal,
  editProposalTaskTime,
  isScheduleWriteAction,
  shiftProposalTaskMinutes,
  validatePlanProposal,
} from '@/lib/learning/calendar-proposal-edit';
import {
  calendarLayoutMode,
  companionVisibleByDefault,
  type CalendarLayoutMode,
} from '@/lib/learning/calendar-grid';
import {
  constraintsToPlanHints,
  nextPlanningConstraintQuestion,
  type PlanningConstraints,
} from '@/lib/learning/planning-constraints';
import { selectContinuation } from '@/lib/chat/continuation-selector';
import { appNavigate, coursePath } from '@/lib/navigation';
import {
  clearEntitySelection,
  peekEntitySelection,
  subscribeEntitySelection,
  type EntitySelection,
} from '@/lib/navigation/entity-selection';

const CALENDAR_DRAFT_STORAGE_KEY = 'minus.calendar-proposal.v1';

function saveCalendarDraft(proposal: PlanProposal | null): void {
  if (typeof window === 'undefined') return;
  if (proposal) window.sessionStorage.setItem(CALENDAR_DRAFT_STORAGE_KEY, JSON.stringify(proposal));
  else window.sessionStorage.removeItem(CALENDAR_DRAFT_STORAGE_KEY);
}

function finishCalendarPlanning(proposal: PlanProposal): void {
  const chat = useChatStore.getState();
  const conversationId = proposal.sourceConversationId ?? chat.activeConversationId;
  if (!conversationId) return;
  const conversation = chat.conversations.find((item) => item.id === conversationId);
  const experience = conversation?.experience;
  if (!experience?.calendarPlanningActive && !experience?.calendarProposalPreviewId) return;
  chat.setExperienceSnapshot(conversationId, {
    ...experience,
    calendarPlanningActive: false,
    calendarPendingConstraintKey: null,
    calendarProposalPreviewId: null,
    updatedAt: new Date().toISOString(),
  });
}

export function CalendarPage() {
  const load = useLearningStore((s) => s.load);
  const data = useLearningStore((s) => s.data);
  const error = useLearningStore((s) => s.error);
  const clearError = useLearningStore((s) => s.clearError);
  const loading = useLearningStore((s) => s.loading);
  const selectedCourseId = useLearningStore((s) => s.selectedCourseId);
  const setSelectedCourseId = useLearningStore((s) => s.setSelectedCourseId);
  const createSession = useLearningStore((s) => s.createSession);
  const setActiveSession = useLearningStore((s) => s.setActiveSession);
  const setActiveTaskId = useLearningStore((s) => s.setActiveTaskId);
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);
  const confirmTask = useLearningStore((s) => s.confirmTask);
  const rejectSuggestion = useLearningStore((s) => s.rejectSuggestion);
  const confirmImportSuggestion = useLearningStore((s) => s.confirmImportSuggestion);
  const rejectImportSuggestion = useLearningStore((s) => s.rejectImportSuggestion);
  const getCalendarBrief = useLearningStore((s) => s.getCalendarBrief);
  const proposePlan = useLearningStore((s) => s.proposePlan);
  const confirmPlan = useLearningStore((s) => s.confirmPlan);
  const skipDay = useLearningStore((s) => s.skipDay);
  const calendarProposalPreview = useLearningStore((s) => s.calendarProposalPreview);
  const setCalendarProposalPreview = useLearningStore(
    (s) => s.setCalendarProposalPreview,
  );

  const [brief, setBrief] = useState<CalendarBrief | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [companionOpen, setCompanionOpen] = useState(true);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<{
    message: string;
    retry: () => void;
  } | null>(null);
  const draftRestoreStarted = useRef(false);
  const previousLayoutMode = useRef<CalendarLayoutMode | null>(null);

  const courseId = selectedCourseId || data.courses[0]?.id || null;
  const planningCourseId = proposal?.courseId ?? courseId;
  const planningCourseTitle = data.courses.find(
    (course) => course.id === planningCourseId,
  )?.title;

  useEffect(() => {
    const reveal = (selection: EntitySelection): boolean => {
      if (selection.kind !== 'task') return false;
      const task = data.tasks.find((item) => item.id === selection.id);
      if (!task) return false;
      setFocusedTaskId(task.id);
      const iso = task.scheduledStart || task.deadline || task.scheduledEnd;
      if (iso) {
        const date = new Date(iso);
        if (!Number.isNaN(date.getTime())) setSelectedDate(date);
      }
      window.setTimeout(() => {
        document
          .querySelector('[data-testid="learning-calendar"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
      clearEntitySelection(selection);
      return true;
    };
    const pending = peekEntitySelection('task');
    if (pending) reveal(pending);
    return subscribeEntitySelection((selection) => {
      reveal(selection);
    });
  }, [data.tasks]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!calendarProposalPreview) return;
    const chat = useChatStore.getState();
    const preview = calendarProposalPreview.sourceConversationId
      ? calendarProposalPreview
      : {
          ...calendarProposalPreview,
          sourceConversationId: chat.activeConversationId ?? undefined,
        };
    // Defer writes to satisfy react-hooks/set-state-in-effect.
    queueMicrotask(() => {
      setProposal(preview);
      setEditing(false);
      setSelectedCourseId(preview.courseId);
      setCalendarProposalPreview(null);
      saveCalendarDraft(preview);
    });
  }, [calendarProposalPreview, setCalendarProposalPreview, setSelectedCourseId]);

  useEffect(() => {
    if (draftRestoreStarted.current || calendarProposalPreview) return;
    draftRestoreStarted.current = true;
    const raw = window.sessionStorage.getItem(CALENDAR_DRAFT_STORAGE_KEY);
    if (!raw) return;
    try {
      const restored = JSON.parse(raw) as PlanProposal;
      if (
        restored?.applied === false &&
        typeof restored.id === 'string' &&
        typeof restored.baseRevision === 'string' &&
        Array.isArray(restored.plan?.tasks)
      ) {
        queueMicrotask(() => {
          setProposal(restored);
          setSelectedCourseId(restored.courseId);
        });
      } else {
        saveCalendarDraft(null);
      }
    } catch {
      saveCalendarDraft(null);
    }
  }, [calendarProposalPreview, setSelectedCourseId]);

  useEffect(() => {
    const measure = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
      setViewportWidth(w);
      const mode = calendarLayoutMode(w);
      if (previousLayoutMode.current !== mode) {
        previousLayoutMode.current = mode;
        setCompanionOpen(companionVisibleByDefault(mode));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const layoutMode: CalendarLayoutMode = calendarLayoutMode(viewportWidth);
  const showCompanionRail = layoutMode === 'desktop' || (layoutMode === 'tablet' && companionOpen);
  const showCompanionToggle = layoutMode === 'tablet' || layoutMode === 'mobile';
  const proposalIssues = useMemo(
    () => validatePlanProposal(proposal, data),
    [proposal, data],
  );

  const refreshBrief = useCallback(async () => {
    try {
      setBriefError(null);
      // The month grid is global, so its companion summary must use the same
      // scope. Course selection below only scopes new plan generation.
      const b = await getCalendarBrief();
      setBrief(b);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : '暂时无法加载今日安排');
      setBrief(null);
    }
  }, [getCalendarBrief]);

  useEffect(() => {
    // Defer so setState inside refreshBrief is not sync-in-effect.
    const t = queueMicrotask(() => {
      void refreshBrief();
    });
    void t;
  }, [refreshBrief, data.tasks, data.importSuggestions]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const pending = useMemo(
    () =>
      data.tasks.filter(
        (t) => t.status === 'pending_suggestion' || t.status === 'pending',
      ),
    [data.tasks],
  );

  const confirmed = useMemo(
    () =>
      data.tasks.filter(
        (t) =>
          t.status === 'confirmed' ||
          t.status === 'scheduled' ||
          t.status === 'in_progress',
      ),
    [data.tasks],
  );

  // UX06: one primary continuation; Calendar uses deep link (not a second Home chip).
  const primaryContinuation = useMemo(
    () =>
      selectContinuation(data.tasks, 'calendar', {
        sessions: data.sessions.map((s) => ({
          id: s.id,
          courseId: s.courseId,
          taskId: s.taskId,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
        })),
      }),
    [data.tasks, data.sessions],
  );

  const todayTodos = useMemo(() => {
    const start = today.getTime();
    const end = start + 86400000 - 1;
    const continuationTaskId = primaryContinuation?.task.id;
    return confirmed.filter((t) => {
      if (continuationTaskId && t.id === continuationTaskId) return false;
      const points = [t.scheduledStart, t.scheduledEnd, t.deadline]
        .filter(Boolean)
        .map((s) => Date.parse(s!));
      if (points.length === 0) return t.status === 'confirmed' || t.status === 'in_progress';
      // Cross-day: occupy today if interval overlaps local day
      if (t.scheduledStart && t.scheduledEnd) {
        const a = Date.parse(t.scheduledStart);
        const b = Date.parse(t.scheduledEnd);
        if (Number.isFinite(a) && Number.isFinite(b) && a <= end && b >= start) return true;
      }
      return points.some((ms) => ms >= start && ms <= end);
    });
  }, [confirmed, today, primaryContinuation]);

  const companionCopy = useMemo(() => naturalCompanionSummary(brief), [brief]);

  // Soft hint: constraints belong in Chat (one question) — not a form on calendar.
  const chatConstraintHint = useMemo(
    () => nextPlanningConstraintQuestion({}),
    [],
  );

  const handleStartTask = async (taskId: string) => {
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return;
    setActionFailure(null);
    try {
      const session = await createSession({
        courseId: task.courseId,
        taskId: task.id,
        notes: `Calendar: ${task.title}`,
      });
      setActiveSession(session);
      setActiveTaskId(task.id);
      appNavigate(coursePath(task.courseId, session.id));
      setActiveAppView('session', {
        courseId: task.courseId,
        sessionId: session.id,
        fromRoute: true,
      });
    } catch (err) {
      setActionFailure({
        message: err instanceof Error ? err.message : '暂时无法开始这个学习任务。',
        retry: () => void handleStartTask(taskId),
      });
    }
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
          return;
        }
      }
      if (link.taskId) {
        void handleStartTask(link.taskId);
      }
      return;
    }
    if (link.taskId) void handleStartTask(link.taskId);
  };

  const handleProposePlan = async () => {
    if (!courseId) return;
    setActionFailure(null);
    try {
      const chat = useChatStore.getState();
      const conversation = chat.conversations.find(
        (item) => item.id === chat.activeConversationId,
      );
      const constraints = (conversation?.experience?.planningConstraints ?? {}) as PlanningConstraints;
      const p = {
        ...(await proposePlan(courseId, undefined, constraintsToPlanHints(constraints))),
        sourceConversationId: conversation?.id,
      };
      setProposal(p);
      setEditing(false);
      saveCalendarDraft(p);
      // propose is not a write
      void isScheduleWriteAction('propose');
    } catch (err) {
      setActionFailure({
        message: err instanceof Error ? err.message : '暂时无法生成日程草案。',
        retry: () => void handleProposePlan(),
      });
    }
  };

  const handleConfirmPlan = async () => {
    if (!proposal || !canAcceptProposal(proposal, proposalIssues)) return;
    if (!isScheduleWriteAction('accept')) return;
    setActionFailure(null);
    try {
      await confirmPlan(proposal);
      finishCalendarPlanning(proposal);
      saveCalendarDraft(null);
      setProposal(null);
      setEditing(false);
      await refreshBrief();
      await load();
    } catch (err) {
      setActionFailure({
        message: err instanceof Error ? err.message : '日程保存失败，草案仍为你保留。',
        retry: () => void handleConfirmPlan(),
      });
    }
  };

  const handleDiscardPlan = () => {
    if (proposal) finishCalendarPlanning(proposal);
    saveCalendarDraft(null);
    setProposal(null);
    setEditing(false);
  };

  const handleAssistantProposalChange = useCallback(
    (nextProposal: PlanProposal) => {
      setProposal(nextProposal);
      setEditing(false);
      setSelectedCourseId(nextProposal.courseId);
      saveCalendarDraft(nextProposal);
    },
    [setSelectedCourseId],
  );

  const handleReplanDay = async (date: Date) => {
    if (!courseId) return;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const skippedDate = `${year}-${month}-${day}`;
    setActionFailure(null);
    try {
      await skipDay(courseId, skippedDate);
      await refreshBrief();
      await load();
    } catch (err) {
      setActionFailure({
        message: err instanceof Error ? err.message : '暂时无法重新安排当天任务。',
        retry: () => void handleReplanDay(date),
      });
    }
  };

  const handleShiftTask = (taskId: string, deltaMinutes: number) => {
    if (!proposal) return;
    const next = shiftProposalTaskMinutes(proposal, taskId, deltaMinutes);
    setProposal(next);
    saveCalendarDraft(next);
    setEditing(true);
  };

  const handleTimeInput = (taskId: string, field: 'start' | 'end', value: string) => {
    if (!proposal) return;
    const task = proposal.plan.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const start = field === 'start' ? value : task.scheduledStart || value;
    const end = field === 'end' ? value : task.scheduledEnd || value;
    if (!start || !end) return;
    // datetime-local → ISO
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
    const next = editProposalTaskTime(
      proposal,
      taskId,
      startDate.toISOString(),
      endDate.toISOString(),
    );
    setProposal(next);
    saveCalendarDraft(next);
    setEditing(true);
  };

  const toLocalInputValue = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const companionBody = (
    <>
      <div className="flex items-center gap-2">
        <PixelIcon name="plan-goal" size={16} aria-hidden />
        <h2 className="font-classic text-xs tracking-widest uppercase text-[var(--text-primary)]">
          {CALENDAR_UI.companionTitle}
        </h2>
        {showCompanionToggle && (
          <SecondaryButton
            className="ml-auto text-[10px] px-2 py-0.5"
            onClick={() => setCompanionOpen(false)}
          >
            {CALENDAR_UI.collapseCompanion}
          </SecondaryButton>
        )}
      </div>

      <section className="soft-card space-y-2 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-zh text-xs font-bold text-[var(--text-primary)]">今日概览</h3>
          <SecondaryButton className="text-[10px] px-2 py-0.5" onClick={() => void refreshBrief()}>
            刷新
          </SecondaryButton>
        </div>
        {briefError && (
          <p className="font-zh text-[11px] text-[var(--danger,#c44)]">{briefError}</p>
        )}
        {brief ? (
          <>
            <p className="font-zh text-xs text-[var(--text-secondary)] whitespace-pre-line leading-relaxed">
              {companionCopy.summary}
            </p>
            {companionCopy.loadLine && (
              <p className="font-zh text-[11px] text-[var(--text-muted)]">{companionCopy.loadLine}</p>
            )}
            {companionCopy.hints.length > 0 && (
              <ul className="space-y-1">
                {companionCopy.hints.map((h, i) => (
                  <li
                    key={`hint-${i}`}
                    className="font-zh text-[11px] text-[var(--text-secondary)] border-l-2 border-[var(--accent)]/50 pl-2"
                  >
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="font-zh text-xs text-[var(--text-muted)]">
            {briefError ? '暂时无法加载' : '正在准备今日安排…'}
          </p>
        )}
      </section>

      <CalendarCompanionChat
        courseId={planningCourseId}
        courseTitle={planningCourseTitle}
        proposal={proposal}
        onProposalChange={handleAssistantProposalChange}
      />

      {primaryContinuation && (
        <section
          className="rounded-[var(--radius-md)] space-y-2 bg-[var(--accent-soft)] px-3.5 py-3"
          data-testid="calendar-primary-continue"
        >
          <h3 className="font-zh text-xs font-bold text-[var(--text-primary)]">
            继续学习
          </h3>
          <p className="font-zh text-sm text-[var(--text-primary)] truncate">
            {primaryContinuation.task.title}
          </p>
          <PrimaryButton className="text-xs" onClick={handlePrimaryContinue}>
            打开课程
          </PrimaryButton>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-zh text-xs font-bold text-[var(--text-primary)]">
          {CALENDAR_UI.todayTodos}
        </h3>
        {todayTodos.length === 0 ? (
          <p className="soft-card font-zh text-xs text-[var(--text-muted)] px-3 py-4">
            今日暂无已确认任务
          </p>
        ) : (
          <ul className="space-y-2">
            {/* Schedule rows keep all today todos; primary continue CTA is separate above */}
            {todayTodos.map((t) => (
              <li key={t.id} className="soft-card px-3 py-2.5">
                <p className="font-zh text-sm text-[var(--text-primary)]">{t.title}</p>
                <PrimaryButton
                  className="mt-2 text-xs"
                  onClick={() => void handleStartTask(t.id)}
                >
                  开始
                </PrimaryButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PendingSuggestionsPanel
        compact
        naturalCopy
        tasks={data.tasks}
        importSuggestions={data.importSuggestions ?? []}
        courseId={courseId}
        loading={loading}
        onConfirmTask={async (id) => {
          await confirmTask(id);
        }}
        onRejectTask={async (id) => {
          await rejectSuggestion(id);
        }}
        onConfirmImport={async (id) => {
          await confirmImportSuggestion(id);
        }}
        onRejectImport={async (id) => {
          await rejectImportSuggestion(id);
        }}
        title={CALENDAR_UI.pendingDecisions}
      />

      <section className="space-y-2 mt-auto border-t border-[var(--border-20)] pt-3">
        <label className="block space-y-1.5">
          <span className="font-zh text-[11px] font-bold text-[var(--text-secondary)]">
            规划课程
          </span>
          <select
            value={planningCourseId ?? ''}
            onChange={(event) => setSelectedCourseId(event.target.value || null)}
            disabled={Boolean(proposal)}
            className="min-h-[40px] w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-2.5 font-zh text-xs text-[var(--text-primary)]"
            aria-label="选择要规划的课程"
          >
            {data.courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
        <div
          className="font-zh text-[11px] text-[var(--text-muted)]"
          data-testid="confirmation-counts"
        >
          {confirmationCountLabel(confirmed.length, pending.length)}
        </div>
        <PrimaryButton
          className="w-full text-xs"
          disabled={!courseId || loading}
          onClick={() => void handleProposePlan()}
        >
          {CALENDAR_UI.proposeDraft}
        </PrimaryButton>
        <p className="font-zh text-[10px] text-[var(--text-muted)] leading-relaxed">
          {CALENDAR_UI.draftHint}
        </p>
        {chatConstraintHint && (
          <p className="font-zh text-[10px] text-[var(--text-muted)] leading-relaxed border border-dashed border-[var(--border-20)] px-2 py-1.5">
            学习时间偏好可在对话里告诉我，例如：「{chatConstraintHint.question}」
          </p>
        )}
      </section>
    </>
  );

  return (
    <div
      className="flex-1 flex min-h-0 overflow-hidden"
      data-testid="calendar-page"
      data-layout={layoutMode}
    >
      {/* Desktop / tablet companion ~300px */}
      {showCompanionRail && (
        <aside
          className="w-[288px] shrink-0 border-r border-[var(--border-20)] bg-[var(--surface)] p-4 flex flex-col gap-4 overflow-y-auto"
          data-testid="calendar-companion"
          aria-label={CALENDAR_UI.companionTitle}
        >
          {companionBody}
        </aside>
      )}

      {/* Main calendar column */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 min-w-0">
        {showCompanionToggle && !showCompanionRail && (
          <div className="flex justify-start">
            <SecondaryButton
              className="text-xs"
              onClick={() => setCompanionOpen(true)}
            >
              {CALENDAR_UI.expandCompanion}
            </SecondaryButton>
          </div>
        )}

        {/* Mobile: companion as top sheet when open */}
        {layoutMode === 'mobile' && companionOpen && (
          <div
            className="border border-[var(--border)] p-3 space-y-3 max-h-[70vh] overflow-y-auto"
            data-testid="calendar-companion-mobile"
          >
            {companionBody}
          </div>
        )}

        {error && <ErrorBanner message={error} onDismiss={clearError} />}
        {actionFailure && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3">
            <p className="font-zh text-xs text-[var(--error)]">{actionFailure.message}</p>
            <div className="flex items-center gap-2">
              <SecondaryButton className="text-xs" onClick={actionFailure.retry}>
                重试
              </SecondaryButton>
              <button
                type="button"
                onClick={() => setActionFailure(null)}
                className="min-h-[36px] px-2 font-zh text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {proposal && (
          <section
            className="surface-card border-[var(--accent)]/30 p-4 sm:p-5 space-y-4"
            data-testid="proposal-preview"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
                {CALENDAR_UI.draftTitle}
                {editing ? ' · 已修改' : ''}
              </h3>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton
                  className="text-xs"
                  disabled={loading || !canAcceptProposal(proposal, proposalIssues)}
                  onClick={() => void handleConfirmPlan()}
                >
                  {CALENDAR_UI.accept}
                </PrimaryButton>
                <SecondaryButton
                  className="text-xs"
                  onClick={() => setEditing((e) => !e)}
                >
                  {CALENDAR_UI.edit}
                </SecondaryButton>
                <SecondaryButton className="text-xs" onClick={handleDiscardPlan}>
                  {CALENDAR_UI.discard}
                </SecondaryButton>
              </div>
            </div>
            <p className="font-zh text-[11px] text-[var(--text-muted)]">
              {CALENDAR_UI.draftHint}
            </p>
            {proposal.plan.warnings.length > 0 && (
              <ul className="font-zh text-xs text-[var(--text-secondary)] list-disc pl-4">
                {proposal.plan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {proposalIssues.length > 0 && (
              <div
                className="border-l-[3px] border-[var(--error)] bg-[var(--error-bg)] px-3 py-2.5"
                role="alert"
                data-testid="proposal-validation"
              >
                <p className="font-zh text-xs font-bold text-[var(--error)]">
                  请先修正这些安排
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 font-zh text-xs text-[var(--text-secondary)]">
                  {proposalIssues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.taskId ?? index}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {proposal.diffs.length === 0 ? (
              <p className="font-zh text-xs text-[var(--text-muted)]">当前没有需要调整的日程。</p>
            ) : (
              <ul className="space-y-2">
                {proposal.diffs.map((d) => {
                  const line = formatDiffPreviewLine(d);
                  const planned = proposal.plan.tasks.find((t) => t.id === d.taskId);
                  return (
                    <li
                      key={d.taskId}
                      className="border-t border-[var(--border-20)] py-3 font-zh text-xs space-y-1 first:border-t-0"
                      data-testid="proposal-diff-row"
                    >
                      <p className="font-bold text-[var(--text-primary)]">{line.title}</p>
                      <p className="text-[var(--text-muted)]">{line.before}</p>
                      <p className="text-[var(--text-secondary)]">{line.after}</p>
                      {editing && planned && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                            开始
                            <input
                              type="datetime-local"
                              className="min-h-[40px] rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-2 py-1 text-xs"
                              value={toLocalInputValue(planned.scheduledStart)}
                              onChange={(e) =>
                                handleTimeInput(d.taskId, 'start', e.target.value)
                              }
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                            结束
                            <input
                              type="datetime-local"
                              className="min-h-[40px] rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-2 py-1 text-xs"
                              value={toLocalInputValue(planned.scheduledEnd)}
                              onChange={(e) =>
                                handleTimeInput(d.taskId, 'end', e.target.value)
                              }
                            />
                          </label>
                          <SecondaryButton
                            className="min-h-[40px] text-xs px-3 py-1"
                            onClick={() => handleShiftTask(d.taskId, 30)}
                            aria-label="向后移 30 分钟"
                          >
                            +30 分
                          </SecondaryButton>
                          <SecondaryButton
                            className="min-h-[40px] text-xs px-3 py-1"
                            onClick={() => handleShiftTask(d.taskId, -30)}
                            aria-label="向前移 30 分钟"
                          >
                            −30 分
                          </SecondaryButton>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <LearningCalendar
          tasks={data.tasks}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          viewportWidth={viewportWidth}
          onStartTask={(id) => void handleStartTask(id)}
          highlightTaskId={focusedTaskId}
          onReplanDay={(date) => void handleReplanDay(date)}
        />
      </div>
    </div>
  );
}
