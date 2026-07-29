import { describe, it, expect } from 'vitest';
import {
  assertCitationsValid,
  CitationError,
  validateCitation,
  validateCitations,
} from '../citation';
import { emptyLearningData, type Citation, type LearningData } from '@/types/learning';

function makeData(): LearningData {
  return {
    ...emptyLearningData(),
    documents: [
      {
        id: 'doc-a1',
        courseId: 'course-a',
        title: 'Doc A1',
        format: 'markdown',
        content: 'Chunk zero. Chunk one.',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        chunks: [
          { index: 0, text: 'Chunk zero.' },
          { index: 1, text: 'Chunk one.' },
        ],
      },
      {
        id: 'doc-b1',
        courseId: 'course-b',
        title: 'Doc B1',
        format: 'markdown',
        content: 'Only chunk zero.',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        chunks: [{ index: 0, text: 'Only chunk zero.' }],
      },
    ],
  };
}

describe('validateCitation', () => {
  const data = makeData();

  it('accepts a citation that points at an existing document and chunk', () => {
    const result = validateCitation(data, { documentId: 'doc-a1', chunkIndex: 0 });
    expect(result.valid).toBe(true);
  });

  it('rejects a citation to a missing document', () => {
    const result = validateCitation(data, { documentId: 'missing-doc', chunkIndex: 0 });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.message).toMatch(/not found/);
  });

  it('rejects a citation to a missing chunk index', () => {
    const result = validateCitation(data, { documentId: 'doc-a1', chunkIndex: 99 });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.message).toMatch(/Chunk 99 not found/);
  });

  it('optionally enforces course isolation', () => {
    const crossCourse: Citation = { documentId: 'doc-b1', chunkIndex: 0 };
    expect(validateCitation(data, crossCourse).valid).toBe(true);
    const withIsolation = validateCitation(data, crossCourse, { courseId: 'course-a' });
    expect(withIsolation.valid).toBe(false);
    expect(withIsolation.valid === false && withIsolation.message).toMatch(/course-a/);
  });
});

describe('validateCitations', () => {
  const data = makeData();

  it('returns valid when every citation resolves', () => {
    const result = validateCitations(data, [
      { documentId: 'doc-a1', chunkIndex: 0 },
      { documentId: 'doc-a1', chunkIndex: 1 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('collects every invalid citation', () => {
    const result = validateCitations(data, [
      { documentId: 'doc-a1', chunkIndex: 0 },
      { documentId: 'missing-doc', chunkIndex: 0 },
      { documentId: 'doc-a1', chunkIndex: 99 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.citation.documentId)).toContain('missing-doc');
    expect(result.errors.map((e) => e.citation.chunkIndex)).toContain(99);
  });
});

describe('assertCitationsValid', () => {
  const data = makeData();

  it('does not throw for valid citations', () => {
    expect(() =>
      assertCitationsValid(data, [{ documentId: 'doc-a1', chunkIndex: 0 }]),
    ).not.toThrow();
  });

  it('throws a CitationError when a citation cannot be resolved', () => {
    expect(() =>
      assertCitationsValid(data, [{ documentId: 'doc-a1', chunkIndex: 99 }]),
    ).toThrow(CitationError);
  });
});
