import { describe, expect, it } from 'vitest';
import {
  dedupeRecentTasks,
  isHomeContinuationCandidate,
  normalizeTaskTitle,
  taskSoftDedupeKey,
} from '../task-dedupe';
import {
  excludeHomeOwnedContinuation,
  isOwnedByHomeContinuation,
  selectHomeContinuation,
} from '../continuation-selector';

describe('task-dedupe (UX03)', () => {
  it('normalizes titles for soft match', () => {
    expect(normalizeTaskTitle('  线性代数 · 特征值  ')).toBe(
      normalizeTaskTitle('线性代数特征值'),
    );
  });

  it('dedupes by id and course+unit before truncate', () => {
    const tasks = [
      {
        id: 'a',
        title: 'Unit 1',
        status: 'confirmed' as const,
        courseId: 'c1',
        unitId: 'u1',
        updatedAt: '2026-07-13T10:00:00.000Z',
      },
      {
        id: 'b',
        title: 'Unit 1 copy',
        status: 'confirmed' as const,
        courseId: 'c1',
        unitId: 'u1',
        updatedAt: '2026-07-13T12:00:00.000Z',
      },
      {
        id: 'c',
        title: 'Other',
        status: 'in_progress' as const,
        courseId: 'c2',
        updatedAt: '2026-07-13T11:00:00.000Z',
      },
      {
        id: 'a',
        title: 'Unit 1 again',
        status: 'confirmed' as const,
        courseId: 'c1',
        unitId: 'u1',
        updatedAt: '2026-07-13T09:00:00.000Z',
      },
    ];
    const out = dedupeRecentTasks(tasks, { max: 10 });
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('b'); // newer for same course+unit
    expect(out.map((t) => t.id).sort()).toEqual(['b', 'c']);
  });

  it('dedupes by normalized title + status when no course/unit', () => {
    const tasks = [
      {
        id: '1',
        title: '完成 微积分 作业',
        status: 'confirmed' as const,
        updatedAt: '2026-07-13T08:00:00.000Z',
      },
      {
        id: '2',
        title: '完成微积分作业',
        status: 'confirmed' as const,
        updatedAt: '2026-07-13T09:00:00.000Z',
      },
    ];
    expect(taskSoftDedupeKey(tasks[0]!)).toBe(taskSoftDedupeKey(tasks[1]!));
    const out = dedupeRecentTasks(tasks);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('2');
  });

  it('truncates after dedupe', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: 'confirmed' as const,
      courseId: `c${i}`,
      updatedAt: new Date(2026, 6, 13, i).toISOString(),
    }));
    const out = dedupeRecentTasks(tasks, { max: 2 });
    expect(out).toHaveLength(2);
  });

  it('isHomeContinuationCandidate skips done and pending_suggestion', () => {
    expect(
      isHomeContinuationCandidate({
        id: '1',
        title: 'x',
        status: 'done',
      }),
    ).toBe(false);
    expect(
      isHomeContinuationCandidate({
        id: '2',
        title: 'x',
        status: 'pending_suggestion',
      }),
    ).toBe(false);
    expect(
      isHomeContinuationCandidate({
        id: '3',
        title: 'x',
        status: 'in_progress',
      }),
    ).toBe(true);
  });
});

describe('continuation-selector (UX03/UX06)', () => {
  const sample = [
    {
      id: 'primary',
      title: '线性代数',
      status: 'in_progress' as const,
      courseId: 'c1',
      unitId: 'u1',
      updatedAt: '2026-07-13T12:00:00.000Z',
    },
    {
      id: 'secondary',
      title: '概率论',
      status: 'confirmed' as const,
      courseId: 'c2',
      updatedAt: '2026-07-13T10:00:00.000Z',
    },
  ];

  it('selects one home continuation with identity + deepLink', () => {
    const entry = selectHomeContinuation(sample);
    expect(entry).not.toBeNull();
    expect(entry!.task.id).toBe('primary');
    expect(entry!.label).toMatch(/继续学习/);
    expect(entry!.ownerSurface).toBe('home');
    expect(entry!.identity).toBe('task:primary');
    expect(entry!.deepLink.courseId).toBe('c1');
    expect(entry!.deepLink.href).toContain('/course/c1');
  });

  it('marks primary as owned so other surfaces can avoid duplicate summary', () => {
    expect(isOwnedByHomeContinuation('primary', sample)).toBe(true);
    expect(isOwnedByHomeContinuation('secondary', sample)).toBe(false);
    const forHistory = excludeHomeOwnedContinuation(sample, 'history');
    expect(forHistory.map((t) => t.id)).toEqual(['secondary']);
  });
});
