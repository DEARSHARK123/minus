import type { LearningData, SearchHit } from '@/types/learning';

export const K1 = 1.5;
export const B = 0.75;
export const TITLE_REPEATS = 3;
export const DEFAULT_SNIPPET_LEN = 160;

// Small English stop-word set. CJK queries still work because we tokenise
// by letter/number runs and only filter the common English fillers.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'as', 'it', 'its', 'this', 'that', 'these', 'those',
]);

export type Token = string;

/**
 * Tokenise a query or document into normalised terms.
 *
 * - Unicode letter/number runs are kept as single tokens (handles English
 *   words and CJK character runs without an external segmenter).
 * - Lower-cased.
 * - Common English stop words are dropped.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const t = match[0].toLowerCase();
    if (t.length >= 1 && !STOP_WORDS.has(t)) {
      tokens.push(t);
    }
  }
  return tokens;
}

type IndexedChunk = {
  documentId: string;
  title: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  termFreq: Map<Token, number>;
};

/**
 * BM25 index over the chunks of a single course.
 *
 * The document title is repeated a few times and folded into the indexed text
 * so title matches receive a natural TF boost without a special scoring path.
 */
export class BM25Index {
  private readonly docs: IndexedChunk[];
  private readonly N: number;
  private readonly avgdl: number;
  private readonly df: Map<Token, number>;

  constructor(data: LearningData, courseId: string) {
    const docsInCourse = data.documents.filter((d) => d.courseId === courseId);

    let totalTokens = 0;
    this.docs = [];

    for (const doc of docsInCourse) {
      const titlePrefix = Array.from({ length: TITLE_REPEATS }, () => doc.title).join(' ');
      for (const chunk of doc.chunks) {
        const indexedText = `${titlePrefix}\n${chunk.text}`;
        const tokens = tokenize(indexedText);
        const tokenCount = tokens.length;
        const termFreq = new Map<Token, number>();
        for (const t of tokens) {
          termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
        }
        this.docs.push({
          documentId: doc.id,
          title: doc.title,
          chunkIndex: chunk.index,
          text: chunk.text,
          tokenCount,
          termFreq,
        });
        totalTokens += tokenCount;
      }
    }

    this.N = this.docs.length;
    this.avgdl = this.N > 0 ? totalTokens / this.N : 1;

    this.df = new Map<Token, number>();
    for (const doc of this.docs) {
      for (const t of doc.termFreq.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
    }
  }

  /**
   * Score every chunk in the course against the query and return the top
   * `limit` hits sorted by descending BM25 score.
   */
  search(query: string, limit = 20): SearchHit[] {
    const qTokens = tokenize(query);
    if (this.N === 0 || qTokens.length === 0) {
      return [];
    }

    const hits: SearchHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const q of qTokens) {
        const df = this.df.get(q) ?? 0;
        if (df === 0) continue;
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const freq = doc.termFreq.get(q) ?? 0;
        const denom = freq + K1 * (1 - B + B * (doc.tokenCount / this.avgdl));
        score += (idf * freq * (K1 + 1)) / denom;
      }
      if (score > 0) {
        hits.push({
          documentId: doc.documentId,
          title: doc.title,
          chunkIndex: doc.chunkIndex,
          snippet: buildSnippet(doc.text, query, DEFAULT_SNIPPET_LEN),
          score: Math.round(score * 10000) / 10000,
        });
      }
    }

    hits.sort(
      (a, b) =>
        b.score - a.score ||
        a.documentId.localeCompare(b.documentId) ||
        a.chunkIndex - b.chunkIndex,
    );
    return hits.slice(0, limit);
  }
}

function buildSnippet(text: string, query: string, maxLen: number): string {
  if (!text) return '';

  const lowerText = text.toLowerCase();
  const normalisedQuery = query.trim().toLowerCase();
  let at = normalisedQuery ? lowerText.indexOf(normalisedQuery) : -1;
  let matchLen = normalisedQuery.length;

  if (at < 0) {
    const firstToken = tokenize(query)[0];
    if (firstToken) {
      at = lowerText.indexOf(firstToken);
      matchLen = firstToken.length;
    }
  }

  if (at < 0) {
    return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
  }

  const clampedMatchLen = Math.min(matchLen, maxLen);
  const pad = Math.floor((maxLen - clampedMatchLen) / 2);
  let start = Math.max(0, at - pad);
  let end = Math.min(text.length, at + clampedMatchLen + pad);
  if (end - start < maxLen) {
    end = Math.min(text.length, start + maxLen);
    start = Math.max(0, end - maxLen);
  }

  let snippet = text.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}
