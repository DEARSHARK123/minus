import { describe, it, expect } from 'vitest';
import { searchDocuments, SearchError } from '../search';
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

describe('searchDocuments', () => {
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
        courseId: 'course-b',
        title: 'Neural Networks Other Course',
        content: 'Backpropagation should not leak across courses.',
      }),
      doc({
        id: 'd3',
        courseId: 'course-a',
        title: 'Optimizers',
        content: 'Adam and SGD are popular optimizers. BACKPROPAGATION appears in caps too.',
      }),
    ],
  };

  it('requires courseId for isolation', () => {
    expect(() => searchDocuments(data, { courseId: '', query: 'x' })).toThrow(SearchError);
  });

  it('only returns hits from the given courseId', () => {
    const hits = searchDocuments(data, { courseId: 'course-a', query: 'backpropagation' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.documentId === 'd1' || h.documentId === 'd3')).toBe(true);
    expect(hits.some((h) => h.documentId === 'd2')).toBe(false);
  });

  it('is case-insensitive and returns required fields', () => {
    const hits = searchDocuments(data, { courseId: 'course-a', query: 'BACKPROPAGATION' });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h).toEqual(
        expect.objectContaining({
          documentId: expect.any(String),
          title: expect.any(String),
          chunkIndex: expect.any(Number),
          snippet: expect.any(String),
          score: expect.any(Number),
        }),
      );
    }
  });

  it('does not return other-course documents even with identical text', () => {
    const hits = searchDocuments(data, { courseId: 'course-b', query: 'backpropagation' });
    expect(hits.every((h) => h.documentId === 'd2')).toBe(true);
    expect(hits.some((h) => h.documentId === 'd1')).toBe(false);
  });

  it('ranks title matches above body-only matches', () => {
    const hits = searchDocuments(data, { courseId: 'course-a', query: 'backpropagation' });
    expect(hits[0]!.documentId).toBe('d3');
  });

  it('returns stable results for repeated identical queries', () => {
    const a = searchDocuments(data, { courseId: 'course-a', query: 'backpropagation' });
    const b = searchDocuments(data, { courseId: 'course-a', query: 'backpropagation' });
    expect(a).toEqual(b);
  });
});
