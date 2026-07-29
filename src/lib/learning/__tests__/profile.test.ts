import { describe, it, expect } from 'vitest';
import { recordFeedback, ProfileError } from '../profile';
import { emptyLearningData, type LearningSession } from '@/types/learning';

function sampleSession(overrides: Partial<LearningSession> = {}): LearningSession {
  return {
    id: 's1',
    courseId: 'c1',
    startedAt: '2026-07-12T08:00:00.000Z',
    endedAt: '2026-07-12T08:30:00.000Z',
    sections: [
      {
        id: 'sec-1',
        status: 'done',
        phase: 'done',
        order: 0,
        title: 'Gradient descent',
        assessment: { result: 'pass', notes: 'Good' },
      },
    ],
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:30:00.000Z',
    ...overrides,
  };
}

function sampleData(sessionOverrides?: Partial<LearningSession>) {
  return {
    ...emptyLearningData(),
    courses: [
      {
        id: 'c1',
        title: 'ML',
        createdAt: '2026-07-12T08:00:00.000Z',
        updatedAt: '2026-07-12T08:00:00.000Z',
      },
    ],
    sessions: [sampleSession(sessionOverrides)],
  };
}

describe('recordFeedback', () => {
  it('creates feedback and a new learner profile', () => {
    const data = sampleData();
    const result = recordFeedback(data, {
      courseId: 'c1',
      sessionId: 's1',
      rating: 4,
      difficulty: 3,
      understood: true,
      notes: 'Solid session.',
    });
    expect(result.feedback.rating).toBe(4);
    expect(result.profile.courseId).toBe('c1');
    expect(result.profile.strengths).toContain('Gradient descent');
    expect(result.profile.totalSessions).toBe(1);
    expect(result.profile.preferredMinutes).toBe(30);
    expect(result.profile.avgRating).toBe(4);
  });

  it('marks weakness when section failed', () => {
    const data = sampleData({
      sections: [
        {
          id: 'sec-1',
          status: 'open',
          phase: 'remediate',
          order: 0,
          title: 'Backpropagation',
          assessment: { result: 'fail', notes: 'Needs work' },
        },
      ],
    });
    const result = recordFeedback(data, {
      courseId: 'c1',
      sessionId: 's1',
      rating: 2,
      understood: false,
    });
    expect(result.profile.weaknesses).toContain('Backpropagation');
    expect(result.profile.strengths).not.toContain('Backpropagation');
  });

  it('updates average rating across multiple feedback signals', () => {
    const data = {
      ...sampleData(),
      feedbackSignals: [
        {
          id: 'f-prev',
          courseId: 'c1',
          sessionId: 's0',
          rating: 2,
          understood: true,
          createdAt: '2026-07-11T08:00:00.000Z',
        },
      ],
    };
    const result = recordFeedback(data, {
      courseId: 'c1',
      sessionId: 's1',
      rating: 4,
    });
    expect(result.profile.avgRating).toBe(3);
  });

  it('throws when course is missing', () => {
    expect(() =>
      recordFeedback(emptyLearningData(), {
        courseId: 'c1',
        sessionId: 's1',
        rating: 3,
      }),
    ).toThrow(ProfileError);
  });

  it('throws when session is missing', () => {
    const data = sampleData();
    data.sessions = [];
    expect(() =>
      recordFeedback(data, {
        courseId: 'c1',
        sessionId: 's1',
        rating: 3,
      }),
    ).toThrow(ProfileError);
  });

  it('throws for invalid rating', () => {
    const data = sampleData();
    expect(() =>
      recordFeedback(data, {
        courseId: 'c1',
        sessionId: 's1',
        rating: 6,
      }),
    ).toThrow(ProfileError);
  });
});
