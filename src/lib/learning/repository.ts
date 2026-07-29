import { promises as fs } from 'fs';
import { constants as fsConstants } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CourseSchema,
  DiagnosticGapSchema,
  ImportSuggestionSchema,
  LearningDataSchema,
  LearningGoalSchema,
  LearningSessionSchema,
  LearningUnitSchema,
  SessionSectionSchema,
  SourceDocumentSchema,
  StudyTaskSchema,
  TimetableSlotSchema,
  emptyLearningData,
  newId,
  nowIso,
  type Artifact,
  type Course,
  type DiagnosticGap,
  type FeedbackSignal,
  type ImportSuggestion,
  type LearnerProfile,
  type LearningData,
  type LearningGoal,
  type LearningSession,
  type LearningUnit,
  type PlanProposal,
  type SessionSection,
  type SourceDocument,
  type StudyTask,
  type TimetableSlot,
} from '@/types/learning';
import { isV1LearningData, migrateV1ToV2 } from './migrate';
import { rescheduleAfterSkipDay } from './planner';
import type { PlanResult } from '@/types/learning';
import { runProactiveTrigger, type ProactiveResult, type ProactiveTrigger } from './proactive';
import { analyzeImportedDocument } from './import-assist';
import { computePlanningRevision, proposePlanSchedule } from './calendar-companion';
import { validatePlanProposal } from './calendar-proposal-edit';
import type { PlanConstraintSnapshot } from '@/types/learning';
import {
  EntityActionRequestSchema,
  learningEntitiesNeedSanitize,
  parseLearningEntityAction,
  sanitizeLearningEntities,
  type EntityActionRequest,
  type LearningEntityApiAction,
} from './entity-actions';

export class LearningDataError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code = 'LEARNING_DATA_ERROR', details?: unknown) {
    super(message);
    this.name = 'LearningDataError';
    this.code = code;
    this.details = details;
  }
}

export type RepositoryOptions = {
  /** Absolute path to learning-data.json. Defaults to ~/.minus/data/learning-data.json */
  dataPath?: string;
};

function defaultDataPath(): string {
  if (process.env.LEARNING_DATA_PATH) {
    return process.env.LEARNING_DATA_PATH;
  }
  return path.join(os.homedir(), '.minus', 'data', 'learning-data.json');
}

/**
 * Serialize all read/write mutations in-process so concurrent callers never
 * interleave partial writes of the same JSON file.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  // Keep the chain alive even if a task fails.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function validateReferences(data: LearningData): void {
  const assertUnique = (label: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) {
      throw new LearningDataError(`Duplicate ${label} id`, 'INVALID_REF');
    }
  };
  assertUnique('course', data.courses.map((item) => item.id));
  assertUnique('document', data.documents.map((item) => item.id));
  assertUnique('goal', data.goals.map((item) => item.id));
  assertUnique('unit', data.units.map((item) => item.id));
  assertUnique('task', data.tasks.map((item) => item.id));
  assertUnique('timetable slot', data.timetable.map((item) => item.id));
  assertUnique('session', data.sessions.map((item) => item.id));
  assertUnique('diagnostic gap', data.diagnosticGaps.map((item) => item.id));
  assertUnique('artifact', data.artifacts.map((item) => item.id));
  assertUnique('feedback signal', data.feedbackSignals.map((item) => item.id));
  assertUnique('import suggestion', (data.importSuggestions ?? []).map((item) => item.id));
  // learnerProfiles are keyed by courseId, so uniqueness is checked below.

  const courses = new Set(data.courses.map((item) => item.id));
  const goals = new Map(data.goals.map((item) => [item.id, item.courseId]));
  const units = new Map(data.units.map((item) => [item.id, item.courseId]));
  const tasks = new Map(data.tasks.map((item) => [item.id, item.courseId]));
  const requireCourse = (entity: string, id: string, courseId: string) => {
    if (!courses.has(courseId)) {
      throw new LearningDataError(`${entity} ${id} references missing course ${courseId}`, 'INVALID_REF');
    }
  };

  for (const doc of data.documents) requireCourse('Document', doc.id, doc.courseId);
  for (const goal of data.goals) requireCourse('Goal', goal.id, goal.courseId);
  for (const unit of data.units) {
    requireCourse('Unit', unit.id, unit.courseId);
    if (unit.goalId && goals.get(unit.goalId) !== unit.courseId) {
      throw new LearningDataError(`Unit ${unit.id} has an invalid goal reference`, 'INVALID_REF');
    }
  }
  for (const task of data.tasks) {
    requireCourse('Task', task.id, task.courseId);
    if (task.goalId && goals.get(task.goalId) !== task.courseId) {
      throw new LearningDataError(`Task ${task.id} has an invalid goal reference`, 'INVALID_REF');
    }
    if (task.unitId && units.get(task.unitId) !== task.courseId) {
      throw new LearningDataError(`Task ${task.id} has an invalid unit reference`, 'INVALID_REF');
    }
  }
  for (const slot of data.timetable) requireCourse('Timetable slot', slot.id, slot.courseId);
  for (const session of data.sessions) {
    requireCourse('Session', session.id, session.courseId);
    if (session.taskId && tasks.get(session.taskId) !== session.courseId) {
      throw new LearningDataError(`Session ${session.id} has an invalid task reference`, 'INVALID_REF');
    }
  }
  for (const gap of data.diagnosticGaps) {
    requireCourse('Diagnostic gap', gap.id, gap.courseId);
    for (const docId of gap.documentIds) {
      const doc = data.documents.find((d) => d.id === docId);
      if (!doc || doc.courseId !== gap.courseId) {
        throw new LearningDataError(
          `Diagnostic gap ${gap.id} references invalid document ${docId}`,
          'INVALID_REF',
        );
      }
    }
    if (gap.taskId && tasks.get(gap.taskId) !== gap.courseId) {
      throw new LearningDataError(`Diagnostic gap ${gap.id} has an invalid task reference`, 'INVALID_REF');
    }
  }
  for (const sug of data.importSuggestions ?? []) {
    requireCourse('Import suggestion', sug.id, sug.courseId);
    const doc = data.documents.find((d) => d.id === sug.documentId);
    if (!doc || doc.courseId !== sug.courseId) {
      throw new LearningDataError(
        `Import suggestion ${sug.id} references invalid document ${sug.documentId}`,
        'INVALID_REF',
      );
    }
  }
  for (const artifact of data.artifacts) {
    requireCourse('Artifact', artifact.id, artifact.courseId);
    if (artifact.sessionId && data.sessions.every((s) => s.id !== artifact.sessionId)) {
      throw new LearningDataError(`Artifact ${artifact.id} has an invalid session reference`, 'INVALID_REF');
    }
    if (artifact.taskId && tasks.get(artifact.taskId) !== artifact.courseId) {
      throw new LearningDataError(`Artifact ${artifact.id} has an invalid task reference`, 'INVALID_REF');
    }
    for (const citation of artifact.citations) {
      const doc = data.documents.find((d) => d.id === citation.documentId);
      if (!doc || doc.courseId !== artifact.courseId) {
        throw new LearningDataError(
          `Artifact ${artifact.id} citation references invalid document ${citation.documentId}`,
          'INVALID_REF',
        );
      }
      if (!doc.chunks.some((c) => c.index === citation.chunkIndex)) {
        throw new LearningDataError(
          `Artifact ${artifact.id} citation references invalid chunk ${citation.chunkIndex}`,
          'INVALID_REF',
        );
      }
    }
  }
  for (const feedback of data.feedbackSignals) {
    requireCourse('Feedback signal', feedback.id, feedback.courseId);
    if (data.sessions.every((s) => s.id !== feedback.sessionId)) {
      throw new LearningDataError(`Feedback signal ${feedback.id} has an invalid session reference`, 'INVALID_REF');
    }
  }
  const profileCourseIds = new Set<string>();
  for (const profile of data.learnerProfiles) {
    if (profileCourseIds.has(profile.courseId)) {
      throw new LearningDataError(`Duplicate learner profile for course ${profile.courseId}`, 'INVALID_REF');
    }
    profileCourseIds.add(profile.courseId);
    requireCourse('Learner profile', profile.courseId, profile.courseId);
  }
}

export class LearningRepository {
  readonly dataPath: string;

  constructor(options: RepositoryOptions = {}) {
    this.dataPath = options.dataPath ?? defaultDataPath();
  }

  get dataDir(): string {
    return path.dirname(this.dataPath);
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  /**
   * Load learning data. Missing file → empty store.
   * Corrupt / invalid JSON → backup + throw (never silent overwrite).
   */
  async load(): Promise<LearningData> {
    return enqueue(() => this._loadUnlocked());
  }

  private async _loadUnlocked(): Promise<LearningData> {
    await this.ensureDir();

    let raw: string;
    try {
      raw = await fs.readFile(this.dataPath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return emptyLearningData();
      }
      throw new LearningDataError(
        `Failed to read learning data: ${(err as Error).message}`,
        'READ_FAILED',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      await this._backupCorrupt(raw, 'invalid-json');
      throw new LearningDataError(
        `Learning data JSON is corrupted and was backed up. Fix or remove the backup before writing again. Parse error: ${(err as Error).message}`,
        'CORRUPT_JSON',
      );
    }

    if (isV1LearningData(parsed)) {
      await this._backupVersion1(raw);
      const migrated = migrateV1ToV2(parsed);
      const cleaned = sanitizeLearningEntities(migrated).data;
      await this._saveUnlocked(cleaned);
      return cleaned;
    }

    const result = LearningDataSchema.safeParse(parsed);
    if (!result.success) {
      await this._backupCorrupt(raw, 'schema-invalid');
      throw new LearningDataError(
        'Learning data failed schema validation and was backed up. The store was not overwritten.',
        'SCHEMA_INVALID',
        result.error.issues,
      );
    }

    try {
      validateReferences(result.data);
    } catch (error) {
      await this._backupCorrupt(raw, 'invalid-references');
      throw new LearningDataError(
        error instanceof Error ? error.message : 'Learning data contains invalid references',
        'SCHEMA_INVALID',
      );
    }

    // Batch-06: strip abnormal migration tags and content-duplicate entities.
    if (learningEntitiesNeedSanitize(result.data)) {
      const cleaned = sanitizeLearningEntities(result.data).data;
      try {
        validateReferences(cleaned);
      } catch {
        return result.data;
      }
      await this._saveUnlocked(cleaned);
      return cleaned;
    }
    return result.data;
  }

  private async _backupCorrupt(raw: string, reason: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.dataPath}.corrupt.${reason}.${stamp}`;
    try {
      await this.ensureDir();
      await fs.writeFile(backupPath, raw, 'utf-8');
    } catch {
      // Backup failure must not hide the primary corruption error.
    }
    return backupPath;
  }

  private async _backupVersion1(raw: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.dataPath}.v1-backup.${stamp}`;
    try {
      await this.ensureDir();
      await fs.writeFile(backupPath, raw, 'utf-8');
    } catch (err) {
      throw new LearningDataError(
        `Failed to back up v1 learning data before migration: ${(err as Error).message}`,
        'BACKUP_FAILED',
      );
    }
    return backupPath;
  }

  /**
   * Atomic write: temp file → fsync → rename. Serialized in-process.
   */
  async save(data: LearningData): Promise<void> {
    return enqueue(async () => {
      // A public save must not silently replace a corrupt existing store.
      // Missing files are fine; corrupt files are backed up and rejected.
      await this._loadUnlocked();
      await this._saveUnlocked(data);
    });
  }

  private async _saveUnlocked(data: LearningData): Promise<void> {
    const validated = LearningDataSchema.parse(data);
    validateReferences(validated);
    await this.ensureDir();

    const dir = this.dataDir;
    const tmpName = `.learning-data.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const tmpPath = path.join(dir, tmpName);
    const payload = `${JSON.stringify(validated, null, 2)}\n`;

    try {
      const handle = await fs.open(tmpPath, 'w');
      try {
        await handle.writeFile(payload, 'utf-8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      await fs.rename(tmpPath, this.dataPath);

      // Best-effort directory fsync (not available on all platforms).
      try {
        const dirHandle = await fs.open(dir, fsConstants.O_RDONLY);
        try {
          await dirHandle.sync();
        } finally {
          await dirHandle.close();
        }
      } catch {
        // Windows / some FS may not support directory fsync.
      }
    } catch (err) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // ignore cleanup errors
      }
      throw new LearningDataError(
        `Failed to write learning data: ${(err as Error).message}`,
        'WRITE_FAILED',
      );
    }
  }

  /**
   * Read-modify-write under the serial lock.
   */
  async update(mutator: (data: LearningData) => LearningData | Promise<LearningData>): Promise<LearningData> {
    return enqueue(async () => {
      const current = await this._loadUnlocked();
      const next = await mutator(current);
      const validated = LearningDataSchema.parse(next);
      await this._saveUnlocked(validated);
      return validated;
    });
  }

  // ─── Course ─────────────────────────────────────────────────────────────

  async createCourse(input: { title: string; description?: string; id?: string }): Promise<Course> {
    const ts = nowIso();
    const course = CourseSchema.parse({
      id: input.id ?? newId(),
      title: input.title,
      description: input.description,
      createdAt: ts,
      updatedAt: ts,
    });

    await this.update((data) => {
      if (data.courses.some((c) => c.id === course.id)) {
        throw new LearningDataError(`Course already exists: ${course.id}`, 'DUPLICATE_ID');
      }
      return { ...data, courses: [...data.courses, course] };
    });

    return course;
  }

  /**
   * Cascade-delete a course and all entities referencing it.
   * Prefer applyEntityAction({ op:'delete', confirmCascade:true }) for API parity.
   */
  async deleteCourse(courseId: string): Promise<{ deleted: true; courseId: string }> {
    await this.update((data) => {
      if (!data.courses.some((c) => c.id === courseId)) {
        throw new LearningDataError(`Course not found: ${courseId}`, 'NOT_FOUND');
      }
      return {
        ...data,
        courses: data.courses.filter((c) => c.id !== courseId),
        documents: data.documents.filter((d) => d.courseId !== courseId),
        goals: data.goals.filter((g) => g.courseId !== courseId),
        units: data.units.filter((u) => u.courseId !== courseId),
        tasks: data.tasks.filter((t) => t.courseId !== courseId),
        timetable: data.timetable.filter((s) => s.courseId !== courseId),
        sessions: data.sessions.filter((s) => s.courseId !== courseId),
        diagnosticGaps: data.diagnosticGaps.filter((g) => g.courseId !== courseId),
        artifacts: data.artifacts.filter((a) => a.courseId !== courseId),
        feedbackSignals: data.feedbackSignals.filter((f) => f.courseId !== courseId),
        learnerProfiles: data.learnerProfiles.filter((p) => p.courseId !== courseId),
        importSuggestions: (data.importSuggestions ?? []).filter((s) => s.courseId !== courseId),
      };
    });
    return { deleted: true, courseId };
  }

  async renameCourse(courseId: string, title: string): Promise<Course> {
    const nextTitle = title.trim();
    if (!nextTitle) {
      throw new LearningDataError('Course title is required', 'INVALID_INPUT');
    }
    const ts = nowIso();
    const data = await this.update((store) => {
      const existing = store.courses.find((c) => c.id === courseId);
      if (!existing) {
        throw new LearningDataError(`Course not found: ${courseId}`, 'NOT_FOUND');
      }
      const course = CourseSchema.parse({
        ...existing,
        title: nextTitle,
        updatedAt: ts,
      });
      return {
        ...store,
        courses: store.courses.map((c) => (c.id === courseId ? course : c)),
      };
    });
    return data.courses.find((c) => c.id === courseId)!;
  }

  async archiveCourse(
    courseId: string,
    archived = true,
  ): Promise<Course> {
    const ts = nowIso();
    const data = await this.update((store) => {
      const existing = store.courses.find((c) => c.id === courseId);
      if (!existing) {
        throw new LearningDataError(`Course not found: ${courseId}`, 'NOT_FOUND');
      }
      const course = CourseSchema.parse({
        id: existing.id,
        title: existing.title,
        description: existing.description,
        createdAt: existing.createdAt,
        updatedAt: ts,
        ...(archived ? { archivedAt: existing.archivedAt ?? ts } : {}),
      });
      return {
        ...store,
        courses: store.courses.map((c) => (c.id === courseId ? course : c)),
      };
    });
    return data.courses.find((c) => c.id === courseId)!;
  }

  async renameDocument(documentId: string, title: string): Promise<SourceDocument> {
    const nextTitle = title.trim();
    if (!nextTitle) {
      throw new LearningDataError('Document title is required', 'INVALID_INPUT');
    }
    const ts = nowIso();
    const data = await this.update((store) => {
      const existing = store.documents.find((d) => d.id === documentId);
      if (!existing) {
        throw new LearningDataError(`Document not found: ${documentId}`, 'NOT_FOUND');
      }
      const doc = SourceDocumentSchema.parse({
        ...existing,
        title: nextTitle,
        updatedAt: ts,
      });
      return {
        ...store,
        documents: store.documents.map((d) => (d.id === documentId ? doc : d)),
      };
    });
    return data.documents.find((d) => d.id === documentId)!;
  }

  async deleteDocument(
    documentId: string,
  ): Promise<{ deleted: true; documentId: string }> {
    await this.update((store) => {
      if (!store.documents.some((d) => d.id === documentId)) {
        throw new LearningDataError(`Document not found: ${documentId}`, 'NOT_FOUND');
      }
      return {
        ...store,
        documents: store.documents.filter((d) => d.id !== documentId),
        importSuggestions: (store.importSuggestions ?? []).filter(
          (s) => s.documentId !== documentId,
        ),
        // Leave diagnostic gaps that may still reference other docs; filter empty later if needed.
      };
    });
    return { deleted: true, documentId };
  }

  /**
   * Unified entity action entry used by API + store (shared Zod schema).
   */
  async applyEntityAction(
    request: EntityActionRequest | unknown,
  ): Promise<
    | Course
    | SourceDocument
    | { deleted: true; courseId: string }
    | { deleted: true; documentId: string }
  > {
    const action = EntityActionRequestSchema.parse(request);
    switch (action.entity) {
      case 'course':
      case 'folder': {
        if (action.op === 'rename') {
          return this.renameCourse(action.id, action.title!);
        }
        if (action.op === 'archive') {
          return this.archiveCourse(action.id, true);
        }
        if (action.op === 'unarchive') {
          return this.archiveCourse(action.id, false);
        }
        if (action.op === 'delete') {
          // confirmCascade already enforced by schema
          return this.deleteCourse(action.id);
        }
        throw new LearningDataError(`Unsupported course op: ${action.op}`, 'INVALID_INPUT');
      }
      case 'document': {
        if (action.op === 'rename') {
          return this.renameDocument(action.id, action.title!);
        }
        if (action.op === 'delete') {
          return this.deleteDocument(action.id);
        }
        throw new LearningDataError(
          `Unsupported document op: ${action.op}`,
          'INVALID_INPUT',
        );
      }
      case 'conversation':
        throw new LearningDataError(
          'Conversation actions are handled by chat-store, not learning repository',
          'INVALID_INPUT',
        );
      default:
        throw new LearningDataError('Unknown entity', 'INVALID_INPUT');
    }
  }

  /** Convenience: map discrete API action name + payload through shared schema. */
  async applyLearningApiEntityAction(
    action: LearningEntityApiAction,
    payload: unknown,
  ): Promise<
    | Course
    | SourceDocument
    | { deleted: true; courseId: string }
    | { deleted: true; documentId: string }
  > {
    try {
      const request = parseLearningEntityAction(action, payload);
      return this.applyEntityAction(request);
    } catch (err) {
      if (err instanceof LearningDataError) throw err;
      const message = err instanceof Error ? err.message : 'Invalid entity action';
      throw new LearningDataError(message, 'INVALID_INPUT');
    }
  }

  // ─── Goal / Unit / Task ─────────────────────────────────────────────────

  async upsertGoal(
    input: Partial<LearningGoal> & { courseId: string; title: string; id?: string },
  ): Promise<LearningGoal> {
    const ts = nowIso();
    const id = input.id ?? newId();
    const data = await this.update((store) => {
      this.assertCourse(store, input.courseId);
      const existing = store.goals.find((g) => g.id === id);
      if (existing && existing.courseId !== input.courseId) {
        throw new LearningDataError('goal.courseId cannot be changed', 'INVALID_REF');
      }
      const goal = LearningGoalSchema.parse({
        id,
        courseId: input.courseId,
        title: input.title,
        description: input.description ?? existing?.description,
        targetDate: input.targetDate ?? existing?.targetDate,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      });
      const goals = existing
        ? store.goals.map((g) => (g.id === goal.id ? goal : g))
        : [...store.goals, goal];
      return { ...store, goals };
    });
    return data.goals.find((g) => g.id === id)!;
  }

  async upsertUnit(
    input: Partial<LearningUnit> & { courseId: string; title: string; id?: string },
  ): Promise<LearningUnit> {
    const ts = nowIso();
    const id = input.id ?? newId();
    const data = await this.update((store) => {
      this.assertCourse(store, input.courseId);
      if (input.goalId) this.assertGoal(store, input.goalId, input.courseId);
      const existing = store.units.find((u) => u.id === id);
      if (existing && existing.courseId !== input.courseId) {
        throw new LearningDataError('unit.courseId cannot be changed', 'INVALID_REF');
      }
      const unit = LearningUnitSchema.parse({
        id,
        courseId: input.courseId,
        goalId: input.goalId ?? existing?.goalId,
        title: input.title,
        description: input.description ?? existing?.description,
        knowledgePoints:
          input.knowledgePoints !== undefined
            ? input.knowledgePoints
            : existing?.knowledgePoints,
        order: input.order ?? existing?.order,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      });
      const units = existing
        ? store.units.map((u) => (u.id === unit.id ? unit : u))
        : [...store.units, unit];
      return { ...store, units };
    });
    return data.units.find((u) => u.id === id)!;
  }

  async upsertTask(
    input: Partial<StudyTask> & {
      courseId: string;
      title: string;
      estimatedMinutes: number;
      id?: string;
    },
  ): Promise<StudyTask> {
    const ts = nowIso();
    const id = input.id ?? newId();
    const data = await this.update((store) => {
      this.assertCourse(store, input.courseId);
      if (input.goalId) this.assertGoal(store, input.goalId, input.courseId);
      if (input.unitId) this.assertUnit(store, input.unitId, input.courseId);
      const existing = store.tasks.find((t) => t.id === id);
      if (existing && existing.courseId !== input.courseId) {
        throw new LearningDataError('task.courseId cannot be changed', 'INVALID_REF');
      }
      const task = StudyTaskSchema.parse({
        id,
        courseId: input.courseId,
        goalId: input.goalId ?? existing?.goalId,
        unitId: input.unitId ?? existing?.unitId,
        title: input.title,
        description: input.description ?? existing?.description,
        estimatedMinutes: input.estimatedMinutes,
        deadline: input.deadline ?? existing?.deadline,
        status: input.status ?? existing?.status ?? 'pending',
        locked: input.locked ?? existing?.locked ?? false,
        scheduledStart: input.scheduledStart ?? existing?.scheduledStart,
        scheduledEnd: input.scheduledEnd ?? existing?.scheduledEnd,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      });
      const tasks = existing
        ? store.tasks.map((t) => (t.id === task.id ? task : t))
        : [...store.tasks, task];
      return { ...store, tasks };
    });
    return data.tasks.find((t) => t.id === id)!;
  }

  async completeTask(taskId: string): Promise<StudyTask> {
    const data = await this.update((store) => {
      const idx = store.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) {
        throw new LearningDataError(`Task not found: ${taskId}`, 'NOT_FOUND');
      }
      const task = StudyTaskSchema.parse({
        ...store.tasks[idx],
        status: 'done',
        updatedAt: nowIso(),
      });
      const tasks = [...store.tasks];
      tasks[idx] = task;
      return { ...store, tasks };
    });
    return data.tasks.find((t) => t.id === taskId)!;
  }

  async proposeTask(
    input: Partial<StudyTask> & {
      courseId: string;
      title: string;
      estimatedMinutes: number;
      id?: string;
    },
  ): Promise<StudyTask> {
    return this.upsertTask({
      ...input,
      status: 'pending_suggestion',
    });
  }

  async confirmTask(taskId: string): Promise<StudyTask> {
    const data = await this.update((store) => {
      const idx = store.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) {
        throw new LearningDataError(`Task not found: ${taskId}`, 'NOT_FOUND');
      }
      const existing = store.tasks[idx]!;
      if (existing.status !== 'pending_suggestion') {
        throw new LearningDataError(
          `Task ${taskId} is not a pending suggestion`,
          'INVALID_STATE',
        );
      }
      const task = StudyTaskSchema.parse({
        ...existing,
        status: 'confirmed',
        updatedAt: nowIso(),
      });
      const tasks = [...store.tasks];
      tasks[idx] = task;
      return { ...store, tasks };
    });
    return data.tasks.find((t) => t.id === taskId)!;
  }

  async rejectSuggestion(taskId: string): Promise<{ deleted: true; taskId: string }> {
    await this.update((store) => {
      const task = store.tasks.find((t) => t.id === taskId);
      if (!task) {
        throw new LearningDataError(`Task not found: ${taskId}`, 'NOT_FOUND');
      }
      if (task.status !== 'pending_suggestion') {
        throw new LearningDataError(
          `Task ${taskId} is not a pending suggestion`,
          'INVALID_STATE',
        );
      }
      return { ...store, tasks: store.tasks.filter((t) => t.id !== taskId) };
    });
    return { deleted: true, taskId };
  }

  async addDocument(doc: SourceDocument): Promise<SourceDocument> {
    const data = await this.update((store) => {
      this.assertCourse(store, doc.courseId);
      if (store.documents.some((d) => d.id === doc.id)) {
        throw new LearningDataError(`Document already exists: ${doc.id}`, 'DUPLICATE_ID');
      }
      const parsed = SourceDocumentSchema.parse(doc);
      return { ...store, documents: [...store.documents, parsed] };
    });
    return data.documents.find((d) => d.id === doc.id)!;
  }

  /**
   * Import document + B06 assist: enrich metadata and persist pending suggestions.
   * Never auto-confirms path/task creation (propose ≠ commit).
   */
  async importDocumentWithAssist(
    doc: SourceDocument,
    options?: { currentGoalId?: string; currentUnitId?: string },
  ): Promise<{
    document: SourceDocument;
    analysis: ReturnType<typeof analyzeImportedDocument>['analysis'];
    suggestions: ImportSuggestion[];
  }> {
    // Analyze against current store (before insert) so dedupe sees siblings.
    const before = await this.load();
    const assist = analyzeImportedDocument(doc, before, options);
    const enriched = SourceDocumentSchema.parse({
      ...doc,
      ...assist.documentPatch,
      title: assist.analysis.title || doc.title,
    });

    const data = await this.update((store) => {
      this.assertCourse(store, enriched.courseId);
      if (store.documents.some((d) => d.id === enriched.id)) {
        throw new LearningDataError(`Document already exists: ${enriched.id}`, 'DUPLICATE_ID');
      }
      for (const s of assist.suggestions) {
        ImportSuggestionSchema.parse(s);
        if ((store.importSuggestions ?? []).some((x) => x.id === s.id)) {
          throw new LearningDataError(`Import suggestion already exists: ${s.id}`, 'DUPLICATE_ID');
        }
      }
      return {
        ...store,
        documents: [...store.documents, enriched],
        importSuggestions: [...(store.importSuggestions ?? []), ...assist.suggestions],
      };
    });

    return {
      document: data.documents.find((d) => d.id === enriched.id)!,
      analysis: assist.analysis,
      suggestions: assist.suggestions,
    };
  }

  async confirmImportSuggestion(suggestionId: string): Promise<{
    suggestion: ImportSuggestion;
    sideEffects: {
      unitUpdated?: LearningUnit;
      pathCreated?: { goalId: string; unitIds: string[]; taskIds: string[] };
      documentLinked?: SourceDocument;
    };
  }> {
    const sideEffects: {
      unitUpdated?: LearningUnit;
      pathCreated?: { goalId: string; unitIds: string[]; taskIds: string[] };
      documentLinked?: SourceDocument;
    } = {};

    const data = await this.update((store) => {
      const list = [...(store.importSuggestions ?? [])];
      const idx = list.findIndex((s) => s.id === suggestionId);
      if (idx < 0) {
        throw new LearningDataError(`Import suggestion not found: ${suggestionId}`, 'NOT_FOUND');
      }
      const existing = list[idx]!;
      if (existing.status !== 'pending') {
        throw new LearningDataError(
          `Import suggestion ${suggestionId} is not pending`,
          'INVALID_STATE',
        );
      }

      const ts = nowIso();
      const confirmed = ImportSuggestionSchema.parse({
        ...existing,
        status: 'confirmed',
        updatedAt: ts,
      });
      list[idx] = confirmed;

      // Reject sibling pending suggestions for the same document (user chose one path).
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
        if (
          s.id !== suggestionId &&
          s.documentId === existing.documentId &&
          s.status === 'pending'
        ) {
          list[i] = ImportSuggestionSchema.parse({
            ...s,
            status: 'rejected',
            updatedAt: ts,
          });
        }
      }

      let documents = store.documents;
      let units = store.units;
      let goals = store.goals;
      let tasks = store.tasks;

      switch (existing.action) {
        case 'ignore':
          // Document stays; no structural write beyond suggestion status.
          break;
        case 'keep_reference': {
          // Ensure document remains linked as reference only (no tasks).
          const docIdx = documents.findIndex((d) => d.id === existing.documentId);
          if (docIdx >= 0) {
            const doc = SourceDocumentSchema.parse({
              ...documents[docIdx]!,
              linkedGoalId: existing.linkedGoalId ?? documents[docIdx]!.linkedGoalId,
              linkedUnitId: existing.linkedUnitId ?? documents[docIdx]!.linkedUnitId,
              updatedAt: ts,
            });
            documents = [...documents];
            documents[docIdx] = doc;
            sideEffects.documentLinked = doc;
          }
          break;
        }
        case 'join_course': {
          const docIdx = documents.findIndex((d) => d.id === existing.documentId);
          if (docIdx >= 0) {
            const doc = SourceDocumentSchema.parse({
              ...documents[docIdx]!,
              linkedGoalId: existing.linkedGoalId ?? documents[docIdx]!.linkedGoalId,
              linkedUnitId: existing.linkedUnitId ?? documents[docIdx]!.linkedUnitId,
              updatedAt: ts,
            });
            documents = [...documents];
            documents[docIdx] = doc;
            sideEffects.documentLinked = doc;
          }
          break;
        }
        case 'update_unit': {
          const unitId = existing.linkedUnitId;
          if (!unitId) {
            throw new LearningDataError(
              'update_unit suggestion missing linkedUnitId',
              'INVALID_STATE',
            );
          }
          const unitIdx = units.findIndex((u) => u.id === unitId);
          if (unitIdx < 0) {
            throw new LearningDataError(`Unit not found: ${unitId}`, 'NOT_FOUND');
          }
          const doc = documents.find((d) => d.id === existing.documentId);
          const unit = LearningUnitSchema.parse({
            ...units[unitIdx]!,
            description:
              existing.summary ||
              doc?.summary ||
              units[unitIdx]!.description ||
              `更新自资料：${doc?.title ?? existing.documentId}`,
            updatedAt: ts,
          });
          units = [...units];
          units[unitIdx] = unit;
          sideEffects.unitUpdated = unit;
          break;
        }
        case 'generate_path': {
          // Explicit confirm creates one goal + one unit + one pending_suggestion task (not scheduled).
          const doc = documents.find((d) => d.id === existing.documentId);
          const goalId = newId();
          const unitId = newId();
          const taskId = newId();
          const goalTitle = doc?.title
            ? `基于「${doc.title}」的学习路径`
            : '基于导入资料的学习路径';
          const goal = LearningGoalSchema.parse({
            id: goalId,
            courseId: existing.courseId,
            title: goalTitle,
            description: existing.summary || doc?.summary || undefined,
            createdAt: ts,
            updatedAt: ts,
          });
          const unit = LearningUnitSchema.parse({
            id: unitId,
            courseId: existing.courseId,
            goalId,
            title: doc?.title ? `研读：${doc.title}` : '研读导入资料',
            description: existing.summary || doc?.summary || undefined,
            knowledgePoints: (existing.tags ?? doc?.tags ?? []).slice(0, 5),
            order: units.filter((u) => u.courseId === existing.courseId).length,
            createdAt: ts,
            updatedAt: ts,
          });
          // Task stays pending_suggestion so user must confirm again to commit schedule work.
          const task = StudyTaskSchema.parse({
            id: taskId,
            courseId: existing.courseId,
            goalId,
            unitId,
            title: unit.title,
            description: unit.description,
            estimatedMinutes: 45,
            status: 'pending_suggestion',
            locked: false,
            createdAt: ts,
            updatedAt: ts,
          });
          goals = [...goals, goal];
          units = [...units, unit];
          tasks = [...tasks, task];
          sideEffects.pathCreated = { goalId, unitIds: [unitId], taskIds: [taskId] };
          break;
        }
        default: {
          const _never: never = existing.action;
          throw new LearningDataError(
            `Unknown import suggestion action: ${String(_never)}`,
            'INVALID_STATE',
          );
        }
      }

      return {
        ...store,
        importSuggestions: list,
        documents,
        units,
        goals,
        tasks,
      };
    });

    const suggestion = (data.importSuggestions ?? []).find((s) => s.id === suggestionId)!;
    return { suggestion, sideEffects };
  }

  async rejectImportSuggestion(suggestionId: string): Promise<ImportSuggestion> {
    const data = await this.update((store) => {
      const list = [...(store.importSuggestions ?? [])];
      const idx = list.findIndex((s) => s.id === suggestionId);
      if (idx < 0) {
        throw new LearningDataError(`Import suggestion not found: ${suggestionId}`, 'NOT_FOUND');
      }
      const existing = list[idx]!;
      if (existing.status !== 'pending') {
        throw new LearningDataError(
          `Import suggestion ${suggestionId} is not pending`,
          'INVALID_STATE',
        );
      }
      list[idx] = ImportSuggestionSchema.parse({
        ...existing,
        status: 'rejected',
        updatedAt: nowIso(),
      });
      return { ...store, importSuggestions: list };
    });
    return (data.importSuggestions ?? []).find((s) => s.id === suggestionId)!;
  }

  /** Propose plan without writing (calendar propose ≠ commit). */
  async proposePlanAsync(
    courseId: string,
    goalId?: string,
    now?: Date,
    constraints?: PlanConstraintSnapshot,
  ): Promise<PlanProposal> {
    const data = await this.load();
    return proposePlanSchedule(data, { courseId, goalId, now, ...constraints });
  }

  /** Apply a proposal only when its scheduling base is still current and valid. */
  async confirmPlan(proposal: PlanProposal): Promise<{ plan: PlanResult; changed: boolean }> {
    let changed = false;
    await this.update((store) => {
      const currentRevision = computePlanningRevision(store);
      if (proposal.baseRevision !== currentRevision) {
        const alreadyApplied = proposal.plan.tasks.every((planned) => {
          const current = store.tasks.find((task) => task.id === planned.id);
          return Boolean(
            current &&
            current.status === planned.status &&
            current.scheduledStart === planned.scheduledStart &&
            current.scheduledEnd === planned.scheduledEnd,
          );
        });
        if (alreadyApplied) return store;
        throw new LearningDataError(
          'Calendar changed after this draft was created. Generate a fresh draft before confirming.',
          'PLAN_STALE',
          { expected: proposal.baseRevision, actual: currentRevision },
        );
      }
      const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
      if (proposal.timeZone !== currentTimeZone) {
        throw new LearningDataError(
          'Local timezone changed after this draft was created. Generate a fresh draft before confirming.',
          'PLAN_STALE',
          { expected: proposal.timeZone, actual: currentTimeZone },
        );
      }
      const missing = proposal.plan.tasks.find(
        (task) => !store.tasks.some((current) => current.id === task.id),
      );
      if (missing) {
        throw new LearningDataError(
          `Plan task no longer exists: ${missing.id}`,
          'PLAN_STALE',
        );
      }
      const issues = validatePlanProposal(proposal, store);
      if (issues.length > 0) {
        throw new LearningDataError(
          'Calendar draft has conflicts that must be fixed before confirming.',
          'PLAN_INVALID',
          issues,
        );
      }
      const byId = new Map(store.tasks.map((task) => [task.id, task]));
      for (const task of proposal.plan.tasks) {
        byId.set(task.id, StudyTaskSchema.parse(task));
      }
      changed = true;
      return { ...store, tasks: Array.from(byId.values()) };
    });
    return { plan: proposal.plan, changed };
  }

  async replaceTimetableForCourse(courseId: string, slots: TimetableSlot[]): Promise<TimetableSlot[]> {
    const data = await this.update((store) => {
      this.assertCourse(store, courseId);
      for (const slot of slots) {
        if (slot.courseId !== courseId) {
          throw new LearningDataError('Timetable slot courseId mismatch', 'INVALID_REF');
        }
        TimetableSlotSchema.parse(slot);
      }
      return {
        ...store,
        timetable: [
          ...store.timetable.filter((s) => s.courseId !== courseId),
          ...slots,
        ],
      };
    });
    return data.timetable.filter((s) => s.courseId === courseId);
  }

  async createSession(
    input: Partial<LearningSession> & {
      courseId: string;
      startedAt?: string;
      id?: string;
      sections?: SessionSection[];
    },
  ): Promise<LearningSession> {
    const ts = nowIso();
    const data = await this.update((store) => {
      this.assertCourse(store, input.courseId);
      if (input.taskId) this.assertTask(store, input.taskId, input.courseId);
      const sections = input.sections ?? [];
      const currentSectionId =
        input.currentSectionId ??
        (sections.length > 0 ? sections[0]!.id : null);
      for (const section of sections) {
        SessionSectionSchema.parse(section);
      }
      const session = LearningSessionSchema.parse({
        id: input.id ?? newId(),
        courseId: input.courseId,
        taskId: input.taskId,
        startedAt: input.startedAt ?? ts,
        endedAt: input.endedAt,
        notes: input.notes,
        sections,
        currentSectionId,
        createdAt: ts,
        updatedAt: ts,
      });
      return { ...store, sessions: [...store.sessions, session] };
    });
    return data.sessions[data.sessions.length - 1]!;
  }

  async endSession(sessionId: string): Promise<LearningSession> {
    const data = await this.update((store) => {
      const index = store.sessions.findIndex((session) => session.id === sessionId);
      if (index < 0) {
        throw new LearningDataError(`Session not found: ${sessionId}`, 'NOT_FOUND');
      }
      const ts = nowIso();
      const session = LearningSessionSchema.parse({
        ...store.sessions[index],
        endedAt: ts,
        updatedAt: ts,
      });
      const sessions = [...store.sessions];
      sessions[index] = session;
      return { ...store, sessions };
    });
    return data.sessions.find((session) => session.id === sessionId)!;
  }

  async getSession(sessionId: string): Promise<LearningSession> {
    const data = await this.load();
    const session = data.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new LearningDataError(`Session not found: ${sessionId}`, 'NOT_FOUND');
    }
    return session;
  }

  async updateSession(
    sessionId: string,
    mutator: (session: LearningSession) => LearningSession,
  ): Promise<LearningSession> {
    const data = await this.update((store) => {
      const index = store.sessions.findIndex((s) => s.id === sessionId);
      if (index < 0) {
        throw new LearningDataError(`Session not found: ${sessionId}`, 'NOT_FOUND');
      }
      const next = mutator(store.sessions[index]!);
      const sessions = [...store.sessions];
      sessions[index] = LearningSessionSchema.parse({ ...next, updatedAt: nowIso() });
      return { ...store, sessions };
    });
    return data.sessions.find((s) => s.id === sessionId)!;
  }

  async replaceTasks(tasks: StudyTask[]): Promise<void> {
    await this.update((store) => {
      const byId = new Map(store.tasks.map((t) => [t.id, t]));
      for (const task of tasks) {
        StudyTaskSchema.parse(task);
        byId.set(task.id, task);
      }
      return { ...store, tasks: Array.from(byId.values()) };
    });
  }

  // ─── Proactive triggers ─────────────────────────────────────────────────

  /**
   * Run a proactive trigger, persist any suggestions (as pending_suggestion)
   * and/or reschedule result, and return the outcome. Never auto-confirms.
   */
  async runProactiveTrigger(trigger: ProactiveTrigger): Promise<ProactiveResult> {
    const data = await this.load();
    const result = runProactiveTrigger(data, trigger);

    if (result.suggestions.length > 0) {
      await this.update((store) => ({
        ...store,
        tasks: [...store.tasks, ...result.suggestions.map((s) => s.task)],
      }));
    }

    if (result.reschedule) {
      await this.replaceTasks(result.reschedule.plan.tasks);
    }

    return result;
  }

  /**
   * Reschedule non-locked confirmed/scheduled tasks away from a skipped local day.
   */
  async rescheduleAfterSkipDay(courseId: string, skippedDate: string): Promise<PlanResult> {
    const data = await this.load();
    const result = rescheduleAfterSkipDay(data, { courseId, skippedDate });
    await this.replaceTasks(result.tasks);
    return result;
  }

  // ─── Diagnostic gaps ────────────────────────────────────────────────────

  async addDiagnosticGaps(
    gaps: DiagnosticGap[],
    tasks: StudyTask[],
  ): Promise<{ gaps: DiagnosticGap[]; tasks: StudyTask[] }> {
    const data = await this.update((store) => {
      for (const gap of gaps) {
        this.assertCourse(store, gap.courseId);
        for (const docId of gap.documentIds) {
          const doc = store.documents.find((d) => d.id === docId);
          if (!doc || doc.courseId !== gap.courseId) {
            throw new LearningDataError(
              `Diagnostic gap references invalid document ${docId}`,
              'INVALID_REF',
            );
          }
        }
        if (store.diagnosticGaps.some((g) => g.id === gap.id)) {
          throw new LearningDataError(`Diagnostic gap already exists: ${gap.id}`, 'DUPLICATE_ID');
        }
        DiagnosticGapSchema.parse(gap);
      }
      for (const task of tasks) {
        StudyTaskSchema.parse(task);
        if (store.tasks.some((t) => t.id === task.id)) {
          throw new LearningDataError(`Task already exists: ${task.id}`, 'DUPLICATE_ID');
        }
      }
      return {
        ...store,
        diagnosticGaps: [...store.diagnosticGaps, ...gaps],
        tasks: [...store.tasks, ...tasks],
      };
    });
    return {
      gaps: data.diagnosticGaps.slice(-gaps.length),
      tasks: data.tasks.slice(-tasks.length),
    };
  }

  async confirmDiagnosticGap(gapId: string): Promise<{ gap: DiagnosticGap; task: StudyTask }> {
    const data = await this.update((store) => {
      const gapIndex = store.diagnosticGaps.findIndex((g) => g.id === gapId);
      if (gapIndex < 0) {
        throw new LearningDataError(`Diagnostic gap not found: ${gapId}`, 'NOT_FOUND');
      }
      const gap = store.diagnosticGaps[gapIndex]!;
      if (gap.status !== 'pending_suggestion') {
        throw new LearningDataError(
          `Diagnostic gap ${gapId} is not a pending suggestion`,
          'INVALID_STATE',
        );
      }
      const taskIndex = store.tasks.findIndex((t) => t.id === gap.taskId);
      if (taskIndex < 0) {
        throw new LearningDataError(`Linked task not found for gap ${gapId}`, 'NOT_FOUND');
      }
      const task = store.tasks[taskIndex]!;
      if (task.status !== 'pending_suggestion') {
        throw new LearningDataError(`Linked task ${task.id} is not pending`, 'INVALID_STATE');
      }

      const ts = nowIso();
      const confirmedGap = DiagnosticGapSchema.parse({ ...gap, status: 'confirmed', updatedAt: ts });
      const confirmedTask = StudyTaskSchema.parse({ ...task, status: 'confirmed', updatedAt: ts });

      const diagnosticGaps = [...store.diagnosticGaps];
      diagnosticGaps[gapIndex] = confirmedGap;
      const tasks = [...store.tasks];
      tasks[taskIndex] = confirmedTask;

      return { ...store, diagnosticGaps, tasks };
    });
    const gap = data.diagnosticGaps.find((g) => g.id === gapId)!;
    const task = data.tasks.find((t) => t.id === gap.taskId)!;
    return { gap, task };
  }

  async dismissDiagnosticGap(gapId: string): Promise<DiagnosticGap> {
    const data = await this.update((store) => {
      const gapIndex = store.diagnosticGaps.findIndex((g) => g.id === gapId);
      if (gapIndex < 0) {
        throw new LearningDataError(`Diagnostic gap not found: ${gapId}`, 'NOT_FOUND');
      }
      const gap = store.diagnosticGaps[gapIndex]!;
      if (gap.status !== 'pending_suggestion') {
        throw new LearningDataError(
          `Diagnostic gap ${gapId} is not a pending suggestion`,
          'INVALID_STATE',
        );
      }
      const diagnosticGaps = [...store.diagnosticGaps];
      diagnosticGaps[gapIndex] = DiagnosticGapSchema.parse({
        ...gap,
        status: 'dismissed',
        taskId: undefined,
        updatedAt: nowIso(),
      });

      // Also remove the linked pending suggestion task.
      const tasks = gap.taskId
        ? store.tasks.filter((t) => t.id !== gap.taskId)
        : store.tasks;

      return { ...store, diagnosticGaps, tasks };
    });
    return data.diagnosticGaps.find((g) => g.id === gapId)!;
  }

  // ─── Artifacts ──────────────────────────────────────────────────────────

  async addArtifact(artifact: Artifact): Promise<Artifact> {
    const data = await this.update((store) => {
      this.assertCourse(store, artifact.courseId);
      if (store.artifacts.some((a) => a.id === artifact.id)) {
        throw new LearningDataError(`Artifact already exists: ${artifact.id}`, 'DUPLICATE_ID');
      }
      // Citations and cross-references are validated by LearningDataSchema
      // plus validateReferences on save.
      return { ...store, artifacts: [...store.artifacts, artifact] };
    });
    return data.artifacts[data.artifacts.length - 1]!;
  }

  // ─── Feedback & Learner profile ─────────────────────────────────────────

  async recordFeedback(
    feedback: FeedbackSignal,
    profile: LearnerProfile,
  ): Promise<{ feedback: FeedbackSignal; profile: LearnerProfile }> {
    const data = await this.update((store) => {
      this.assertCourse(store, feedback.courseId);
      if (store.feedbackSignals.some((f) => f.id === feedback.id)) {
        throw new LearningDataError(`Feedback signal already exists: ${feedback.id}`, 'DUPLICATE_ID');
      }
      const existingIndex = store.learnerProfiles.findIndex(
        (p) => p.courseId === profile.courseId,
      );
      const learnerProfiles =
        existingIndex >= 0
          ? store.learnerProfiles.map((p, i) => (i === existingIndex ? profile : p))
          : [...store.learnerProfiles, profile];

      return {
        ...store,
        feedbackSignals: [...store.feedbackSignals, feedback],
        learnerProfiles,
      };
    });
    return {
      feedback: data.feedbackSignals[data.feedbackSignals.length - 1]!,
      profile: data.learnerProfiles.find((p) => p.courseId === profile.courseId)!,
    };
  }

  async getLearnerProfile(courseId: string): Promise<LearnerProfile | null> {
    const data = await this.load();
    return data.learnerProfiles.find((p) => p.courseId === courseId) ?? null;
  }

  // ─── Ref helpers ────────────────────────────────────────────────────────

  private assertCourse(data: LearningData, courseId: string): void {
    if (!data.courses.some((c) => c.id === courseId)) {
      throw new LearningDataError(`Course not found: ${courseId}`, 'INVALID_REF');
    }
  }

  private assertGoal(data: LearningData, goalId: string, courseId: string): void {
    const goal = data.goals.find((g) => g.id === goalId);
    if (!goal) {
      throw new LearningDataError(`Goal not found: ${goalId}`, 'INVALID_REF');
    }
    if (goal.courseId !== courseId) {
      throw new LearningDataError(`Goal ${goalId} does not belong to course ${courseId}`, 'INVALID_REF');
    }
  }

  private assertUnit(data: LearningData, unitId: string, courseId: string): void {
    const unit = data.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new LearningDataError(`Unit not found: ${unitId}`, 'INVALID_REF');
    }
    if (unit.courseId !== courseId) {
      throw new LearningDataError(`Unit ${unitId} does not belong to course ${courseId}`, 'INVALID_REF');
    }
  }

  private assertTask(data: LearningData, taskId: string, courseId: string): void {
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new LearningDataError(`Task not found: ${taskId}`, 'INVALID_REF');
    }
    if (task.courseId !== courseId) {
      throw new LearningDataError(`Task ${taskId} does not belong to course ${courseId}`, 'INVALID_REF');
    }
  }
}

/** Default singleton bound to ~/.minus/data/learning-data.json */
export const learningRepository = new LearningRepository();
