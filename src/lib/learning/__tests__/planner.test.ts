import { describe, it, expect } from 'vitest';
import { planStudySchedule, rescheduleAfterSkipDay } from '../planner';
import { emptyLearningData, type LearningData, type StudyTask, type TimetableSlot } from '@/types/learning';

const iso = (s: string) => new Date(s).toISOString();

function task(partial: Partial<StudyTask> & Pick<StudyTask, 'id' | 'title' | 'estimatedMinutes'>): StudyTask {
  return {
    courseId: 'c1',
    status: 'confirmed',
    locked: false,
    createdAt: iso('2026-07-01T00:00:00Z'),
    updatedAt: iso('2026-07-01T00:00:00Z'),
    ...partial,
  };
}

function slot(partial: Partial<TimetableSlot> & Pick<TimetableSlot, 'id' | 'weekday' | 'start' | 'end' | 'courseName'>): TimetableSlot {
  return {
    courseId: 'c1',
    location: '',
    createdAt: iso('2026-07-01T00:00:00Z'),
    updatedAt: iso('2026-07-01T00:00:00Z'),
    ...partial,
  };
}

describe('planStudySchedule', () => {
  it('does not move locked=true tasks', () => {
    const lockedStart = iso('2026-07-13T09:00:00');
    const lockedEnd = iso('2026-07-13T10:00:00');
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'c1',
          title: 'C',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      tasks: [
        task({
          id: 'locked-1',
          title: 'Locked review',
          estimatedMinutes: 60,
          locked: true,
          scheduledStart: lockedStart,
          scheduledEnd: lockedEnd,
        }),
        task({
          id: 'free-1',
          title: 'Open work',
          estimatedMinutes: 30,
          deadline: iso('2026-07-14T23:59:00Z'),
        }),
      ],
    };

    const now = new Date('2026-07-12T07:00:00');
    const result = planStudySchedule(data, { courseId: 'c1', now });
    const locked = result.tasks.find((t) => t.id === 'locked-1')!;
    expect(locked.scheduledStart).toBe(lockedStart);
    expect(locked.scheduledEnd).toBe(lockedEnd);

    const free = result.tasks.find((t) => t.id === 'free-1')!;
    expect(free.scheduledStart).toBeTruthy();
    expect(free.scheduledStart).not.toBe(lockedStart);
  });

  it('emits warnings when no available slot fits the task', () => {
    // Fill every day 08:00-22:00 with timetable for all weekdays
    const timetable: TimetableSlot[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      slot({
        id: `full-${weekday}`,
        weekday,
        start: '08:00',
        end: '22:00',
        courseName: 'Blocked',
      }),
    );

    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'c1',
          title: 'C',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      timetable,
      tasks: [
        task({
          id: 'huge',
          title: 'Impossible',
          estimatedMinutes: 60,
          deadline: iso('2026-07-15T00:00:00Z'),
        }),
      ],
    };

    const result = planStudySchedule(data, {
      courseId: 'c1',
      now: new Date('2026-07-12T08:00:00'),
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/No available slot/i);
    const planned = result.tasks.find((t) => t.id === 'huge')!;
    expect(planned.scheduledStart).toBeUndefined();
  });

  it('respects deadline order and timetable free windows', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'c1',
          title: 'C',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      timetable: [
        // Monday blocked morning (2026-07-13 is Monday)
        slot({ id: 'm1', weekday: 1, start: '08:00', end: '12:00', courseName: 'Lecture' }),
      ],
      tasks: [
        task({
          id: 'late',
          title: 'Later deadline',
          estimatedMinutes: 60,
          deadline: iso('2026-07-20T00:00:00Z'),
        }),
        task({
          id: 'soon',
          title: 'Soon deadline',
          estimatedMinutes: 60,
          deadline: iso('2026-07-13T18:00:00Z'),
        }),
      ],
    };

    const result = planStudySchedule(data, {
      courseId: 'c1',
      now: new Date('2026-07-13T07:00:00'), // Monday
    });

    const soon = result.tasks.find((t) => t.id === 'soon')!;
    const late = result.tasks.find((t) => t.id === 'late')!;
    expect(soon.scheduledStart).toBeTruthy();
    expect(late.scheduledStart).toBeTruthy();
    // soon should be scheduled before late
    expect(Date.parse(soon.scheduledStart!)).toBeLessThan(Date.parse(late.scheduledStart!));
    // soon should not start before 12:00 local (timetable ends)
    const soonHour = new Date(soon.scheduledStart!).getHours();
    expect(soonHour).toBeGreaterThanOrEqual(12);
  });

  it('does not schedule pending_suggestion tasks until confirmed', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'c1',
          title: 'C',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      tasks: [
        task({
          id: 'suggestion-1',
          title: 'Suggested review',
          estimatedMinutes: 30,
          status: 'pending_suggestion',
        }),
        task({
          id: 'confirmed-1',
          title: 'Confirmed work',
          estimatedMinutes: 30,
          status: 'confirmed',
        }),
      ],
    };

    const now = new Date('2026-07-12T07:00:00');
    const result = planStudySchedule(data, { courseId: 'c1', now });

    // Pending suggestions are not candidates and are not returned by the planner.
    expect(result.tasks.some((t) => t.id === 'suggestion-1')).toBe(false);

    const confirmed = result.tasks.find((t) => t.id === 'confirmed-1')!;
    expect(confirmed.status).toBe('scheduled');
    expect(confirmed.scheduledStart).toBeTruthy();
  });

  it('scopes by goalId when provided', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'c1',
          title: 'C',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      goals: [
        {
          id: 'g1',
          courseId: 'c1',
          title: 'G',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      tasks: [
        task({ id: 'in', title: 'In goal', estimatedMinutes: 30, goalId: 'g1' }),
        task({ id: 'out', title: 'Out goal', estimatedMinutes: 30, goalId: 'g2' }),
      ],
    };

    const result = planStudySchedule(data, {
      courseId: 'c1',
      goalId: 'g1',
      now: new Date('2026-07-12T08:00:00'),
    });
    // planned list includes locked (none) + candidates for g1 only in the planned set;
    // out-goal task is not a candidate so won't get a new schedule from this plan pass
    // but may still appear if locked — here neither is locked, so only 'in' is planned.
    const ids = result.tasks.map((t) => t.id);
    expect(ids).toContain('in');
    expect(ids).not.toContain('out');
  });

  it('does not schedule a task after its deadline', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [{
        id: 'c1',
        title: 'C',
        createdAt: iso('2026-07-01T00:00:00Z'),
        updatedAt: iso('2026-07-01T00:00:00Z'),
      }],
      tasks: [task({
        id: 'deadline',
        title: 'Deadline task',
        estimatedMinutes: 120,
        deadline: iso('2026-07-12T09:00:00'),
      })],
    };
    const result = planStudySchedule(data, {
      courseId: 'c1',
      now: new Date('2026-07-12T08:30:00'),
    });
    expect(result.tasks[0]!.scheduledStart).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });

  it('treats timetable slots imported under another course as blocked time', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'c1',
          title: 'Target',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
        {
          id: 'c2',
          title: 'Other',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      timetable: [slot({
        id: 'other-class',
        courseId: 'c2',
        weekday: 1,
        start: '08:00',
        end: '12:00',
        courseName: 'Other class',
      })],
      tasks: [task({ id: 'target-task', title: 'Target task', estimatedMinutes: 30 })],
    };
    const result = planStudySchedule(data, {
      courseId: 'c1',
      now: new Date('2026-07-13T07:00:00'),
    });
    expect(new Date(result.tasks[0]!.scheduledStart!).getHours()).toBeGreaterThanOrEqual(12);
  });

  it('respects available weekdays and the daily study budget across courses', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        { id: 'c1', title: 'Target', createdAt: iso('2026-07-01T00:00:00Z'), updatedAt: iso('2026-07-01T00:00:00Z') },
        { id: 'c2', title: 'Other', createdAt: iso('2026-07-01T00:00:00Z'), updatedAt: iso('2026-07-01T00:00:00Z') },
      ],
      tasks: [
        task({
          id: 'other-course',
          courseId: 'c2',
          title: 'Other course review',
          estimatedMinutes: 30,
          status: 'scheduled',
          scheduledStart: iso('2026-07-14T08:00:00'),
          scheduledEnd: iso('2026-07-14T08:30:00'),
        }),
        task({ id: 'target', title: 'Target review', estimatedMinutes: 60 }),
      ],
    };

    const result = planStudySchedule(data, {
      courseId: 'c1',
      now: new Date('2026-07-13T07:00:00'),
      availableDays: [2, 3],
      dailyBudgetMinutes: 60,
    });
    const planned = result.tasks.find((item) => item.id === 'target')!;
    const start = new Date(planned.scheduledStart!);
    expect(start.getDay()).toBe(3);
    expect(start.getDate()).toBe(15);
  });

  it('uses the learner deadline strategy instead of always front-loading', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [{ id: 'c1', title: 'C', createdAt: iso('2026-07-01T00:00:00Z'), updatedAt: iso('2026-07-01T00:00:00Z') }],
      tasks: [task({
        id: 'deadline-strategy',
        title: 'Deadline strategy',
        estimatedMinutes: 30,
        deadline: iso('2026-07-16T18:00:00'),
      })],
    };

    const result = planStudySchedule(data, {
      courseId: 'c1',
      now: new Date('2026-07-13T07:00:00'),
      days: 7,
      deadlinePreference: 'before_deadline',
    });
    expect(new Date(result.tasks[0]!.scheduledStart!).getDate()).toBe(16);
  });
});

describe('rescheduleAfterSkipDay', () => {
  it('moves non-locked tasks off the skipped local day', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [{
        id: 'c1',
        title: 'C',
        createdAt: iso('2026-07-01T00:00:00Z'),
        updatedAt: iso('2026-07-01T00:00:00Z'),
      }],
      tasks: [
        task({
          id: 'movable',
          title: 'Movable',
          estimatedMinutes: 60,
          status: 'scheduled',
          scheduledStart: iso('2026-07-13T09:00:00'),
          scheduledEnd: iso('2026-07-13T10:00:00'),
        }),
      ],
    };

    const result = rescheduleAfterSkipDay(data, {
      courseId: 'c1',
      skippedDate: '2026-07-13',
      now: new Date('2026-07-12T08:00:00'),
    });

    const moved = result.tasks.find((t) => t.id === 'movable')!;
    expect(moved.status).toBe('scheduled');
    const localDate = new Date(moved.scheduledStart!).toLocaleDateString('en-CA');
    expect(localDate).not.toBe('2026-07-13');
  });

  it('does not move locked tasks', () => {
    const lockedStart = iso('2026-07-13T09:00:00');
    const lockedEnd = iso('2026-07-13T10:00:00');
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [{
        id: 'c1',
        title: 'C',
        createdAt: iso('2026-07-01T00:00:00Z'),
        updatedAt: iso('2026-07-01T00:00:00Z'),
      }],
      tasks: [
        task({
          id: 'locked',
          title: 'Locked',
          estimatedMinutes: 60,
          locked: true,
          status: 'scheduled',
          scheduledStart: lockedStart,
          scheduledEnd: lockedEnd,
        }),
      ],
    };

    const result = rescheduleAfterSkipDay(data, {
      courseId: 'c1',
      skippedDate: '2026-07-13',
      now: new Date('2026-07-12T08:00:00'),
    });

    expect(result.tasks).toHaveLength(0);
  });

  it('returns empty result when no tasks are scheduled on skipped day', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [{
        id: 'c1',
        title: 'C',
        createdAt: iso('2026-07-01T00:00:00Z'),
        updatedAt: iso('2026-07-01T00:00:00Z'),
      }],
      tasks: [
        task({
          id: 'later',
          title: 'Later',
          estimatedMinutes: 30,
          status: 'scheduled',
          scheduledStart: iso('2026-07-14T09:00:00'),
          scheduledEnd: iso('2026-07-14T09:30:00'),
        }),
      ],
    };

    const result = rescheduleAfterSkipDay(data, {
      courseId: 'c1',
      skippedDate: '2026-07-13',
      now: new Date('2026-07-12T08:00:00'),
    });

    expect(result.tasks).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects invalid skippedDate format', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [{
        id: 'c1',
        title: 'C',
        createdAt: iso('2026-07-01T00:00:00Z'),
        updatedAt: iso('2026-07-01T00:00:00Z'),
      }],
      tasks: [],
    };

    expect(() =>
      rescheduleAfterSkipDay(data, {
        courseId: 'c1',
        skippedDate: 'not-a-date',
        now: new Date('2026-07-12T08:00:00'),
      }),
    ).toThrow(/YYYY-MM-DD/);
  });
});
