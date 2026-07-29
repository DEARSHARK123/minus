import type { LearningData, SearchHit } from '@/types/learning';
import { BM25Index } from './bm25';

export type SearchOptions = {
  courseId: string;
  query: string;
  /** Max hits to return (default 20). */
  limit?: number;
};

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchError';
  }
}

/**
 * BM25-ranked search over document chunks, strictly isolated by courseId.
 * Returns documentId/title/chunkIndex/snippet/score.
 */
export function searchDocuments(data: LearningData, options: SearchOptions): SearchHit[] {
  const courseId = options.courseId?.trim();
  if (!courseId) {
    throw new SearchError('courseId is required for search isolation');
  }

  const query = (options.query ?? '').trim();
  if (!query) {
    return [];
  }

  const limit = options.limit ?? 20;
  const index = new BM25Index(data, courseId);
  return index.search(query, limit);
}
