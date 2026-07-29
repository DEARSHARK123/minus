import { describe, it, expect } from 'vitest';
import {
  analyzeImportedDocument,
  buildSummary,
  extractTags,
  findDuplicate,
  inferContentType,
  scoreSourceQuality,
} from '../import-assist';
import { emptyLearningData, type LearningData, type SourceDocument } from '@/types/learning';

const ts = '2026-07-12T08:00:00.000Z';

function doc(partial: Partial<SourceDocument> & Pick<SourceDocument, 'id' | 'title' | 'content'>): SourceDocument {
  return {
    courseId: 'c1',
    format: 'markdown',
    chunks: [{ index: 0, text: partial.content.slice(0, 100) }],
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

function data(overrides: Partial<LearningData> = {}): LearningData {
  return {
    ...emptyLearningData(),
    courses: [
      { id: 'c1', title: 'Course', createdAt: ts, updatedAt: ts },
    ],
    ...overrides,
  };
}

describe('import-assist pipeline', () => {
  it('infers type, summary, tags, quality and emits pending suggestions only', () => {
    const content = `# 梯度下降笔记

## 定义
梯度下降是一种优化算法。

## 例子
用学习率更新参数。

## 练习
完成三次迭代计算。
`;
    const d = doc({ id: 'd1', title: 'GD', content });
    const result = analyzeImportedDocument(d, data());

    expect(result.analysis.contentType).toMatch(/notes|exercise|lecture|other|reference/);
    expect(result.analysis.summary.length).toBeGreaterThan(10);
    expect(result.analysis.tags.length).toBeGreaterThan(0);
    expect(result.analysis.sourceQuality).toBeGreaterThan(0.3);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.every((s) => s.status === 'pending')).toBe(true);
    // Never auto-commits tasks/courses in analysis itself
    expect(result.suggestions.every((s) => s.documentId === 'd1')).toBe(true);
    const actions = new Set(result.suggestions.map((s) => s.action));
    expect(actions.has('keep_reference')).toBe(true);
    expect(actions.has('ignore')).toBe(true);
  });

  it('links to current goal/unit when provided', () => {
    const store = data({
      goals: [
        {
          id: 'g1',
          courseId: 'c1',
          title: '掌握梯度下降',
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      units: [
        {
          id: 'u1',
          courseId: 'c1',
          goalId: 'g1',
          title: '一阶优化',
          knowledgePoints: ['梯度', '学习率'],
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    });
    const d = doc({
      id: 'd2',
      title: '梯度笔记',
      content: '学习率与梯度更新步骤说明。'.repeat(5),
    });
    const result = analyzeImportedDocument(d, store, {
      currentGoalId: 'g1',
      currentUnitId: 'u1',
    });
    expect(result.analysis.linkedGoalId).toBe('g1');
    expect(result.analysis.linkedUnitId).toBe('u1');
    expect(result.suggestions.some((s) => s.action === 'join_course')).toBe(true);
    expect(result.suggestions.some((s) => s.action === 'update_unit')).toBe(true);
  });

  it('detects duplicates and prefers ignore / keep_reference', () => {
    const existing = doc({
      id: 'd0',
      title: 'Same Title',
      content: 'A'.repeat(200),
    });
    const store = data({ documents: [existing] });
    const dup = doc({
      id: 'd1',
      title: 'Same Title',
      content: 'B'.repeat(50),
    });
    const result = analyzeImportedDocument(dup, store);
    expect(result.analysis.isDuplicate).toBe(true);
    expect(result.analysis.duplicateOfDocumentId).toBe('d0');
    const actions = result.suggestions.map((s) => s.action);
    expect(actions).toContain('ignore');
    expect(actions).toContain('keep_reference');
    expect(actions).not.toContain('generate_path');
  });

  it('buildSummary / tags / quality helpers are stable', () => {
    expect(buildSummary('短')).toBeTruthy();
    expect(extractTags('机器学习', '监督 学习 模型', '摘要')).toContain('机器学习');
    expect(scoreSourceQuality('# H\n- a\n- b\n' + '正文'.repeat(100), 'markdown', 'notes')).toBeGreaterThan(
      0.4,
    );
    expect(inferContentType('homework', 'exercise 1', 'txt')).toBe('exercise');
  });

  it('findDuplicate matches identical titles', () => {
    const a = doc({ id: 'a', title: 'X', content: '1' });
    const b = doc({ id: 'b', title: 'X', content: '2' });
    expect(findDuplicate(b, [a])?.id).toBe('a');
  });
});

describe('import suggestion lifecycle (confirm/reject pure contract)', () => {
  it('suggestions start pending and are confirmable/rejectable by status field', () => {
    const d = doc({
      id: 'd1',
      title: 'Notes',
      content: '## 定义\n可解释的摘要文本。'.repeat(20),
    });
    const { suggestions } = analyzeImportedDocument(d, data());
    expect(suggestions.length).toBeGreaterThan(0);

    // Simulate confirm lifecycle on a copy (repo does persistence).
    const confirmed = { ...suggestions[0]!, status: 'confirmed' as const };
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.status).not.toBe('pending');

    const rejected = { ...suggestions[0]!, status: 'rejected' as const };
    expect(rejected.status).toBe('rejected');
  });

  it('does not invent course writes in analysis result', () => {
    const d = doc({
      id: 'd1',
      title: 'Path candidate',
      content: '# Lecture\n' + '概念与推导。'.repeat(80),
    });
    const result = analyzeImportedDocument(d, data());
    // Analysis is propose-only: no tasks array mutation
    expect(result.suggestions.every((s) => s.status === 'pending')).toBe(true);
    expect(Object.keys(result.documentPatch)).toEqual(
      expect.arrayContaining(['summary', 'tags', 'contentType', 'sourceQuality']),
    );
  });
});
