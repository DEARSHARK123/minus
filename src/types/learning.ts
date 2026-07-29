import { z } from 'zod';

/** Non-empty entity id (UUID preferred, any non-empty string accepted for flexibility). */
export const EntityIdSchema = z.string().min(1, 'id is required');

/** ISO-8601 datetime string (e.g. 2026-07-12T08:00:00.000Z). */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true }).or(z.iso.datetime());

/** HH:mm 24-hour clock. */
export const HhMmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'time must be HH:mm');

export const DocumentFormatSchema = z.enum(['markdown', 'txt']);

/** v2 task statuses. Legacy v1 values are still accepted for gradual caller migration. */
export const TaskStatusSchema = z.enum([
  'pending_suggestion',
  'confirmed',
  'scheduled',
  'in_progress',
  'done',
  'pending',
  'completed',
]);

/** Weekday: 1=Monday … 7=Sunday (ISO-like). */
export const WeekdaySchema = z.number().int().min(1).max(7);

export const DocumentChunkSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
});

export const CourseSchema = z.object({
  id: EntityIdSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  /**
   * Batch-06: when set, course is archived (hidden from primary「学习课程」list).
   * Undefined/null = active.
   */
  archivedAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** Inferred document content type from import assist (B06). */
export const DocumentContentTypeSchema = z.enum([
  'notes',
  'lecture',
  'reference',
  'exercise',
  'other',
]);

export const SourceDocumentSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  title: z.string().min(1),
  format: DocumentFormatSchema,
  content: z.string(),
  chunks: z.array(DocumentChunkSchema),
  /** B06 import-assist metadata (optional for back-compat). */
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  contentType: DocumentContentTypeSchema.optional(),
  sourceQuality: z.number().min(0).max(1).optional(),
  linkedGoalId: EntityIdSchema.optional(),
  linkedUnitId: EntityIdSchema.optional(),
  duplicateOfDocumentId: EntityIdSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/**
 * Confirmable post-import suggestions (B06).
 * propose ≠ commit: status stays pending until user confirms/rejects.
 */
export const ImportSuggestionActionSchema = z.enum([
  'join_course',
  'generate_path',
  'update_unit',
  'keep_reference',
  'ignore',
]);

export const ImportSuggestionStatusSchema = z.enum([
  'pending',
  'confirmed',
  'rejected',
]);

export const ImportSuggestionSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  documentId: EntityIdSchema,
  action: ImportSuggestionActionSchema,
  title: z.string().min(1),
  reason: z.string().min(1),
  status: ImportSuggestionStatusSchema.default('pending'),
  /** Optional linkage targets for update_unit / join_course. */
  linkedGoalId: EntityIdSchema.optional(),
  linkedUnitId: EntityIdSchema.optional(),
  /** Snapshot of analysis shown to the user. */
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sourceQuality: z.number().min(0).max(1).optional(),
  contentType: DocumentContentTypeSchema.optional(),
  isDuplicate: z.boolean().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const LearningGoalSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  targetDate: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const LearningUnitSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  goalId: EntityIdSchema.optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  /** Adaptive outline knowledge points persisted from OutlineAgent. */
  knowledgePoints: z.array(z.string()).optional(),
  order: z.number().int().min(0).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const StudyTaskSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  goalId: EntityIdSchema.optional(),
  unitId: EntityIdSchema.optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  estimatedMinutes: z.number().int().positive(),
  deadline: IsoDateTimeSchema.optional(),
  status: TaskStatusSchema,
  locked: z.boolean().default(false),
  scheduledStart: IsoDateTimeSchema.optional(),
  scheduledEnd: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).superRefine((task, ctx) => {
  const hasStart = task.scheduledStart !== undefined;
  const hasEnd = task.scheduledEnd !== undefined;
  if (hasStart !== hasEnd) {
    ctx.addIssue({
      code: 'custom',
      message: 'scheduledStart and scheduledEnd must be provided together',
      path: ['scheduledEnd'],
    });
  } else if (task.scheduledStart && task.scheduledEnd
    && Date.parse(task.scheduledEnd) <= Date.parse(task.scheduledStart)) {
    ctx.addIssue({
      code: 'custom',
      message: 'scheduledEnd must be later than scheduledStart',
      path: ['scheduledEnd'],
    });
  }
});

export const TimetableSlotSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  weekday: WeekdaySchema,
  start: HhMmSchema,
  end: HhMmSchema,
  courseName: z.string().min(1),
  location: z.string().default(''),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).refine(
  (slot) => slot.end > slot.start,
  { message: 'end must be later than start', path: ['end'] },
);

export const CitationSchema = z.object({
  documentId: EntityIdSchema,
  chunkIndex: z.number().int().min(0),
  excerpt: z.string().optional(),
});

export const WebSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string().optional(),
});

export const WebSearchModeSchema = z.enum(['auto', 'always', 'off']);

export const KnowledgeSourceStatusSchema = z.object({
  model: z.literal('used'),
  local: z.enum(['used', 'available', 'not_used']),
  web: z.enum(['used', 'reused', 'unavailable', 'not_used']),
});

export const DiagnosticGapSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  documentIds: z.array(EntityIdSchema).min(1),
  topic: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  status: z.enum(['pending_suggestion', 'confirmed', 'dismissed']).default('pending_suggestion'),
  taskId: EntityIdSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ArtifactKindSchema = z.enum(['quiz', 'flashcard', 'summary']);

export const ArtifactSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  sessionId: EntityIdSchema.optional(),
  taskId: EntityIdSchema.optional(),
  kind: ArtifactKindSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  citations: z.array(CitationSchema).min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const FeedbackSignalSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  sessionId: EntityIdSchema,
  sectionId: EntityIdSchema.optional(),
  rating: z.number().int().min(1).max(5),
  difficulty: z.number().int().min(1).max(5).optional(),
  understood: z.boolean().default(true),
  notes: z.string().optional(),
  createdAt: IsoDateTimeSchema,
});

export const LearnerProfileSchema = z.object({
  courseId: EntityIdSchema,
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  preferredMinutes: z.number().int().positive().optional(),
  avgRating: z.number().min(0).max(5).default(0),
  totalSessions: z.number().int().min(0).default(0),
  lastFeedbackAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema,
});

export const SessionSectionStatusSchema = z.enum(['open', 'done', 'locked']);

export const SessionSectionPhaseSchema = z.enum([
  'teach',
  'active_recall',
  'assess',
  'remediate',
  'done',
]);

/**
 * Mastery distinctions (B05):
 * - completed: section finished (status done / phase done) — walked through the flow
 * - mastered: assessment pass on this section
 * - durable: re-pass after remediation, or pass without remediation (spaced proficiency proxy)
 * Only SessionEngine/repository set these — ProgressNarrator cannot forge them.
 */
export const MasteryLevelSchema = z.enum(['none', 'completed', 'mastered', 'durable']);

export const AssessmentResultSchema = z.enum(['pass', 'partial', 'fail']);

export const AssessmentSchema = z.object({
  result: AssessmentResultSchema,
  notes: z.string().optional(),
});

export const InteractionTurnSchema = z.object({
  id: EntityIdSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
  citations: z.array(CitationSchema).optional(),
  /** Public web sources used for this answer; local documents stay in citations. */
  webSources: z.array(WebSourceSchema).optional(),
  webSearchStatus: z.enum(['used', 'reused', 'unavailable']).optional(),
  /** New model-generated course turns record origin and validation explicitly. */
  contentOrigin: z.literal('model').optional(),
  qualityStatus: z.enum(['substantive', 'legacy_low_quality']).optional(),
  sourceStatus: KnowledgeSourceStatusSchema.optional(),
  assessment: AssessmentSchema.optional(),
  createdAt: IsoDateTimeSchema,
});

export const SessionSectionSchema = z.object({
  id: EntityIdSchema,
  status: SessionSectionStatusSchema,
  phase: SessionSectionPhaseSchema.default('teach'),
  order: z.number().int().min(0).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  /** Outline knowledge points for teach injection (from unit). */
  knowledgePoints: z.array(z.string()).optional(),
  turns: z.array(InteractionTurnSchema).optional(),
  assessment: AssessmentSchema.optional(),
  /**
   * Mastery level owned by SessionEngine.applyAssessment.
   * none | completed | mastered | durable — optional for back-compat.
   */
  masteryLevel: MasteryLevelSchema.optional(),
  /** True if section entered remediate at least once before a later pass. */
  hadRemediation: z.boolean().optional(),
});

export const LearningSessionSchema = z.object({
  id: EntityIdSchema,
  courseId: EntityIdSchema,
  taskId: EntityIdSchema.optional(),
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.optional(),
  notes: z.string().optional(),
  sections: z.array(SessionSectionSchema).default([]),
  currentSectionId: EntityIdSchema.nullable().optional(),
  /** Per-course-session network preference; optional for existing learning data. */
  webSearchMode: WebSearchModeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const LearningDataSchema = z.object({
  version: z.literal(2),
  courses: z.array(CourseSchema),
  documents: z.array(SourceDocumentSchema),
  goals: z.array(LearningGoalSchema),
  units: z.array(LearningUnitSchema),
  tasks: z.array(StudyTaskSchema),
  timetable: z.array(TimetableSlotSchema),
  sessions: z.array(LearningSessionSchema),
  diagnosticGaps: z.array(DiagnosticGapSchema).default([]),
  artifacts: z.array(ArtifactSchema).default([]),
  feedbackSignals: z.array(FeedbackSignalSchema).default([]),
  learnerProfiles: z.array(LearnerProfileSchema).default([]),
  /** B06: confirmable post-import agent suggestions (propose ≠ commit). */
  importSuggestions: z.array(ImportSuggestionSchema).default([]),
});

export type EntityId = z.infer<typeof EntityIdSchema>;
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;
export type DocumentContentType = z.infer<typeof DocumentContentTypeSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;
export type ImportSuggestionAction = z.infer<typeof ImportSuggestionActionSchema>;
export type ImportSuggestionStatus = z.infer<typeof ImportSuggestionStatusSchema>;
export type ImportSuggestion = z.infer<typeof ImportSuggestionSchema>;
export type LearningGoal = z.infer<typeof LearningGoalSchema>;
export type LearningUnit = z.infer<typeof LearningUnitSchema>;
export type StudyTask = z.infer<typeof StudyTaskSchema>;
export type TimetableSlot = z.infer<typeof TimetableSlotSchema>;
export type DiagnosticGap = z.infer<typeof DiagnosticGapSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type FeedbackSignal = z.infer<typeof FeedbackSignalSchema>;
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type WebSource = z.infer<typeof WebSourceSchema>;
export type WebSearchMode = z.infer<typeof WebSearchModeSchema>;
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
export type InteractionTurn = z.infer<typeof InteractionTurnSchema>;
export type SessionSectionStatus = z.infer<typeof SessionSectionStatusSchema>;
export type SessionSectionPhase = z.infer<typeof SessionSectionPhaseSchema>;
export type MasteryLevel = z.infer<typeof MasteryLevelSchema>;
export type SessionSection = z.infer<typeof SessionSectionSchema>;
export type LearningSession = z.infer<typeof LearningSessionSchema>;
export type LearningData = z.infer<typeof LearningDataSchema>;

export type SearchHit = {
  documentId: string;
  title: string;
  chunkIndex: number;
  snippet: string;
  score: number;
};

export type PlanResult = {
  tasks: StudyTask[];
  warnings: string[];
};

export const PlanConstraintSnapshotSchema = z.object({
  availableDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  dailyBudgetMinutes: z.number().int().min(10).max(480).optional(),
  dayStartHour: z.number().int().min(0).max(23).optional(),
  dayEndHour: z.number().int().min(1).max(24).optional(),
  deadlinePreference: z.enum(['front_load', 'even', 'before_deadline']).optional(),
}).superRefine((value, ctx) => {
  if (
    value.dayStartHour != null &&
    value.dayEndHour != null &&
    value.dayEndHour <= value.dayStartHour
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'dayEndHour must be later than dayStartHour',
      path: ['dayEndHour'],
    });
  }
});

export type PlanConstraintSnapshot = z.infer<typeof PlanConstraintSnapshotSchema>;

/** Before/after schedule row for calendar propose≠commit diffs (B06). */
export type PlanScheduleDiff = {
  taskId: string;
  title: string;
  beforeStart?: string;
  beforeEnd?: string;
  beforeStatus: TaskStatus;
  afterStart?: string;
  afterEnd?: string;
  afterStatus: TaskStatus;
};

export type PlanProposal = {
  id: string;
  courseId: string;
  baseRevision: string;
  createdAt: string;
  /** IANA timezone used to interpret local planning constraints. */
  timeZone: string;
  constraints?: PlanConstraintSnapshot;
  /** Client-only origin used to close the matching chat planning flow. */
  sourceConversationId?: string;
  plan: PlanResult;
  diffs: PlanScheduleDiff[];
  applied: false;
};

export type ApiSuccessResponse<T = unknown> = {
  success: true;
  data: T;
  error?: undefined;
  details?: undefined;
};

export type ApiErrorResponse = {
  success: false;
  data?: undefined;
  error: string;
  details?: unknown;
};

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export function emptyLearningData(): LearningData {
  return {
    version: 2,
    courses: [],
    documents: [],
    goals: [],
    units: [],
    tasks: [],
    timetable: [],
    sessions: [],
    diagnosticGaps: [],
    artifacts: [],
    feedbackSignals: [],
    learnerProfiles: [],
    importSuggestions: [],
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
