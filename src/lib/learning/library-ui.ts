/**
 * UX06 — Library presentation helpers.
 * File/folder workspace: primary list hides chunks / sourceQuality / duplicateId /
 * File.text and similar implementation metadata. Parse runs in background;
 * only conflicts or decisions interrupt.
 */

export type LibraryParsePhase =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'success'
  | 'conflict'
  | 'decision_needed'
  | 'error';

export type DocumentActionId =
  | 'ask'
  | 'summarize'
  | 'use_normal'
  | 'deep_outline';

export interface DocumentAction {
  id: DocumentActionId;
  /** Natural Chinese primary label. */
  label: string;
  /** Mode preference when opening Home. */
  mode: 'normal' | 'deep' | null;
}

/** Selected-doc primary actions only (no raw JSON / engineering). */
export const DOCUMENT_PRIMARY_ACTIONS: readonly DocumentAction[] = [
  { id: 'ask', label: '提问', mode: 'normal' },
  { id: 'summarize', label: '总结', mode: 'normal' },
  { id: 'use_normal', label: '用于普通学习', mode: 'normal' },
  { id: 'deep_outline', label: '生成深入大纲', mode: 'deep' },
] as const;

/** Fields allowed on primary list / thumbnail cards. */
export type LibraryListField =
  | 'title'
  | 'format'
  | 'summary'
  | 'updatedAt'
  | 'createdAt'
  | 'contentTypeLabel';

/** Implementation fields — advanced detail only. */
export type LibraryAdvancedField =
  | 'chunks'
  | 'sourceQuality'
  | 'duplicateId'
  | 'duplicateOfDocumentId'
  | 'content'
  | 'fileText'
  | 'File.text'
  | 'rawJson';

export const LIBRARY_PRIMARY_LIST_FIELDS: readonly LibraryListField[] = [
  'title',
  'format',
  'summary',
  'updatedAt',
  'createdAt',
  'contentTypeLabel',
] as const;

export const LIBRARY_ADVANCED_ONLY_FIELDS: readonly LibraryAdvancedField[] = [
  'chunks',
  'sourceQuality',
  'duplicateId',
  'duplicateOfDocumentId',
  'content',
  'fileText',
  'File.text',
  'rawJson',
] as const;

export interface LibraryDocumentLike {
  id: string;
  courseId: string;
  title: string;
  format?: string;
  content?: string;
  chunks?: unknown[];
  summary?: string;
  tags?: string[];
  contentType?: string;
  sourceQuality?: number;
  duplicateOfDocumentId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LibraryCourseLike {
  id: string;
  title: string;
}

export interface LibraryListItem {
  id: string;
  title: string;
  formatLabel: string;
  summaryLine: string | null;
  updatedLabel: string | null;
  /** Never includes chunks / quality / duplicate ids. */
  primaryFields: Partial<Record<LibraryListField, string>>;
}

export interface LibraryEmptyState {
  isEmpty: boolean;
  /** Only upload / create entry points — no engineering empty copy. */
  allowedEntryPoints: Array<'upload' | 'create'>;
  title: string;
  description: string;
}

/** Short Chinese status for upload/parse strip (not pipeline console). */
export function parsePhaseLabel(phase: LibraryParsePhase): string {
  switch (phase) {
    case 'idle':
      return '';
    case 'uploading':
      return '正在上传…';
    case 'processing':
      return '正在处理…';
    case 'success':
      return '处理完成';
    case 'conflict':
      return '发现可能的重复，需要你确认';
    case 'decision_needed':
      return '有建议待确认';
    case 'error':
      return '处理失败，请重试';
    default:
      return '';
  }
}

export function successToastMessage(
  kind: 'document' | 'timetable' | 'folder' = 'document',
): string {
  if (kind === 'timetable') return '课表已添加';
  if (kind === 'folder') return '文件夹已创建';
  return '资料已添加';
}

/**
 * Background parse/dedup/context must not interrupt primary UI
 * except for conflict or decision.
 */
export function shouldInterruptForBackground(phase: LibraryParsePhase): boolean {
  return phase === 'conflict' || phase === 'decision_needed';
}

/** Map analysis flags → phase for post-import UI. */
export function phaseFromImportAnalysis(input: {
  isDuplicate?: boolean;
  pendingSuggestionCount?: number;
  error?: boolean;
}): LibraryParsePhase {
  if (input.error) return 'error';
  if (input.isDuplicate) return 'conflict';
  if ((input.pendingSuggestionCount ?? 0) > 0) return 'decision_needed';
  return 'success';
}

export function isEmptyLibrary(input: {
  courses?: LibraryCourseLike[];
  documents?: LibraryDocumentLike[];
}): boolean {
  const courses = input.courses ?? [];
  const docs = input.documents ?? [];
  return courses.length === 0 && docs.length === 0;
}

/** Empty library: only upload / create (folder) entry points. */
export function buildLibraryEmptyState(input: {
  courses?: LibraryCourseLike[];
  documents?: LibraryDocumentLike[];
}): LibraryEmptyState {
  const empty = isEmptyLibrary(input);
  if (!empty) {
    return {
      isEmpty: false,
      allowedEntryPoints: ['upload', 'create'],
      title: '',
      description: '',
    };
  }
  return {
    isEmpty: true,
    allowedEntryPoints: ['upload', 'create'],
    title: '还没有资料',
    description: '上传文件或新建文件夹，开始整理你的学习资料。',
  };
}

export function formatLabel(format?: string): string {
  if (!format) return '文件';
  if (format === 'markdown') return 'Markdown';
  if (format === 'txt') return '文本';
  return format;
}

export function contentTypeLabel(contentType?: string): string | null {
  if (!contentType) return null;
  const map: Record<string, string> = {
    notes: '笔记',
    article: '文章',
    slides: '课件',
    reference: '参考',
    exercise: '练习',
    other: '其他',
  };
  return map[contentType] || null;
}

function shortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Project a document for primary list/thumbnail — strips advanced fields.
 */
export function toLibraryListItem(doc: LibraryDocumentLike): LibraryListItem {
  const format = formatLabel(doc.format);
  const summary = (doc.summary || '').trim();
  const summaryLine = summary
    ? summary.length <= 80
      ? summary
      : `${summary.slice(0, 79)}…`
    : null;
  const updated = shortDate(doc.updatedAt || doc.createdAt);
  const typeLabel = contentTypeLabel(doc.contentType);

  const primaryFields: Partial<Record<LibraryListField, string>> = {
    title: doc.title,
    format,
  };
  if (summaryLine) primaryFields.summary = summaryLine;
  if (updated) {
    primaryFields.updatedAt = updated;
    primaryFields.createdAt = updated;
  }
  if (typeLabel) primaryFields.contentTypeLabel = typeLabel;

  return {
    id: doc.id,
    title: doc.title,
    formatLabel: format,
    summaryLine,
    updatedLabel: updated,
    primaryFields,
  };
}

/** True if a key/path is advanced-only (must not appear on primary list). */
export function isAdvancedLibraryField(key: string): boolean {
  const k = key.trim();
  return (LIBRARY_ADVANCED_ONLY_FIELDS as readonly string[]).includes(k);
}

/**
 * Guard for primary UI payloads: reject if advanced keys present at top level.
 */
export function assertPrimaryLibraryPayload(
  payload: Record<string, unknown>,
): void {
  for (const key of Object.keys(payload)) {
    if (isAdvancedLibraryField(key)) {
      throw new Error(`Library primary UI must not expose ${key}`);
    }
  }
  // Nested accidental exposure of File.text style keys
  if ('File.text' in payload || 'fileText' in payload) {
    throw new Error('Library primary UI must not expose File.text');
  }
}

export function filterDocumentsBySearch<T extends LibraryDocumentLike>(
  documents: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter((d) => {
    const hay = [
      d.title,
      d.summary,
      d.format,
      d.contentType,
      ...(d.tags || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Folder row = course container. */
export function coursesAsFolders(
  courses: LibraryCourseLike[],
): Array<{ id: string; title: string; kind: 'folder' }> {
  return courses.map((c) => ({
    id: c.id,
    title: c.title,
    kind: 'folder' as const,
  }));
}

export function buildDocumentActionPrompt(
  action: DocumentActionId,
  doc: Pick<LibraryDocumentLike, 'title' | 'summary' | 'content'>,
): string {
  const title = (doc.title || '未命名资料').trim();
  const summary = (doc.summary || '').trim();
  const excerpt = (doc.content || '').trim().slice(0, 1200);
  const bodyHint = summary
    ? `摘要：${summary}`
    : excerpt
      ? `内容节选：\n${excerpt}`
      : '（正文已在资料库中）';

  switch (action) {
    case 'ask':
      return `我想针对资料「${title}」提问。\n${bodyHint}\n请先确认你理解了这份资料，然后等我的问题。`;
    case 'summarize':
      return `请用简洁中文总结资料「${title}」的要点，分条列出。\n${bodyHint}`;
    case 'use_normal':
      return `请用这份资料「${title}」帮我普通学习：先讲清楚核心概念，再给一两个小例子。\n${bodyHint}`;
    case 'deep_outline':
      return `请基于资料「${title}」生成一份可编辑的深入学习大纲（若干单元 + 知识点），用简洁中文。\n${bodyHint}`;
    default:
      return `关于资料「${title}」：\n${bodyHint}`;
  }
}

export function documentActionById(id: DocumentActionId): DocumentAction {
  const found = DOCUMENT_PRIMARY_ACTIONS.find((a) => a.id === id);
  if (!found) {
    return { id: 'ask', label: '提问', mode: 'normal' };
  }
  return found;
}

/** Advanced detail view model (collapsed by default in UI). */
export function buildAdvancedDocumentDetail(doc: LibraryDocumentLike): {
  chunkCount: number | null;
  sourceQualityPct: number | null;
  duplicateOfDocumentId: string | null;
  hasFullText: boolean;
} {
  return {
    chunkCount: Array.isArray(doc.chunks) ? doc.chunks.length : null,
    sourceQualityPct:
      typeof doc.sourceQuality === 'number'
        ? Math.round(doc.sourceQuality * 100)
        : null,
    duplicateOfDocumentId: doc.duplicateOfDocumentId || null,
    hasFullText: Boolean((doc.content || '').trim()),
  };
}
