import { assertCitationsValid } from './citation';
import {
  DiagnosticGapSchema,
  StudyTaskSchema,
  newId,
  nowIso,
  type DiagnosticGap,
  type LearningData,
  type SourceDocument,
  type StudyTask,
} from '@/types/learning';

export type DiagnoseOptions = {
  courseId: string;
  /** Limit to specific documents; defaults to all course documents. */
  documentIds?: string[];
  /** Minimum number of chunks before a topic is considered covered. */
  coverageThreshold?: number;
};

export type DiagnoseResult = {
  gaps: DiagnosticGap[];
  tasks: StudyTask[];
};

export class DiagnosticError extends Error {
  readonly code: string;

  constructor(message: string, code = 'DIAGNOSTIC_ERROR') {
    super(message);
    this.name = 'DiagnosticError';
    this.code = code;
  }
}

/**
 * Rule-based multi-document diagnostic.
 *
 * - Only creates `pending_suggestion` tasks (never auto-schedules).
 * - Detects topics that appear in multiple documents but lack worked examples
 *   or assessment markers.
 * - Detects documents with very low chunk counts as under-covered.
 */
export function diagnoseGaps(
  data: LearningData,
  options: DiagnoseOptions,
): DiagnoseResult {
  const courseId = options.courseId?.trim();
  if (!courseId) {
    throw new DiagnosticError('courseId is required', 'INVALID_INPUT');
  }

  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new DiagnosticError(`Course not found: ${courseId}`, 'NOT_FOUND');
  }

  const requestedIds = new Set((options.documentIds ?? []).filter(Boolean));
  const docs = data.documents.filter(
    (d) => d.courseId === courseId && (requestedIds.size === 0 || requestedIds.has(d.id)),
  );

  if (docs.length === 0) {
    throw new DiagnosticError(
      `No documents found for course ${courseId}`,
      'NOT_FOUND',
    );
  }

  const coverageThreshold = options.coverageThreshold ?? 3;
  const gaps: DiagnosticGap[] = [];
  const tasks: StudyTask[] = [];
  const ts = nowIso();

  // 1) Under-covered documents: few chunks overall.
  for (const doc of docs) {
    if (doc.chunks.length < coverageThreshold) {
      const gap = DiagnosticGapSchema.parse({
        id: newId(),
        courseId,
        documentIds: [doc.id],
        topic: doc.title,
        reason: `Document has only ${doc.chunks.length} chunk(s); expected at least ${coverageThreshold} for solid coverage.`,
        severity: 'medium',
        status: 'pending_suggestion',
        createdAt: ts,
        updatedAt: ts,
      });
      const task = buildSuggestionTask(courseId, gap);
      gap.taskId = task.id;
      gaps.push(gap);
      tasks.push(task);
    }
  }

  // 2) Cross-document topics missing examples or assessments.
  const topics = extractSharedTopics(docs);
  for (const topic of topics) {
    const topicDocs = docs.filter((d) => mentionsTopic(d, topic));
    if (topicDocs.length < 2) continue;

    const hasExample = topicDocs.some((d) =>
      d.content.match(/(?:例子|示例|example|eg\.?)/i),
    );
    const hasAssessment = topicDocs.some((d) =>
      d.content.match(/(?:练习|习题|quiz|exercise|assess|test|问题|question)/i),
    );

    if (!hasExample || !hasAssessment) {
      const missing = [!hasExample && 'worked example', !hasAssessment && 'assessment prompt']
        .filter(Boolean)
        .join(' / ');
      const gap = DiagnosticGapSchema.parse({
        id: newId(),
        courseId,
        documentIds: topicDocs.map((d) => d.id),
        topic,
        reason: `Topic appears across ${topicDocs.length} documents but lacks ${missing}.`,
        severity: 'high',
        status: 'pending_suggestion',
        createdAt: ts,
        updatedAt: ts,
      });
      const task = buildSuggestionTask(courseId, gap);
      gap.taskId = task.id;
      gaps.push(gap);
      tasks.push(task);
    }
  }

  return { gaps, tasks };
}

function buildSuggestionTask(courseId: string, gap: DiagnosticGap): StudyTask {
  return StudyTaskSchema.parse({
    id: newId(),
    courseId,
    title: `补漏：${gap.topic}`,
    description: gap.reason,
    estimatedMinutes: gap.severity === 'high' ? 60 : 30,
    status: 'pending_suggestion',
    createdAt: gap.createdAt,
    updatedAt: gap.updatedAt,
  });
}

/**
 * Simple noun-phrase extraction from headings and repeated capitalized terms.
 */
function extractSharedTopics(docs: SourceDocument[]): string[] {
  const headingRe = /(?:^|\n)\s*(?:#{1,3}\s+)?(.{3,60}?)\s*(?:\n|$)/g;
  const counts = new Map<string, number>();

  for (const doc of docs) {
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    // Reset lastIndex for each document
    headingRe.lastIndex = 0;
    while ((m = headingRe.exec(doc.content)) !== null) {
      const phrase = normalizeTopic(m[1]!);
      if (phrase && phrase.length >= 3 && phrase.length <= 40) {
        seen.add(phrase);
      }
    }
    for (const phrase of seen) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([phrase]) => phrase)
    .slice(0, 10);
}

function mentionsTopic(doc: SourceDocument, topic: string): boolean {
  const normalized = topic.toLowerCase();
  return (
    doc.title.toLowerCase().includes(normalized) ||
    doc.content.toLowerCase().includes(normalized)
  );
}

function normalizeTopic(raw: string): string {
  return raw
    .replace(/[#*`\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Confirm a diagnostic gap and its linked suggestion task.
 *
 * Returns the confirmed gap (status updated) and the promoted task.
 */
export function confirmGap(
  gap: DiagnosticGap,
  task: StudyTask,
): { gap: DiagnosticGap; task: StudyTask } {
  if (gap.status !== 'pending_suggestion') {
    throw new DiagnosticError(`Gap ${gap.id} is not a pending suggestion`, 'INVALID_STATE');
  }
  if (task.status !== 'pending_suggestion') {
    throw new DiagnosticError(`Task ${task.id} is not a pending suggestion`, 'INVALID_STATE');
  }

  const ts = nowIso();
  const confirmedGap: DiagnosticGap = {
    ...gap,
    status: 'confirmed',
    updatedAt: ts,
  };
  const confirmedTask: StudyTask = {
    ...task,
    status: 'confirmed',
    updatedAt: ts,
  };
  return { gap: confirmedGap, task: confirmedTask };
}

/**
 * Dismiss a diagnostic gap and remove its linked suggestion task.
 */
export function dismissGap(gap: DiagnosticGap): DiagnosticGap {
  if (gap.status !== 'pending_suggestion') {
    throw new DiagnosticError(`Gap ${gap.id} is not a pending suggestion`, 'INVALID_STATE');
  }
  return {
    ...gap,
    status: 'dismissed',
    taskId: undefined,
    updatedAt: nowIso(),
  };
}

export { assertCitationsValid };
