import type { Citation, LearningData } from '@/types/learning';

export type CitationValidationError = {
  citation: Citation;
  message: string;
};

export type CitationValidationResult = {
  valid: boolean;
  errors: CitationValidationError[];
};

export class CitationError extends Error {
  readonly errors: CitationValidationError[];

  constructor(message: string, errors: CitationValidationError[]) {
    super(message);
    this.name = 'CitationError';
    this.errors = errors;
  }
}

export type CitationValidationOptions = {
  /** When provided, citations must point at a document inside this course. */
  courseId?: string;
};

/**
 * Validate a single citation against the learning data store.
 *
 * A citation resolves successfully when:
 * - its documentId points to an existing SourceDocument, and
 * - its chunkIndex exists in that document's chunks.
 *
 * If `courseId` is supplied, the document must also belong to that course.
 */
export function validateCitation(
  data: LearningData,
  citation: Citation,
  options?: CitationValidationOptions,
): { valid: true } | { valid: false; message: string } {
  const doc = data.documents.find((d) => d.id === citation.documentId);
  if (!doc) {
    return { valid: false, message: `Document ${citation.documentId} not found` };
  }

  if (options?.courseId && doc.courseId !== options.courseId) {
    return {
      valid: false,
      message: `Document ${citation.documentId} does not belong to course ${options.courseId}`,
    };
  }

  const chunk = doc.chunks.find((c) => c.index === citation.chunkIndex);
  if (!chunk) {
    return {
      valid: false,
      message: `Chunk ${citation.chunkIndex} not found in document ${citation.documentId}`,
    };
  }

  return { valid: true };
}

/**
 * Validate a batch of citations.
 *
 * Returns all failures so callers can surface every bad citation at once.
 */
export function validateCitations(
  data: LearningData,
  citations: Citation[],
  options?: CitationValidationOptions,
): CitationValidationResult {
  const errors: CitationValidationError[] = [];
  for (const citation of citations) {
    const result = validateCitation(data, citation, options);
    if (!result.valid) {
      errors.push({ citation, message: result.message });
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Convenience wrapper that throws a CitationError when any citation fails.
 */
export function assertCitationsValid(
  data: LearningData,
  citations: Citation[],
  options?: CitationValidationOptions,
): void {
  const result = validateCitations(data, citations, options);
  if (!result.valid) {
    throw new CitationError('One or more citations could not be resolved', result.errors);
  }
}
