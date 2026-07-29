'use client';

/**
 * UX05 — Full-month (42-cell) learning calendar.
 * Default: month. Week is secondary. Overflow →「还有 N 项」.
 * Selection + optional day drawer on mobile.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { iconSizes } from '@/lib/icons';
import type { StudyTask } from '@/types/learning';
import {
  MONTH_CELL_COUNT,
  buildCalendarGrid,
  calendarLayoutMode,
  collapseOverflow,
  navigateAnchor,
  preferDayDetailDrawer,
  preferHorizontalMonthScroll,
  prioritizeTaskForOverflow,
  todayAnchor,
  type CalendarLayoutMode,
  type CalendarViewMode,
} from '@/lib/learning/calendar-grid';
import { CALENDAR_UI } from '@/lib/learning/calendar-copy';
import { SecondaryButton } from './shared';

export type LearningCalendarProps = {
  tasks: StudyTask[];
  onStartTask?: (taskId: string) => void;
  /** Optional controlled selected date (ISO date local midnight). */
  selectedDate?: Date | null;
  onSelectDate?: (date: Date) => void;
  /** Viewport width for responsive layout tests / SSR override. */
  viewportWidth?: number;
  /** Max visible task chips per cell before overflow. */
  maxVisibleTasks?: number;
  /** When true, expose day-detail drawer on mobile (default true). */
  enableDayDrawer?: boolean;
  /** Global-search target to reveal inside its calendar cell. */
  highlightTaskId?: string | null;
  /** Replan the selected local day after an explicit user action. */
  onReplanDay?: (date: Date) => void;
};

export function LearningCalendar({
  tasks,
  onStartTask,
  selectedDate: controlledSelected,
  onSelectDate,
  viewportWidth,
  maxVisibleTasks = 3,
  enableDayDrawer = true,
  highlightTaskId = null,
  onReplanDay,
}: LearningCalendarProps) {
  const [view, setView] = useState<CalendarViewMode>('month');
  const [anchor, setAnchor] = useState<Date>(() => todayAnchor());
  const [internalSelected, setInternalSelected] = useState<Date | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mobileDefaultApplied = useRef(false);

  const selected =
    controlledSelected !== undefined ? controlledSelected : internalSelected;

  useEffect(() => {
    if (!controlledSelected) return;
    queueMicrotask(() => setAnchor(todayAnchor(controlledSelected)));
  }, [controlledSelected]);

  const layoutMode: CalendarLayoutMode = useMemo(() => {
    const w =
      viewportWidth ??
      (typeof window !== 'undefined' ? window.innerWidth : 1440);
    return calendarLayoutMode(w);
  }, [viewportWidth]);

  const horizontal = preferHorizontalMonthScroll(layoutMode) && view === 'month';
  const useDrawer = enableDayDrawer && preferDayDetailDrawer(layoutMode);

  useEffect(() => {
    if (layoutMode !== 'mobile' || mobileDefaultApplied.current) return;
    mobileDefaultApplied.current = true;
    queueMicrotask(() => setView('week'));
  }, [layoutMode]);

  const { cells, label } = useMemo(
    () =>
      buildCalendarGrid(view, anchor, tasks, {
        selectedDate: selected,
      }),
    [view, anchor, tasks, selected],
  );

  const navigate = (direction: -1 | 1) => {
    setAnchor((prev) => navigateAnchor(prev, view, direction));
  };

  const handleSelect = (day: Date) => {
    if (onSelectDate) onSelectDate(day);
    else setInternalSelected(day);
    if (useDrawer) setDrawerOpen(true);
  };

  const selectedCell = useMemo(() => {
    if (!selected) return null;
    return cells.find(
      (c) =>
        c.date.getFullYear() === selected.getFullYear() &&
        c.date.getMonth() === selected.getMonth() &&
        c.date.getDate() === selected.getDate(),
    );
  }, [cells, selected]);

  return (
    <section
      className="surface-card p-4 sm:p-5 space-y-4"
      data-testid="learning-calendar"
      data-view={view}
      data-layout={layoutMode}
      data-cell-count={cells.length}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-zh text-base font-bold text-[var(--text-primary)]">
            {CALENDAR_UI.title}
          </h2>
          <span className="font-zh text-xs text-[var(--text-muted)]">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={() => navigate(-1)} aria-label={CALENDAR_UI.prev}>
            <ChevronLeft size={iconSizes.sm} aria-hidden />
          </SecondaryButton>
          <SecondaryButton
            onClick={() => {
              const t = todayAnchor();
              setAnchor(t);
              handleSelect(t);
            }}
            aria-label={CALENDAR_UI.today}
          >
            {CALENDAR_UI.today}
          </SecondaryButton>
          <SecondaryButton onClick={() => navigate(1)} aria-label={CALENDAR_UI.next}>
            <ChevronRight size={iconSizes.sm} aria-hidden />
          </SecondaryButton>
          <div
            className="flex rounded-xl bg-[var(--surface-soft)] p-1"
            role="group"
            aria-label="视图切换"
          >
            <button
              type="button"
              onClick={() => setView('month')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-zh focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                view === 'month'
                  ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-bold shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              aria-pressed={view === 'month'}
            >
              {CALENDAR_UI.month}
            </button>
            <button
              type="button"
              onClick={() => setView('week')}
              className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-zh focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                view === 'week'
                  ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-bold shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              aria-pressed={view === 'week'}
            >
              {CALENDAR_UI.week}
            </button>
          </div>
        </div>
      </div>

      <div
        className={
          horizontal
            ? 'overflow-x-auto -mx-1 px-1'
            : 'overflow-visible'
        }
        data-testid="calendar-grid-scroll"
      >
        <div
          className="grid min-w-0"
          style={{
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            minWidth: horizontal ? '640px' : undefined,
          }}
          data-testid="calendar-grid"
          data-rows={view === 'month' ? 6 : 1}
          data-cols={7}
        >
          {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
            <div
              key={d}
              className="font-zh text-[11px] font-bold text-[var(--text-muted)] text-center py-2 border-b border-[var(--border)]"
            >
              {d}
            </div>
          ))}
          {cells.map((cell, i) => {
            const overflow = collapseOverflow(
              prioritizeTaskForOverflow(cell.tasks, highlightTaskId),
              maxVisibleTasks,
            );
            return (
              <div
                key={`${cell.date.toISOString()}-${i}`}
                data-testid="calendar-cell"
                data-current-month={cell.isCurrentMonth ? 'true' : 'false'}
                data-today={cell.isToday ? 'true' : 'false'}
                data-selected={cell.isSelected ? 'true' : 'false'}
                data-task-count={cell.tasks.length}
                role="gridcell"
                className={`min-h-[76px] sm:min-h-[96px] border border-[var(--border-20)] p-2 text-left transition-colors ${
                  cell.isSelected
                    ? 'bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/40'
                    : cell.isToday
                      ? 'bg-[var(--accent)]/5'
                    : 'bg-[var(--surface)] hover:bg-[var(--surface-soft)]'
                } ${!cell.isCurrentMonth && view === 'month' ? 'opacity-50' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => handleSelect(cell.date)}
                  aria-label={`查看 ${cell.dayLabel} 的安排`}
                  className="mb-1 flex min-h-[24px] w-full items-center justify-between rounded px-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span
                    className={`font-zh text-[11px] ${
                      cell.isToday
                        ? 'text-[var(--accent)] font-bold'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {cell.dayLabel}
                  </span>
                </button>
                {layoutMode === 'mobile' ? (
                  <div
                    className="flex min-h-[32px] flex-col items-center justify-center gap-1"
                    aria-label={cell.tasks.length > 0 ? `${cell.tasks.length} 项学习任务` : '暂无学习任务'}
                  >
                    {cell.tasks.length > 0 && (
                      <>
                        <span className="flex items-center justify-center gap-1" aria-hidden>
                          {cell.tasks.slice(0, 3).map((task) => (
                            <span
                              key={task.id}
                              className={`h-1.5 w-1.5 rounded-full ${
                                task.id === highlightTaskId
                                  ? 'bg-[var(--accent-strong)] ring-2 ring-[var(--accent)]/25'
                                  : 'bg-[var(--accent)]'
                              }`}
                            />
                          ))}
                        </span>
                        <span className="font-zh text-[10px] text-[var(--text-muted)]">
                          {cell.tasks.length} 项
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {overflow.visible.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => onStartTask?.(task.id)}
                          data-highlighted={task.id === highlightTaskId ? 'true' : 'false'}
                          className={`block w-full rounded-md bg-[var(--accent-soft)] px-1.5 py-1 text-left text-[10px] font-zh truncate text-[var(--accent-strong)] hover:bg-[var(--accent)] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                            task.id === highlightTaskId
                              ? 'ring-2 ring-[var(--accent)] ring-offset-1'
                              : ''
                          }`}
                          title={task.title}
                        >
                          {task.title}
                        </button>
                      </li>
                    ))}
                    {overflow.overflowLabel && (
                      <li
                        className="font-zh text-[10px] text-[var(--text-muted)] px-0.5"
                        data-testid="calendar-overflow"
                      >
                        {overflow.overflowLabel}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {view === 'month' && cells.length === MONTH_CELL_COUNT && (
        <span className="sr-only" data-testid="month-cell-count">
          {MONTH_CELL_COUNT}
        </span>
      )}

      {cells.every((c) => c.tasks.length === 0) && (
        <p className="soft-card font-zh text-sm text-[var(--text-muted)] px-4 py-6 text-center">
          {CALENDAR_UI.emptyMonth}
        </p>
      )}

      {selectedCell && !useDrawer && (
        <section
          className="border-t border-[var(--border-20)] pt-4"
          aria-label={`${selectedCell.dayLabel} 的安排`}
          data-testid="calendar-day-inspector"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-zh text-xs font-bold text-[var(--text-primary)]">
                {selectedCell.dayLabel} 的安排
              </p>
              <p className="font-zh text-[11px] text-[var(--text-muted)]">
                {selectedCell.tasks.length === 0 ? '暂未安排学习任务' : `${selectedCell.tasks.length} 项学习任务`}
              </p>
            </div>
            {onReplanDay && (
              <SecondaryButton
                className="text-xs"
                onClick={() => onReplanDay(selectedCell.date)}
              >
                重新安排当天
              </SecondaryButton>
            )}
          </div>
          {selectedCell.tasks.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {selectedCell.tasks.map((task) => (
                <li key={task.id} className="flex min-w-0 items-center justify-between gap-3 border border-[var(--border-20)] bg-[var(--surface-soft)] px-3 py-2.5">
                  <span className="min-w-0 truncate font-zh text-sm text-[var(--text-primary)]">
                    {task.title}
                  </span>
                  {onStartTask && (
                    <SecondaryButton className="shrink-0 text-xs" onClick={() => onStartTask(task.id)}>
                      开始
                    </SecondaryButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Mobile day-detail drawer */}
      {useDrawer && drawerOpen && selectedCell && (
        <div
          className="fixed inset-0 z-40 flex items-end sm:items-center justify-center"
          data-testid="day-detail-drawer"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="关闭"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md max-h-[70vh] overflow-y-auto border border-[var(--border)] bg-[var(--bg-primary)] p-4 m-0 sm:m-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
                {CALENDAR_UI.dayDetail} · {selectedCell.dayLabel}
              </h3>
              <SecondaryButton
                className="text-xs"
                onClick={() => setDrawerOpen(false)}
              >
                关闭
              </SecondaryButton>
            </div>
            {selectedCell.tasks.length === 0 ? (
              <p className="font-zh text-xs text-[var(--text-muted)]">
                {CALENDAR_UI.emptyDay}
              </p>
            ) : (
              <ul className="space-y-2">
                {selectedCell.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="border border-[var(--border-20)] px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <span className="font-zh text-sm text-[var(--text-primary)] truncate">
                      {t.title}
                    </span>
                    {onStartTask && (
                      <SecondaryButton
                        className="text-xs shrink-0"
                        onClick={() => onStartTask(t.id)}
                      >
                        开始
                      </SecondaryButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
