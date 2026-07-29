/**
 * UX05 — Pure full-month calendar grid, date ownership, overflow, responsive modes.
 * Default surface is 6×7 = 42 cells; week is secondary.
 */

import type { StudyTask, TaskStatus } from '@/types/learning';

export type CalendarViewMode = 'month' | 'week';

/** Layout mode by viewport width (visual contract breakpoints). */
export type CalendarLayoutMode = 'desktop' | 'tablet' | 'mobile';

export type CalendarCell = {
  date: Date;
  /** Day-of-month number for month view, or M/D for week. */
  dayLabel: string;
  isToday: boolean;
  isCurrentMonth: boolean;
  isSelected: boolean;
  tasks: StudyTask[];
};

export type CalendarGridResult = {
  cells: CalendarCell[];
  label: string;
  view: CalendarViewMode;
};

export type CellOverflow = {
  visible: StudyTask[];
  hidden: StudyTask[];
  overflowCount: number;
  /** e.g. 「还有 3 项」; null when nothing hidden. */
  overflowLabel: string | null;
};

export const MONTH_CELL_COUNT = 42;
export const WEEK_CELL_COUNT = 7;
/** Readable blocks before collapsing remainder. */
export const DEFAULT_MAX_VISIBLE_TASKS = 3;

/** Statuses that may appear on the confirmed calendar grid. */
export const CALENDAR_GRID_STATUSES: readonly TaskStatus[] = [
  'confirmed',
  'scheduled',
  'in_progress',
] as const;

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

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** ISO weekday: Mon=1 … Sun=7. */
export function isoWeekday(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

export function isCalendarGridTask(task: StudyTask): boolean {
  return (CALENDAR_GRID_STATUSES as readonly string[]).includes(task.status);
}

/**
 * Date ownership for a local day:
 * - Interval [scheduledStart, scheduledEnd] spans any part of the day → owns day
 * - Deadline-only (or deadline outside the schedule interval) on that calendar day → owns day
 * - Single-point start without end → start day only
 * - Pending / done never own grid cells
 */
export function taskOccupiesLocalDay(task: StudyTask, day: Date): boolean {
  if (!isCalendarGridTask(task)) return false;

  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = endOfLocalDay(day).getTime();

  const startMs = task.scheduledStart ? Date.parse(task.scheduledStart) : NaN;
  const endMs = task.scheduledEnd ? Date.parse(task.scheduledEnd) : NaN;
  const deadlineMs = task.deadline ? Date.parse(task.deadline) : NaN;

  const hasStart = Number.isFinite(startMs);
  const hasEnd = Number.isFinite(endMs);
  const hasDeadline = Number.isFinite(deadlineMs);

  if (hasStart && hasEnd) {
    // Inclusive range overlap: task covers any instant on this local day.
    if (startMs <= dayEnd && endMs >= dayStart) return true;
  } else if (hasStart) {
    if (startMs >= dayStart && startMs <= dayEnd) return true;
  } else if (hasEnd) {
    if (endMs >= dayStart && endMs <= dayEnd) return true;
  }

  // Deadline ownership: show on the deadline's local calendar day
  // even when a multi-day schedule already covered it (still one cell entry).
  if (hasDeadline && deadlineMs >= dayStart && deadlineMs <= dayEnd) {
    return true;
  }

  return false;
}

export function tasksOwnedByDay(tasks: StudyTask[], day: Date): StudyTask[] {
  return tasks.filter((t) => taskOccupiesLocalDay(t, day));
}

export function filterGridTasks(tasks: StudyTask[]): StudyTask[] {
  return tasks.filter(isCalendarGridTask);
}

export function collapseOverflow(
  tasks: StudyTask[],
  maxVisible: number = DEFAULT_MAX_VISIBLE_TASKS,
): CellOverflow {
  const max = Math.max(0, maxVisible);
  if (tasks.length <= max) {
    return {
      visible: tasks,
      hidden: [],
      overflowCount: 0,
      overflowLabel: null,
    };
  }
  const visible = tasks.slice(0, max);
  const hidden = tasks.slice(max);
  const overflowCount = hidden.length;
  return {
    visible,
    hidden,
    overflowCount,
    overflowLabel: `还有 ${overflowCount} 项`,
  };
}

/** Keep an explicitly located task visible before applying cell overflow. */
export function prioritizeTaskForOverflow(
  tasks: StudyTask[],
  taskId?: string | null,
): StudyTask[] {
  if (!taskId) return tasks;
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index <= 0) return tasks;
  return [tasks[index]!, ...tasks.slice(0, index), ...tasks.slice(index + 1)];
}

export function navigateAnchor(
  anchor: Date,
  view: CalendarViewMode,
  direction: -1 | 1,
): Date {
  const next = new Date(anchor);
  if (view === 'week') {
    next.setDate(next.getDate() + direction * 7);
  } else {
    next.setMonth(next.getMonth() + direction);
  }
  return next;
}

export function todayAnchor(now: Date = new Date()): Date {
  return startOfLocalDay(now);
}

/**
 * Responsive layout mode for Calendar shell.
 * ≥1200 desktop companion+grid; 768–1199 collapsible companion; <768 mobile drawer.
 */
export function calendarLayoutMode(widthPx: number): CalendarLayoutMode {
  if (widthPx >= 1200) return 'desktop';
  if (widthPx >= 768) return 'tablet';
  return 'mobile';
}

export function companionVisibleByDefault(mode: CalendarLayoutMode): boolean {
  return mode === 'desktop';
}

/** Keep month cells readable on tablet/mobile; allow horizontal scroll below desktop. */
export function preferHorizontalMonthScroll(mode: CalendarLayoutMode): boolean {
  return mode !== 'desktop';
}

/** Day-detail drawer instead of always-on companion on mobile. */
export function preferDayDetailDrawer(mode: CalendarLayoutMode): boolean {
  return mode === 'mobile';
}

export function buildMonthCells(
  anchor: Date,
  tasks: StudyTask[],
  options?: { selectedDate?: Date | null; now?: Date },
): CalendarGridResult {
  const now = options?.now ?? new Date();
  const selected = options?.selectedDate ?? null;
  const gridTasks = filterGridTasks(tasks);

  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfLocalDay(firstOfMonth);
  const offset = isoWeekday(start) - 1;
  start.setDate(start.getDate() - offset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < MONTH_CELL_COUNT; i++) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    cells.push({
      date: day,
      dayLabel: String(day.getDate()),
      isToday: isSameLocalDay(day, now),
      isCurrentMonth:
        day.getFullYear() === anchor.getFullYear() &&
        day.getMonth() === anchor.getMonth(),
      isSelected: selected ? isSameLocalDay(day, selected) : false,
      tasks: tasksOwnedByDay(gridTasks, day),
    });
  }

  return {
    cells,
    label: `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`,
    view: 'month',
  };
}

export function buildWeekCells(
  anchor: Date,
  tasks: StudyTask[],
  options?: { selectedDate?: Date | null; now?: Date },
): CalendarGridResult {
  const now = options?.now ?? new Date();
  const selected = options?.selectedDate ?? null;
  const gridTasks = filterGridTasks(tasks);

  const start = startOfLocalDay(anchor);
  const offset = isoWeekday(start) - 1;
  start.setDate(start.getDate() - offset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < WEEK_CELL_COUNT; i++) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    cells.push({
      date: day,
      dayLabel: `${day.getMonth() + 1}/${day.getDate()}`,
      isToday: isSameLocalDay(day, now),
      isCurrentMonth: true,
      isSelected: selected ? isSameLocalDay(day, selected) : false,
      tasks: tasksOwnedByDay(gridTasks, day),
    });
  }

  const end = cells[cells.length - 1]!.date;
  const label = `${formatMonthDay(cells[0]!.date)} – ${formatMonthDay(end)}`;
  return { cells, label, view: 'week' };
}

export function buildCalendarGrid(
  view: CalendarViewMode,
  anchor: Date,
  tasks: StudyTask[],
  options?: { selectedDate?: Date | null; now?: Date },
): CalendarGridResult {
  return view === 'week'
    ? buildWeekCells(anchor, tasks, options)
    : buildMonthCells(anchor, tasks, options);
}

function formatMonthDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
