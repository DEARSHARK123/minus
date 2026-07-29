import { z } from 'zod';
import {
  CourseSchema,
  LearningSessionSchema,
  LearningDataSchema,
  SourceDocumentSchema,
  LearningGoalSchema,
  LearningUnitSchema,
  StudyTaskSchema,
  TimetableSlotSchema,
  type LearningData,
  type TaskStatus,
  type StudyTask,
} from '@/types/learning';

/**
 * Loose v1 schema used to read legacy files. Entity shapes are reused from v2
 * because the v2 schemas remain backward-compatible (optional sections, legacy
 * task statuses accepted for parsing).
 */
export const LearningDataV1Schema = z.object({
  version: z.literal(1),
  courses: z.array(CourseSchema),
  documents: z.array(SourceDocumentSchema),
  goals: z.array(LearningGoalSchema),
  units: z.array(LearningUnitSchema),
  tasks: z.array(StudyTaskSchema),
  timetable: z.array(TimetableSlotSchema),
  sessions: z.array(LearningSessionSchema),
});

export type LearningDataV1 = z.infer<typeof LearningDataV1Schema>;

function migrateTaskStatus(task: StudyTask): TaskStatus {
  switch (task.status) {
    case 'pending':
      return task.scheduledStart && task.scheduledEnd ? 'scheduled' : 'confirmed';
    case 'completed':
      return 'done';
    case 'in_progress':
      return 'in_progress';
    default:
      // Already a v2 status.
      return task.status as TaskStatus;
  }
}

/**
 * Convert a v1 LearningData payload to v2.
 *
 * - version becomes 2
 * - task status mapping: pending → confirmed (no schedule) or scheduled;
 *   completed → done; in_progress unchanged
 * - sessions receive empty sections[] and a null currentSectionId (no synthetic
 *   sections are invented per course)
 */
export function migrateV1ToV2(data: unknown): LearningData {
  const v1 = LearningDataV1Schema.parse(data);

  const migrated: LearningData = {
    version: 2,
    courses: v1.courses,
    documents: v1.documents,
    goals: v1.goals,
    units: v1.units,
    tasks: v1.tasks.map((task) => ({
      ...task,
      status: migrateTaskStatus(task),
    })),
    timetable: v1.timetable,
    sessions: v1.sessions.map((session) => ({
      ...session,
      sections: [],
      currentSectionId: null,
    })),
    diagnosticGaps: [],
    artifacts: [],
    feedbackSignals: [],
    learnerProfiles: [],
    importSuggestions: [],
  };

  // Final validation so callers never receive an invalid v2 object.
  return LearningDataSchema.parse(migrated);
}

/** Type guard for raw v1 payloads (used before JSON schema validation). */
export function isV1LearningData(parsed: unknown): parsed is { version: 1 } {
  return typeof parsed === 'object'
    && parsed !== null
    && (parsed as Record<string, unknown>).version === 1;
}
