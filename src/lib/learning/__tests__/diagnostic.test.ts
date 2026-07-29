import { describe, it, expect } from 'vitest';
import {
  diagnoseGaps,
  DiagnosticError,
  confirmGap,
  dismissGap,
} from '../diagnostic';
import { emptyLearningData, type DiagnosticGap, type StudyTask } from '@/types/learning';

function sampleCourse() {
  return {
    id: 'c1',
    title: 'ML',
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:00:00.000Z',
  };
}

function sampleDoc(overrides: { id: string; title: string; content: string }) {
  const chunks = overrides.content
    .split(/\n\n+/)
    .map((text, index) => ({ index, text: text.trim() }))
    .filter((c) => c.text.length > 0);
  return {
    id: overrides.id,
    courseId: 'c1',
    title: overrides.title,
    format: 'markdown' as const,
    content: overrides.content,
    chunks,
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:00:00.000Z',
  };
}

describe('diagnoseGaps', () => {
  it('throws when courseId is missing', () => {
    expect(() => diagnoseGaps(emptyLearningData(), { courseId: '' })).toThrow(
      DiagnosticError,
    );
  });

  it('throws when course has no documents', () => {
    const data = {
      ...emptyLearningData(),
      courses: [sampleCourse()],
    };
    expect(() => diagnoseGaps(data, { courseId: 'c1' })).toThrow(DiagnosticError);
  });

  it('detects under-covered documents with few chunks', () => {
    const data = {
      ...emptyLearningData(),
      courses: [sampleCourse()],
      documents: [
        sampleDoc({
          id: 'd1',
          title: 'Short',
          content: 'Only one chunk.',
        }),
      ],
    };
    const result = diagnoseGaps(data, { courseId: 'c1', coverageThreshold: 3 });
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps[0]!.topic).toBe('Short');
    expect(result.gaps[0]!.status).toBe('pending_suggestion');
    expect(result.tasks[0]!.status).toBe('pending_suggestion');
  });

  it('detects cross-document topics missing examples or assessments', () => {
    const data = {
      ...emptyLearningData(),
      courses: [sampleCourse()],
      documents: [
        sampleDoc({
          id: 'd1',
          title: 'Doc 1',
          content: '# Gradient descent\n\nGradient descent is an optimization algorithm.',
        }),
        sampleDoc({
          id: 'd2',
          title: 'Doc 2',
          content: '# Gradient descent\n\nGradient descent iteratively updates parameters.',
        }),
      ],
    };
    const result = diagnoseGaps(data, { courseId: 'c1' });
    const gap = result.gaps.find((g) => g.topic.includes('gradient descent'));
    expect(gap).toBeTruthy();
    expect(gap!.documentIds).toContain('d1');
    expect(gap!.documentIds).toContain('d2');
    expect(gap!.reason).toMatch(/lacks/);
  });

  it('does not flag a topic that has both example and assessment', () => {
    const data = {
      ...emptyLearningData(),
      courses: [sampleCourse()],
      documents: [
        sampleDoc({
          id: 'd1',
          title: 'Doc 1',
          content: '# Gradient descent\n\nExample: solve x^2.\n\nExercise: derive step.',
        }),
        sampleDoc({
          id: 'd2',
          title: 'Doc 2',
          content: '# Gradient descent\n\nGradient descent iteratively updates parameters.',
        }),
      ],
    };
    const result = diagnoseGaps(data, { courseId: 'c1' });
    const gap = result.gaps.find((g) => g.topic.includes('gradient descent'));
    expect(gap).toBeFalsy();
  });

  it('limits diagnosis to requested documents', () => {
    const data = {
      ...emptyLearningData(),
      courses: [sampleCourse()],
      documents: [
        sampleDoc({
          id: 'd1',
          title: 'Doc 1',
          content: '# Gradient descent\n\nText.',
        }),
        sampleDoc({
          id: 'd2',
          title: 'Doc 2',
          content: '# Gradient descent\n\nText.',
        }),
        sampleDoc({
          id: 'd3',
          title: 'Doc 3',
          content: '# Other topic\n\nText.',
        }),
      ],
    };
    const result = diagnoseGaps(data, { courseId: 'c1', documentIds: ['d1', 'd2'] });
    expect(result.gaps.every((g) => g.documentIds.every((id) => ['d1', 'd2'].includes(id)))).toBe(true);
  });
});

describe('confirmGap / dismissGap', () => {
  const gap: DiagnosticGap = {
    id: 'g1',
    courseId: 'c1',
    documentIds: ['d1'],
    topic: 'Gradient descent',
    reason: 'No example.',
    severity: 'high',
    status: 'pending_suggestion',
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:00:00.000Z',
  };
  const task: StudyTask = {
    id: 't1',
    courseId: 'c1',
    title: '补漏：Gradient descent',
    estimatedMinutes: 60,
    status: 'pending_suggestion',
    locked: false,
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:00:00.000Z',
  };

  it('confirms a pending gap and task', () => {
    const result = confirmGap(gap, task);
    expect(result.gap.status).toBe('confirmed');
    expect(result.task.status).toBe('confirmed');
  });

  it('throws when confirming non-pending gap', () => {
    expect(() => confirmGap({ ...gap, status: 'confirmed' }, task)).toThrow(
      DiagnosticError,
    );
  });

  it('dismisses a pending gap', () => {
    const dismissed = dismissGap(gap);
    expect(dismissed.status).toBe('dismissed');
  });
});
