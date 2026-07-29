import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LearningDataError, LearningRepository } from '../repository';
import { emptyLearningData, nowIso, type LearningData } from '@/types/learning';
import { type LearningDataV1 } from '../migrate';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minus-learning-'));
}

describe('LearningRepository', () => {
  let dir: string;
  let dataPath: string;
  let repo: LearningRepository;

  beforeEach(async () => {
    dir = await tempDir();
    dataPath = path.join(dir, 'learning-data.json');
    repo = new LearningRepository({ dataPath });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns empty data when file is missing', async () => {
    const data = await repo.load();
    expect(data).toEqual(emptyLearningData());
  });

  it('atomically persists and reloads courses', async () => {
    const course = await repo.createCourse({ title: 'Algorithms' });
    const data = await repo.load();
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0]!.id).toBe(course.id);
    expect(data.courses[0]!.title).toBe('Algorithms');
  });

  it('confirms a current calendar proposal atomically', async () => {
    const course = await repo.createCourse({ title: 'Planning' });
    const task = await repo.upsertTask({
      courseId: course.id,
      title: 'Review',
      estimatedMinutes: 30,
      status: 'confirmed',
    });
    const proposal = await repo.proposePlanAsync(
      course.id,
      undefined,
      new Date('2026-07-15T08:00:00'),
    );

    await repo.confirmPlan(proposal);
    const saved = (await repo.load()).tasks.find((item) => item.id === task.id)!;
    expect(saved.status).toBe('scheduled');
    expect(saved.scheduledStart).toBeTruthy();
  });

  it('rejects a stale calendar proposal after schedule-relevant data changes', async () => {
    const course = await repo.createCourse({ title: 'Planning' });
    const task = await repo.upsertTask({
      courseId: course.id,
      title: 'Review',
      estimatedMinutes: 30,
      status: 'confirmed',
    });
    const proposal = await repo.proposePlanAsync(
      course.id,
      undefined,
      new Date('2026-07-15T08:00:00'),
    );
    await repo.upsertTask({
      ...task,
      title: 'Review updated',
      estimatedMinutes: 45,
      status: 'confirmed',
    });

    await expect(repo.confirmPlan(proposal)).rejects.toMatchObject({
      code: 'PLAN_STALE',
    });
  });

  it('backs up corrupt JSON and returns a clear error without wiping the store', async () => {
    await fs.mkdir(dir, { recursive: true });
    const corrupt = '{ not valid json !!!';
    await fs.writeFile(dataPath, corrupt, 'utf-8');

    await expect(repo.load()).rejects.toMatchObject({
      name: 'LearningDataError',
      code: 'CORRUPT_JSON',
    });

    // Original file still present (not silently emptied)
    const still = await fs.readFile(dataPath, 'utf-8');
    expect(still).toBe(corrupt);

    // Backup created
    const files = await fs.readdir(dir);
    const backups = files.filter((f) => f.includes('.corrupt.'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    const backupRaw = await fs.readFile(path.join(dir, backups[0]!), 'utf-8');
    expect(backupRaw).toBe(corrupt);
  });

  it('does not let direct save overwrite an existing corrupt store', async () => {
    await fs.mkdir(dir, { recursive: true });
    const corrupt = '{ broken';
    await fs.writeFile(dataPath, corrupt, 'utf-8');
    await expect(repo.save(emptyLearningData())).rejects.toMatchObject({
      code: 'CORRUPT_JSON',
    });
    expect(await fs.readFile(dataPath, 'utf-8')).toBe(corrupt);
  });

  it('migrates a v1 file to v2, backs it up, and persists the upgrade', async () => {
    await fs.mkdir(dir, { recursive: true });
    const ts = '2026-07-12T08:00:00.000Z';
    const v1: LearningDataV1 = {
      version: 1,
      courses: [{ id: 'c1', title: 'ML', createdAt: ts, updatedAt: ts }],
      documents: [],
      goals: [],
      units: [],
      tasks: [
        {
          id: 't1',
          courseId: 'c1',
          title: 'T1',
          estimatedMinutes: 30,
          status: 'pending',
          locked: false,
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: 't2',
          courseId: 'c1',
          title: 'T2',
          estimatedMinutes: 30,
          status: 'completed',
          locked: false,
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      timetable: [],
      sessions: [
        {
          id: 's1',
          courseId: 'c1',
          startedAt: ts,
          sections: [],
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    };
    const raw = JSON.stringify(v1);
    await fs.writeFile(dataPath, raw, 'utf-8');

    const data = await repo.load();
    expect(data.version).toBe(2);
    const statuses = new Map(data.tasks.map((t) => [t.id, t.status]));
    expect(statuses.get('t1')).toBe('confirmed');
    expect(statuses.get('t2')).toBe('done');
    expect(data.sessions[0]!.sections).toEqual([]);
    expect(data.sessions[0]!.currentSectionId).toBeNull();

    // Original file is upgraded in place.
    const upgradedRaw = await fs.readFile(dataPath, 'utf-8');
    const upgraded = JSON.parse(upgradedRaw);
    expect(upgraded.version).toBe(2);

    // Backup of the original v1 payload exists.
    const files = await fs.readdir(dir);
    const backups = files.filter((f) => f.includes('.v1-backup.'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    const backupRaw = await fs.readFile(path.join(dir, backups[0]!), 'utf-8');
    expect(backupRaw).toBe(raw);

    // Second load is a normal v2 load and does not create extra backups.
    const backupCountBefore = files.filter((f) => f.includes('.v1-backup.')).length;
    const data2 = await repo.load();
    expect(data2.version).toBe(2);
    const backupCountAfter = (await fs.readdir(dir)).filter((f) =>
      f.includes('.v1-backup.'),
    ).length;
    expect(backupCountAfter).toBe(backupCountBefore);
  });

  it('aborts v1 migration and leaves original untouched when backup fails', async () => {
    await fs.mkdir(dir, { recursive: true });
    const ts = '2026-07-12T08:00:00.000Z';
    const v1: LearningDataV1 = {
      version: 1,
      courses: [{ id: 'c1', title: 'ML', createdAt: ts, updatedAt: ts }],
      documents: [],
      goals: [],
      units: [],
      tasks: [
        {
          id: 't1',
          courseId: 'c1',
          title: 'T1',
          estimatedMinutes: 30,
          status: 'pending',
          locked: false,
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      timetable: [],
      sessions: [],
    };
    const raw = JSON.stringify(v1);
    await fs.writeFile(dataPath, raw, 'utf-8');

    // Force backup failure without touching the original file.
    type BackupFn = (r: string) => Promise<string>;
    const originalBackup = ((repo as unknown as { _backupVersion1: BackupFn })._backupVersion1).bind(repo);
    (repo as unknown as { _backupVersion1: BackupFn })._backupVersion1 = async () => {
      throw new LearningDataError('disk full', 'BACKUP_FAILED');
    };

    try {
      await expect(repo.load()).rejects.toMatchObject({
        name: 'LearningDataError',
        code: 'BACKUP_FAILED',
      });

      // Original v1 file must remain untouched.
      const still = await fs.readFile(dataPath, 'utf-8');
      expect(still).toBe(raw);

      // No v2 upgrade should have been written.
      const upgraded = JSON.parse(still);
      expect(upgraded.version).toBe(1);
    } finally {
      (repo as unknown as { _backupVersion1: BackupFn })._backupVersion1 = originalBackup;
    }
  });

  it('backs up schema-invalid JSON and does not overwrite with empty data', async () => {
    await fs.mkdir(dir, { recursive: true });
    const invalid = JSON.stringify({ version: 99, courses: 'nope' });
    await fs.writeFile(dataPath, invalid, 'utf-8');

    await expect(repo.load()).rejects.toBeInstanceOf(LearningDataError);
    const still = await fs.readFile(dataPath, 'utf-8');
    expect(still).toBe(invalid);
  });

  it('rejects persisted cross-entity references to missing courses', async () => {
    await fs.mkdir(dir, { recursive: true });
    const invalidRefs: LearningData = {
      ...emptyLearningData(),
      goals: [{
        id: 'orphan-goal',
        courseId: 'missing-course',
        title: 'Orphan',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    };
    const raw = JSON.stringify(invalidRefs);
    await fs.writeFile(dataPath, raw, 'utf-8');

    await expect(repo.load()).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(await fs.readFile(dataPath, 'utf-8')).toBe(raw);
  });

  it('serializes concurrent writes without losing updates', async () => {
    const base = await repo.createCourse({ title: 'Base' });

    const writers = Array.from({ length: 12 }, (_, i) =>
      repo.update((data) => ({
        ...data,
        courses: [
          ...data.courses,
          {
            id: `c-${i}`,
            title: `Course ${i}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      })),
    );

    await Promise.all(writers);
    const final = await repo.load();
    // base + 12 concurrent inserts
    expect(final.courses.length).toBe(13);
    expect(final.courses.some((c) => c.id === base.id)).toBe(true);
    for (let i = 0; i < 12; i++) {
      expect(final.courses.some((c) => c.id === `c-${i}`)).toBe(true);
    }
  });

  it('cascades deleteCourse across all related entities', async () => {
    const course = await repo.createCourse({ title: 'Cascade' });
    const other = await repo.createCourse({ title: 'Keep' });
    const goal = await repo.upsertGoal({ courseId: course.id, title: 'G1' });
    const unit = await repo.upsertUnit({ courseId: course.id, title: 'U1', goalId: goal.id });
    const task = await repo.upsertTask({
      courseId: course.id,
      title: 'T1',
      estimatedMinutes: 30,
      goalId: goal.id,
      unitId: unit.id,
    });
    await repo.createSession({ courseId: course.id, taskId: task.id });
    await repo.upsertGoal({ courseId: other.id, title: 'Other goal' });

    await repo.deleteCourse(course.id);
    const data = await repo.load();
    expect(data.courses.map((c) => c.id)).toEqual([other.id]);
    expect(data.goals.every((g) => g.courseId === other.id)).toBe(true);
    expect(data.units).toHaveLength(0);
    expect(data.tasks).toHaveLength(0);
    expect(data.sessions).toHaveLength(0);
  });

  it('rejects cross-entity refs that do not belong to the course', async () => {
    const a = await repo.createCourse({ title: 'A' });
    const b = await repo.createCourse({ title: 'B' });
    const goalB = await repo.upsertGoal({ courseId: b.id, title: 'GB' });

    await expect(
      repo.upsertTask({
        courseId: a.id,
        title: 'Bad',
        estimatedMinutes: 10,
        goalId: goalB.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' });
  });

  it('createSession with sections sets currentSectionId to first section', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const sections = [
      { id: 's1', status: 'open' as const, phase: 'teach' as const, order: 0, title: 'S1' },
      { id: 's2', status: 'locked' as const, phase: 'teach' as const, order: 1, title: 'S2' },
    ];
    const session = await repo.createSession({
      courseId: course.id,
      sections,
    });
    expect(session.sections).toHaveLength(2);
    expect(session.currentSectionId).toBe('s1');
  });

  it('getSession returns a session by id', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const created = await repo.createSession({ courseId: course.id });
    const loaded = await repo.getSession(created.id);
    expect(loaded.id).toBe(created.id);
  });

  it('getSession throws NOT_FOUND for missing session', async () => {
    await expect(repo.getSession('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updateSession mutates and persists a session', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const session = await repo.createSession({ courseId: course.id });
    const updated = await repo.updateSession(session.id, (s) => ({
      ...s,
      notes: 'updated',
      sections: [{ id: 'sec', status: 'open' as const, phase: 'teach' as const, title: 'T' }],
    }));
    expect(updated.notes).toBe('updated');
    expect(updated.sections).toHaveLength(1);
    const loaded = await repo.load();
    expect(loaded.sessions[0]!.notes).toBe('updated');
  });

  it('completeTask marks status done', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const task = await repo.upsertTask({
      courseId: course.id,
      title: 'Do it',
      estimatedMinutes: 15,
    });
    const done = await repo.completeTask(task.id);
    expect(done.status).toBe('done');
  });

  it('round-trips full LearningData schema', async () => {
    const sample: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'course-1',
          title: 'T',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    await repo.save(sample);
    const loaded = await repo.load();
    expect(loaded.courses[0]!.title).toBe('T');
  });

  it('proposeTask creates a pending_suggestion task', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const task = await repo.proposeTask({
      courseId: course.id,
      title: 'Read chapter 1',
      estimatedMinutes: 30,
    });
    expect(task.status).toBe('pending_suggestion');
    expect(task.title).toBe('Read chapter 1');
  });

  it('confirmTask promotes a pending_suggestion to confirmed', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const task = await repo.proposeTask({
      courseId: course.id,
      title: 'Read chapter 1',
      estimatedMinutes: 30,
    });
    const confirmed = await repo.confirmTask(task.id);
    expect(confirmed.status).toBe('confirmed');
  });

  it('rejectSuggestion deletes a pending_suggestion task', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const task = await repo.proposeTask({
      courseId: course.id,
      title: 'Read chapter 1',
      estimatedMinutes: 30,
    });
    await repo.rejectSuggestion(task.id);
    const data = await repo.load();
    expect(data.tasks.some((t) => t.id === task.id)).toBe(false);
  });

  it('confirmTask rejects non-suggestion tasks', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const task = await repo.upsertTask({
      courseId: course.id,
      title: 'Regular',
      estimatedMinutes: 15,
      status: 'confirmed',
    });
    await expect(repo.confirmTask(task.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejectSuggestion rejects non-suggestion tasks', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const task = await repo.upsertTask({
      courseId: course.id,
      title: 'Regular',
      estimatedMinutes: 15,
      status: 'confirmed',
    });
    await expect(repo.rejectSuggestion(task.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('addDiagnosticGaps persists gaps and linked pending tasks', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const ts = nowIso();
    const gap = {
      id: 'gap-1',
      courseId: course.id,
      documentIds: [],
      topic: 'T',
      reason: 'R',
      severity: 'medium' as const,
      status: 'pending_suggestion' as const,
      createdAt: ts,
      updatedAt: ts,
    };
    const task = {
      id: 'task-1',
      courseId: course.id,
      title: '补漏：T',
      estimatedMinutes: 30,
      status: 'pending_suggestion' as const,
      locked: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await expect(repo.addDiagnosticGaps([gap], [task])).rejects.toBeInstanceOf(Error);

    const doc = {
      id: 'd1',
      courseId: course.id,
      title: 'Doc',
      format: 'markdown' as const,
      content: 'text',
      chunks: [{ index: 0, text: 'text' }],
      createdAt: ts,
      updatedAt: ts,
    };
    await repo.addDocument(doc);

    const validGap = { ...gap, documentIds: ['d1'] };
    const result = await repo.addDiagnosticGaps([validGap], [task]);
    const data = await repo.load();
    expect(data.diagnosticGaps).toHaveLength(1);
    expect(data.tasks[0]!.status).toBe('pending_suggestion');
    expect(result.gaps[0]!.id).toBe('gap-1');
  });

  it('confirmDiagnosticGap promotes gap and linked task', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const ts = nowIso();
    const doc = {
      id: 'd1',
      courseId: course.id,
      title: 'Doc',
      format: 'markdown' as const,
      content: 'text',
      chunks: [{ index: 0, text: 'text' }],
      createdAt: ts,
      updatedAt: ts,
    };
    await repo.addDocument(doc);
    const task = {
      id: 'task-1',
      courseId: course.id,
      title: '补漏：T',
      estimatedMinutes: 30,
      status: 'pending_suggestion' as const,
      locked: false,
      createdAt: ts,
      updatedAt: ts,
    };
    const gap = {
      id: 'gap-1',
      courseId: course.id,
      documentIds: ['d1'],
      topic: 'T',
      reason: 'R',
      severity: 'medium' as const,
      status: 'pending_suggestion' as const,
      taskId: task.id,
      createdAt: ts,
      updatedAt: ts,
    };
    await repo.addDiagnosticGaps([gap], [task]);
    const result = await repo.confirmDiagnosticGap('gap-1');
    expect(result.gap.status).toBe('confirmed');
    expect(result.task.status).toBe('confirmed');
  });

  it('dismissDiagnosticGap removes linked pending task', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const ts = nowIso();
    const doc = {
      id: 'd1',
      courseId: course.id,
      title: 'Doc',
      format: 'markdown' as const,
      content: 'text',
      chunks: [{ index: 0, text: 'text' }],
      createdAt: ts,
      updatedAt: ts,
    };
    await repo.addDocument(doc);
    const task = {
      id: 'task-1',
      courseId: course.id,
      title: '补漏：T',
      estimatedMinutes: 30,
      status: 'pending_suggestion' as const,
      locked: false,
      createdAt: ts,
      updatedAt: ts,
    };
    const gap = {
      id: 'gap-1',
      courseId: course.id,
      documentIds: ['d1'],
      topic: 'T',
      reason: 'R',
      severity: 'medium' as const,
      status: 'pending_suggestion' as const,
      taskId: task.id,
      createdAt: ts,
      updatedAt: ts,
    };
    await repo.addDiagnosticGaps([gap], [task]);
    await repo.dismissDiagnosticGap('gap-1');
    const data = await repo.load();
    expect(data.diagnosticGaps[0]!.status).toBe('dismissed');
    expect(data.tasks.some((t) => t.id === task.id)).toBe(false);
  });

  it('addArtifact and recordFeedback persist new entities', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const ts = nowIso();
    await repo.addDocument({
      id: 'd1',
      courseId: course.id,
      title: 'Doc',
      format: 'markdown',
      content: 'text',
      chunks: [{ index: 0, text: 'text' }],
      createdAt: ts,
      updatedAt: ts,
    });

    const artifact = {
      id: 'a1',
      courseId: course.id,
      sessionId: 's1',
      kind: 'summary' as const,
      title: 'Summary',
      content: 'C',
      citations: [{ documentId: 'd1', chunkIndex: 0 }],
      createdAt: ts,
      updatedAt: ts,
    };
    // Missing session reference should fail validateReferences.
    await expect(repo.addArtifact(artifact)).rejects.toMatchObject({ code: 'INVALID_REF' });

    const session = await repo.createSession({ courseId: course.id });
    const validArtifact = { ...artifact, sessionId: session.id };
    await repo.addArtifact(validArtifact);
    const data = await repo.load();
    expect(data.artifacts).toHaveLength(1);

    const profile = {
      courseId: course.id,
      strengths: [],
      weaknesses: [],
      avgRating: 0,
      totalSessions: 0,
      updatedAt: ts,
    };
    const feedback = {
      id: 'f1',
      courseId: course.id,
      sessionId: session.id,
      rating: 4,
      understood: true,
      createdAt: ts,
    };
    const fbResult = await repo.recordFeedback(feedback, profile);
    expect(fbResult.profile.courseId).toBe(course.id);
    const loaded = await repo.load();
    expect(loaded.feedbackSignals).toHaveLength(1);
    expect(loaded.learnerProfiles).toHaveLength(1);
  });

  it('getLearnerProfile returns null when absent', async () => {
    const course = await repo.createCourse({ title: 'C' });
    expect(await repo.getLearnerProfile(course.id)).toBeNull();
  });

  it('deleteCourse cascades to gaps, artifacts, feedback, and profiles', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const other = await repo.createCourse({ title: 'Other' });
    const ts = nowIso();
    const doc = {
      id: 'd1',
      courseId: course.id,
      title: 'Doc',
      format: 'markdown' as const,
      content: 'text',
      chunks: [{ index: 0, text: 'text' }],
      createdAt: ts,
      updatedAt: ts,
    };
    await repo.addDocument(doc);
    const session = await repo.createSession({ courseId: course.id });
    const gap = {
      id: 'gap-1',
      courseId: course.id,
      documentIds: ['d1'],
      topic: 'T',
      reason: 'R',
      severity: 'medium' as const,
      status: 'pending_suggestion' as const,
      createdAt: ts,
      updatedAt: ts,
    };
    const task = {
      id: 'task-1',
      courseId: course.id,
      title: '补漏：T',
      estimatedMinutes: 30,
      status: 'pending_suggestion' as const,
      locked: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await repo.addDiagnosticGaps([gap], [task]);
    await repo.addArtifact({
      id: 'a1',
      courseId: course.id,
      sessionId: session.id,
      kind: 'summary',
      title: 'Summary',
      content: 'C',
      citations: [{ documentId: 'd1', chunkIndex: 0 }],
      createdAt: ts,
      updatedAt: ts,
    });
    await repo.recordFeedback(
      {
        id: 'f1',
        courseId: course.id,
        sessionId: session.id,
        rating: 4,
        understood: true,
        createdAt: ts,
      },
      {
        courseId: course.id,
        strengths: [],
        weaknesses: [],
        avgRating: 0,
        totalSessions: 0,
        updatedAt: ts,
      },
    );

    await repo.deleteCourse(course.id);
    const data = await repo.load();
    expect(data.courses.map((c) => c.id)).toEqual([other.id]);
    expect(data.diagnosticGaps).toHaveLength(0);
    expect(data.artifacts).toHaveLength(0);
    expect(data.feedbackSignals).toHaveLength(0);
    expect(data.learnerProfiles).toHaveLength(0);
  });

  it('runProactiveTrigger persists suggestions as pending_suggestion', async () => {
    const course = await repo.createCourse({ title: 'C' });
    const result = await repo.runProactiveTrigger({
      kind: 'add_goal',
      courseId: course.id,
      goalId: 'g1',
      goalTitle: 'Goal',
    });

    expect(result.suggestions).toHaveLength(1);
    const data = await repo.load();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]!.status).toBe('pending_suggestion');
  });

  it('rescheduleAfterSkipDay moves tasks off skipped day', async () => {
    const course = await repo.createCourse({ title: 'C' });
    await repo.upsertTask({
      id: 't1',
      courseId: course.id,
      title: 'Task',
      estimatedMinutes: 60,
      status: 'confirmed',
      scheduledStart: '2026-07-13T09:00:00.000Z',
      scheduledEnd: '2026-07-13T10:00:00.000Z',
    });

    await repo.rescheduleAfterSkipDay(course.id, '2026-07-13');
    const data = await repo.load();
    const task = data.tasks.find((t) => t.id === 't1')!;
    expect(task.status).toBe('scheduled');
    const localDate = new Date(task.scheduledStart!).toLocaleDateString('en-CA');
    expect(localDate).not.toBe('2026-07-13');
  });
});
