import { create } from 'zustand';
import type {
  ApiResponse,
  Artifact,
  Course,
  DiagnosticGap,
  FeedbackSignal,
  ImportSuggestion,
  LearnerProfile,
  LearningData,
  LearningSession,
  PlanProposal,
  PlanConstraintSnapshot,
  PlanResult,
  SearchHit,
  SourceDocument,
  StudyTask,
  TimetableSlot,
  WebSearchMode,
} from '@/types/learning';
import { emptyLearningData } from '@/types/learning';
import type { ObservabilityCounters } from '@/lib/learning/observability';
import type { ProactiveResult } from '@/lib/learning/proactive';
import type { CalendarBrief } from '@/lib/learning/calendar-companion';
import type { DocumentAnalysis } from '@/lib/learning/import-assist';

/**
 * QUARANTINED (B05) — Rule-based four-stage learning path (NOT AI, NOT production Home).
 * Production Start Session uses createLearningPathFromOutline (OutlineAgent units).
 * Do not drive AppShell Home or Session from LEARNING_PATH_STAGES.
 * Kept only for legacy createLearningPath helper / migration.
 */
export const LEARNING_PATH_STAGES = [
  {
    key: 'foundations',
    title: '基础概念',
    description: '建立术语与核心定义，扫清前置知识。',
    estimatedMinutes: 45,
  },
  {
    key: 'principles',
    title: '核心原理',
    description: '理解机制、因果与关键推导。',
    estimatedMinutes: 60,
  },
  {
    key: 'practice',
    title: '实践练习',
    description: '动手练习与应用，巩固理解。',
    estimatedMinutes: 75,
  },
  {
    key: 'review',
    title: '复盘评估',
    description: '总结薄弱点，完成自测与复盘。',
    estimatedMinutes: 40,
  },
] as const;

export type CreateLearningPathInput = {
  courseId: string;
  goalTitle: string;
  goalDescription?: string;
  targetDate?: string;
};

/** OutlineAgent units — used by Start Session (must not be replaced by LEARNING_PATH_STAGES). */
export type OutlineUnitInput = {
  title: string;
  knowledgePoints?: string[];
  description?: string;
  estimatedMinutes?: number;
};

export type CreateLearningPathFromOutlineInput = {
  courseId: string;
  goalTitle: string;
  goalDescription?: string;
  targetDate?: string;
  units: OutlineUnitInput[];
};

export type ImportDocumentInput = {
  courseId: string;
  title: string;
  format: 'markdown' | 'txt';
  content: string;
  currentGoalId?: string;
  currentUnitId?: string;
};

export type ImportDocumentResult = {
  document: SourceDocument;
  analysis: DocumentAnalysis;
  suggestions: ImportSuggestion[];
};

export type CreateSessionInput = {
  courseId: string;
  taskId?: string;
  notes?: string;
};

export type CourseKnowledgeOptions = {
  providerId?: string;
  webSearchMode?: WebSearchMode;
  systemPrompt?: string;
};

async function learningApi<T>(
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('/api/learning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`Learning API returned non-JSON (HTTP ${res.status})`);
  }

  if (!json.success) {
    throw new Error(json.error || `Learning API failed (HTTP ${res.status})`);
  }

  return json.data as T;
}

function dispatchLearningAutomationEvent(input: {
  type: 'course_completed' | 'assessment_failed';
  courseId: string;
  eventId: string;
}): void {
  void fetch('/api/settings/automations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'runDue', context: { event: input } }),
  }).catch(() => undefined);
}

interface LearningStore {
  data: LearningData;
  loading: boolean;
  error: string | null;
  /** Last search hits for the active session. */
  lastSearchHits: SearchHit[];
  /** Active learning session (client selection). */
  activeSession: LearningSession | null;
  /** Active task being studied in a session. */
  activeTaskId: string | null;
  /** Selected course for knowledge base / planning. */
  selectedCourseId: string | null;
  /** Latest observability counters. */
  observabilityCounters: ObservabilityCounters | null;
  /** Batch-07: Chat→Calendar preview proposal (not committed until Accept). */
  calendarProposalPreview: PlanProposal | null;

  load: () => Promise<void>;
  createCourse: (title: string, description?: string) => Promise<Course>;
  /** Batch-06 entity management (shared Zod schema with API/repository). */
  renameCourse: (courseId: string, title: string) => Promise<Course>;
  archiveCourse: (courseId: string, archived?: boolean) => Promise<Course>;
  deleteCourse: (
    courseId: string,
    opts: { confirmCascade: true },
  ) => Promise<{ deleted: true; courseId: string }>;
  renameDocument: (documentId: string, title: string) => Promise<SourceDocument>;
  deleteDocument: (
    documentId: string,
  ) => Promise<{ deleted: true; documentId: string }>;
  /**
   * Rule-based four-stage path: create goal → units → tasks → plan schedule.
   * Does not claim AI generation. Prefer createLearningPathFromOutline for agent outlines.
   */
  createLearningPath: (input: CreateLearningPathInput) => Promise<void>;
  /**
   * Persist OutlineAgent units → upsertUnit / upsertTask / plan.
   * Fixes LEARNING_PATH_STAGES discard bug on Start Session.
   */
  createLearningPathFromOutline: (input: CreateLearningPathFromOutlineInput) => Promise<void>;
  importDocument: (input: ImportDocumentInput) => Promise<ImportDocumentResult>;
  importTimetable: (courseId: string, csv: string) => Promise<TimetableSlot[]>;
  search: (courseId: string, query: string, limit?: number) => Promise<SearchHit[]>;
  plan: (courseId: string, goalId?: string) => Promise<PlanResult>;
  proposePlan: (
    courseId: string,
    goalId?: string,
    constraints?: PlanConstraintSnapshot,
  ) => Promise<PlanProposal>;
  confirmPlan: (proposal: PlanProposal) => Promise<PlanResult>;
  getCalendarBrief: (courseId?: string) => Promise<CalendarBrief>;
  confirmImportSuggestion: (suggestionId: string) => Promise<{
    suggestion: ImportSuggestion;
    sideEffects: Record<string, unknown>;
  }>;
  rejectImportSuggestion: (suggestionId: string) => Promise<ImportSuggestion>;
  proactiveTrigger: (payload: { kind: string; courseId: string; [key: string]: unknown }) => Promise<ProactiveResult>;
  skipDay: (courseId: string, skippedDate: string) => Promise<PlanResult>;
  getObservabilityCounters: () => Promise<ObservabilityCounters | null>;
  proposeTask: (input: Partial<StudyTask> & { courseId: string; title: string; estimatedMinutes: number }) => Promise<StudyTask>;
  confirmTask: (taskId: string) => Promise<StudyTask>;
  rejectSuggestion: (taskId: string) => Promise<{ deleted: true; taskId: string }>;
  completeTask: (taskId: string) => Promise<StudyTask>;
  createSession: (input: CreateSessionInput) => Promise<LearningSession>;
  endSession: (sessionId: string) => Promise<LearningSession>;
  getSession: (sessionId: string) => Promise<LearningSession>;
  saveSessionReflection: (sessionId: string, notes: string) => Promise<LearningSession>;
  sessionTeach: (
    sessionId: string,
    sectionId: string,
    courseId: string,
    hits?: SearchHit[],
    options?: CourseKnowledgeOptions,
  ) => Promise<LearningSession>;
  sessionReteach: (
    sessionId: string,
    sectionId: string,
    courseId: string,
    hits?: SearchHit[],
    options?: CourseKnowledgeOptions,
  ) => Promise<LearningSession>;
  sessionOpenSection: (
    sessionId: string,
    sectionId: string,
    mode?: 'guided' | 'flexible',
  ) => Promise<LearningSession>;
  sessionSetWebSearchMode: (sessionId: string, webSearchMode: WebSearchMode) => Promise<LearningSession>;
  sessionStartRecall: (sessionId: string, sectionId: string) => Promise<LearningSession>;
  sessionSubmitRecall: (sessionId: string, sectionId: string, answer: string) => Promise<LearningSession>;
  sessionAssess: (
    sessionId: string,
    sectionId: string,
    courseId: string,
    providerId?: string,
  ) => Promise<LearningSession>;
  sessionFollowUp: (
    sessionId: string,
    sectionId: string,
    question: string,
    unitTitle?: string,
    options?: CourseKnowledgeOptions & { hits?: SearchHit[] },
  ) => Promise<LearningSession>;

  setCalendarProposalPreview: (proposal: PlanProposal | null) => void;
  diagnoseGaps: (courseId: string, documentIds?: string[]) => Promise<{ gaps: DiagnosticGap[]; tasks: StudyTask[] }>;
  confirmDiagnosticGap: (gapId: string) => Promise<{ gap: DiagnosticGap; task: StudyTask }>;
  dismissDiagnosticGap: (gapId: string) => Promise<DiagnosticGap>;
  createArtifact: (input: {
    courseId: string;
    kind: Artifact['kind'];
    title: string;
    hits: SearchHit[];
    sessionId?: string;
    taskId?: string;
  }) => Promise<Artifact>;
  recordFeedback: (input: {
    courseId: string;
    sessionId: string;
    sectionId?: string;
    rating: number;
    difficulty?: number;
    understood?: boolean;
    notes?: string;
  }) => Promise<{ feedback: FeedbackSignal; profile: LearnerProfile }>;
  getLearnerProfile: (courseId: string) => Promise<LearnerProfile | null>;

  setSelectedCourseId: (courseId: string | null) => void;
  setActiveTaskId: (taskId: string | null) => void;
  setActiveSession: (session: LearningSession | null) => void;
  clearError: () => void;
  clearSearchHits: () => void;
}

export const useLearningStore = create<LearningStore>((set, get) => ({
  data: emptyLearningData(),
  loading: false,
  error: null,
  lastSearchHits: [],
  activeSession: null,
  activeTaskId: null,
  selectedCourseId: null,
  observabilityCounters: null,
  calendarProposalPreview: null,

  clearError: () => set({ error: null }),
  setCalendarProposalPreview: (proposal) => set({ calendarProposalPreview: proposal }),
  clearSearchHits: () => set({ lastSearchHits: [] }),
  setSelectedCourseId: (courseId) => set({ selectedCourseId: courseId }),
  setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),
  setActiveSession: (session) => set({ activeSession: session }),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await learningApi<LearningData>('getAll');
      const selected = get().selectedCourseId;
      const activeSessionId = get().activeSession?.id;
      const nextSelected =
        selected && data.courses.some((c) => c.id === selected)
          ? selected
          : data.courses[0]?.id ?? null;
      const activeSessions = data.sessions
        .filter((s) => s.courseId === nextSelected && !s.endedAt)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
      const activeSession =
        (activeSessionId ? data.sessions.find((session) => session.id === activeSessionId) : undefined) ??
        activeSessions[0] ??
        null;
      set({
        data,
        loading: false,
        selectedCourseId: nextSelected,
        activeSession,
        activeTaskId: activeSession?.taskId ?? null,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load learning data',
      });
    }
  },

  createCourse: async (title, description) => {
    set({ loading: true, error: null });
    try {
      const course = await learningApi<Course>('createCourse', {
        title: title.trim(),
        description: description?.trim() || undefined,
      });
      await get().load();
      set({ selectedCourseId: course.id, loading: false });
      return course;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create course';
      set({ loading: false, error: message });
      throw err;
    }
  },

  renameCourse: async (courseId, title) => {
    set({ loading: true, error: null });
    try {
      const course = await learningApi<Course>('renameCourse', {
        courseId,
        id: courseId,
        title: title.trim(),
      });
      await get().load();
      set({ loading: false });
      return course;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename course';
      set({ loading: false, error: message });
      throw err;
    }
  },

  archiveCourse: async (courseId, archived = true) => {
    set({ loading: true, error: null });
    try {
      const action = archived ? 'archiveCourse' : 'unarchiveCourse';
      const course = await learningApi<Course>(action, {
        courseId,
        id: courseId,
      });
      await get().load();
      const active = get().activeSession;
      if (archived && active?.courseId === courseId) {
        set({ activeSession: null, activeTaskId: null });
      }
      set({ loading: false });
      return course;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to archive course';
      set({ loading: false, error: message });
      throw err;
    }
  },

  deleteCourse: async (courseId, opts) => {
    if (!opts?.confirmCascade) {
      throw new Error('deleteCourse requires confirmCascade: true');
    }
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{ deleted: true; courseId: string }>(
        'deleteCourse',
        { courseId, id: courseId, confirmCascade: true },
      );
      await get().load();
      const active = get().activeSession;
      if (active?.courseId === courseId) {
        set({ activeSession: null, activeTaskId: null });
      }
      if (get().selectedCourseId === courseId) {
        set({ selectedCourseId: get().data.courses[0]?.id ?? null });
      }
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete course';
      set({ loading: false, error: message });
      throw err;
    }
  },

  renameDocument: async (documentId, title) => {
    set({ loading: true, error: null });
    try {
      const doc = await learningApi<SourceDocument>('renameDocument', {
        documentId,
        id: documentId,
        title: title.trim(),
      });
      await get().load();
      set({ loading: false });
      return doc;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename document';
      set({ loading: false, error: message });
      throw err;
    }
  },

  deleteDocument: async (documentId) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{ deleted: true; documentId: string }>(
        'deleteDocument',
        { documentId, id: documentId },
      );
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete document';
      set({ loading: false, error: message });
      throw err;
    }
  },

  createLearningPath: async (input) => {
    set({ loading: true, error: null });
    try {
      const { courseId, goalTitle, goalDescription, targetDate } = input;
      if (!courseId || !goalTitle.trim()) {
        throw new Error('createLearningPath requires courseId and goalTitle');
      }

      // 1) Goal
      const goal = await learningApi<{ id: string }>('upsertGoal', {
        courseId,
        title: goalTitle.trim(),
        description: goalDescription?.trim() || undefined,
        targetDate: targetDate || undefined,
      });

      // 2) Four rule-based stages → units + tasks
      for (let i = 0; i < LEARNING_PATH_STAGES.length; i++) {
        const stage = LEARNING_PATH_STAGES[i]!;
        const unit = await learningApi<{ id: string }>('upsertUnit', {
          courseId,
          goalId: goal.id,
          title: stage.title,
          description: stage.description,
          order: i,
        });

        await learningApi('upsertTask', {
          courseId,
          goalId: goal.id,
          unitId: unit.id,
          title: `${stage.title}：${goalTitle.trim()}`,
          description: stage.description,
          estimatedMinutes: stage.estimatedMinutes,
          status: 'confirmed',
          deadline: targetDate || undefined,
        });
      }

      // 3) Schedule with rule-based planner
      await learningApi<PlanResult>('plan', { courseId, goalId: goal.id });
      await get().load();
      set({ loading: false });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create learning path';
      set({ loading: false, error: message });
      throw err;
    }
  },

  createLearningPathFromOutline: async (input) => {
    set({ loading: true, error: null });
    try {
      const { courseId, goalTitle, goalDescription, targetDate, units } = input;
      if (!courseId || !goalTitle.trim()) {
        throw new Error('createLearningPathFromOutline requires courseId and goalTitle');
      }
      if (!units || units.length === 0) {
        throw new Error('createLearningPathFromOutline requires OutlineAgent units');
      }

      const goal = await learningApi<{ id: string }>('upsertGoal', {
        courseId,
        title: goalTitle.trim(),
        description: goalDescription?.trim() || undefined,
        targetDate: targetDate || undefined,
      });

      for (let i = 0; i < units.length; i++) {
        const u = units[i]!;
        const kp = (u.knowledgePoints || []).map((k) => k.trim()).filter(Boolean);
        const description =
          u.description?.trim() ||
          (kp.length > 0 ? kp.join(' · ') : undefined);
        const unit = await learningApi<{ id: string }>('upsertUnit', {
          courseId,
          goalId: goal.id,
          title: u.title.trim(),
          description,
          knowledgePoints: kp.length > 0 ? kp : undefined,
          order: i,
        });

        await learningApi('upsertTask', {
          courseId,
          goalId: goal.id,
          unitId: unit.id,
          title: `${u.title.trim()}：${goalTitle.trim()}`,
          description,
          estimatedMinutes: u.estimatedMinutes && u.estimatedMinutes > 0 ? u.estimatedMinutes : 45,
          status: 'confirmed',
          deadline: targetDate || undefined,
        });
      }

      await learningApi<PlanResult>('plan', { courseId, goalId: goal.id });
      await get().load();
      set({ loading: false });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create learning path from outline';
      set({ loading: false, error: message });
      throw err;
    }
  },

  importDocument: async (input) => {
    set({ loading: true, error: null });
    try {
      // Never send path fields. B06: returns analysis + pending suggestions (not auto-committed).
      const result = await learningApi<ImportDocumentResult>('importDocument', {
        courseId: input.courseId,
        title: input.title,
        format: input.format,
        content: input.content,
        currentGoalId: input.currentGoalId,
        currentUnitId: input.currentUnitId,
      });
      await get().load();
      // Optional extra review task after multi-doc — still pending_suggestion only.
      void get().proactiveTrigger({
        kind: 'import_document',
        courseId: input.courseId,
        documentTitle: result.document.title || input.title,
      });
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import document';
      set({ loading: false, error: message });
      throw err;
    }
  },

  confirmImportSuggestion: async (suggestionId) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{
        suggestion: ImportSuggestion;
        sideEffects: Record<string, unknown>;
      }>('confirmImportSuggestion', { suggestionId });
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to confirm import suggestion';
      set({ loading: false, error: message });
      throw err;
    }
  },

  rejectImportSuggestion: async (suggestionId) => {
    set({ loading: true, error: null });
    try {
      const suggestion = await learningApi<ImportSuggestion>('rejectImportSuggestion', {
        suggestionId,
      });
      await get().load();
      set({ loading: false });
      return suggestion;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to reject import suggestion';
      set({ loading: false, error: message });
      throw err;
    }
  },

  proposePlan: async (courseId, goalId, constraints) => {
    set({ loading: true, error: null });
    try {
      const proposal = await learningApi<PlanProposal>('proposePlan', {
        courseId,
        goalId,
        constraints,
      });
      set({ loading: false });
      return proposal;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to propose plan';
      set({ loading: false, error: message });
      throw err;
    }
  },

  confirmPlan: async (proposal) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{ plan: PlanResult; applied: true }>('confirmPlan', {
        proposal,
      });
      await get().load();
      set({ loading: false });
      return result.plan;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to confirm plan';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getCalendarBrief: async (courseId) => {
    try {
      const brief = await learningApi<CalendarBrief>('getCalendarBrief', {
        courseId: courseId || undefined,
      });
      return brief;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load calendar brief';
      set({ error: message });
      throw err;
    }
  },

  importTimetable: async (courseId, csv) => {
    set({ loading: true, error: null });
    try {
      const slots = await learningApi<TimetableSlot[]>('importTimetable', {
        courseId,
        csv,
      });
      await get().load();
      // Fire-and-forget proactive reschedule check; errors are non-blocking.
      void get().proactiveTrigger({ kind: 'import_timetable', courseId });
      set({ loading: false });
      return slots;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import timetable';
      set({ loading: false, error: message });
      throw err;
    }
  },

  search: async (courseId, query, limit) => {
    set({ loading: true, error: null });
    try {
      const hits = await learningApi<SearchHit[]>('search', {
        courseId,
        query,
        limit,
      });
      set({ lastSearchHits: hits, loading: false });
      return hits;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      set({ loading: false, error: message, lastSearchHits: [] });
      throw err;
    }
  },

  plan: async (courseId, goalId) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<PlanResult>('plan', {
        courseId,
        goalId,
      });
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Planning failed';
      set({ loading: false, error: message });
      throw err;
    }
  },

  proactiveTrigger: async (payload) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<ProactiveResult>('proactiveTrigger', payload);
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Proactive trigger failed';
      set({ loading: false, error: message });
      throw err;
    }
  },

  skipDay: async (courseId, skippedDate) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<PlanResult>('skipDay', { courseId, skippedDate });
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Skip-day reschedule failed';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getObservabilityCounters: async () => {
    try {
      const counters = await learningApi<ObservabilityCounters | null>('getObservabilityCounters', {});
      set({ observabilityCounters: counters });
      return counters;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load observability counters';
      set({ error: message });
      return null;
    }
  },

  proposeTask: async (input) => {
    set({ loading: true, error: null });
    try {
      const task = await learningApi<StudyTask>('proposeTask', {
        courseId: input.courseId,
        title: input.title.trim(),
        estimatedMinutes: input.estimatedMinutes,
        goalId: input.goalId,
        unitId: input.unitId,
        description: input.description?.trim() || undefined,
        deadline: input.deadline,
      });
      await get().load();
      set({ loading: false });
      return task;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to propose task';
      set({ loading: false, error: message });
      throw err;
    }
  },

  confirmTask: async (taskId) => {
    set({ loading: true, error: null });
    try {
      const task = await learningApi<StudyTask>('confirmTask', { taskId });
      await get().load();
      set({ loading: false });
      return task;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to confirm task';
      set({ loading: false, error: message });
      throw err;
    }
  },

  rejectSuggestion: async (taskId) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{ deleted: true; taskId: string }>('rejectSuggestion', { taskId });
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject suggestion';
      set({ loading: false, error: message });
      throw err;
    }
  },

  completeTask: async (taskId) => {
    set({ loading: true, error: null });
    try {
      const task = await learningApi<StudyTask>('completeTask', { taskId });
      await get().load();
      set({ loading: false });
      return task;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to complete task';
      set({ loading: false, error: message });
      throw err;
    }
  },

  createSession: async (input) => {
    set({ loading: true, error: null });
    try {
      const task = input.taskId
        ? get().data.tasks.find((item) => item.id === input.taskId)
        : undefined;
      if (task && (task.status === 'confirmed' || task.status === 'scheduled')) {
        await learningApi<StudyTask>('upsertTask', {
          ...task,
          status: 'in_progress',
        });
      }
      const session = await learningApi<LearningSession>('createSession', {
        courseId: input.courseId,
        taskId: input.taskId,
        notes: input.notes,
        startedAt: new Date().toISOString(),
      });
      await get().load();
      set({
        activeSession: session,
        activeTaskId: input.taskId ?? null,
        loading: false,
      });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      set({ loading: false, error: message });
      throw err;
    }
  },

  endSession: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('endSession', { sessionId });
      if (session.sections.length > 0 && session.sections.every((section) => section.phase === 'done')) {
        dispatchLearningAutomationEvent({
          type: 'course_completed',
          courseId: session.courseId,
          eventId: session.id,
        });
      }
      await get().load();
      set({ activeSession: null, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to end session';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getSession: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('getSession', { sessionId });
      set({ loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get session';
      set({ loading: false, error: message });
      throw err;
    }
  },

  saveSessionReflection: async (sessionId, notes) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('saveSessionReflection', {
        sessionId,
        notes,
      });
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save session reflection';
      set({ loading: false, error: message });
      throw err;
    }
  },

  sessionTeach: async (sessionId, sectionId, courseId, hits, options) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionTeach', {
        sessionId,
        sectionId,
        courseId,
        hits,
        providerId: options?.providerId,
        webSearchMode: options?.webSearchMode ?? 'auto',
        systemPrompt: options?.systemPrompt,
      });
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate teach';
      set({ loading: false, error: message });
      throw err;
    }
  },

  sessionReteach: async (sessionId, sectionId, courseId, hits, options) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionReteach', {
        sessionId,
        sectionId,
        courseId,
        hits,
        providerId: options?.providerId,
        webSearchMode: options?.webSearchMode ?? 'auto',
        systemPrompt: options?.systemPrompt,
      });
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate teach';
      set({ loading: false, error: message });
      throw err;
    }
  },

  sessionOpenSection: async (sessionId, sectionId, mode = 'guided') => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionOpenSection', {
        sessionId,
        sectionId,
        mode,
      });
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open section';
      set({ loading: false, error: message });
      throw err;
    }
  },

  sessionSetWebSearchMode: async (sessionId, webSearchMode) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionSetWebSearchMode', {
        sessionId,
        webSearchMode,
      });
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save network preference';
      set({ error: message, loading: false });
      throw err;
    }
  },

  sessionStartRecall: async (sessionId, sectionId) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionStartRecall', {
        sessionId,
        sectionId,
      });
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recall';
      set({ loading: false, error: message });
      throw err;
    }
  },

  sessionSubmitRecall: async (sessionId, sectionId, answer) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionSubmitRecall', {
        sessionId,
        sectionId,
        answer,
      });
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit recall';
      set({ loading: false, error: message });
      throw err;
    }
  },

  sessionFollowUp: async (
    sessionId,
    sectionId,
    question,
    unitTitle,
    options,
  ) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionFollowUp', {
        sessionId,
        sectionId,
        question,
        unitTitle,
        hits: options?.hits,
        providerId: options?.providerId,
        webSearchMode: options?.webSearchMode ?? 'auto',
        systemPrompt: options?.systemPrompt,
      });
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save follow-up';
      set({ loading: false, error: message });
      throw err;
    }
  },

  sessionAssess: async (sessionId, sectionId, courseId, providerId) => {
    set({ loading: true, error: null });
    try {
      const session = await learningApi<LearningSession>('sessionAssess', {
        sessionId,
        sectionId,
        courseId,
        providerId,
      });
      const assessedSection = session.sections.find((section) => section.id === sectionId);
      if (assessedSection?.assessment?.result && assessedSection.assessment.result !== 'pass') {
        dispatchLearningAutomationEvent({
          type: 'assessment_failed',
          courseId,
          eventId: `${session.id}:${sectionId}:${session.updatedAt}`,
        });
      }
      await get().load();
      set({ activeSession: session, loading: false });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assess';
      set({ loading: false, error: message });
      throw err;
    }
  },

  diagnoseGaps: async (courseId, documentIds) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{ gaps: DiagnosticGap[]; tasks: StudyTask[] }>('diagnoseGaps', {
        courseId,
        documentIds,
      });
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to diagnose gaps';
      set({ loading: false, error: message });
      throw err;
    }
  },

  confirmDiagnosticGap: async (gapId) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{ gap: DiagnosticGap; task: StudyTask }>('confirmDiagnosticGap', { gapId });
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to confirm gap';
      set({ loading: false, error: message });
      throw err;
    }
  },

  dismissDiagnosticGap: async (gapId) => {
    set({ loading: true, error: null });
    try {
      const gap = await learningApi<DiagnosticGap>('dismissDiagnosticGap', { gapId });
      await get().load();
      set({ loading: false });
      return gap;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to dismiss gap';
      set({ loading: false, error: message });
      throw err;
    }
  },

  createArtifact: async (input) => {
    set({ loading: true, error: null });
    try {
      const artifact = await learningApi<Artifact>('createArtifact', {
        courseId: input.courseId,
        kind: input.kind,
        title: input.title,
        hits: input.hits,
        sessionId: input.sessionId,
        taskId: input.taskId,
      });
      await get().load();
      set({ loading: false });
      return artifact;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create artifact';
      set({ loading: false, error: message });
      throw err;
    }
  },

  recordFeedback: async (input) => {
    set({ loading: true, error: null });
    try {
      const result = await learningApi<{ feedback: FeedbackSignal; profile: LearnerProfile }>('recordFeedback', {
        courseId: input.courseId,
        sessionId: input.sessionId,
        sectionId: input.sectionId,
        rating: input.rating,
        difficulty: input.difficulty,
        understood: input.understood,
        notes: input.notes,
      });
      await get().load();
      set({ loading: false });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record feedback';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getLearnerProfile: async (courseId) => {
    set({ loading: true, error: null });
    try {
      const profile = await learningApi<LearnerProfile | null>('getLearnerProfile', { courseId });
      set({ loading: false });
      return profile;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get learner profile';
      set({ loading: false, error: message });
      throw err;
    }
  },
}));
