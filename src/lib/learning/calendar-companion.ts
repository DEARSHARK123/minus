/**
 * B06 Calendar companion — agent brief + deterministic planner slots.
 * Uses LearnerContextPack audience `calendar`. Mutations stay propose≠commit.
 */

import {
  type LearningData,
  type PlanProposal,
  type PlanResult,
  type PlanScheduleDiff,
  type StudyTask,
  type TaskStatus,
} from '@/types/learning';
import {
  buildLearnerContextPack,
  type LearnerContextPack,
} from '@/lib/memory/context-pack';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';
import { planStudySchedule, type PlanOptions } from './planner';
import type { LearnerMemoryData } from '@/lib/memory/learner-memory-core';

export type CalendarConflictHint = {
  kind: 'overlap' | 'overload' | 'deadline_risk' | 'defer';
  taskIds: string[];
  message: string;
};

export type CalendarBrief = {
  /** Chinese multi-line brief for companion pane. */
  summary: string;
  /** Load explanation (minutes / task count). */
  loadExplanation: string;
  /** Conflict / defer suggestions (not committed). */
  conflictHints: CalendarConflictHint[];
  /** Whether brief used LLM enrichment (false = deterministic fallback). */
  agentGenerated: boolean;
  /** Context pack was loaded (may still be empty). */
  contextPackLoaded: boolean;
  contextSummaryLine: string;
  generatedAt: string;
};

export type BuildCalendarBriefInput = {
  data: LearningData;
  courseId?: string | null;
  now?: Date;
  /** Preloaded pack; if omitted, caller should use buildCalendarBriefAsync. */
  contextPack?: LearnerContextPack;
  agentGenerated?: boolean;
};

/**
 * Pure brief builder. Prefer buildCalendarBriefAsync so ContextPack is loaded.
 */
export function buildCalendarBrief(input: BuildCalendarBriefInput): CalendarBrief {
  const now = input.now ?? new Date();
  const pack = input.contextPack ?? {
    empty: true,
    labeledBlock: '',
    summaryLine: '',
    entries: [],
  };

  const tasks = filterCourseTasks(input.data.tasks, input.courseId);
  const today = tasksForLocalDay(tasks, now);
  const pending = tasks.filter((t) => t.status === 'pending_suggestion');
  const confirmedOrScheduled = tasks.filter(
    (t) =>
      t.status === 'confirmed' ||
      t.status === 'scheduled' ||
      t.status === 'in_progress',
  );

  const todayMinutes = today.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
  const loadExplanation = buildLoadExplanation(today, todayMinutes, confirmedOrScheduled.length);
  const conflictHints = detectConflictHints(tasks, now);

  const lines: string[] = [];
  lines.push(`今日 ${formatLocalDate(now)}：已排/待办 ${today.length} 项，约 ${todayMinutes} 分钟。`);
  if (pending.length > 0) {
    lines.push(`另有 ${pending.length} 条待确认建议（未写入日程）。`);
  }
  if (pack.summaryLine) {
    lines.push(`学习者上下文：${pack.summaryLine}`);
  } else {
    lines.push('学习者上下文：暂无可用记忆（ContextPack 为空）。');
  }
  if (conflictHints.length > 0) {
    lines.push(`负荷提示：${conflictHints[0]!.message}`);
  } else if (today.length === 0) {
    lines.push('今日暂无已确认任务，可从待确认建议中挑选，或稍后重新规划。');
  } else {
    lines.push('日程无严重冲突；可按确认过的计划推进。');
  }

  return {
    summary: lines.join('\n'),
    loadExplanation,
    conflictHints,
    agentGenerated: input.agentGenerated === true,
    contextPackLoaded: true,
    contextSummaryLine: pack.summaryLine,
    generatedAt: now.toISOString(),
  };
}

/**
 * Server path: always calls loadLearnerContextPack('calendar').
 */
export async function buildCalendarBriefAsync(
  data: LearningData,
  options?: { courseId?: string | null; now?: Date },
): Promise<CalendarBrief> {
  const pack = await loadLearnerContextPack('calendar');
  return buildCalendarBrief({
    data,
    courseId: options?.courseId,
    now: options?.now,
    contextPack: pack,
    agentGenerated: false,
  });
}

/** Test helper: build pack from in-memory learner data without disk I/O. */
export function buildCalendarBriefWithMemory(
  data: LearningData,
  memory: LearnerMemoryData,
  options?: { courseId?: string | null; now?: Date },
): CalendarBrief {
  const pack = buildLearnerContextPack(memory, 'calendar');
  return buildCalendarBrief({
    data,
    courseId: options?.courseId,
    now: options?.now,
    contextPack: pack,
    agentGenerated: false,
  });
}

/**
 * Deterministic planner as a proposal (no persistence).
 */
export function proposePlanSchedule(
  data: LearningData,
  options: PlanOptions,
): PlanProposal {
  const plan = planStudySchedule(data, options);
  const diffs = computePlanDiffs(data.tasks, plan);
  const createdAt = (options.now ?? new Date()).toISOString();
  return {
    id: `plan_${createdAt}_${options.courseId}`,
    courseId: options.courseId,
    baseRevision: computePlanningRevision(data),
    createdAt,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    constraints: {
      availableDays: options.availableDays ? [...options.availableDays] : undefined,
      dailyBudgetMinutes: options.dailyBudgetMinutes,
      dayStartHour: options.dayStartHour,
      dayEndHour: options.dayEndHour,
      deadlinePreference: options.deadlinePreference,
    },
    plan,
    diffs,
    applied: false,
  };
}

/** Stable signature for schedule-relevant state used by optimistic confirmation. */
export function computePlanningRevision(data: LearningData): string {
  const tasks = data.tasks
    .map((task) => [
      task.id,
      task.courseId,
      task.status,
      task.locked,
      task.estimatedMinutes,
      task.deadline ?? '',
      task.scheduledStart ?? '',
      task.scheduledEnd ?? '',
      task.updatedAt,
    ].join('|'))
    .sort();
  const timetable = data.timetable
    .map((slot) => [slot.id, slot.courseId, slot.weekday, slot.start, slot.end, slot.updatedAt].join('|'))
    .sort();
  const input = `${tasks.join('\n')}\n--\n${timetable.join('\n')}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function computePlanDiffs(
  beforeTasks: StudyTask[],
  plan: PlanResult,
): PlanScheduleDiff[] {
  const beforeById = new Map(beforeTasks.map((t) => [t.id, t]));
  const diffs: PlanScheduleDiff[] = [];

  for (const after of plan.tasks) {
    const before = beforeById.get(after.id);
    if (!before) {
      diffs.push({
        taskId: after.id,
        title: after.title,
        beforeStatus: 'pending_suggestion' as TaskStatus,
        afterStart: after.scheduledStart,
        afterEnd: after.scheduledEnd,
        afterStatus: after.status,
      });
      continue;
    }
    const changed =
      before.scheduledStart !== after.scheduledStart ||
      before.scheduledEnd !== after.scheduledEnd ||
      before.status !== after.status;
    if (!changed) continue;
    diffs.push({
      taskId: after.id,
      title: after.title,
      beforeStart: before.scheduledStart,
      beforeEnd: before.scheduledEnd,
      beforeStatus: before.status,
      afterStart: after.scheduledStart,
      afterEnd: after.scheduledEnd,
      afterStatus: after.status,
    });
  }
  return diffs;
}

function filterCourseTasks(tasks: StudyTask[], courseId?: string | null): StudyTask[] {
  if (!courseId) return tasks;
  return tasks.filter((t) => t.courseId === courseId);
}

function tasksForLocalDay(tasks: StudyTask[], now: Date): StudyTask[] {
  const start = startOfLocalDay(now).getTime();
  const end = start + 86400000 - 1;
  return tasks.filter((t) => {
    if (t.status === 'done' || t.status === 'completed' || t.status === 'pending_suggestion') {
      return false;
    }
    const points = [t.scheduledStart, t.scheduledEnd, t.deadline]
      .filter(Boolean)
      .map((s) => Date.parse(s!));
    if (points.length === 0) {
      return t.status === 'confirmed' || t.status === 'in_progress';
    }
    return points.some((ms) => ms >= start && ms <= end);
  });
}

function buildLoadExplanation(
  today: StudyTask[],
  todayMinutes: number,
  activeCount: number,
): string {
  if (today.length === 0) {
    return `今日负荷：0 项。课程内活跃任务 ${activeCount} 个（含未排到今日的）。`;
  }
  let band: string;
  if (todayMinutes <= 45) band = '较轻';
  else if (todayMinutes <= 120) band = '适中';
  else if (todayMinutes <= 240) band = '偏重';
  else band = '过重';
  return `今日负荷：${today.length} 项、合计约 ${todayMinutes} 分钟（${band}）。`;
}

function detectConflictHints(tasks: StudyTask[], now: Date): CalendarConflictHint[] {
  const hints: CalendarConflictHint[] = [];
  const scheduled = tasks.filter(
    (t) =>
      t.scheduledStart &&
      t.scheduledEnd &&
      (t.status === 'scheduled' || t.status === 'confirmed' || t.status === 'in_progress'),
  );

  // Pairwise overlap on same day
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]!;
      const b = scheduled[j]!;
      const a0 = Date.parse(a.scheduledStart!);
      const a1 = Date.parse(a.scheduledEnd!);
      const b0 = Date.parse(b.scheduledStart!);
      const b1 = Date.parse(b.scheduledEnd!);
      if (a0 < b1 && b0 < a1) {
        hints.push({
          kind: 'overlap',
          taskIds: [a.id, b.id],
          message: `「${a.title}」与「${b.title}」时段重叠，建议延期其中一项。`,
        });
      }
    }
  }

  const todayMinutes = tasksForLocalDay(tasks, now).reduce(
    (s, t) => s + t.estimatedMinutes,
    0,
  );
  if (todayMinutes > 240) {
    const ids = tasksForLocalDay(tasks, now).map((t) => t.id);
    hints.push({
      kind: 'overload',
      taskIds: ids,
      message: `今日预估 ${todayMinutes} 分钟，负荷过重，建议将部分任务延后。`,
    });
  }

  const horizon = now.getTime() + 2 * 86400000;
  for (const t of tasks) {
    if (!t.deadline || t.status === 'done' || t.status === 'completed') continue;
    const dl = Date.parse(t.deadline);
    if (Number.isNaN(dl)) continue;
    if (dl < now.getTime()) {
      hints.push({
        kind: 'deadline_risk',
        taskIds: [t.id],
        message: `「${t.title}」已过截止日期，建议优先处理或调整截止时间。`,
      });
    } else if (dl <= horizon && !t.scheduledStart) {
      hints.push({
        kind: 'defer',
        taskIds: [t.id],
        message: `「${t.title}」两日内到期且未排程，建议确认后重新规划。`,
      });
    }
  }

  return hints.slice(0, 6);
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
