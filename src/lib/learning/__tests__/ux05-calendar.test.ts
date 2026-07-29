/**
 * UX05 focused tests:
 * - 42-cell month grid
 * - month navigation / today / selection
 * - overflow 「还有 N 项」
 * - cross-day & deadline ownership
 * - pending vs confirmed write gate
 * - responsive layout modes
 * - natural copy / no jargon
 * - planning constraints in Chat
 */

import { describe, expect, it } from 'vitest';
import {
  MONTH_CELL_COUNT,
  WEEK_CELL_COUNT,
  buildCalendarGrid,
  buildMonthCells,
  buildWeekCells,
  calendarLayoutMode,
  collapseOverflow,
  companionVisibleByDefault,
  navigateAnchor,
  preferDayDetailDrawer,
  preferHorizontalMonthScroll,
  prioritizeTaskForOverflow,
  taskOccupiesLocalDay,
  tasksOwnedByDay,
  todayAnchor,
} from '../calendar-grid';
import {
  CALENDAR_UI,
  confirmationCountLabel,
  formatDiffPreviewLine,
  formatProposalSlotNatural,
  hasCalendarJargonLeak,
  naturalCompanionSummary,
  taskStatusLabelZh,
} from '../calendar-copy';
import {
  canAcceptProposal,
  editProposalTaskTime,
  isScheduleWriteAction,
  mergeAcceptedPlanIntoTasks,
  pendingTasksExcludedFromConfirmedGrid,
  proposalLeavesStoreUnchanged,
  shiftProposalTaskMinutes,
  validatePlanProposal,
} from '../calendar-proposal-edit';
import {
  applyConstraintAnswer,
  constraintsToPlanHints,
  formatConstraintsSummary,
  missingPlanningConstraints,
  nextPlanningConstraintQuestion,
  planningSurfaceFor,
} from '../planning-constraints';
import { proposePlanSchedule } from '../calendar-companion';
import { emptyLearningData, type LearningData, type PlanProposal, type StudyTask } from '@/types/learning';

const ts = '2026-07-12T08:00:00.000Z';

function task(partial: Partial<StudyTask> & Pick<StudyTask, 'id' | 'title'>): StudyTask {
  return {
    courseId: 'c1',
    estimatedMinutes: 30,
    status: 'scheduled',
    locked: false,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

function data(overrides: Partial<LearningData> = {}): LearningData {
  return {
    ...emptyLearningData(),
    courses: [{ id: 'c1', title: 'C', createdAt: ts, updatedAt: ts }],
    ...overrides,
  };
}

describe('UX05 month grid = 42 cells', () => {
  it('buildMonthCells always returns 42 cells (6×7)', () => {
    const anchors = [
      new Date(2026, 0, 1), // Jan
      new Date(2026, 1, 15), // Feb
      new Date(2026, 6, 13), // Jul
      new Date(2026, 11, 31), // Dec
    ];
    for (const a of anchors) {
      const { cells, view } = buildMonthCells(a, []);
      expect(cells).toHaveLength(MONTH_CELL_COUNT);
      expect(view).toBe('month');
      expect(MONTH_CELL_COUNT).toBe(42);
    }
  });

  it('default calendar grid uses month (not week)', () => {
    const grid = buildCalendarGrid('month', new Date(2026, 6, 13), []);
    expect(grid.cells).toHaveLength(42);
    expect(grid.view).toBe('month');
  });

  it('week view is secondary with 7 cells', () => {
    const week = buildWeekCells(new Date(2026, 6, 13), []);
    expect(week.cells).toHaveLength(WEEK_CELL_COUNT);
    expect(week.view).toBe('week');
  });
});

describe('UX05 navigation / today / selection', () => {
  it('navigates month prev/next', () => {
    const jul = new Date(2026, 6, 15);
    const next = navigateAnchor(jul, 'month', 1);
    expect(next.getMonth()).toBe(7);
    const prev = navigateAnchor(jul, 'month', -1);
    expect(prev.getMonth()).toBe(5);
  });

  it('navigates week by 7 days', () => {
    const d = new Date(2026, 6, 13);
    const next = navigateAnchor(d, 'week', 1);
    expect(next.getDate()).toBe(20);
  });

  it('todayAnchor zeros clock', () => {
    const t = todayAnchor(new Date(2026, 6, 13, 15, 30));
    expect(t.getHours()).toBe(0);
    expect(t.getDate()).toBe(13);
  });

  it('marks selected date on cells', () => {
    const selected = new Date(2026, 6, 13);
    const { cells } = buildMonthCells(new Date(2026, 6, 1), [], {
      selectedDate: selected,
      now: new Date(2026, 6, 12),
    });
    const hit = cells.filter((c) => c.isSelected);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.date.getDate()).toBe(13);
  });

  it('marks today independently of selection', () => {
    const now = new Date(2026, 6, 13, 10, 0);
    const { cells } = buildMonthCells(new Date(2026, 6, 1), [], { now });
    expect(cells.filter((c) => c.isToday)).toHaveLength(1);
  });
});

describe('UX05 overflow collapse', () => {
  it('shows overflow label 还有 N 项', () => {
    const many = [1, 2, 3, 4, 5].map((i) =>
      task({ id: `t${i}`, title: `任务${i}` }),
    );
    const o = collapseOverflow(many, 3);
    expect(o.visible).toHaveLength(3);
    expect(o.overflowCount).toBe(2);
    expect(o.overflowLabel).toBe('还有 2 项');
  });

  it('no overflow when within max', () => {
    const few = [1, 2].map((i) => task({ id: `t${i}`, title: `T${i}` }));
    const o = collapseOverflow(few, 3);
    expect(o.overflowLabel).toBeNull();
    expect(o.overflowCount).toBe(0);
  });

  it('keeps a globally located task visible before overflow collapse', () => {
    const many = [1, 2, 3, 4, 5].map((i) =>
      task({ id: `t${i}`, title: `任务${i}` }),
    );
    const ordered = prioritizeTaskForOverflow(many, 't5');
    const overflow = collapseOverflow(ordered, 3);

    expect(overflow.visible.map((item) => item.id)).toContain('t5');
    expect(overflow.visible[0]?.id).toBe('t5');
  });
});

describe('UX05 cross-day & deadline ownership', () => {
  it('multi-day scheduled task appears on every spanned day', () => {
    const multi = task({
      id: 'multi',
      title: '跨日复习',
      scheduledStart: '2026-07-13T22:00:00',
      scheduledEnd: '2026-07-15T02:00:00',
    });
    const d13 = new Date(2026, 6, 13);
    const d14 = new Date(2026, 6, 14);
    const d15 = new Date(2026, 6, 15);
    const d12 = new Date(2026, 6, 12);
    expect(taskOccupiesLocalDay(multi, d13)).toBe(true);
    expect(taskOccupiesLocalDay(multi, d14)).toBe(true);
    expect(taskOccupiesLocalDay(multi, d15)).toBe(true);
    expect(taskOccupiesLocalDay(multi, d12)).toBe(false);

    const owned = tasksOwnedByDay([multi], d14);
    expect(owned.map((t) => t.id)).toEqual(['multi']);
  });

  it('deadline-only task owns deadline local day', () => {
    const dl = task({
      id: 'dl',
      title: '作业截止',
      status: 'confirmed',
      deadline: '2026-07-20T23:59:00',
    });
    expect(taskOccupiesLocalDay(dl, new Date(2026, 6, 20))).toBe(true);
    expect(taskOccupiesLocalDay(dl, new Date(2026, 6, 19))).toBe(false);
  });

  it('pending_suggestion never owns grid cells', () => {
    const p = task({
      id: 'p',
      title: '建议',
      status: 'pending_suggestion',
      scheduledStart: '2026-07-13T09:00:00',
      scheduledEnd: '2026-07-13T10:00:00',
    });
    expect(taskOccupiesLocalDay(p, new Date(2026, 6, 13))).toBe(false);
  });

  it('month cells include multi-day task on intermediate days', () => {
    const multi = task({
      id: 'multi',
      title: '跨日',
      scheduledStart: '2026-07-10T20:00:00',
      scheduledEnd: '2026-07-12T08:00:00',
    });
    const { cells } = buildMonthCells(new Date(2026, 6, 1), [multi], {
      now: new Date(2026, 6, 1),
    });
    const withTask = cells.filter((c) => c.tasks.some((t) => t.id === 'multi'));
    expect(withTask.length).toBeGreaterThanOrEqual(2);
  });
});

describe('UX05 pending vs confirmed write gate', () => {
  it('only accept is a schedule write action', () => {
    expect(isScheduleWriteAction('propose')).toBe(false);
    expect(isScheduleWriteAction('edit_time')).toBe(false);
    expect(isScheduleWriteAction('discard')).toBe(false);
    expect(isScheduleWriteAction('accept')).toBe(true);
  });

  it('proposePlanSchedule leaves store tasks unscheduled and applied:false', () => {
    const store = data({
      tasks: [
        task({
          id: 't1',
          title: '任务A',
          status: 'confirmed',
          estimatedMinutes: 25,
        }),
      ],
    });
    const proposal = proposePlanSchedule(store, {
      courseId: 'c1',
      now: new Date('2026-07-12T08:00:00'),
    });
    expect(proposal.applied).toBe(false);
    expect(store.tasks[0]!.scheduledStart).toBeUndefined();
    expect(proposalLeavesStoreUnchanged(store.tasks, proposal)).toBe(true);
    expect(canAcceptProposal(proposal)).toBe(true);
  });

  it('editProposalTaskTime stays applied:false (no write)', () => {
    const proposal: PlanProposal = {
      id: 'plan-test',
      courseId: 'c1',
      baseRevision: 'v1-test',
      createdAt: ts,
      timeZone: 'Asia/Shanghai',
      applied: false,
      plan: {
        warnings: [],
        tasks: [
          task({
            id: 't1',
            title: 'A',
            scheduledStart: '2026-07-13T09:00:00.000Z',
            scheduledEnd: '2026-07-13T09:30:00.000Z',
          }),
        ],
      },
      diffs: [
        {
          taskId: 't1',
          title: 'A',
          beforeStatus: 'confirmed',
          afterStart: '2026-07-13T09:00:00.000Z',
          afterEnd: '2026-07-13T09:30:00.000Z',
          afterStatus: 'scheduled',
        },
      ],
    };
    const edited = editProposalTaskTime(
      proposal,
      't1',
      '2026-07-13T10:00:00.000Z',
      '2026-07-13T10:30:00.000Z',
    );
    expect(edited.applied).toBe(false);
    expect(edited.plan.tasks[0]!.scheduledStart).toBe('2026-07-13T10:00:00.000Z');
    expect(isScheduleWriteAction('edit_time')).toBe(false);

    const shifted = shiftProposalTaskMinutes(edited, 't1', 30);
    expect(shifted.applied).toBe(false);
  });

  it('after accept merge updates grid tasks immediately (client model)', () => {
    const current = [
      task({ id: 't1', title: 'A', status: 'confirmed' }),
      task({ id: 'pending', title: 'P', status: 'pending_suggestion' }),
    ];
    const plan = {
      warnings: [],
      tasks: [
        task({
          id: 't1',
          title: 'A',
          status: 'scheduled',
          scheduledStart: '2026-07-13T09:00:00.000Z',
          scheduledEnd: '2026-07-13T09:30:00.000Z',
        }),
      ],
    };
    const merged = mergeAcceptedPlanIntoTasks(current, plan);
    expect(merged.find((t) => t.id === 't1')!.status).toBe('scheduled');
    expect(merged.find((t) => t.id === 't1')!.scheduledStart).toBeTruthy();
    const grid = pendingTasksExcludedFromConfirmedGrid(merged);
    expect(grid.some((t) => t.id === 'pending')).toBe(false);
    expect(grid.some((t) => t.id === 't1')).toBe(true);
  });

  it('blocks acceptance when a local edit overlaps another task', () => {
    const store = data({
      tasks: [
        task({ id: 'a', title: 'A', status: 'confirmed' }),
        task({ id: 'b', title: 'B', status: 'confirmed' }),
      ],
    });
    const proposal = proposePlanSchedule(store, {
      courseId: 'c1',
      now: new Date('2026-07-13T08:00:00'),
    });
    const first = proposal.plan.tasks.find((item) => item.id === 'a')!;
    const overlapping = editProposalTaskTime(
      proposal,
      'b',
      first.scheduledStart!,
      first.scheduledEnd!,
    );
    const issues = validatePlanProposal(overlapping, store);

    expect(issues.some((issue) => issue.code === 'overlap')).toBe(true);
    expect(canAcceptProposal(overlapping, issues)).toBe(false);
  });

  it('blocks edits outside available days, preferred hours and daily budget', () => {
    const store = data({
      tasks: [task({ id: 'a', title: 'A', status: 'confirmed', estimatedMinutes: 90 })],
    });
    const proposal = proposePlanSchedule(store, {
      courseId: 'c1',
      now: new Date('2026-07-13T08:00:00'),
      availableDays: [1],
      dailyBudgetMinutes: 60,
      dayStartHour: 19,
      dayEndHour: 22,
    });
    const edited = editProposalTaskTime(
      proposal,
      'a',
      '2026-07-14T10:00:00.000Z',
      '2026-07-14T11:30:00.000Z',
    );
    const issues = validatePlanProposal(edited, store);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unavailable_day', 'preferred_hours', 'daily_budget']),
    );
  });
});

describe('UX05 responsive modes', () => {
  it('maps 1440 / 1024 / 768 to desktop / tablet / mobile', () => {
    expect(calendarLayoutMode(1440)).toBe('desktop');
    expect(calendarLayoutMode(1200)).toBe('desktop');
    expect(calendarLayoutMode(1024)).toBe('tablet');
    expect(calendarLayoutMode(768)).toBe('tablet');
    expect(calendarLayoutMode(767)).toBe('mobile');
  });

  it('companion defaults and mobile drawer/scroll', () => {
    expect(companionVisibleByDefault('desktop')).toBe(true);
    expect(companionVisibleByDefault('tablet')).toBe(false);
    expect(companionVisibleByDefault('mobile')).toBe(false);
    expect(preferHorizontalMonthScroll('mobile')).toBe(true);
    expect(preferHorizontalMonthScroll('tablet')).toBe(true);
    expect(preferHorizontalMonthScroll('desktop')).toBe(false);
    expect(preferDayDetailDrawer('mobile')).toBe(true);
    expect(preferDayDetailDrawer('desktop')).toBe(false);
  });

  it('42 cells remain available under tablet width logic (no clipping rule)', () => {
    // Pure: month still builds 42 regardless of layout mode
    const mode = calendarLayoutMode(1024);
    expect(mode).toBe('tablet');
    const { cells } = buildMonthCells(new Date(2026, 6, 1), []);
    expect(cells).toHaveLength(42);
  });
});

describe('UX05 natural copy & no jargon', () => {
  it('status labels are Chinese 已确认/待确认', () => {
    expect(taskStatusLabelZh('confirmed')).toBe('已确认');
    expect(taskStatusLabelZh('pending_suggestion')).toBe('待确认');
    expect(confirmationCountLabel(3, 2)).toBe('已确认 3 · 待确认 2');
  });

  it('diff preview has no raw status enums', () => {
    const line = formatDiffPreviewLine({
      taskId: 't1',
      title: '复习',
      beforeStatus: 'confirmed',
      afterStart: '2026-07-13T09:00:00.000Z',
      afterEnd: '2026-07-13T09:30:00.000Z',
      afterStatus: 'scheduled',
    });
    expect(line.before).toMatch(/调整前/);
    expect(line.after).toMatch(/调整后/);
    expect(hasCalendarJargonLeak(line.before)).toBe(false);
    expect(hasCalendarJargonLeak(line.after)).toBe(false);
    expect(line.after).not.toMatch(/scheduled|confirmed|pending_suggestion/);
  });

  it('companion summary strips ContextPack / agent labels', () => {
    const natural = naturalCompanionSummary({
      summary:
        '今日 2026-07-12：已排/待办 1 项，约 30 分钟。\n学习者上下文：暂无可用记忆（ContextPack 为空）。\n日程无严重冲突；可按确认过的计划推进。',
      loadExplanation: '今日负荷：1 项',
      conflictHints: [],
      agentGenerated: true,
      contextPackLoaded: true,
      contextSummaryLine: 'x',
      generatedAt: ts,
    });
    expect(hasCalendarJargonLeak(natural.summary)).toBe(false);
    expect(natural.summary).not.toMatch(/ContextPack|Agent 简报|规则回退/);
    expect(CALENDAR_UI.accept).toBe('应用这个安排');
    expect(CALENDAR_UI.edit).toBe('再改一下');
  });

  it('formatProposalSlotNatural avoids raw status dump', () => {
    const s = formatProposalSlotNatural(undefined, undefined, 'pending_suggestion');
    expect(s).not.toContain('pending_suggestion');
    expect(s).toMatch(/待确认|未安排/);
  });
});

describe('UX05 planning constraints primarily in Chat', () => {
  it('collect_constraints → chat; accept_edit → calendar', () => {
    expect(planningSurfaceFor('collect_constraints')).toBe('chat');
    expect(planningSurfaceFor('view_results')).toBe('calendar');
    expect(planningSurfaceFor('accept_edit')).toBe('calendar');
  });

  it('asks one missing constraint at a time', () => {
    let known = {};
    const q1 = nextPlanningConstraintQuestion(known);
    expect(q1).not.toBeNull();
    expect(q1!.question).toBeTruthy();
    known = applyConstraintAnswer(known, q1!.key, q1!.choices?.[0] || '工作日');
    const missing = missingPlanningConstraints(known);
    expect(missing[0]).not.toBe(q1!.key);
    const q2 = nextPlanningConstraintQuestion(known);
    expect(q2).not.toBeNull();
    expect(q2!.key).not.toBe(q1!.key);
  });

  it('maps constraints to planner hints without writing', () => {
    let known = applyConstraintAnswer({}, 'preferred_hours', '晚上');
    known = applyConstraintAnswer(known, 'daily_budget_minutes', '1 小时');
    const hints = constraintsToPlanHints(known);
    expect(hints.dayStartHour).toBe(19);
    expect(formatConstraintsSummary(known)).toMatch(/分钟|晚上|19/);
  });

  it('does not invent defaults for an unrecognized free-text answer', () => {
    const available = applyConstraintAnswer({}, 'available_days', '看情况再说');
    const budget = applyConstraintAnswer({}, 'daily_budget_minutes', '不确定');
    const hours = applyConstraintAnswer({}, 'preferred_hours', '随缘');
    const deadline = applyConstraintAnswer({}, 'deadline_preference', '都行吧');

    expect(available.availableDays).toBeUndefined();
    expect(budget.dailyBudgetMinutes).toBeUndefined();
    expect(hours.preferredHours).toBeUndefined();
    expect(deadline.deadlinePreference).toBeUndefined();
  });

  it('parses explicit custom weekdays, minutes and hour ranges', () => {
    let known = applyConstraintAnswer({}, 'available_days', '周一、周三和周六');
    known = applyConstraintAnswer(known, 'daily_budget_minutes', '每天 90 分钟');
    known = applyConstraintAnswer(known, 'preferred_hours', '19:00 到 21:00');

    expect(known.availableDays).toEqual([1, 3, 6]);
    expect(known.dailyBudgetMinutes).toBe(90);
    expect(known.preferredHours).toEqual({ startHour: 19, endHour: 21 });
  });
});
