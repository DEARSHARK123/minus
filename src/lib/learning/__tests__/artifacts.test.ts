import { describe, it, expect } from 'vitest';
import { createArtifact, ArtifactError } from '../artifacts';
import { emptyLearningData, type SearchHit } from '@/types/learning';

function sampleData() {
  return {
    ...emptyLearningData(),
    courses: [
      {
        id: 'c1',
        title: 'ML',
        createdAt: '2026-07-12T08:00:00.000Z',
        updatedAt: '2026-07-12T08:00:00.000Z',
      },
    ],
    documents: [
      {
        id: 'd1',
        courseId: 'c1',
        title: 'Ch1',
        format: 'markdown' as const,
        content: 'Definition: gradient descent is an optimization algorithm.',
        chunks: [{ index: 0, text: 'Definition: gradient descent is an optimization algorithm.' }],
        createdAt: '2026-07-12T08:00:00.000Z',
        updatedAt: '2026-07-12T08:00:00.000Z',
      },
    ],
  };
}

function sampleHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    documentId: 'd1',
    title: 'Ch1',
    chunkIndex: 0,
    snippet: 'Gradient descent is an optimization algorithm.',
    score: 0.9,
    ...overrides,
  };
}

describe('createArtifact', () => {
  it('creates a summary with validated citations', () => {
    const data = sampleData();
    const artifact = createArtifact(data, {
      courseId: 'c1',
      kind: 'summary',
      title: 'GD Summary',
      hits: [sampleHit()],
    });
    expect(artifact.kind).toBe('summary');
    expect(artifact.citations).toHaveLength(1);
    expect(artifact.citations[0]!.documentId).toBe('d1');
    expect(artifact.content).toContain('Ch1 · chunk 0');
  });

  it('creates flashcards with at least one Q/A pair', () => {
    const data = sampleData();
    const artifact = createArtifact(data, {
      courseId: 'c1',
      kind: 'flashcard',
      title: 'GD Flashcards',
      hits: [sampleHit()],
    });
    expect(artifact.kind).toBe('flashcard');
    expect(artifact.content).toContain('Q:');
    expect(artifact.content).toContain('A:');
  });

  it('creates a quiz with questions and sources', () => {
    const data = sampleData();
    const artifact = createArtifact(data, {
      courseId: 'c1',
      kind: 'quiz',
      title: 'GD Quiz',
      hits: [sampleHit()],
    });
    expect(artifact.kind).toBe('quiz');
    expect(artifact.content).toContain('Answer:');
    expect(artifact.content).toContain('Source:');
  });

  it('throws when course is missing', () => {
    expect(() =>
      createArtifact(emptyLearningData(), {
        courseId: 'c1',
        kind: 'summary',
        title: 'X',
        hits: [sampleHit()],
      }),
    ).toThrow(ArtifactError);
  });

  it('throws when no hits are provided', () => {
    expect(() =>
      createArtifact(sampleData(), {
        courseId: 'c1',
        kind: 'summary',
        title: 'X',
        hits: [],
      }),
    ).toThrow(ArtifactError);
  });

  it('throws when citation cannot be resolved', () => {
    const data = sampleData();
    expect(() =>
      createArtifact(data, {
        courseId: 'c1',
        kind: 'summary',
        title: 'X',
        hits: [sampleHit({ documentId: 'missing', chunkIndex: 99 })],
      }),
    ).toThrow(ArtifactError);
  });

  it('throws when title is empty', () => {
    expect(() =>
      createArtifact(sampleData(), {
        courseId: 'c1',
        kind: 'summary',
        title: '   ',
        hits: [sampleHit()],
      }),
    ).toThrow(ArtifactError);
  });
});
