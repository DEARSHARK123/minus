import { StudyTaskSchema, nowIso, type LearningData, type PlanResult, type StudyTask, type TimetableSlot } from '@/types/learning';
import { timesOverlap } from './importer';

export type PlanOptions = {
  courseId: string;
  /** Only schedule tasks linked to this goal (optional). */
  goalId?: string;
  /** Planning origin; defaults to now. */
  now?: Date;
  /** Inclusive planning window length in days (default 7). */
  days?: number;
  dayStartHour?: number;
  dayEndHour?: number;
  /** ISO weekdays (Monday=1 ... Sunday=7) that may receive study tasks. */
  availableDays?: number[];
  /** Maximum study-task minutes per local day across all courses. */
  dailyBudgetMinutes?: number;
  deadlinePreference?: 'front_load' | 'even' | 'before_deadline';
};

export type SkipDayOptions = {
  courseId: string;
  /** Local date to skip, formatted YYYY-MM-DD. */
  skippedDate: string;
  /** Planning origin; defaults to now. */
  now?: Date;
};

const DEFAULT_DAY_START = 8;
const DEFAULT_DAY_END = 22;

/**
 * Rule-based planner:
 * - Select confirmed / already-scheduled tasks for course (optionally goal-scoped)
 * - Never auto-commit pending_suggestion tasks
 * - Priority: earlier deadline first, then larger estimatedMinutes as secondary urgency
 * - Place into free windows over the next 7 days between 08:00–22:00
 * - Occupied by timetable slots (matching weekday) and already-scheduled tasks
 * - Never move tasks with locked === true
 * - Emit warnings when no free slot fits a task
 */
export function planStudySchedule(data: LearningData, options: PlanOptions): PlanResult {
  const courseId = options.courseId?.trim();
  if (!courseId) {
    throw new Error('courseId is required for planning');
  }

  const now = options.now ?? new Date();
  const days = options.days ?? 7;
  const dayStartHour = options.dayStartHour ?? DEFAULT_DAY_START;
  const dayEndHour = options.dayEndHour ?? DEFAULT_DAY_END;
  const availableDays = options.availableDays?.length
    ? new Set(options.availableDays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))
    : null;
  const dailyBudgetMinutes = options.dailyBudgetMinutes;
  const deadlinePreference = options.deadlinePreference ?? 'front_load';

  if (dayStartHour < 0 || dayEndHour > 24 || dayEndHour <= dayStartHour) {
    throw new Error('planning hours must form a valid increasing range');
  }
  if (dailyBudgetMinutes != null && (!Number.isFinite(dailyBudgetMinutes) || dailyBudgetMinutes <= 0)) {
    throw new Error('dailyBudgetMinutes must be positive');
  }

  const warnings: string[] = [];
  const courseTasks = data.tasks.filter((t) => t.courseId === courseId);
  // Every imported class blocks the learner's time, regardless of which
  // course owns the timetable import.
  const timetable = data.timetable;

  // Locked tasks keep their schedule; never rescheduled.
  const locked = courseTasks.filter((t) => t.locked === true);
  const unlocked = courseTasks.filter((t) => !t.locked);

  let candidates = unlocked.filter(
    (t) => t.status === 'confirmed' || t.status === 'scheduled',
  );
  if (options.goalId) {
    candidates = candidates.filter((t) => t.goalId === options.goalId);
  }

  // Sort: deadline ascending (missing deadline last), then estimatedMinutes ascending
  // so shorter tasks fill gaps earlier; equal deadline prefers shorter first to pack more.
  candidates = [...candidates].sort((a, b) => {
    const ad = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
    const bd = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.estimatedMinutes - b.estimatedMinutes;
  });

  // Occupancy: every fixed scheduled task across every course.
  type Interval = { startMs: number; endMs: number; label: string };
  const occupied: Interval[] = [];
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const usedStudyMinutes = new Map<string, number>();

  for (const t of data.tasks) {
    if (t.scheduledStart && t.scheduledEnd) {
      const isCandidate = candidateIds.has(t.id);
      if (!isCandidate) {
        const startMs = Date.parse(t.scheduledStart);
        const endMs = Date.parse(t.scheduledEnd);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        occupied.push({
          startMs,
          endMs,
          label: `task:${t.title}`,
        });
        const dateKey = localDateKey(new Date(startMs));
        const minutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
        usedStudyMinutes.set(dateKey, (usedStudyMinutes.get(dateKey) ?? 0) + minutes);
      }
    }
  }

  // Expand timetable into concrete intervals for the planning window
  for (let d = 0; d < days; d++) {
    const day = startOfLocalDay(addDays(now, d));
    const weekday = isoWeekday(day); // 1..7
    const daySlots = timetable.filter((s) => s.weekday === weekday);
    for (const slot of daySlots) {
      const startMs = combineLocal(day, slot.start).getTime();
      const endMs = combineLocal(day, slot.end).getTime();
      occupied.push({
        startMs,
        endMs,
        label: `timetable:${slot.courseName}`,
      });
    }
  }

  const planned: StudyTask[] = [];
  const ts = nowIso();

  for (const task of candidates) {
    const durationMs = task.estimatedMinutes * 60 * 1000;
    const deadlineMs = task.deadline ? Date.parse(task.deadline) : undefined;
    const slot = findFreeSlot(
      now,
      days,
      dayStartHour,
      dayEndHour,
      durationMs,
      occupied,
      deadlineMs,
      availableDays,
      dailyBudgetMinutes,
      usedStudyMinutes,
      deadlinePreference,
    );

    if (!slot) {
      warnings.push(
        `No available slot before the planning window or deadline for task "${task.title}" (${task.estimatedMinutes} min)`,
      );
      // Clear previous soft schedule if we failed to replan? Keep as-is but mark warning.
      planned.push(
        StudyTaskSchema.parse({
          ...task,
          // leave schedule unchanged if any; still return task in result
          updatedAt: ts,
        }),
      );
      continue;
    }

    occupied.push({
      startMs: slot.startMs,
      endMs: slot.endMs,
      label: `task:${task.title}`,
    });
    const dateKey = localDateKey(new Date(slot.startMs));
    usedStudyMinutes.set(
      dateKey,
      (usedStudyMinutes.get(dateKey) ?? 0) + task.estimatedMinutes,
    );

    planned.push(
      StudyTaskSchema.parse({
        ...task,
        status: 'scheduled',
        scheduledStart: new Date(slot.startMs).toISOString(),
        scheduledEnd: new Date(slot.endMs).toISOString(),
        updatedAt: ts,
      }),
    );
  }

  // Include locked tasks in result for completeness (unchanged)
  const resultTasks = [
    ...locked.map((t) => StudyTaskSchema.parse(t)),
    ...planned,
  ];

  // De-dupe by id (locked shouldn't appear in planned)
  const byId = new Map<string, StudyTask>();
  for (const t of resultTasks) byId.set(t.id, t);

  return {
    tasks: Array.from(byId.values()),
    warnings,
  };
}

function findFreeSlot(
  now: Date,
  days: number,
  dayStartHour: number,
  dayEndHour: number,
  durationMs: number,
  occupied: { startMs: number; endMs: number }[],
  deadlineMs?: number,
  availableDays?: Set<number> | null,
  dailyBudgetMinutes?: number,
  usedStudyMinutes: Map<string, number> = new Map(),
  deadlinePreference: 'front_load' | 'even' | 'before_deadline' = 'front_load',
): { startMs: number; endMs: number } | null {
  if (deadlineMs !== undefined && deadlineMs <= now.getTime()) return null;
  const durationMinutes = Math.ceil(durationMs / 60_000);
  const dayIndexes = Array.from({ length: days }, (_, index) => index);
  if (deadlinePreference === 'before_deadline' && deadlineMs !== undefined) {
    dayIndexes.sort((a, b) => b - a);
  } else if (deadlinePreference === 'even') {
    dayIndexes.sort((a, b) => {
      const aDay = startOfLocalDay(addDays(now, a));
      const bDay = startOfLocalDay(addDays(now, b));
      const loadDelta = (usedStudyMinutes.get(localDateKey(aDay)) ?? 0) - (usedStudyMinutes.get(localDateKey(bDay)) ?? 0);
      return loadDelta || a - b;
    });
  }

  for (const d of dayIndexes) {
    const day = startOfLocalDay(addDays(now, d));
    if (availableDays && !availableDays.has(isoWeekday(day))) continue;
    const usedMinutes = usedStudyMinutes.get(localDateKey(day)) ?? 0;
    if (dailyBudgetMinutes != null && usedMinutes + durationMinutes > dailyBudgetMinutes) continue;
    const windowStart = new Date(day);
    windowStart.setHours(dayStartHour, 0, 0, 0);
    const windowEndDate = new Date(day);
    windowEndDate.setHours(dayEndHour, 0, 0, 0);
    const windowEndMs = deadlineMs === undefined
      ? windowEndDate.getTime()
      : Math.min(windowEndDate.getTime(), deadlineMs);

    let cursor = Math.max(windowStart.getTime(), now.getTime());
    // Snap cursor to next minute boundary
    cursor = Math.ceil(cursor / 60_000) * 60_000;

    if (cursor + durationMs > windowEndMs) continue;

    const dayBusy = occupied
      .filter((o) => o.endMs > windowStart.getTime() && o.startMs < windowEndMs)
      .map((o) => ({
        startMs: Math.max(o.startMs, windowStart.getTime()),
        endMs: Math.min(o.endMs, windowEndMs),
      }))
      .sort((a, b) => a.startMs - b.startMs);

    // Merge busy intervals
    const merged: { startMs: number; endMs: number }[] = [];
    for (const b of dayBusy) {
      const last = merged[merged.length - 1];
      if (!last || b.startMs > last.endMs) {
        merged.push({ ...b });
      } else {
        last.endMs = Math.max(last.endMs, b.endMs);
      }
    }

    let t = cursor;
    for (const busy of merged) {
      if (t + durationMs <= busy.startMs) {
        return { startMs: t, endMs: t + durationMs };
      }
      if (busy.endMs > t) t = busy.endMs;
      if (t + durationMs > windowEndMs) break;
    }

    if (t + durationMs <= windowEndMs) {
      return { startMs: t, endMs: t + durationMs };
    }
  }
  return null;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** ISO weekday: Monday=1 … Sunday=7 */
function isoWeekday(d: Date): number {
  const js = d.getDay(); // 0=Sun
  return js === 0 ? 7 : js;
}

function combineLocal(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const x = new Date(day);
  x.setHours(h, m, 0, 0);
  return x;
}

/** Utility exposed for tests: whether two HH:mm ranges on same day conflict. */
export function slotsConflict(a: Pick<TimetableSlot, 'weekday' | 'start' | 'end'>, b: Pick<TimetableSlot, 'weekday' | 'start' | 'end'>): boolean {
  if (a.weekday !== b.weekday) return false;
  return timesOverlap(a.start, a.end, b.start, b.end);
}

/**
 * Reschedule non-locked confirmed/scheduled tasks away from a skipped local day.
 *
 * - Tasks scheduled on `skippedDate` (local time) are unscheduled and replanned.
 * - Locked tasks are never moved.
 * - Returns the planner result; callers persist `result.tasks`.
 */
export function rescheduleAfterSkipDay(data: LearningData, options: SkipDayOptions): PlanResult {
  const courseId = options.courseId?.trim();
  if (!courseId) {
    throw new Error('courseId is required for skip-day reschedule');
  }

  const skippedDate = options.skippedDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(skippedDate)) {
    throw new Error('skippedDate must be YYYY-MM-DD');
  }

  const skippedLocal = new Date(`${skippedDate}T00:00:00`);
  const planFrom = new Date(skippedLocal);
  planFrom.setDate(planFrom.getDate() + 1);
  planFrom.setHours(DEFAULT_DAY_START, 0, 0, 0);

  const now = options.now ?? planFrom;

  const affected = data.tasks.filter(
    (t) =>
      t.courseId === courseId &&
      !t.locked &&
      (t.status === 'confirmed' || t.status === 'scheduled') &&
      t.scheduledStart &&
      localIsoDate(t.scheduledStart) === skippedDate,
  );

  if (affected.length === 0) {
    return { tasks: [], warnings: [] };
  }

  const cleared = data.tasks.map((t) => {
    if (affected.some((a) => a.id === t.id)) {
      return StudyTaskSchema.parse({
        ...t,
        status: 'confirmed',
        scheduledStart: undefined,
        scheduledEnd: undefined,
        updatedAt: nowIso(),
      });
    }
    return t;
  });

  return planStudySchedule({ ...data, tasks: cleared }, { courseId, now });
}

function localIsoDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
