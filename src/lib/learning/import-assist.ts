/**
 * B06 Library import agent assist (deterministic first).
 * Pipeline: parse → title/type → summary → tags → dedupe → source quality → link topic.
 * Produces confirmable suggestions only — never silently creates courses/tasks.
 */

import {
  ImportSuggestionSchema,
  newId,
  nowIso,
  type DocumentContentType,
  type ImportSuggestion,
  type ImportSuggestionAction,
  type LearningData,
  type LearningGoal,
  type LearningUnit,
  type SourceDocument,
} from '@/types/learning';

export type DocumentAnalysis = {
  title: string;
  contentType: DocumentContentType;
  summary: string;
  tags: string[];
  sourceQuality: number;
  isDuplicate: boolean;
  duplicateOfDocumentId?: string;
  linkedGoalId?: string;
  linkedUnitId?: string;
  linkedGoalTitle?: string;
  linkedUnitTitle?: string;
};

export type ImportAssistResult = {
  analysis: DocumentAnalysis;
  /** Enriched document fields to merge on save. */
  documentPatch: Partial<
    Pick<
      SourceDocument,
      | 'summary'
      | 'tags'
      | 'contentType'
      | 'sourceQuality'
      | 'linkedGoalId'
      | 'linkedUnitId'
      | 'duplicateOfDocumentId'
    >
  >;
  /** Pending suggestions — propose only; caller must persist with status pending. */
  suggestions: ImportSuggestion[];
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'this', 'that', 'it', 'as', 'by', 'from', 'at', 'be', 'was', 'were', 'not',
  '的', '了', '和', '与', '是', '在', '有', '对', '及', '等', '中', '为', '以', '或',
  '一个', '我们', '可以', '进行', '通过',
]);

const ACTION_LABELS: Record<ImportSuggestionAction, string> = {
  join_course: '关联到当前学习目标',
  generate_path: '基于资料生成学习路径',
  update_unit: '更新已有学习单元',
  keep_reference: '仅作参考资料保留',
  ignore: '忽略本次建议',
};

/**
 * Analyze an imported document and build confirmable suggestions.
 * Pure / deterministic — no LLM required; safe for offline import.
 */
export function analyzeImportedDocument(
  doc: SourceDocument,
  data: LearningData,
  options?: { currentGoalId?: string; currentUnitId?: string },
): ImportAssistResult {
  const courseGoals = data.goals.filter((g) => g.courseId === doc.courseId);
  const courseUnits = data.units.filter((u) => u.courseId === doc.courseId);
  const courseDocs = data.documents.filter(
    (d) => d.courseId === doc.courseId && d.id !== doc.id,
  );

  const inferredTitle = inferTitle(doc.title, doc.content);
  const contentType = inferContentType(doc.title, doc.content, doc.format);
  const summary = buildSummary(doc.content);
  const tags = extractTags(doc.title, doc.content, summary);
  const sourceQuality = scoreSourceQuality(doc.content, doc.format, contentType);

  const dup = findDuplicate(doc, courseDocs);
  const topic = linkToTopic(
    inferredTitle,
    summary,
    tags,
    courseGoals,
    courseUnits,
    options,
  );

  const analysis: DocumentAnalysis = {
    title: inferredTitle,
    contentType,
    summary,
    tags,
    sourceQuality,
    isDuplicate: !!dup,
    duplicateOfDocumentId: dup?.id,
    linkedGoalId: topic.goalId,
    linkedUnitId: topic.unitId,
    linkedGoalTitle: topic.goalTitle,
    linkedUnitTitle: topic.unitTitle,
  };

  const documentPatch: ImportAssistResult['documentPatch'] = {
    summary,
    tags,
    contentType,
    sourceQuality,
    linkedGoalId: topic.goalId,
    linkedUnitId: topic.unitId,
    duplicateOfDocumentId: dup?.id,
  };

  const suggestions = buildSuggestions(doc, analysis);
  return { analysis, documentPatch, suggestions };
}

function buildSuggestions(
  doc: SourceDocument,
  analysis: DocumentAnalysis,
): ImportSuggestion[] {
  const ts = nowIso();
  const base = {
    courseId: doc.courseId,
    documentId: doc.id,
    status: 'pending' as const,
    summary: analysis.summary,
    tags: analysis.tags,
    sourceQuality: analysis.sourceQuality,
    contentType: analysis.contentType,
    isDuplicate: analysis.isDuplicate,
    linkedGoalId: analysis.linkedGoalId,
    linkedUnitId: analysis.linkedUnitId,
    createdAt: ts,
    updatedAt: ts,
  };

  const out: ImportSuggestion[] = [];

  if (analysis.isDuplicate) {
    out.push(
      ImportSuggestionSchema.parse({
        ...base,
        id: newId(),
        action: 'ignore',
        title: ACTION_LABELS.ignore,
        reason: `检测到与已有文档高度相似（可能是重复导入）。建议忽略或仅保留参考。`,
      }),
    );
    out.push(
      ImportSuggestionSchema.parse({
        ...base,
        id: newId(),
        action: 'keep_reference',
        title: ACTION_LABELS.keep_reference,
        reason: '若内容有细微差异，可仅作参考资料保留，不创建学习任务。',
      }),
    );
    return out;
  }

  if (analysis.linkedGoalId || analysis.linkedUnitId) {
    out.push(
      ImportSuggestionSchema.parse({
        ...base,
        id: newId(),
        action: 'join_course',
        title: ACTION_LABELS.join_course,
        reason: analysis.linkedGoalTitle
          ? `内容与目标「${analysis.linkedGoalTitle}」相关，可关联到当前课程目标（不会自动创建任务）。`
          : `内容可关联到课程现有学习目标。`,
      }),
    );
  }

  if (analysis.linkedUnitId && analysis.linkedUnitTitle) {
    out.push(
      ImportSuggestionSchema.parse({
        ...base,
        id: newId(),
        action: 'update_unit',
        title: ACTION_LABELS.update_unit,
        reason: `建议用本文摘要更新单元「${analysis.linkedUnitTitle}」的说明（需你确认后才会写入）。`,
      }),
    );
  }

  if (analysis.sourceQuality >= 0.45 && !analysis.isDuplicate) {
    out.push(
      ImportSuggestionSchema.parse({
        ...base,
        id: newId(),
        action: 'generate_path',
        title: ACTION_LABELS.generate_path,
        reason: `来源质量 ${Math.round(analysis.sourceQuality * 100)}%。可基于摘要生成学习路径草案（确认后才会创建目标/单元/任务）。`,
      }),
    );
  }

  out.push(
    ImportSuggestionSchema.parse({
      ...base,
      id: newId(),
      action: 'keep_reference',
      title: ACTION_LABELS.keep_reference,
      reason: '仅将文档保存在资料库，不生成学习任务或路径。',
    }),
  );

  out.push(
    ImportSuggestionSchema.parse({
      ...base,
      id: newId(),
      action: 'ignore',
      title: ACTION_LABELS.ignore,
      reason: '关闭本次导入建议，文档仍保留在资料库中。',
    }),
  );

  return out;
}

export function inferTitle(provided: string, content: string): string {
  const trimmed = provided.trim();
  if (trimmed && trimmed !== '未命名文档' && trimmed.toLowerCase() !== 'untitled') {
    return trimmed;
  }
  const heading = content.match(/^#{1,3}\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim().slice(0, 80);
  const firstLine = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= 4 && !l.startsWith('```'));
  if (firstLine) return firstLine.replace(/^#+\s*/, '').slice(0, 80);
  return trimmed || '未命名文档';
}

export function inferContentType(
  title: string,
  content: string,
  format: SourceDocument['format'],
): DocumentContentType {
  const blob = `${title}\n${content.slice(0, 2000)}`.toLowerCase();
  if (/练习|习题|homework|exercise|quiz|作业|试题/.test(blob)) return 'exercise';
  if (/讲义|lecture|课件|slides|课堂/.test(blob)) return 'lecture';
  if (/参考|reference|附录|appendix|手册|manual|spec/.test(blob)) return 'reference';
  if (/笔记|notes|memo|要点|提纲/.test(blob) || format === 'markdown') return 'notes';
  return 'other';
}

export function buildSummary(content: string, maxLen = 280): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '（无有效正文摘要）';

  const sentences = cleaned
    .split(/(?<=[。！？.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  let summary = '';
  for (const s of sentences) {
    if (summary.length + s.length + 1 > maxLen) break;
    summary = summary ? `${summary} ${s}` : s;
  }
  if (!summary) summary = cleaned.slice(0, maxLen);
  return summary.length >= cleaned.length ? summary : `${summary.replace(/\s+$/, '')}…`;
}

export function extractTags(title: string, content: string, summary: string, max = 8): string[] {
  const text = `${title} ${summary} ${content.slice(0, 1500)}`;
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_+-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 24 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));

  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  // Boost title tokens
  for (const t of title.toLowerCase().split(/[^\p{L}\p{N}_+-]+/u)) {
    if (t.length >= 2 && !STOP_WORDS.has(t)) {
      freq.set(t, (freq.get(t) ?? 0) + 3);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

export function scoreSourceQuality(
  content: string,
  format: SourceDocument['format'],
  contentType: DocumentContentType,
): number {
  const len = content.trim().length;
  if (len < 40) return 0.15;

  let score = 0.35;
  // Length band
  if (len >= 200) score += 0.1;
  if (len >= 800) score += 0.1;
  if (len >= 2000) score += 0.05;
  // Structure
  const headings = (content.match(/^#{1,3}\s+/gm) ?? []).length;
  if (headings >= 1) score += 0.1;
  if (headings >= 3) score += 0.05;
  const lists = (content.match(/^\s*[-*+]\s+/gm) ?? []).length;
  if (lists >= 2) score += 0.05;
  if (format === 'markdown') score += 0.05;
  // Content type prior
  switch (contentType) {
    case 'lecture':
    case 'notes':
      score += 0.05;
      break;
    case 'exercise':
      score += 0.08;
      break;
    case 'reference':
      score += 0.03;
      break;
    case 'other':
      break;
    default: {
      const _never: never = contentType;
      void _never;
      break;
    }
  }
  // Penalize very short or noisy
  const chineseOrWord = (content.match(/[\u4e00-\u9fff]|\b[a-zA-Z]{3,}\b/g) ?? []).length;
  if (chineseOrWord < 20) score -= 0.1;

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').slice(0, 500);
}

function jaccardChars(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const ch of sa) {
    if (sb.has(ch)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function findDuplicate(
  doc: SourceDocument,
  existing: SourceDocument[],
): SourceDocument | undefined {
  const titleNorm = doc.title.trim().toLowerCase();
  const contentNorm = normalizeForCompare(doc.content);

  for (const other of existing) {
    if (other.title.trim().toLowerCase() === titleNorm && titleNorm.length > 0) {
      return other;
    }
    const otherContent = normalizeForCompare(other.content);
    if (contentNorm.length >= 80 && otherContent.length >= 80) {
      const sim = jaccardChars(contentNorm.slice(0, 400), otherContent.slice(0, 400));
      if (sim >= 0.92) return other;
    }
  }
  return undefined;
}

function linkToTopic(
  title: string,
  summary: string,
  tags: string[],
  goals: LearningGoal[],
  units: LearningUnit[],
  options?: { currentGoalId?: string; currentUnitId?: string },
): {
  goalId?: string;
  unitId?: string;
  goalTitle?: string;
  unitTitle?: string;
} {
  if (options?.currentUnitId) {
    const u = units.find((x) => x.id === options.currentUnitId);
    if (u) {
      const g = u.goalId ? goals.find((x) => x.id === u.goalId) : undefined;
      return {
        unitId: u.id,
        unitTitle: u.title,
        goalId: g?.id ?? options.currentGoalId,
        goalTitle: g?.title,
      };
    }
  }
  if (options?.currentGoalId) {
    const g = goals.find((x) => x.id === options.currentGoalId);
    if (g) return { goalId: g.id, goalTitle: g.title };
  }

  const hay = `${title} ${summary} ${tags.join(' ')}`.toLowerCase();
  let bestUnit: LearningUnit | undefined;
  let bestUnitScore = 0;
  for (const u of units) {
    const score = topicScore(hay, u.title, u.description, u.knowledgePoints);
    if (score > bestUnitScore) {
      bestUnitScore = score;
      bestUnit = u;
    }
  }
  let bestGoal: LearningGoal | undefined;
  let bestGoalScore = 0;
  for (const g of goals) {
    const score = topicScore(hay, g.title, g.description);
    if (score > bestGoalScore) {
      bestGoalScore = score;
      bestGoal = g;
    }
  }

  if (bestUnit && bestUnitScore >= 0.15) {
    const g =
      (bestUnit.goalId && goals.find((x) => x.id === bestUnit!.goalId)) ||
      (bestGoalScore >= 0.15 ? bestGoal : undefined);
    return {
      unitId: bestUnit.id,
      unitTitle: bestUnit.title,
      goalId: g?.id,
      goalTitle: g?.title,
    };
  }
  if (bestGoal && bestGoalScore >= 0.15) {
    return { goalId: bestGoal.id, goalTitle: bestGoal.title };
  }
  // Fall back to most recent goal if any (weak link)
  const latest = [...goals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (latest) return { goalId: latest.id, goalTitle: latest.title };
  return {};
}

function topicScore(
  hay: string,
  title: string,
  description?: string,
  knowledgePoints?: string[],
): number {
  const parts = [title, description ?? '', ...(knowledgePoints ?? [])]
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_+-]+/u)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  if (parts.length === 0) return 0;
  let hits = 0;
  for (const p of parts) {
    if (hay.includes(p)) hits += 1;
  }
  return hits / parts.length;
}

/** Chinese label for action (UI). */
export function importActionLabel(action: ImportSuggestionAction): string {
  return ACTION_LABELS[action];
}
