import {
  FeedbackSignalSchema,
  LearnerProfileSchema,
  newId,
  nowIso,
  type FeedbackSignal,
  type LearnerProfile,
  type LearningData,
  type LearningSession,
  type SessionSection,
} from '@/types/learning';

export type FeedbackInput = {
  courseId: string;
  sessionId: string;
  sectionId?: string;
  rating: number;
  difficulty?: number;
  understood?: boolean;
  notes?: string;
};

export class ProfileError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PROFILE_ERROR') {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

/**
 * Record a feedback signal and update the learner profile for the course.
 *
 * - Strengths come from sections the learner passed.
 * - Weaknesses come from sections the learner failed or marked not understood.
 * - Preferred session length is averaged from completed session durations.
 */
export function recordFeedback(
  data: LearningData,
  input: FeedbackInput,
): { feedback: FeedbackSignal; profile: LearnerProfile } {
  const courseId = input.courseId?.trim();
  if (!courseId) {
    throw new ProfileError('courseId is required', 'INVALID_INPUT');
  }

  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new ProfileError(`Course not found: ${courseId}`, 'NOT_FOUND');
  }

  const session = data.sessions.find((s) => s.id === input.sessionId);
  if (!session) {
    throw new ProfileError(`Session not found: ${input.sessionId}`, 'NOT_FOUND');
  }

  if (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ProfileError('rating must be between 1 and 5', 'INVALID_INPUT');
  }

  const ts = nowIso();
  const feedback = FeedbackSignalSchema.parse({
    id: newId(),
    courseId,
    sessionId: input.sessionId,
    sectionId: input.sectionId,
    rating: input.rating,
    difficulty: input.difficulty,
    understood: input.understood ?? true,
    notes: input.notes?.trim(),
    createdAt: ts,
  });

  const existing = data.learnerProfiles.find((p) => p.courseId === courseId);
  const profile = applyFeedbackToProfile(
    data,
    existing ?? buildEmptyProfile(courseId),
    feedback,
    session,
  );

  return { feedback, profile };
}

function buildEmptyProfile(courseId: string): LearnerProfile {
  return LearnerProfileSchema.parse({
    courseId,
    strengths: [],
    weaknesses: [],
    updatedAt: nowIso(),
  });
}

function applyFeedbackToProfile(
  data: LearningData,
  profile: LearnerProfile,
  feedback: FeedbackSignal,
  session: LearningSession,
): LearnerProfile {
  const allFeedback = [...data.feedbackSignals, feedback].filter(
    (f) => f.courseId === profile.courseId,
  );
  const ratings = allFeedback.map((f) => f.rating);
  const avgRating =
    ratings.length > 0
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : 0;

  const sessionMinutes = sessionDurationMinutes(session);
  const completedSessions = data.sessions.filter(
    (s) => s.courseId === profile.courseId && s.endedAt,
  ).length;

  const prevPreferred = profile.preferredMinutes ?? sessionMinutes;
  const preferredMinutes =
    completedSessions > 1
      ? Math.round((prevPreferred * (completedSessions - 1) + sessionMinutes) / completedSessions)
      : sessionMinutes;

  const { strengths, weaknesses } = deriveStrengthsWeaknesses(
    data,
    profile,
    session,
    feedback,
  );

  return LearnerProfileSchema.parse({
    ...profile,
    strengths,
    weaknesses,
    avgRating,
    totalSessions: completedSessions,
    preferredMinutes,
    lastFeedbackAt: feedback.createdAt,
    updatedAt: feedback.createdAt,
  });
}

function sessionDurationMinutes(session: LearningSession): number {
  if (!session.endedAt) return 0;
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(1, Math.round((end - start) / 60_000));
}

function deriveStrengthsWeaknesses(
  data: LearningData,
  profile: LearnerProfile,
  session: LearningSession,
  feedback: FeedbackSignal,
): { strengths: string[]; weaknesses: string[] } {
  const strengths = new Set(profile.strengths);
  const weaknesses = new Set(profile.weaknesses);

  for (const section of session.sections) {
    const topic = topicForSection(section);
    if (!topic) continue;

    const passed = section.assessment?.result === 'pass';
    const struggled =
      section.assessment?.result === 'fail' ||
      (!feedback.understood && feedback.sectionId === section.id);

    if (passed) {
      strengths.add(topic);
      weaknesses.delete(topic);
    } else if (struggled) {
      weaknesses.add(topic);
      strengths.delete(topic);
    }
  }

  // Reinforce existing weaknesses if still failing them.
  for (const w of profile.weaknesses) {
    const related = session.sections.find((s) => topicForSection(s)?.includes(w),
    );
    if (related && related.assessment?.result === 'fail') {
      weaknesses.add(w);
    }
  }

  return {
    strengths: Array.from(strengths).slice(0, 20),
    weaknesses: Array.from(weaknesses).slice(0, 20),
  };
}

function topicForSection(section: SessionSection): string | undefined {
  return section.title?.trim() || undefined;
}
