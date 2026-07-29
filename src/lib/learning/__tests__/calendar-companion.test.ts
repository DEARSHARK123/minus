import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCalendarBrief,
  buildCalendarBriefAsync,
  computePlanDiffs,
  computePlanningRevision,
  proposePlanSchedule,
} from '../calendar-companion';
import { emptyLearningData, type LearningData, type StudyTask } from '@/types/learning';

const ts = '2026-07-12T08:00:00.000Z';

vi.mock('@/lib/memory/context-pack-server', () => ({
  loadLearnerContextPack: vi.fn(async () => ({
    empty: false,
    labeledBlock: '## 学习者上下文\n- 偏好：短会话',
    summaryLine: '偏好：短会话',
    entries: [
      {
        text: '偏好：短会话',
        kind: 'preference',
        status: 'confirmed' as const,
        confidence: 0.9,
        sensitive: false,
      },
    ],
  })),
}));

function task(partial: Partial<StudyTask> & Pick<StudyTask, 'id' | 'title'>): StudyTask {
  return {
    courseId: 'c1',
    estimatedMinutes: 30,
    status: 'confirmed',
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

describe('calendar companion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildCalendarBriefAsync calls loadLearnerContextPack(calendar)', async () => {
    const { loadLearnerContextPack } = await import('@/lib/memory/context-pack-server');
    const brief = await buildCalendarBriefAsync(
      data({
        tasks: [
          task({
            id: 't1',
            title: '复习',
            status: 'scheduled',
            scheduledStart: '2026-07-12T09:00:00.000Z',
            scheduledEnd: '2026-07-12T09:30:00.000Z',
          }),
        ],
      }),
      { courseId: 'c1', now: new Date('2026-07-12T08:00:00') },
    );

    expect(loadLearnerContextPack).toHaveBeenCalledWith('calendar');
    expect(brief.contextPackLoaded).toBe(true);
    expect(brief.contextSummaryLine).toContain('短会话');
    expect(brief.summary.length).toBeGreaterThan(10);
    expect(brief.agentGenerated).toBe(false);
  });

  it('detects overload / pending copy in deterministic brief', () => {
    const now = new Date('2026-07-12T08:00:00');
    const brief = buildCalendarBrief({
      data: data({
        tasks: [
          task({
            id: 't1',
            title: '大任务',
            estimatedMinutes: 300,
            status: 'confirmed',
          }),
          task({
            id: 't2',
            title: '建议',
            status: 'pending_suggestion',
            estimatedMinutes: 20,
          }),
        ],
      }),
      courseId: 'c1',
      now,
      contextPack: {
        empty: true,
        labeledBlock: '',
        summaryLine: '',
        entries: [],
      },
    });
    expect(brief.loadExplanation).toMatch(/300|过重|负荷/);
    expect(brief.summary).toMatch(/待确认/);
  });

  it('proposePlanSchedule is applied:false with before/after diffs', () => {
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
    expect(proposal.baseRevision).toBe(computePlanningRevision(store));
    expect(proposal.courseId).toBe('c1');
    // Original store tasks unchanged
    expect(store.tasks[0]!.status).toBe('confirmed');
    expect(store.tasks[0]!.scheduledStart).toBeUndefined();
    // Plan may schedule the task
    const planned = proposal.plan.tasks.find((t) => t.id === 't1');
    expect(planned).toBeTruthy();
    if (planned?.scheduledStart) {
      expect(proposal.diffs.some((d) => d.taskId === 't1')).toBe(true);
      const diff = proposal.diffs.find((d) => d.taskId === 't1')!;
      expect(diff.beforeStart).toBeUndefined();
      expect(diff.afterStart).toBeTruthy();
    }
  });

  it('changes the planning revision when another schedule changes', () => {
    const before = data({
      tasks: [task({ id: 't1', title: 'A', status: 'confirmed' })],
    });
    const after = data({
      tasks: [task({
        id: 't1',
        title: 'A',
        status: 'scheduled',
        scheduledStart: '2026-07-13T09:00:00.000Z',
        scheduledEnd: '2026-07-13T09:30:00.000Z',
        updatedAt: '2026-07-13T08:00:00.000Z',
      })],
    });
    expect(computePlanningRevision(after)).not.toBe(computePlanningRevision(before));
  });

  it('computePlanDiffs captures status and schedule changes', () => {
    const before = [
      task({ id: 't1', title: 'A', status: 'confirmed' }),
      task({
        id: 't2',
        title: 'B',
        status: 'scheduled',
        scheduledStart: '2026-07-12T10:00:00.000Z',
        scheduledEnd: '2026-07-12T10:30:00.000Z',
      }),
    ];
    const plan = {
      tasks: [
        task({
          id: 't1',
          title: 'A',
          status: 'scheduled',
          scheduledStart: '2026-07-13T09:00:00.000Z',
          scheduledEnd: '2026-07-13T09:30:00.000Z',
        }),
        before[1]!,
      ],
      warnings: [],
    };
    const diffs = computePlanDiffs(before, plan);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.taskId).toBe('t1');
    expect(diffs[0]!.beforeStatus).toBe('confirmed');
    expect(diffs[0]!.afterStatus).toBe('scheduled');
  });
});
