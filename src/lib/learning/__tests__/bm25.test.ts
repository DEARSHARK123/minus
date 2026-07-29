import { describe, it, expect } from 'vitest';
import { BM25Index, tokenize } from '../bm25';
import { emptyLearningData, type LearningData, type SourceDocument } from '@/types/learning';
import { chunkText } from '../importer';

function doc(partial: Partial<SourceDocument> & Pick<SourceDocument, 'id' | 'courseId' | 'title' | 'content'>): SourceDocument {
  const chunks = partial.chunks ?? chunkText(partial.content);
  return {
    format: 'markdown',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
    chunks,
  };
}

describe('tokenize', () => {
  it('normalises case and drops punctuation', () => {
    expect(tokenize('BM25 is a Ranking Algorithm!')).toContain('bm25');
    expect(tokenize('BM25 is a Ranking Algorithm!')).toContain('ranking');
    expect(tokenize('BM25 is a Ranking Algorithm!')).toContain('algorithm');
  });

  it('keeps CJK character runs as tokens', () => {
    expect(tokenize('深度学习')).toContain('深度学习');
  });

  it('drops common English stop words', () => {
    expect(tokenize('the a an is of and')).toEqual([]);
  });
});

describe('BM25Index', () => {
  const data: LearningData = {
    ...emptyLearningData(),
    documents: [
      doc({
        id: 'd1',
        courseId: 'course-a',
        title: 'Neural Networks',
        content: 'Backpropagation is a key algorithm for training deep networks.',
      }),
      doc({
        id: 'd2',
        courseId: 'course-a',
        title: 'Backpropagation Guide',
        content: 'This document is mostly about other optimiser topics.',
      }),
      doc({
        id: 'd3',
        courseId: 'course-b',
        title: 'Backpropagation Other Course',
        content: 'Backpropagation should not leak across courses.',
      }),
    ],
  };

  it('returns ranked hits within a course', () => {
    const index = new BM25Index(data, 'course-a');
    const hits = index.search('backpropagation');
    expect(hits.length).toBe(2);
    expect(hits[0]!.documentId).toBe('d2');
    expect(hits[1]!.documentId).toBe('d1');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('does not return documents from other courses', () => {
    const index = new BM25Index(data, 'course-a');
    const hits = index.search('backpropagation');
    expect(hits.some((h) => h.documentId === 'd3')).toBe(false);
  });

  it('returns the same ordering for identical queries', () => {
    const index = new BM25Index(data, 'course-a');
    const a = index.search('backpropagation');
    const b = index.search('backpropagation');
    expect(a).toEqual(b);
  });

  it('returns empty results for empty or stop-word-only queries', () => {
    const index = new BM25Index(data, 'course-a');
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('the of')).toEqual([]);
  });

  it('respects the limit option', () => {
    const index = new BM25Index(data, 'course-a');
    expect(index.search('backpropagation', 1)).toHaveLength(1);
  });

  it('produces snippets around the matched term', () => {
    const index = new BM25Index(data, 'course-a');
    const hits = index.search('backpropagation');
    for (const h of hits) {
      expect(h.snippet).toEqual(expect.any(String));
      expect(h.snippet.length).toBeGreaterThan(0);
    }
  });

  it('ranks multi-term queries by combined term relevance', () => {
    const data2: LearningData = {
      ...emptyLearningData(),
      documents: [
        doc({
          id: 'd-only-a',
          courseId: 'course-a',
          title: 'Only A',
          content: 'The term alpha appears many times here. alpha alpha alpha.',
        }),
        doc({
          id: 'd-a-and-b',
          courseId: 'course-a',
          title: 'A and B',
          content: 'alpha and beta together. alpha beta.',
        }),
        doc({
          id: 'd-only-b',
          courseId: 'course-a',
          title: 'Only B',
          content: 'beta beta beta beta beta.',
        }),
      ],
    };
    const index = new BM25Index(data2, 'course-a');
    const hits = index.search('alpha beta');
    expect(hits[0]!.documentId).toBe('d-a-and-b');
  });
});
