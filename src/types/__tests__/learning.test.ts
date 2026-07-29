import { describe, it, expect } from 'vitest';
import {
  ArtifactSchema,
  AssessmentSchema,
  CitationSchema,
  CourseSchema,
  DiagnosticGapSchema,
  FeedbackSignalSchema,
  InteractionTurnSchema,
  LearnerProfileSchema,
  LearningDataSchema,
  LearningGoalSchema,
  LearningSessionSchema,
  LearningUnitSchema,
  SessionSectionSchema,
  SourceDocumentSchema,
  StudyTaskSchema,
  TaskStatusSchema,
  TimetableSlotSchema,
  emptyLearningData,
} from '../learning';

const ts = '2026-07-12T08:00:00.000Z';

describe('learning Zod schemas', () => {
  it('validates Course', () => {
    const c = CourseSchema.parse({
      id: 'c1',
      title: 'ML',
      createdAt: ts,
      updatedAt: ts,
    });
    expect(c.id).toBe('c1');
  });

  it('validates SourceDocument with chunks', () => {
    const d = SourceDocumentSchema.parse({
      id: 'd1',
      courseId: 'c1',
      title: 'N',
      format: 'markdown',
      content: 'hello',
      chunks: [{ index: 0, text: 'hello' }],
      createdAt: ts,
      updatedAt: ts,
    });
    expect(d.chunks[0]!.index).toBe(0);
  });

  it('validates LearningGoal / Unit / Task / Session cross-entity ids', () => {
    LearningGoalSchema.parse({
      id: 'g1',
      courseId: 'c1',
      title: 'G',
      createdAt: ts,
      updatedAt: ts,
    });
    LearningUnitSchema.parse({
      id: 'u1',
      courseId: 'c1',
      goalId: 'g1',
      title: 'U',
      createdAt: ts,
      updatedAt: ts,
    });
    const task = StudyTaskSchema.parse({
      id: 't1',
      courseId: 'c1',
      goalId: 'g1',
      unitId: 'u1',
      title: 'T',
      estimatedMinutes: 30,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    });
    expect(task.locked).toBe(false);
    LearningSessionSchema.parse({
      id: 's1',
      courseId: 'c1',
      taskId: 't1',
      startedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
  });

  it('rejects invalid timetable end<=start and bad HH:mm', () => {
    expect(() =>
      TimetableSlotSchema.parse({
        id: 's',
        courseId: 'c',
        weekday: 1,
        start: '10:00',
        end: '09:00',
        courseName: 'X',
        location: '',
        createdAt: ts,
        updatedAt: ts,
      }),
    ).toThrow();
    expect(() =>
      TimetableSlotSchema.parse({
        id: 's',
        courseId: 'c',
        weekday: 1,
        start: '9:00',
        end: '10:00',
        courseName: 'X',
        location: '',
        createdAt: ts,
        updatedAt: ts,
      }),
    ).toThrow();
  });

  it('rejects empty ids and invalid ISO timestamps', () => {
    expect(() =>
      CourseSchema.parse({ id: '', title: 'x', createdAt: ts, updatedAt: ts }),
    ).toThrow();
    expect(() =>
      CourseSchema.parse({
        id: 'c',
        title: 'x',
        createdAt: 'not-a-date',
        updatedAt: ts,
      }),
    ).toThrow();
  });

  it('validates empty LearningData store as version 2', () => {
    expect(LearningDataSchema.parse(emptyLearningData()).version).toBe(2);
  });

  it('validates v2 task statuses', () => {
    for (const status of ['pending_suggestion', 'confirmed', 'scheduled', 'in_progress', 'done']) {
      const t = StudyTaskSchema.parse({
        id: `t-${status}`,
        courseId: 'c1',
        title: 'T',
        estimatedMinutes: 15,
        status,
        createdAt: ts,
        updatedAt: ts,
      });
      expect(t.status).toBe(status);
      expect(TaskStatusSchema.parse(status)).toBe(status);
    }
  });

  it('still accepts deprecated v1 task statuses for backward compatibility', () => {
    const pending = StudyTaskSchema.parse({
      id: 'legacy-pending',
      courseId: 'c1',
      title: 'Legacy',
      estimatedMinutes: 15,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    });
    expect(pending.status).toBe('pending');
  });

  it('validates Citation', () => {
    const c = CitationSchema.parse({
      documentId: 'd1',
      chunkIndex: 3,
      excerpt: 'a snippet',
    });
    expect(c.documentId).toBe('d1');
    expect(c.chunkIndex).toBe(3);
  });

  it('validates Assessment', () => {
    const a = AssessmentSchema.parse({ result: 'partial', notes: 'needs work' });
    expect(a.result).toBe('partial');
  });

  it('validates InteractionTurn with citations and assessment', () => {
    const turn = InteractionTurnSchema.parse({
      id: 'turn-1',
      role: 'assistant',
      content: 'Here is the answer.',
      citations: [{ documentId: 'd1', chunkIndex: 0 }],
      assessment: { result: 'pass' },
      createdAt: ts,
    });
    expect(turn.role).toBe('assistant');
    expect(turn.citations).toHaveLength(1);
  });

  it('validates SessionSection with phase', () => {
    const section = SessionSectionSchema.parse({
      id: 'sec-1',
      status: 'open',
      phase: 'teach',
      order: 1,
    });
    expect(section.status).toBe('open');
    expect(section.phase).toBe('teach');
  });

  it('extends LearningSession with sections and currentSectionId', () => {
    const session = LearningSessionSchema.parse({
      id: 's1',
      courseId: 'c1',
      startedAt: ts,
      sections: [
        { id: 'sec-1', status: 'open', order: 1 },
        { id: 'sec-2', status: 'locked' },
      ],
      currentSectionId: 'sec-1',
      createdAt: ts,
      updatedAt: ts,
    });
    expect(session.sections).toHaveLength(2);
    expect(session.currentSectionId).toBe('sec-1');
  });

  it('defaults LearningSession sections to empty array', () => {
    const session = LearningSessionSchema.parse({
      id: 's2',
      courseId: 'c1',
      startedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
    expect(session.sections).toEqual([]);
    expect(session.currentSectionId).toBeUndefined();
  });

  it('validates DiagnosticGap with linked task', () => {
    const gap = DiagnosticGapSchema.parse({
      id: 'g1',
      courseId: 'c1',
      documentIds: ['d1'],
      topic: 'Gradient descent',
      reason: 'No example found.',
      severity: 'high',
      status: 'pending_suggestion',
      taskId: 't1',
      createdAt: ts,
      updatedAt: ts,
    });
    expect(gap.status).toBe('pending_suggestion');
    expect(gap.severity).toBe('high');
  });

  it('validates Artifact with mandatory citations', () => {
    const artifact = ArtifactSchema.parse({
      id: 'a1',
      courseId: 'c1',
      sessionId: 's1',
      kind: 'flashcard',
      title: 'Flashcard',
      content: 'Q: What?\nA: That.',
      citations: [{ documentId: 'd1', chunkIndex: 0 }],
      createdAt: ts,
      updatedAt: ts,
    });
    expect(artifact.kind).toBe('flashcard');
    expect(artifact.citations).toHaveLength(1);
  });

  it('rejects Artifact without citations', () => {
    expect(() =>
      ArtifactSchema.parse({
        id: 'a1',
        courseId: 'c1',
        kind: 'summary',
        title: 'Summary',
        content: 'No citations.',
        citations: [],
        createdAt: ts,
        updatedAt: ts,
      }),
    ).toThrow();
  });

  it('validates FeedbackSignal', () => {
    const fb = FeedbackSignalSchema.parse({
      id: 'f1',
      courseId: 'c1',
      sessionId: 's1',
      sectionId: 'sec-1',
      rating: 4,
      difficulty: 3,
      understood: true,
      notes: 'Good.',
      createdAt: ts,
    });
    expect(fb.rating).toBe(4);
    expect(fb.understood).toBe(true);
  });

  it('validates LearnerProfile', () => {
    const profile = LearnerProfileSchema.parse({
      courseId: 'c1',
      strengths: ['gradient descent'],
      weaknesses: ['backpropagation'],
      preferredMinutes: 30,
      avgRating: 4,
      totalSessions: 2,
      updatedAt: ts,
    });
    expect(profile.totalSessions).toBe(2);
    expect(profile.avgRating).toBe(4);
  });

  it('includes new arrays in empty LearningData', () => {
    const data = emptyLearningData();
    expect(data.diagnosticGaps).toEqual([]);
    expect(data.artifacts).toEqual([]);
    expect(data.feedbackSignals).toEqual([]);
    expect(data.learnerProfiles).toEqual([]);
  });
});
