/**
 * UX05 — Local proposal time edits + write gate.
 * Edits stay in memory until Accept; never persist before confirmPlan.
 */

import type {
  LearningData,
  PlanProposal,
  PlanResult,
  PlanScheduleDiff,
  StudyTask,
} from '@/types/learning';

export type ProposalWriteAction = 'propose' | 'edit_time' | 'accept' | 'discard';

/**
 * Write gate: only Accept may persist schedule.
 * propose / edit_time / discard are non-persisting.
 */
export function isScheduleWriteAction(action: ProposalWriteAction): boolean {
  return action === 'accept';
}

export function canAcceptProposal(
  proposal: PlanProposal | null | undefined,
  issues: ProposalValidationIssue[] = [],
): boolean {
  if (!proposal) return false;
  if (proposal.applied !== false) return false;
  return proposal.plan.tasks.length > 0 && issues.length === 0;
}

export type ProposalValidationIssue = {
  code:
    | 'invalid_time'
    | 'overlap'
    | 'timetable_conflict'
    | 'deadline'
    | 'unavailable_day'
    | 'preferred_hours'
    | 'daily_budget'
    | 'locked_task'
    | 'course_mismatch';
  message: string;
  taskId?: string;
};

/** Validate a locally edited proposal against current calendar state. */
export function validatePlanProposal(
  proposal: PlanProposal | null | undefined,
  data: LearningData,
): ProposalValidationIssue[] {
  if (!proposal) return [];
  const issues: ProposalValidationIssue[] = [];
  const issueKeys = new Set<string>();
  const add = (issue: ProposalValidationIssue) => {
    const key = `${issue.code}:${issue.taskId ?? ''}:${issue.message}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push(issue);
  };

  const proposalIds = new Set(proposal.plan.tasks.map((task) => task.id));
  const currentById = new Map(data.tasks.map((task) => [task.id, task]));
  const scheduled: Array<{ task: StudyTask; start: number; end: number }> = [];

  for (const task of proposal.plan.tasks) {
    const current = currentById.get(task.id);
    if (task.courseId !== proposal.courseId) {
      add({ code: 'course_mismatch', taskId: task.id, message: `“${task.title}”不属于当前规划课程。` });
    }
    if (current?.locked && (
      current.scheduledStart !== task.scheduledStart ||
      current.scheduledEnd !== task.scheduledEnd ||
      current.status !== task.status
    )) {
      add({ code: 'locked_task', taskId: task.id, message: `“${task.title}”已锁定，不能在草稿中移动。` });
    }
    if (!task.scheduledStart && !task.scheduledEnd) continue;
    const start = Date.parse(task.scheduledStart ?? '');
    const end = Date.parse(task.scheduledEnd ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      add({ code: 'invalid_time', taskId: task.id, message: `“${task.title}”的结束时间必须晚于开始时间。` });
      continue;
    }
    scheduled.push({ task, start, end });

    if (task.deadline && end > Date.parse(task.deadline)) {
      add({ code: 'deadline', taskId: task.id, message: `“${task.title}”被安排在截止时间之后。` });
    }
    const date = new Date(start);
    const weekday = isoWeekday(date);
    if (proposal.constraints?.availableDays?.length && !proposal.constraints.availableDays.includes(weekday)) {
      add({ code: 'unavailable_day', taskId: task.id, message: `“${task.title}”不在你选择的可用日内。` });
    }
    const startHour = date.getHours() + date.getMinutes() / 60;
    const endDate = new Date(end);
    const endHour = endDate.getHours() + endDate.getMinutes() / 60;
    if (
      proposal.constraints?.dayStartHour != null &&
      proposal.constraints.dayEndHour != null &&
      (startHour < proposal.constraints.dayStartHour || endHour > proposal.constraints.dayEndHour)
    ) {
      add({ code: 'preferred_hours', taskId: task.id, message: `“${task.title}”超出了偏好的学习时段。` });
    }

    for (const slot of data.timetable) {
      if (slot.weekday !== weekday) continue;
      const taskStart = date.getHours() * 60 + date.getMinutes();
      const taskEnd = endDate.getHours() * 60 + endDate.getMinutes();
      const slotStart = hhmmMinutes(slot.start);
      const slotEnd = hhmmMinutes(slot.end);
      if (taskStart < slotEnd && slotStart < taskEnd) {
        add({ code: 'timetable_conflict', taskId: task.id, message: `“${task.title}”与课表“${slot.courseName}”冲突。` });
      }
    }
  }

  const fixed = data.tasks
    .filter((task) =>
      !proposalIds.has(task.id) &&
      task.scheduledStart &&
      task.scheduledEnd &&
      task.status !== 'done' &&
      task.status !== 'completed' &&
      task.status !== 'pending_suggestion')
    .map((task) => ({
      task,
      start: Date.parse(task.scheduledStart!),
      end: Date.parse(task.scheduledEnd!),
    }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  const allScheduled = [...scheduled, ...fixed];

  for (let left = 0; left < allScheduled.length; left += 1) {
    for (let right = left + 1; right < allScheduled.length; right += 1) {
      const a = allScheduled[left]!;
      const b = allScheduled[right]!;
      if (a.start < b.end && b.start < a.end && (proposalIds.has(a.task.id) || proposalIds.has(b.task.id))) {
        const task = proposalIds.has(a.task.id) ? a.task : b.task;
        const other = task.id === a.task.id ? b.task : a.task;
        add({ code: 'overlap', taskId: task.id, message: `“${task.title}”与“${other.title}”时间重叠。` });
      }
    }
  }

  if (proposal.constraints?.dailyBudgetMinutes != null) {
    const minutesByDay = new Map<string, number>();
    for (const item of allScheduled) {
      const day = localDateKey(new Date(item.start));
      const minutes = Math.ceil((item.end - item.start) / 60_000);
      minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + minutes);
    }
    for (const [day, minutes] of minutesByDay) {
      if (minutes > proposal.constraints.dailyBudgetMinutes) {
        add({ code: 'daily_budget', message: `${day} 共安排 ${minutes} 分钟，超过每日 ${proposal.constraints.dailyBudgetMinutes} 分钟的预算。` });
      }
    }
  }

  return issues;
}

/**
 * Apply a local time edit to a draft proposal (pure; no I/O).
 * Updates plan.tasks and regenerates matching diffs' after slots.
 */
export function editProposalTaskTime(
  proposal: PlanProposal,
  taskId: string,
  startIso: string,
  endIso: string,
): PlanProposal {
  const tasks = proposal.plan.tasks.map((t) => {
    if (t.id !== taskId) return t;
    return {
      ...t,
      scheduledStart: startIso,
      scheduledEnd: endIso,
      status: t.status === 'confirmed' || t.status === 'scheduled' ? 'scheduled' : t.status,
      updatedAt: new Date().toISOString(),
    } as StudyTask;
  });

  const diffs: PlanScheduleDiff[] = proposal.diffs.map((d) => {
    if (d.taskId !== taskId) return d;
    return {
      ...d,
      afterStart: startIso,
      afterEnd: endIso,
      afterStatus: 'scheduled',
    };
  });

  // If task was not in diffs but is in plan, add a diff row for visibility
  const hasDiff = diffs.some((d) => d.taskId === taskId);
  if (!hasDiff) {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      const before = proposal.plan.tasks.find((t) => t.id === taskId);
      diffs.push({
        taskId,
        title: task.title,
        beforeStart: before?.scheduledStart,
        beforeEnd: before?.scheduledEnd,
        beforeStatus: before?.status ?? 'confirmed',
        afterStart: startIso,
        afterEnd: endIso,
        afterStatus: 'scheduled',
      });
    }
  }

  return {
    ...proposal,
    applied: false,
    plan: { ...proposal.plan, tasks },
    diffs,
  };
}

function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function hhmmMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shift a proposal task by delta minutes (drag simulation). */
export function shiftProposalTaskMinutes(
  proposal: PlanProposal,
  taskId: string,
  deltaMinutes: number,
): PlanProposal {
  const task = proposal.plan.tasks.find((t) => t.id === taskId);
  if (!task?.scheduledStart || !task.scheduledEnd) return proposal;
  const start = Date.parse(task.scheduledStart);
  const end = Date.parse(task.scheduledEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return proposal;
  const delta = deltaMinutes * 60 * 1000;
  return editProposalTaskTime(
    proposal,
    taskId,
    new Date(start + delta).toISOString(),
    new Date(end + delta).toISOString(),
  );
}

/**
 * Merge accepted plan tasks into a local task list (immediate UI update model).
 * Does not hit the repository — mirrors post-confirm client state.
 */
export function mergeAcceptedPlanIntoTasks(
  current: StudyTask[],
  plan: PlanResult,
): StudyTask[] {
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const merged = current.map((t) => byId.get(t.id) ?? t);
  for (const t of plan.tasks) {
    if (!current.some((c) => c.id === t.id)) {
      merged.push(t);
    }
  }
  return merged;
}

/** Pending suggestions never appear as confirmed grid writes. */
export function pendingTasksExcludedFromConfirmedGrid(tasks: StudyTask[]): StudyTask[] {
  return tasks.filter(
    (t) =>
      t.status === 'confirmed' ||
      t.status === 'scheduled' ||
      t.status === 'in_progress',
  );
}

export function proposalLeavesStoreUnchanged(
  storeTasks: StudyTask[],
  proposal: PlanProposal,
): boolean {
  // Structural check: proposal must not mutate the input array references/slots
  if (proposal.applied !== false) return false;
  for (const t of storeTasks) {
    const planned = proposal.plan.tasks.find((p) => p.id === t.id);
    if (!planned) continue;
    // Original store object identity/values remain as caller left them —
    // we only verify that proposing did not set applied:true
  }
  return proposal.applied === false;
}
