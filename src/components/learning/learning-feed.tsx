'use client';

/**
 * QUARANTINED (B05 / UX08) — Legacy LearningFeed dual-truth path.
 *
 * Production Home is `/chat` → HomeChat; calendar is `/calendar`; tasks surface
 * via Calendar companion + Home continuation chips — not this feed.
 * Do NOT mount LearningFeed as product Home or primary nav target.
 *
 * @deprecated Never re-link as production Home.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import PixelIcon, { type PixelIconName } from '@/components/icons/PixelIcon';
import { iconSizes } from '@/lib/icons';
import { useLearningStore } from '@/store/learning-store';
import { useUIStore } from '@/store/ui-store';
import type { StudyTask } from '@/types/learning';
import {
  confirmedTasks,
  courseProgress,
  DestructiveButton,
  EmptyState,
  ErrorBanner,
  formatDateTime,
  pendingSuggestions,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  StatusBadge,
  tasksForToday,
} from './shared';
import { LearningCalendar } from './calendar';

/** @deprecated UX08 quarantine — competing task feed; not a production entry. */
export function LearningFeed() {
  const data = useLearningStore((s) => s.data);
  const loading = useLearningStore((s) => s.loading);
  const error = useLearningStore((s) => s.error);
  const clearError = useLearningStore((s) => s.clearError);
  const createCourse = useLearningStore((s) => s.createCourse);
  const createLearningPath = useLearningStore((s) => s.createLearningPath);
  const plan = useLearningStore((s) => s.plan);
  const proposeTask = useLearningStore((s) => s.proposeTask);
  const confirmTask = useLearningStore((s) => s.confirmTask);
  const rejectSuggestion = useLearningStore((s) => s.rejectSuggestion);
  const createSession = useLearningStore((s) => s.createSession);
  const selectedCourseId = useLearningStore((s) => s.selectedCourseId);
  const setSelectedCourseId = useLearningStore((s) => s.setSelectedCourseId);
  const setActiveTaskId = useLearningStore((s) => s.setActiveTaskId);
  const diagnoseGaps = useLearningStore((s) => s.diagnoseGaps);
  const confirmDiagnosticGap = useLearningStore((s) => s.confirmDiagnosticGap);
  const dismissDiagnosticGap = useLearningStore((s) => s.dismissDiagnosticGap);
  const skipDay = useLearningStore((s) => s.skipDay);
  const setActiveLearningView = useUIStore((s) => s.setActiveLearningView);

  const [showCreateCourse, setShowCreateCourse] = useState(false);
  const [showCreateGoal, setShowCreateGoal] = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [courseDesc, setCourseDesc] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDesc, setGoalDesc] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [proposeTitle, setProposeTitle] = useState('');
  const [proposeMinutes, setProposeMinutes] = useState('');
  const [proposeDesc, setProposeDesc] = useState('');
  const [skipDate, setSkipDate] = useState('');

  const courses = data.courses;
  const courseId = selectedCourseId || courses[0]?.id || null;
  const courseTasks = useMemo(
    () => (courseId ? data.tasks.filter((t) => t.courseId === courseId) : data.tasks),
    [data.tasks, courseId],
  );
  const courseGaps = useMemo(
    () => (courseId ? data.diagnosticGaps.filter((g) => g.courseId === courseId) : data.diagnosticGaps),
    [data.diagnosticGaps, courseId],
  );

  const pending = useMemo(() => pendingSuggestions(courseTasks), [courseTasks]);
  const confirmed = useMemo(() => confirmedTasks(courseTasks), [courseTasks]);
  const today = useMemo(() => tasksForToday(courseTasks), [courseTasks]);
  const done = useMemo(
    () => courseTasks.filter((t) => t.status === 'done' || t.status === 'completed'),
    [courseTasks],
  );
  const progress = courseProgress(courseTasks);
  const hasAnyData =
    data.courses.length > 0 || data.tasks.length > 0 || data.goals.length > 0;

  const handleCreateCourse = async () => {
    if (!courseTitle.trim()) return;
    try {
      await createCourse(courseTitle.trim(), courseDesc.trim() || undefined);
      setCourseTitle('');
      setCourseDesc('');
      setShowCreateCourse(false);
    } catch {
      /* error in store */
    }
  };

  const handleCreatePath = async () => {
    if (!courseId || !goalTitle.trim()) return;
    try {
      await createLearningPath({
        courseId,
        goalTitle: goalTitle.trim(),
        goalDescription: goalDesc.trim() || undefined,
        targetDate: targetDate
          ? new Date(targetDate + 'T23:59:59').toISOString()
          : undefined,
      });
      setGoalTitle('');
      setGoalDesc('');
      setTargetDate('');
      setShowCreateGoal(false);
    } catch {
      /* error in store */
    }
  };

  const handlePropose = async () => {
    if (!courseId || !proposeTitle.trim() || !proposeMinutes) return;
    const minutes = Number(proposeMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    try {
      await proposeTask({
        courseId,
        title: proposeTitle.trim(),
        estimatedMinutes: minutes,
        description: proposeDesc.trim() || undefined,
      });
      setProposeTitle('');
      setProposeMinutes('');
      setProposeDesc('');
      setShowPropose(false);
    } catch {
      /* error in store */
    }
  };

  const handleConfirm = async (taskId: string) => {
    try {
      await confirmTask(taskId);
    } catch {
      /* error in store */
    }
  };

  const handleReject = async (taskId: string) => {
    try {
      await rejectSuggestion(taskId);
    } catch {
      /* error in store */
    }
  };

  const handleReplan = async () => {
    if (!courseId) return;
    try {
      await plan(courseId);
    } catch {
      /* error in store */
    }
  };

  const handleDiagnose = async () => {
    if (!courseId) return;
    try {
      await diagnoseGaps(courseId);
    } catch {
      /* error in store */
    }
  };

  const handleSkipDay = async () => {
    if (!courseId || !skipDate) return;
    try {
      await skipDay(courseId, skipDate);
      setSkipDate('');
    } catch {
      /* error in store */
    }
  };

  const handleConfirmGap = async (gapId: string) => {
    try {
      await confirmDiagnosticGap(gapId);
    } catch {
      /* error in store */
    }
  };

  const handleDismissGap = async (gapId: string) => {
    try {
      await dismissDiagnosticGap(gapId);
    } catch {
      /* error in store */
    }
  };

  const handleStartLearning = async (taskId?: string) => {
    if (!courseId) return;
    const task =
      (taskId && courseTasks.find((t) => t.id === taskId)) ||
      today[0] ||
      confirmed[0] ||
      courseTasks.find(
        (t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'pending_suggestion',
      ) ||
      null;
    try {
      await createSession({
        courseId,
        taskId: task?.id,
        notes: task ? `Learning: ${task.title}` : 'Learning session',
      });
      setActiveTaskId(task?.id ?? null);
      setActiveLearningView('session');
    } catch {
      /* error in store */
    }
  };

  if (!hasAnyData) {
    return (
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        )}
        <EmptyState
          icon={<PixelIcon name="nav-feed" size={32} aria-hidden />}
          title="开始你的学习之旅"
          description="创建一门课程并设定学习目标。系统将用规则式四阶段路径（基础概念 → 核心原理 → 实践练习 → 复盘评估）拆解任务并排程——非 AI 生成。"
          action={
            <div className="flex flex-col sm:flex-row gap-3">
              <PrimaryButton
                onClick={() => setShowCreateCourse(true)}
                aria-label="Create first course"
              >
                <PixelIcon name="action-plus" size={16} aria-hidden className="mr-1.5" />
                创建课程
              </PrimaryButton>
              <SecondaryButton
                onClick={() => setActiveLearningView('knowledge')}
                aria-label="Go to knowledge base"
              >
                <PixelIcon name="nav-knowledge" size={16} aria-hidden className="mr-1.5" />
                导入资料
              </SecondaryButton>
            </div>
          }
        />
        {showCreateCourse && (
          <div className="max-w-md mx-auto px-6 pb-12">
            <CourseForm
              title={courseTitle}
              desc={courseDesc}
              loading={loading}
              onTitle={setCourseTitle}
              onDesc={setCourseDesc}
              onSubmit={handleCreateCourse}
              onCancel={() => setShowCreateCourse(false)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        {/* Header actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-classic text-xl tracking-widest text-[var(--text-primary)] uppercase">
              学习动态
            </h1>
            <p className="font-zh text-sm text-[var(--text-secondary)] mt-1">
              今日任务、进度与下一步学习
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PlanningDropdown
              courseId={courseId}
              loading={loading}
              skipDate={skipDate}
              onSkipDateChange={setSkipDate}
              onCreateCourse={() => setShowCreateCourse((v) => !v)}
              onCreateGoal={() => setShowCreateGoal((v) => !v)}
              onPropose={() => setShowPropose((v) => !v)}
              onReplan={handleReplan}
              onDiagnose={handleDiagnose}
              onSkipDay={handleSkipDay}
            />
            <PrimaryButton
              onClick={() => handleStartLearning()}
              disabled={!courseId || loading}
              aria-label="Start learning session"
            >
              <PixelIcon name="action-play" size={16} aria-hidden className="mr-1" />
              开始学习
            </PrimaryButton>
          </div>
        </div>

        {/* Course selector + progress */}
        {courses.length > 0 && (
          <section className="border border-[var(--border)] bg-[var(--bg-primary)]/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="font-tech text-xs text-[var(--text-muted)] uppercase tracking-wider">
                当前课程
              </label>
              <select
                value={courseId || ''}
                onChange={(e) => setSelectedCourseId(e.target.value || null)}
                className="flex-1 min-w-[160px] bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-1.5 font-zh text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="Select course"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <ProgressBar
              value={progress.done}
              max={progress.total || 1}
              label={`课程进度 ${progress.done}/${progress.total}`}
            />
          </section>
        )}

        {showCreateCourse && (
          <CourseForm
            title={courseTitle}
            desc={courseDesc}
            loading={loading}
            onTitle={setCourseTitle}
            onDesc={setCourseDesc}
            onSubmit={handleCreateCourse}
            onCancel={() => setShowCreateCourse(false)}
          />
        )}

        {showCreateGoal && courseId && (
          <section className="border border-[var(--border)] bg-[var(--bg-primary)]/60 p-4 space-y-3">
            <h2 className="font-classic text-sm tracking-widest uppercase text-[var(--text-primary)]">
              创建学习目标（规则四阶段）
            </h2>
            <p className="font-zh text-xs text-[var(--text-muted)]">
              将按「基础概念 / 核心原理 / 实践练习 / 复盘评估」拆解单元与任务，再调用规则排程器分配时间。不是 AI 生成。
            </p>
            <input
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              placeholder="目标标题，例如：掌握线性代数基础"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Goal title"
            />
            <textarea
              value={goalDesc}
              onChange={(e) => setGoalDesc(e.target.value)}
              placeholder="可选描述"
              rows={2}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Goal description"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="font-tech text-xs text-[var(--text-muted)]">
                目标日期
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="ml-2 bg-[var(--bg-secondary)] border border-[var(--border)] px-2 py-1 font-tech text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                />
              </label>
              <PrimaryButton onClick={handleCreatePath} disabled={loading || !goalTitle.trim()}>
                生成路径并排程
              </PrimaryButton>
              <SecondaryButton onClick={() => setShowCreateGoal(false)}>取消</SecondaryButton>
            </div>
          </section>
        )}

        {showPropose && courseId && (
          <section className="border border-[var(--border)] bg-[var(--bg-primary)]/60 p-4 space-y-3">
            <h2 className="font-classic text-sm tracking-widest uppercase text-[var(--text-primary)]">
              建议学习任务
            </h2>
            <input
              value={proposeTitle}
              onChange={(e) => setProposeTitle(e.target.value)}
              placeholder="任务标题"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Task title"
            />
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="number"
                min={1}
                value={proposeMinutes}
                onChange={(e) => setProposeMinutes(e.target.value)}
                placeholder="预计分钟"
                className="w-32 bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-tech text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="Estimated minutes"
              />
              <PrimaryButton
                onClick={handlePropose}
                disabled={loading || !proposeTitle.trim() || !proposeMinutes}
              >
                建议
              </PrimaryButton>
              <SecondaryButton onClick={() => setShowPropose(false)}>取消</SecondaryButton>
            </div>
            <textarea
              value={proposeDesc}
              onChange={(e) => setProposeDesc(e.target.value)}
              placeholder="可选描述"
              rows={2}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Task description"
            />
          </section>
        )}

        <TaskSection
          title="今日任务"
          subtitle="今日需完成的计划任务"
          icon={<CalendarClock size={iconSizes.sm} aria-hidden />}
          empty="今天没有排定任务。可从已确认任务中排程，或点击「规划 → 重新规划」。"
          tasks={today}
          onStart={(id) => handleStartLearning(id)}
        />

        <section className="border border-[var(--border)] bg-[var(--bg-primary)]/60 p-4 space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <PixelIcon name="plan-propose" size={16} aria-hidden />
            <h2 className="font-classic text-sm tracking-widest uppercase text-[var(--text-primary)]">
              待确认
            </h2>
            <span className="font-tech text-xs text-[var(--text-muted)]">({pending.length + courseGaps.length})</span>
          </div>
          <p className="font-zh text-xs text-[var(--text-muted)] mb-2">
            规划建议与诊断缺口需确认后才会进入排程。
          </p>
          {pending.length === 0 && courseGaps.length === 0 ? (
            <p className="font-zh text-sm text-[var(--text-muted)] border border-dashed border-[var(--border-20)] px-4 py-6 text-center">
              暂无待确认的建议。新规划生成的建议或诊断缺口会显示在这里。
            </p>
          ) : (
            <ul className="space-y-2">
              {pending.map((task) => (
                <PendingInboxItem
                  key={task.id}
                  title={task.title}
                  badge="建议"
                  meta={`${task.estimatedMinutes} min`}
                  extra={<StatusBadge status={task.status} />}
                >
                  <SecondaryButton
                    onClick={() => handleConfirm(task.id)}
                    disabled={loading}
                    aria-label={`Confirm task: ${task.title}`}
                  >
                    <PixelIcon name="action-check" size={16} className="mr-1" aria-hidden />
                    确认
                  </SecondaryButton>
                  <DestructiveButton
                    onClick={() => handleReject(task.id)}
                    disabled={loading}
                    aria-label={`Reject task: ${task.title}`}
                  >
                    <PixelIcon name="action-x" size={16} className="mr-1" aria-hidden />
                    拒绝
                  </DestructiveButton>
                </PendingInboxItem>
              ))}
              {courseGaps.map((gap) => (
                <PendingInboxItem
                  key={gap.id}
                  title={gap.topic}
                  badge="诊断"
                  meta={gap.reason}
                  extra={
                    <span className="font-tech text-[10px] uppercase px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-muted)]">
                      {gap.severity}
                    </span>
                  }
                >
                  <SecondaryButton
                    onClick={() => handleConfirmGap(gap.id)}
                    disabled={loading}
                    aria-label={`Confirm gap: ${gap.topic}`}
                  >
                    <PixelIcon name="action-check" size={16} className="mr-1" aria-hidden />
                    确认
                  </SecondaryButton>
                  <DestructiveButton
                    onClick={() => handleDismissGap(gap.id)}
                    disabled={loading}
                    aria-label={`Dismiss gap: ${gap.topic}`}
                  >
                    <PixelIcon name="action-x" size={16} className="mr-1" aria-hidden />
                    忽略
                  </DestructiveButton>
                </PendingInboxItem>
              ))}
            </ul>
          )}
        </section>

        <TaskSection
          title="已确认任务"
          subtitle="已确认待排程的学习任务"
          icon={<PixelIcon name="session-open" size={16} aria-hidden />}
          empty="没有已确认的任务。请在待确认列表中确认任务。"
          tasks={confirmed}
          onStart={(id) => handleStartLearning(id)}
        />

        <LearningCalendar tasks={courseTasks} onStartTask={(id) => handleStartLearning(id)} />

        <TaskSection
          title="已完成"
          subtitle="已完成的挑战与学习任务"
          icon={<PixelIcon name="session-done" size={16} aria-hidden />}
          empty="尚未完成任何任务。开始你的第一个学习会话吧！"
          tasks={done.slice(0, 20)}
          showStart={false}
        />
      </div>
    </div>
  );
}

function PlanningDropdown({
  courseId,
  loading,
  skipDate,
  onSkipDateChange,
  onCreateCourse,
  onCreateGoal,
  onPropose,
  onReplan,
  onDiagnose,
  onSkipDay,
}: {
  courseId: string | null;
  loading: boolean;
  skipDate: string;
  onSkipDateChange: (v: string) => void;
  onCreateCourse: () => void;
  onCreateGoal: () => void;
  onPropose: () => void;
  onReplan: () => void;
  onDiagnose: () => void;
  onSkipDay: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const item = (label: string, icon: PixelIconName, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      disabled={disabled}
      className="w-full text-left px-3 py-2 flex items-center gap-2 font-zh text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/50 hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <PixelIcon name={icon} size={16} aria-hidden />
      {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <SecondaryButton
        onClick={() => setOpen((v) => !v)}
        aria-label="Planning actions"
        aria-expanded={open}
      >
        <PixelIcon name="plan-replan" size={16} aria-hidden className="mr-1" />
        规划
      </SecondaryButton>
      {open && (
        <div className="absolute right-0 mt-1 w-56 border border-[var(--border)] bg-[var(--bg-primary)] shadow-lg z-20 py-1">
          {item('创建课程', 'action-plus', onCreateCourse)}
          {item('学习目标', 'plan-goal', onCreateGoal, !courseId)}
          {item('建议任务', 'plan-propose', onPropose, !courseId)}
          {item('重新规划', 'plan-replan', onReplan, !courseId || loading)}
          {item('诊断缺口', 'plan-diagnose', onDiagnose, !courseId || loading)}
          <div className="px-3 py-2 border-t border-[var(--border-20)]">
            <label className="font-tech text-xs text-[var(--text-muted)] sr-only" htmlFor="skip-day">
              跳过日期
            </label>
            <div className="flex items-center gap-2">
              <input
                id="skip-day"
                type="date"
                value={skipDate}
                onChange={(e) => onSkipDateChange(e.target.value)}
                className="flex-1 min-w-0 bg-[var(--bg-secondary)] border border-[var(--border)] px-2 py-1 font-tech text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="Skip study day"
              />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSkipDay();
                }}
                disabled={!courseId || !skipDate || loading}
                className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border-20)] text-[var(--text-secondary)] font-zh text-xs hover:bg-[var(--bg-tertiary)]/50 hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PixelIcon name="plan-skip" size={16} aria-hidden />
                跳过某日
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CourseForm({
  title,
  desc,
  loading,
  onTitle,
  onDesc,
  onSubmit,
  onCancel,
}: {
  title: string;
  desc: string;
  loading: boolean;
  onTitle: (v: string) => void;
  onDesc: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="border border-[var(--border)] bg-[var(--bg-primary)]/60 p-4 space-y-3">
      <h2 className="font-classic text-sm tracking-widest uppercase text-[var(--text-primary)]">
        创建课程
      </h2>
      <input
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="课程名称"
        className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label="Course title"
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
      />
      <textarea
        value={desc}
        onChange={(e) => onDesc(e.target.value)}
        placeholder="可选描述"
        rows={2}
        className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label="Course description"
      />
      <div className="flex gap-2">
        <PrimaryButton onClick={onSubmit} disabled={loading || !title.trim()}>
          创建
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>取消</SecondaryButton>
      </div>
    </section>
  );
}

function PendingInboxItem({
  title,
  badge,
  meta,
  extra,
  children,
}: {
  title: string;
  badge: string;
  meta?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 border border-[var(--border-20)] bg-[var(--bg-primary)]/50 hover:border-[var(--border-40)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
            {title}
          </span>
          <span className="font-tech text-[10px] uppercase px-1.5 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/10">
            {badge}
          </span>
          {extra}
        </div>
        {meta && <p className="font-zh text-xs text-[var(--text-secondary)]">{meta}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

function TaskSection({
  title,
  subtitle,
  icon,
  empty,
  tasks,
  onStart,
  showStart = true,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  empty: string;
  tasks: StudyTask[];
  onStart?: (id: string) => void;
  showStart?: boolean;
  actions?: (task: StudyTask) => ReactNode;
}) {
  const canStart = (task: StudyTask) =>
    showStart &&
    task.status !== 'done' &&
    task.status !== 'completed' &&
    task.status !== 'pending_suggestion';

  return (
    <section>
      <div className="mb-3 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent)]">{icon}</span>
          <h2 className="font-classic text-sm tracking-widest uppercase text-[var(--text-primary)]">
            {title}
          </h2>
          <span className="font-tech text-xs text-[var(--text-muted)]">({tasks.length})</span>
        </div>
        {subtitle && (
          <p className="font-zh text-xs text-[var(--text-muted)] pl-6">{subtitle}</p>
        )}
      </div>
      {tasks.length === 0 ? (
        <p className="font-zh text-sm text-[var(--text-muted)] border border-dashed border-[var(--border-20)] px-4 py-6 text-center">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 border border-[var(--border-20)] bg-[var(--bg-primary)]/50 hover:border-[var(--border-40)] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                    {task.title}
                  </span>
                  <StatusBadge status={task.status} />
                </div>
                <div className="font-tech text-xs text-[var(--text-muted)] flex flex-wrap gap-3">
                  <span>{task.estimatedMinutes} min</span>
                  {task.scheduledStart && (
                    <span>排程 {formatDateTime(task.scheduledStart)}</span>
                  )}
                  {task.deadline && <span>截止 {formatDateTime(task.deadline)}</span>}
                </div>
              </div>
              {actions && actions(task)}
              {onStart && canStart(task) && (
                <SecondaryButton
                  onClick={() => onStart(task.id)}
                  aria-label={`Start learning: ${task.title}`}
                >
                  <PixelIcon name="action-play" size={16} className="mr-1" aria-hidden />
                  开始
                </SecondaryButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
