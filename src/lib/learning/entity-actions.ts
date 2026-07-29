/**
 * Batch-06 — Shared entity action contracts.
 *
 * Repository, /api/learning, and learning-store all accept the same Zod shapes
 * so UI capabilities never drift from the server. Conversation rename/delete
 * live in chat-store but reuse the same op vocabulary where useful.
 */

import { z } from 'zod';
import type { Course, LearningData, SourceDocument } from '@/types/learning';

/** Entities that support management actions in this batch. */
export const EntityKindSchema = z.enum([
  'conversation',
  'course',
  'document',
  'folder',
]);

export const EntityOpSchema = z.enum([
  'rename',
  'delete',
  'archive',
  'unarchive',
]);

/**
 * Canonical action request shared by Repository / API / Store.
 * - rename requires non-empty title
 * - course/folder delete requires confirmCascade: true (secondary confirm)
 */
export const EntityActionRequestSchema = z
  .object({
    entity: EntityKindSchema,
    op: EntityOpSchema,
    id: z.string().min(1, 'id is required'),
    title: z.string().min(1).max(200).optional(),
    /** Secondary confirmation for cascade delete of course/folder. */
    confirmCascade: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.op === 'rename') {
      const title = (value.title ?? '').trim();
      if (!title) {
        ctx.addIssue({
          code: 'custom',
          message: 'rename requires a non-empty title',
          path: ['title'],
        });
      }
    }
    if (
      value.op === 'delete' &&
      (value.entity === 'course' || value.entity === 'folder') &&
      value.confirmCascade !== true
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'course/folder delete requires confirmCascade: true',
        path: ['confirmCascade'],
      });
    }
    if (
      (value.op === 'archive' || value.op === 'unarchive') &&
      value.entity !== 'course' &&
      value.entity !== 'folder'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'archive/unarchive only applies to course or folder',
        path: ['op'],
      });
    }
  });

export type EntityKind = z.infer<typeof EntityKindSchema>;
export type EntityOp = z.infer<typeof EntityOpSchema>;
export type EntityActionRequest = z.infer<typeof EntityActionRequestSchema>;

/** Learning API action names that map 1:1 onto EntityActionRequest. */
export const LearningEntityApiActionSchema = z.enum([
  'renameCourse',
  'archiveCourse',
  'unarchiveCourse',
  'deleteCourse',
  'renameDocument',
  'deleteDocument',
  'renameFolder',
  'deleteFolder',
]);

export type LearningEntityApiAction = z.infer<typeof LearningEntityApiActionSchema>;

const API_TO_REQUEST: Record<
  LearningEntityApiAction,
  { entity: EntityKind; op: EntityOp }
> = {
  renameCourse: { entity: 'course', op: 'rename' },
  archiveCourse: { entity: 'course', op: 'archive' },
  unarchiveCourse: { entity: 'course', op: 'unarchive' },
  deleteCourse: { entity: 'course', op: 'delete' },
  renameDocument: { entity: 'document', op: 'rename' },
  deleteDocument: { entity: 'document', op: 'delete' },
  renameFolder: { entity: 'folder', op: 'rename' },
  deleteFolder: { entity: 'folder', op: 'delete' },
};

/**
 * Parse a learning API action + payload into the shared EntityActionRequest.
 * Folder ops are course entities under the Library “文件夹” metaphor.
 */
export function parseLearningEntityAction(
  action: LearningEntityApiAction,
  payload: unknown,
): EntityActionRequest {
  const body = (payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const map = API_TO_REQUEST[action];
  const id = String(
    body.id ??
      body.courseId ??
      body.documentId ??
      body.folderId ??
      '',
  ).trim();
  const title =
    body.title != null ? String(body.title).trim() : undefined;
  const confirmCascade =
    typeof body.confirmCascade === 'boolean'
      ? body.confirmCascade
      : undefined;

  return EntityActionRequestSchema.parse({
    entity: map.entity,
    op: map.op,
    id,
    title: title || undefined,
    confirmCascade,
  });
}

export function requiresCascadeConfirm(
  entity: EntityKind,
  op: EntityOp,
): boolean {
  return op === 'delete' && (entity === 'course' || entity === 'folder');
}

/** Natural course display title — never task/session name or raw id. */
export function courseDisplayTitle(
  course: Pick<Course, 'id' | 'title'> | null | undefined,
  fallback = '未命名课程',
): string {
  const title = (course?.title || '').trim();
  if (!title) return fallback;
  // Refuse raw entity ids masquerading as titles.
  if (/^(course|session|task|conv)[_-]/i.test(title) && title.length > 12) {
    return fallback;
  }
  return title;
}

/**
 * Latest session for a course (by startedAt). Used for sidebar deep-links.
 */
export function latestSessionForCourse<
  T extends { id: string; courseId: string; startedAt: string },
>(sessions: T[], courseId: string): T | null {
  const list = sessions
    .filter((s) => s.courseId === courseId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return list[0] ?? null;
}

/** Active (non-archived) courses, newest first, optionally capped. */
export function selectActiveCourses(
  courses: Course[],
  cap?: number,
): Course[] {
  const active = [...courses]
    .filter((c) => !c.archivedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (cap == null || cap < 0) return active;
  return active.slice(0, cap);
}

/**
 * Tags that look like internal migration / engineering labels — strip from UI
 * and persisted documents when sanitizing.
 */
export const ABNORMAL_MIGRATION_TAGS = new Set([
  'migrated',
  'migration',
  'v1-migrated',
  'v1_migrate',
  'legacy',
  'legacy-import',
  'legacy_import',
  '__migrate__',
  '__migration__',
  'schema-v1',
  'schema_v1',
  'import-migrate',
  'batch-migrate',
]);

export function isAbnormalMigrationTag(tag: string): boolean {
  const t = tag.trim().toLowerCase();
  if (!t) return true;
  if (ABNORMAL_MIGRATION_TAGS.has(t)) return true;
  // Internal double-underscore or schema-version tags
  if (/^__.*__$/.test(t)) return true;
  if (/^schema[-_]?v\d+$/i.test(t)) return true;
  if (/^migrat(e|ed|ion)([-_]|$)/i.test(t)) return true;
  return false;
}

export function sanitizeDocumentTags(
  tags: string[] | undefined | null,
): string[] | undefined {
  if (!tags || tags.length === 0) return tags ?? undefined;
  const cleaned = tags
    .map((t) => String(t).trim())
    .filter((t) => t && !isAbnormalMigrationTag(t));
  // Dedupe case-insensitively while preserving first casing
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of cleaned) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  return unique;
}

function contentFingerprint(doc: Pick<SourceDocument, 'content' | 'title'>): string {
  const content = (doc.content || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const title = (doc.title || '').trim().toLowerCase();
  return `${title}::${content.slice(0, 4000)}`;
}

/**
 * Remove abnormal migration tags and content-duplicate documents (keep oldest).
 * Does not invent course titles from task/session names.
 */
export function sanitizeLearningEntities(data: LearningData): {
  data: LearningData;
  removedDocumentIds: string[];
  tagsCleaned: number;
} {
  let tagsCleaned = 0;
  const documents = data.documents.map((doc) => {
    const before = doc.tags?.length ?? 0;
    const tags = sanitizeDocumentTags(doc.tags);
    const after = tags?.length ?? 0;
    if (before !== after) tagsCleaned += before - after;
    return tags === doc.tags ? doc : { ...doc, tags };
  });

  // Drop later content duplicates within the same course.
  const kept: SourceDocument[] = [];
  const removedDocumentIds: string[] = [];
  const seenByCourse = new Map<string, Set<string>>();

  const ordered = [...documents].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  for (const doc of ordered) {
    const key = contentFingerprint(doc);
    let set = seenByCourse.get(doc.courseId);
    if (!set) {
      set = new Set();
      seenByCourse.set(doc.courseId, set);
    }
    if (set.has(key) && key.endsWith('::') === false && key.length > 4) {
      // Only treat as duplicate when content is non-empty
      const contentPart = key.split('::')[1] ?? '';
      if (contentPart.length > 0) {
        removedDocumentIds.push(doc.id);
        continue;
      }
    }
    set.add(key);
    kept.push(doc);
  }

  // Preserve original relative order among kept docs (by updatedAt desc not required)
  const keptIds = new Set(kept.map((d) => d.id));
  const nextDocs = documents.filter((d) => keptIds.has(d.id));

  // Clean orphan import suggestions pointing at removed docs
  const importSuggestions = (data.importSuggestions ?? []).filter(
    (s) => keptIds.has(s.documentId),
  );

  return {
    data: {
      ...data,
      documents: nextDocs,
      importSuggestions,
    },
    removedDocumentIds,
    tagsCleaned,
  };
}

export function learningEntitiesNeedSanitize(data: LearningData): boolean {
  const result = sanitizeLearningEntities(data);
  return (
    result.removedDocumentIds.length > 0 ||
    result.tagsCleaned > 0 ||
    result.data.documents.length !== data.documents.length
  );
}
