import { describe, it, expect } from 'vitest';
import { runProactiveTrigger } from '../proactive';
import { emptyLearningData, type LearningData, type StudyTask } from '@/types/learning';

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

function buildData(overrides: Partial<LearningData> = {}): LearningData {
  return {
    ...emptyLearningData(),
    courses: [
      {
        id: 'c1',
        title: 'Course',
        createdAt: iso('2026-07-01T00:00:00Z'),
        updatedAt: iso('2026-07-01T00:00:00Z'),
      },
    ],
    ...overrides,
  };
}

describe('runProactiveTrigger', () => {
  const now = new Date('2026-07-12T08:00:00');

  it('import_document suggests a review task after multiple documents', () => {
    const data = buildData({
      documents: [
        {
          id: 'd1',
          courseId: 'c1',
          title: 'Doc 1',
          format: 'markdown',
          content: 'a',
          chunks: [{ index: 0, text: 'a' }],
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
        {
          id: 'd2',
          courseId: 'c1',
          title: 'Doc 2',
          format: 'markdown',
          content: 'b',
          chunks: [{ index: 0, text: 'b' }],
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
    });

    const result = runProactiveTrigger(data, {
      kind: 'import_document',
      courseId: 'c1',
      documentTitle: 'Doc 2',
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.task.status).toBe('pending_suggestion');
    expect(result.suggestions[0]!.task.title).toMatch(/复习/);
    expect(result.reschedule).toBeNull();
  });

  it('import_document does not suggest on first document', () => {
    const data = buildData({
      documents: [
        {
          id: 'd1',
          courseId: 'c1',
          title: 'Doc 1',
          format: 'markdown',
          content: 'a',
          chunks: [{ index: 0, text: 'a' }],
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
    });

    const result = runProactiveTrigger(data, {
      kind: 'import_document',
      courseId: 'c1',
      documentTitle: 'Doc 1',
    });

    expect(result.suggestions).toHaveLength(0);
    expect(result.reschedule).toBeNull();
  });

  it('add_goal and add_unit produce pending suggestions', () => {
    const data = buildData();

    const goalResult = runProactiveTrigger(data, {
      kind: 'add_goal',
      courseId: 'c1',
      goalId: 'g1',
      goalTitle: 'Master basics',
    });
    expect(goalResult.suggestions).toHaveLength(1);
    expect(goalResult.suggestions[0]!.task.status).toBe('pending_suggestion');

    const unitResult = runProactiveTrigger(data, {
      kind: 'add_unit',
      courseId: 'c1',
      unitId: 'u1',
      unitTitle: 'Unit 1',
    });
    expect(unitResult.suggestions).toHaveLength(1);
    expect(unitResult.suggestions[0]!.task.status).toBe('pending_suggestion');
  });

  it('skip_day reschedules affected confirmed tasks and leaves locked tasks', () => {
    const data = buildData({
      tasks: [
        task({
          id: 'movable',
          title: 'Movable',
          estimatedMinutes: 60,
          status: 'confirmed',
          scheduledStart: iso('2026-07-13T09:00:00'),
          scheduledEnd: iso('2026-07-13T10:00:00'),
        }),
        task({
          id: 'locked',
          title: 'Locked',
          estimatedMinutes: 60,
          locked: true,
          status: 'confirmed',
          scheduledStart: iso('2026-07-13T11:00:00'),
          scheduledEnd: iso('2026-07-13T12:00:00'),
        }),
      ],
    });

    const result = runProactiveTrigger(data, {
      kind: 'skip_day',
      courseId: 'c1',
      date: '2026-07-13',
    }, now);

    expect(result.reschedule).not.toBeNull();
    expect(result.reschedule!.affectedTaskIds).toContain('movable');
    expect(result.reschedule!.affectedTaskIds).not.toContain('locked');

    const movable = result.reschedule!.plan.tasks.find((t) => t.id === 'movable')!;
    expect(movable.status).toBe('scheduled');
    // Should be moved off 2026-07-13 (local)
    const localDate = new Date(movable.scheduledStart!).toLocaleDateString('en-CA');
    expect(localDate).not.toBe('2026-07-13');
  });

  it('skip_day warns when no tasks are affected', () => {
    const data = buildData();
    const result = runProactiveTrigger(data, {
      kind: 'skip_day',
      courseId: 'c1',
      date: '2026-07-13',
    }, now);

    expect(result.reschedule).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('import_timetable returns reschedule when tasks are affected', () => {
    const data = buildData({
      timetable: [
        {
          id: 's1',
          courseId: 'c1',
          weekday: 1,
          start: '08:00',
          end: '22:00',
          courseName: 'All day class',
          location: '',
          createdAt: iso('2026-07-01T00:00:00Z'),
          updatedAt: iso('2026-07-01T00:00:00Z'),
        },
      ],
      tasks: [
        task({
          id: 't1',
          title: 'Task 1',
          estimatedMinutes: 60,
          status: 'confirmed',
        }),
      ],
    });

    const result = runProactiveTrigger(data, {
      kind: 'import_timetable',
      courseId: 'c1',
    }, now);

    // The timetable blocks the whole day, so planning may produce warnings but still schedule later.
    expect(result.suggestions).toHaveLength(0);
    expect(result.reschedule).not.toBeNull();
  });

  it('never auto-confirms suggestions', () => {
    const data = buildData();
    const result = runProactiveTrigger(data, {
      kind: 'add_goal',
      courseId: 'c1',
      goalId: 'g1',
      goalTitle: 'Goal',
    });

    expect(result.suggestions.every((s) => s.task.status === 'pending_suggestion')).toBe(true);
  });
});
