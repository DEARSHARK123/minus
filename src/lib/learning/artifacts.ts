import { assertCitationsValid } from './citation';
import {
  ArtifactSchema,
  newId,
  nowIso,
  type Artifact,
  type ArtifactKind,
  type Citation,
  type LearningData,
  type SearchHit,
} from '@/types/learning';

export type ArtifactInput = {
  courseId: string;
  sessionId?: string;
  taskId?: string;
  kind: ArtifactKind;
  title: string;
  /** Source hits used to build the artifact; citations are derived from hits. */
  hits: SearchHit[];
};

export class ArtifactError extends Error {
  readonly code: string;

  constructor(message: string, code = 'ARTIFACT_ERROR') {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
  }
}

/**
 * Factory for cited learning artifacts.
 *
 * Every artifact must carry at least one citation derived from real search hits.
 * Citations are validated against course documents before the artifact is built.
 */
export function createArtifact(
  data: LearningData,
  input: ArtifactInput,
): Artifact {
  const courseId = input.courseId?.trim();
  if (!courseId) {
    throw new ArtifactError('courseId is required', 'INVALID_INPUT');
  }

  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new ArtifactError(`Course not found: ${courseId}`, 'NOT_FOUND');
  }

  if (!input.title.trim()) {
    throw new ArtifactError('title is required', 'INVALID_INPUT');
  }

  if (input.hits.length === 0) {
    throw new ArtifactError(
      'At least one search hit is required to build a cited artifact',
      'INVALID_INPUT',
    );
  }

  const citations: Citation[] = input.hits.map((hit) => ({
    documentId: hit.documentId,
    chunkIndex: hit.chunkIndex,
    excerpt: hit.snippet.slice(0, 200),
  }));

  try {
    assertCitationsValid(data, citations, { courseId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid citations';
    throw new ArtifactError(message, 'INVALID_CITATION');
  }

  const content = buildArtifactContent(input.kind, input.title, input.hits);

  const ts = nowIso();
  return ArtifactSchema.parse({
    id: newId(),
    courseId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    kind: input.kind,
    title: input.title.trim(),
    content,
    citations,
    createdAt: ts,
    updatedAt: ts,
  });
}

function buildArtifactContent(
  kind: ArtifactKind,
  title: string,
  hits: SearchHit[],
): string {
  switch (kind) {
    case 'summary':
      return buildSummary(title, hits);
    case 'flashcard':
      return buildFlashcards(title, hits);
    case 'quiz':
      return buildQuiz(title, hits);
    default: {
      const _exhaustive: never = kind;
      throw new ArtifactError(`Unknown artifact kind: ${_exhaustive}`, 'INVALID_INPUT');
    }
  }
}

function buildSummary(title: string, hits: SearchHit[]): string {
  const lines = [
    `# ${title}`,
    '',
    'Generated from cited source snippets:',
    '',
    ...hits.map(
      (hit, i) =>
        `${i + 1}. ${hit.snippet.trim()}\n   — ${hit.title} · chunk ${hit.chunkIndex}`,
    ),
  ];
  return lines.join('\n');
}

function buildFlashcards(title: string, hits: SearchHit[]): string {
  const lines = [`# ${title}`, ''];
  for (const hit of hits.slice(0, 5)) {
    const [question, answer] = makeQuestionAnswer(hit.snippet);
    lines.push(`Q: ${question}`);
    lines.push(`A: ${answer}`);
    lines.push(`Source: ${hit.title} · chunk ${hit.chunkIndex}`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildQuiz(title: string, hits: SearchHit[]): string {
  const lines = [`# ${title}`, ''];
  for (const hit of hits.slice(0, 5)) {
    const [question, answer] = makeQuestionAnswer(hit.snippet);
    lines.push(`- ${question}`);
    lines.push(`  Answer: ${answer}`);
    lines.push(`  Source: ${hit.title} · chunk ${hit.chunkIndex}`);
    lines.push('');
  }
  return lines.join('\n');
}

function makeQuestionAnswer(snippet: string): [string, string] {
  const trimmed = snippet.trim();
  const sentences = trimmed
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 10);

  if (sentences.length >= 2) {
    const question = `Explain: ${sentences[0]!.slice(0, 120)}...`;
    const answer = sentences[1]!.slice(0, 240);
    return [question, answer];
  }

  const question = `What does the following describe? "${trimmed.slice(0, 80)}..."`;
  return [question, trimmed.slice(0, 240)];
}
