/**
 * B06 suggestion lifecycle confirm/reject via LearningRepository (propose ≠ commit).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LearningRepository } from '../repository';
import { importDocument } from '../importer';

describe('import suggestion lifecycle (repo)', () => {
  let tmpDir: string;
  let repo: LearningRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minus-b06-'));
    repo = new LearningRepository({
      dataPath: path.join(tmpDir, 'learning-data.json'),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('import produces pending suggestions; reject does not create path tasks', async () => {
    const course = await repo.createCourse({ title: 'C1' });
    const raw = importDocument({
      courseId: course.id,
      title: '线性代数笔记',
      format: 'markdown',
      content: `# 线性代数\n\n## 定义\n向量空间。\n\n## 例子\n矩阵乘法。\n\n` + '正文内容。'.repeat(40),
    });
    const result = await repo.importDocumentWithAssist(raw);
    expect(result.document.id).toBeTruthy();
    expect(result.analysis.summary.length).toBeGreaterThan(5);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.every((s) => s.status === 'pending')).toBe(true);

    const before = await repo.load();
    expect(before.importSuggestions?.length).toBe(result.suggestions.length);
    const tasksBefore = before.tasks.length;

    const toReject = result.suggestions.find((s) => s.action === 'generate_path')
      ?? result.suggestions[0]!;
    const rejected = await repo.rejectImportSuggestion(toReject.id);
    expect(rejected.status).toBe('rejected');

    const after = await repo.load();
    expect(after.tasks.length).toBe(tasksBefore);
    expect(after.importSuggestions?.find((s) => s.id === toReject.id)?.status).toBe(
      'rejected',
    );
  });

  it('confirm keep_reference links doc without inventing scheduled tasks', async () => {
    const course = await repo.createCourse({ title: 'C2' });
    const raw = importDocument({
      courseId: course.id,
      title: '参考手册',
      format: 'txt',
      content: '参考内容手册条目一。'.repeat(30),
    });
    const { suggestions } = await repo.importDocumentWithAssist(raw);
    const keep = suggestions.find((s) => s.action === 'keep_reference');
    expect(keep).toBeTruthy();

    const confirmed = await repo.confirmImportSuggestion(keep!.id);
    expect(confirmed.suggestion.status).toBe('confirmed');

    const data = await repo.load();
    // Sibling pending for same doc should be rejected
    const siblings = data.importSuggestions?.filter(
      (s) => s.documentId === keep!.documentId && s.id !== keep!.id,
    );
    expect(siblings?.every((s) => s.status === 'rejected')).toBe(true);
    // No auto-scheduled tasks
    expect(data.tasks.every((t) => t.status !== 'scheduled')).toBe(true);
  });

  it('confirm generate_path creates goal/unit and pending_suggestion task only', async () => {
    const course = await repo.createCourse({ title: 'C3' });
    const raw = importDocument({
      courseId: course.id,
      title: '高质量讲义',
      format: 'markdown',
      content:
        '# 讲义\n\n## 第一节\n概念\n\n## 第二节\n推导\n\n## 第三节\n应用\n\n' +
        '详细说明与例子。'.repeat(50),
    });
    const { suggestions } = await repo.importDocumentWithAssist(raw);
    const gen = suggestions.find((s) => s.action === 'generate_path');
    expect(gen).toBeTruthy();

    const result = await repo.confirmImportSuggestion(gen!.id);
    expect(result.sideEffects.pathCreated).toBeTruthy();

    const data = await repo.load();
    expect(data.goals.length).toBeGreaterThanOrEqual(1);
    expect(data.units.length).toBeGreaterThanOrEqual(1);
    const pathTasks = data.tasks.filter(
      (t) => t.id === result.sideEffects.pathCreated!.taskIds[0],
    );
    expect(pathTasks).toHaveLength(1);
    expect(pathTasks[0]!.status).toBe('pending_suggestion');
  });

  it('task confirm/reject lifecycle still works for pending_suggestion', async () => {
    const course = await repo.createCourse({ title: 'C4' });
    const proposed = await repo.proposeTask({
      courseId: course.id,
      title: '预习',
      estimatedMinutes: 20,
    });
    expect(proposed.status).toBe('pending_suggestion');

    const confirmed = await repo.confirmTask(proposed.id);
    expect(confirmed.status).toBe('confirmed');

    const again = await repo.proposeTask({
      courseId: course.id,
      title: '复习',
      estimatedMinutes: 15,
    });
    const rejected = await repo.rejectSuggestion(again.id);
    expect(rejected.deleted).toBe(true);
    const data = await repo.load();
    expect(data.tasks.find((t) => t.id === again.id)).toBeUndefined();
  });
});
