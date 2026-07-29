import { describe, expect, it } from 'vitest';
import {
  applyCalendarAssistantMove,
  buildCalendarAssistantUserPrompt,
  CalendarAssistantProposalSchema,
  mergeCalendarAssistantConstraints,
} from '../calendar-assistant';
import { emptyLearningData, type LearningData, type PlanProposal, type StudyTask } from '@/types/learning';

const now = '2026-07-15T08:00:00.000Z';

function task(partial: Partial<StudyTask> = {}): StudyTask {
  return {
    id: 'task-1',
    courseId: 'course-1',
    title: '复习闭包',
    estimatedMinutes: 30,
    status: 'scheduled',
    locked: false,
    scheduledStart: '2026-07-15T11:00:00.000Z',
    scheduledEnd: '2026-07-15T11:30:00.000Z',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function data(taskOverrides: Partial<StudyTask> = {}): LearningData {
  return {
    ...emptyLearningData(),
    courses: [
      { id: 'course-1', title: 'JavaScript 进阶', createdAt: now, updatedAt: now },
      { id: 'course-2', title: '无关课程', createdAt: now, updatedAt: now },
    ],
    tasks: [
      task(taskOverrides),
      task({ id: 'task-2', courseId: 'course-2', title: '不应泄漏的任务' }),
    ],
  };
}

function proposal(): PlanProposal {
  const planned = task();
  return {
    id: 'plan-1',
    courseId: 'course-1',
    baseRevision: 'v1_test',
    createdAt: now,
    timeZone: 'Asia/Shanghai',
    constraints: { dailyBudgetMinutes: 60 },
    plan: { tasks: [planned], warnings: [] },
    diffs: [
      {
        taskId: planned.id,
        title: planned.title,
        beforeStatus: 'confirmed',
        afterStatus: 'scheduled',
        afterStart: planned.scheduledStart,
        afterEnd: planned.scheduledEnd,
      },
    ],
    applied: false,
  };
}

describe('calendar assistant', () => {
  it('builds course-scoped context and keeps the latest conversation turns', () => {
    const prompt = buildCalendarAssistantUserPrompt({
      data: data(),
      courseId: 'course-1',
      proposal: proposal(),
      messages: [
        { role: 'user', content: '把学习安排到晚上' },
        { role: 'assistant', content: '好的，我会先生成草案。' },
      ],
      now: new Date(now),
    });

    expect(prompt).toContain('JavaScript 进阶');
    expect(prompt).toContain('复习闭包');
    expect(prompt).toContain('把学习安排到晚上');
    expect(prompt).not.toContain('不应泄漏的任务');
  });

  it('merges new planning preferences without dropping existing constraints', () => {
    const merged = mergeCalendarAssistantConstraints(
      { dailyBudgetMinutes: 60, availableDays: [1, 2, 3, 4, 5] },
      { dayStartHour: 19, dayEndHour: 22 },
    );

    expect(merged).toEqual({
      dailyBudgetMinutes: 60,
      availableDays: [1, 2, 3, 4, 5],
      dayStartHour: 19,
      dayEndHour: 22,
    });
  });

  it('moves a real unlocked task only inside the draft', () => {
    const source = data();
    const current = proposal();
    const moved = applyCalendarAssistantMove({
      data: source,
      courseId: 'course-1',
      proposal: current,
      move: {
        taskId: 'task-1',
        scheduledStart: '2026-07-18T19:00:00+08:00',
        scheduledEnd: '2026-07-18T19:30:00+08:00',
      },
    });

    expect(moved.plan.tasks[0]!.scheduledStart).toBe('2026-07-18T11:00:00.000Z');
    expect(current.plan.tasks[0]!.scheduledStart).toBe('2026-07-15T11:00:00.000Z');
    expect(source.tasks[0]!.scheduledStart).toBe('2026-07-15T11:00:00.000Z');
  });

  it('rejects moving a locked task', () => {
    expect(() =>
      applyCalendarAssistantMove({
        data: data({ locked: true }),
        courseId: 'course-1',
        proposal: proposal(),
        move: {
          taskId: 'task-1',
          scheduledStart: '2026-07-18T19:00:00+08:00',
          scheduledEnd: '2026-07-18T19:30:00+08:00',
        },
      }),
    ).toThrow(/锁定/);
  });

  it('rejects moving a task before a draft exists', () => {
    expect(() =>
      applyCalendarAssistantMove({
        data: data(),
        courseId: 'course-1',
        proposal: null,
        move: {
          taskId: 'task-1',
          scheduledStart: '2026-07-18T19:00:00+08:00',
          scheduledEnd: '2026-07-18T19:30:00+08:00',
        },
      }),
    ).toThrow(/先生成一个安排草案/);
  });

  it('deeply rejects malformed client proposals', () => {
    expect(
      CalendarAssistantProposalSchema.safeParse({
        ...proposal(),
        plan: { tasks: [{ id: 'fake' }], warnings: [] },
      }).success,
    ).toBe(false);
  });
});
