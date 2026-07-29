/**
 * Batch-06 — Entity management: shared Zod action schema, course/document CRUD,
 * cascade confirm, title/sidebar semantics, migration tag cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EntityActionRequestSchema,
  courseDisplayTitle,
  isAbnormalMigrationTag,
  latestSessionForCourse,
  parseLearningEntityAction,
  requiresCascadeConfirm,
  sanitizeDocumentTags,
  sanitizeLearningEntities,
  selectActiveCourses,
} from '../entity-actions';
import { LearningRepository } from '../repository';
import { emptyLearningData, nowIso, type LearningData } from '@/types/learning';
import {
  capSidebarCourses,
  courseSidebarLabel,
} from '@/lib/chat/sidebar-recent';
import {
  backfillConversationTitle,
  isGenericConversationTitle,
} from '@/lib/chat/conversation-aggregate';

const ts = '2026-07-14T10:00:00.000Z';

describe('Batch-06 EntityActionRequest schema', () => {
  it('accepts rename with title for course/document/folder', () => {
    for (const entity of ['course', 'document', 'folder'] as const) {
      const parsed = EntityActionRequestSchema.parse({
        entity,
        op: 'rename',
        id: 'e1',
        title: '新名称',
      });
      expect(parsed.title).toBe('新名称');
    }
  });

  it('rejects rename without title', () => {
    expect(() =>
      EntityActionRequestSchema.parse({
        entity: 'course',
        op: 'rename',
        id: 'c1',
      }),
    ).toThrow();
  });

  it('requires confirmCascade for course/folder delete', () => {
    expect(requiresCascadeConfirm('course', 'delete')).toBe(true);
    expect(requiresCascadeConfirm('folder', 'delete')).toBe(true);
    expect(requiresCascadeConfirm('document', 'delete')).toBe(false);

    expect(() =>
      EntityActionRequestSchema.parse({
        entity: 'course',
        op: 'delete',
        id: 'c1',
      }),
    ).toThrow(/confirmCascade/);

    const ok = EntityActionRequestSchema.parse({
      entity: 'course',
      op: 'delete',
      id: 'c1',
      confirmCascade: true,
    });
    expect(ok.confirmCascade).toBe(true);
  });

  it('maps API action names through the same schema', () => {
    const rename = parseLearningEntityAction('renameCourse', {
      courseId: 'c9',
      title: '线性代数',
    });
    expect(rename).toMatchObject({
      entity: 'course',
      op: 'rename',
      id: 'c9',
      title: '线性代数',
    });

    const del = parseLearningEntityAction('deleteFolder', {
      id: 'f1',
      confirmCascade: true,
    });
    expect(del).toMatchObject({
      entity: 'folder',
      op: 'delete',
      id: 'f1',
      confirmCascade: true,
    });

    const doc = parseLearningEntityAction('renameDocument', {
      documentId: 'd1',
      title: '笔记',
    });
    expect(doc.entity).toBe('document');
  });

  it('rejects archive on document', () => {
    expect(() =>
      EntityActionRequestSchema.parse({
        entity: 'document',
        op: 'archive',
        id: 'd1',
      }),
    ).toThrow();
  });
});

describe('Batch-06 titles and sidebar course semantics', () => {
  it('instant natural title from first user message', () => {
    expect(isGenericConversationTitle('新对话')).toBe(true);
    expect(
      backfillConversationTitle({
        title: '新对话',
        messages: [{ role: 'user', content: '想系统学一下概率论' }],
      }),
    ).toBe('想系统学一下概率论');
  });

  it('course display never uses task/session id-like titles', () => {
    expect(
      courseDisplayTitle({ id: 'c1', title: 'session_abc123_xyz' }),
    ).toBe('未命名课程');
    expect(courseDisplayTitle({ id: 'c1', title: '概率论入门' })).toBe(
      '概率论入门',
    );
    expect(courseSidebarLabel({ id: 'c1', title: 'task_deadbeef01' })).toBe(
      '未命名课程',
    );
  });

  it('lists real courses only; archived excluded; deep-link latest session', () => {
    const courses = [
      {
        id: 'c1',
        title: '课程 A',
        updatedAt: '2026-07-14T12:00:00.000Z',
      },
      {
        id: 'c2',
        title: '课程 B',
        archivedAt: '2026-07-14T11:00:00.000Z',
        updatedAt: '2026-07-14T13:00:00.000Z',
      },
      {
        id: 'c3',
        title: '课程 C',
        updatedAt: '2026-07-14T09:00:00.000Z',
      },
    ];
    const capped = capSidebarCourses(courses, 5);
    expect(capped.items.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(capped.total).toBe(2);

    const mapped = courses.map((c) => ({
      ...c,
      createdAt: ts,
      updatedAt: c.updatedAt,
    }));
    const active = selectActiveCourses(mapped, 1);
    expect(active).toHaveLength(1);
    // Non-archived only; c1 has latest updatedAt among active
    expect(active[0]!.id).toBe('c1');

    const activeAll = selectActiveCourses(mapped);
    expect(activeAll.map((c) => c.id)).toEqual(['c1', 'c3']);

    const sessions = [
      {
        id: 's-old',
        courseId: 'c1',
        startedAt: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 's-new',
        courseId: 'c1',
        startedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        id: 's-other',
        courseId: 'c3',
        startedAt: '2026-07-14T01:00:00.000Z',
      },
    ];
    expect(latestSessionForCourse(sessions, 'c1')?.id).toBe('s-new');
    expect(latestSessionForCourse(sessions, 'missing')).toBeNull();
  });
});

describe('Batch-06 sanitize migration tags and duplicates', () => {
  it('strips abnormal migration tags', () => {
    expect(isAbnormalMigrationTag('migrated')).toBe(true);
    expect(isAbnormalMigrationTag('__migrate__')).toBe(true);
    expect(isAbnormalMigrationTag('schema-v1')).toBe(true);
    expect(isAbnormalMigrationTag('概率论')).toBe(false);

    expect(
      sanitizeDocumentTags(['概率论', 'migrated', 'legacy-import', '概率论']),
    ).toEqual(['概率论']);
  });

  it('removes content-duplicate documents, keeps oldest', () => {
    const data: LearningData = {
      ...emptyLearningData(),
      courses: [
        {
          id: 'c1',
          title: 'C',
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      documents: [
        {
          id: 'd1',
          courseId: 'c1',
          title: '笔记',
          format: 'txt',
          content: 'same body content here',
          chunks: [{ index: 0, text: 'same body content here' }],
          tags: ['migrated', '实分析'],
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'd2',
          courseId: 'c1',
          title: '笔记',
          format: 'txt',
          content: 'same body content here',
          chunks: [{ index: 0, text: 'same body content here' }],
          tags: ['实分析'],
          createdAt: '2026-07-02T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
        {
          id: 'd3',
          courseId: 'c1',
          title: '另一份',
          format: 'txt',
          content: 'different',
          chunks: [{ index: 0, text: 'different' }],
          createdAt: '2026-07-03T00:00:00.000Z',
          updatedAt: '2026-07-03T00:00:00.000Z',
        },
      ],
    };

    const result = sanitizeLearningEntities(data);
    expect(result.removedDocumentIds).toEqual(['d2']);
    expect(result.data.documents.map((d) => d.id).sort()).toEqual(['d1', 'd3']);
    expect(result.data.documents.find((d) => d.id === 'd1')?.tags).toEqual([
      '实分析',
    ]);
    expect(result.tagsCleaned).toBeGreaterThan(0);
  });
});

describe('Batch-06 repository CRUD (shared applyEntityAction)', () => {
  let dataPath: string;
  let dataDir: string;
  let repo: LearningRepository;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minus-entity-b06-'));
    dataPath = path.join(dataDir, 'learning-data.json');
    repo = new LearningRepository({ dataPath });
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('renames and archives courses; cascade delete needs confirm via schema', async () => {
    const course = await repo.createCourse({ title: '原始课' });
    const renamed = await repo.applyEntityAction({
      entity: 'course',
      op: 'rename',
      id: course.id,
      title: '重命名课',
    });
    expect((renamed as { title: string }).title).toBe('重命名课');

    const archived = await repo.archiveCourse(course.id, true);
    expect(archived.archivedAt).toBeTruthy();

    await expect(
      repo.applyEntityAction({
        entity: 'course',
        op: 'delete',
        id: course.id,
      }),
    ).rejects.toThrow();

    const del = await repo.applyEntityAction({
      entity: 'course',
      op: 'delete',
      id: course.id,
      confirmCascade: true,
    });
    expect(del).toEqual({ deleted: true, courseId: course.id });
    const data = await repo.load();
    expect(data.courses).toHaveLength(0);
  });

  it('renames and deletes documents', async () => {
    const course = await repo.createCourse({ title: 'Folder' });
    const doc = await repo.addDocument({
      id: crypto.randomUUID(),
      courseId: course.id,
      title: '旧文档',
      format: 'markdown',
      content: '# hi',
      chunks: [{ index: 0, text: '# hi' }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    const renamed = await repo.renameDocument(doc.id, '新文档');
    expect(renamed.title).toBe('新文档');

    await repo.deleteDocument(doc.id);
    const data = await repo.load();
    expect(data.documents).toHaveLength(0);
  });

  it('folder delete via shared schema cascades', async () => {
    const course = await repo.createCourse({ title: '文件夹' });
    await repo.addDocument({
      id: crypto.randomUUID(),
      courseId: course.id,
      title: 'd',
      format: 'txt',
      content: 'x',
      chunks: [{ index: 0, text: 'x' }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await repo.applyLearningApiEntityAction('deleteFolder', {
      folderId: course.id,
      confirmCascade: true,
    });
    const data = await repo.load();
    expect(data.courses).toHaveLength(0);
    expect(data.documents).toHaveLength(0);
  });
});

describe('Batch-06 delete current conversation → draft semantics', () => {
  it('documents expected active id null after deleting current (pure contract)', () => {
    // Mirrors chat-store.deleteConversation: wasActive → activeConversationId null
    // (unpersisted /chat draft), never auto-pick another thread.
    type C = { id: string; messages: unknown[] };
    const deleteCurrent = (
      conversations: C[],
      activeId: string | null,
      id: string,
    ) => {
      const filtered = conversations.filter((c) => c.id !== id);
      const wasActive = activeId === id;
      return {
        conversations: filtered,
        activeConversationId: wasActive ? null : activeId,
      };
    };

    const state = {
      conversations: [
        { id: 'a', messages: [1] },
        { id: 'b', messages: [1] },
      ],
      activeConversationId: 'a' as string | null,
    };
    const next = deleteCurrent(
      state.conversations,
      state.activeConversationId,
      'a',
    );
    expect(next.activeConversationId).toBeNull();
    expect(next.conversations.map((c) => c.id)).toEqual(['b']);

    const nextB = deleteCurrent(
      next.conversations,
      'b',
      'b',
    );
    expect(nextB.activeConversationId).toBeNull();
    expect(nextB.conversations).toHaveLength(0);
  });
});
