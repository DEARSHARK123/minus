/**
 * Memory pipeline: extract → classify → dedupe → conflict detect → merge.
 *
 * Greetings / one-off trivia must not create memories (prompt + post-filter).
 */

import { randomUUID } from 'crypto';
import {
  readLearnerMemory,
  writeMergedMemories,
  type AiMemoryCandidate,
  type LearnerMemoryData,
  type MemoryEvidence,
  type MemoryKind,
} from './learner-memory';

/** Greeting / social-only turns that must never produce memories. */
export function isGreetingOnlyTranscript(
  messages: Array<{ role: string; content: string }>,
): boolean {
  const userTexts = messages
    .filter((m) => m.role === 'user')
    .map((m) => (m.content || '').trim())
    .filter(Boolean);
  if (userTexts.length === 0) return true;
  return userTexts.every((t) => isGreetingOrTriviaText(t));
}

/**
 * Greetings and one-off trivia that should not become long-term memory.
 */
export function isGreetingOrTriviaText(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  if (t.length > 80) return false;

  const greetingOnly =
    /^(你好|您好|嗨|哈喽|hello|hi|hey|good\s*(morning|afternoon|evening)|早上好|下午好|晚上好|在吗|谢谢|多谢|ok|okay|好的|嗯|哦)([\s，,!！.。~～？?\u2026…]*)$/i;
  if (greetingOnly.test(t)) return true;

  // Ultra-short acknowledgements without preference signal
  if (t.length <= 4 && !/[想要希望喜欢偏好目标学习]/.test(t)) return true;

  return false;
}

/** Drop candidate texts that look like greetings / trivia / empty. */
export function postFilterExtractedTexts(texts: string[]): string[] {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .filter((t) => !isGreetingOrTriviaText(t))
    .filter((t) => !isOneOffTrivia(t));
}

function isOneOffTrivia(text: string): boolean {
  // Pure weather / time / joke style one-offs without learning signal
  if (/^(今天|明天).{0,12}(天气|星期|几号)/.test(text)) return true;
  if (/^(讲个笑话|讲笑话|测试一下|test)$/i.test(text)) return true;
  return false;
}

export function classifyMemoryKind(text: string, hinted?: MemoryKind): MemoryKind {
  if (hinted) return hinted;
  const t = text.toLowerCase();
  if (/目标|想学|要掌握|准备考|计划|希望学会/.test(t)) return 'goal';
  if (/喜欢|偏好|更爱|不要|风格|习惯|方式/.test(t)) return 'preference';
  if (/是|在读|职业|专业|年级|背景/.test(t)) return 'fact';
  return 'preference';
}

function normalizeKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s，,。.!！?？、；;：:""''「」【】()（）]/g, '');
}

/** Similarity: exact normalize match or high character overlap. */
export function textsAreDuplicate(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return shorter >= 6 && shorter / longer >= 0.75;
  }
  // Bigram Jaccard for near-duplicates
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return inter / union >= 0.72;
}

/** Detect opposing preference / goal statements. */
export function textsConflict(a: string, b: string): boolean {
  const pair = (x: string, y: string) => {
    const nx = normalizeKey(x);
    const ny = normalizeKey(y);
    // "喜欢A" vs "不喜欢A" / "讨厌A"
    const pos = /喜欢|偏好|更爱|想要|希望/.exec(x);
    const neg = /不喜欢|讨厌|不要|避免|不想/.exec(y);
    if (pos && neg) {
      // Same topic token after verb
      const topicX = nx.replace(/喜欢|偏好|更爱|想要|希望|不|讨厌|避免/g, '');
      const topicY = ny.replace(/喜欢|偏好|更爱|想要|希望|不|讨厌|避免/g, '');
      if (topicX && topicY && (topicX.includes(topicY) || topicY.includes(topicX))) {
        return true;
      }
    }
    return false;
  };
  return pair(a, b) || pair(b, a);
}

export interface PipelineCandidate {
  text: string;
  kind: MemoryKind;
  confidence: number;
  evidence: MemoryEvidence[];
  sensitive: boolean;
}

export function classifyCandidates(
  raw: AiMemoryCandidate[],
): PipelineCandidate[] {
  return raw
    .map((c) => {
      const text = (c.text || '').trim();
      return {
        text,
        kind: classifyMemoryKind(text, c.kind),
        confidence:
          typeof c.confidence === 'number' && Number.isFinite(c.confidence)
            ? Math.max(0, Math.min(1, c.confidence))
            : 0.7,
        evidence: Array.isArray(c.evidence) ? c.evidence : [],
        sensitive: c.sensitive === true,
      };
    })
    .filter((c) => c.text.length >= 4)
    .filter((c) => !isGreetingOrTriviaText(c.text))
    .filter((c) => !isOneOffTrivia(c.text));
}

/** Dedupe within candidates (keep higher confidence). */
export function dedupeCandidates(candidates: PipelineCandidate[]): PipelineCandidate[] {
  const out: PipelineCandidate[] = [];
  for (const c of candidates) {
    const idx = out.findIndex((o) => textsAreDuplicate(o.text, c.text));
    if (idx < 0) {
      out.push(c);
      continue;
    }
    if (c.confidence > out[idx]!.confidence) {
      out[idx] = {
        ...c,
        evidence: [...out[idx]!.evidence, ...c.evidence].slice(0, 8),
      };
    } else {
      out[idx] = {
        ...out[idx]!,
        evidence: [...out[idx]!.evidence, ...c.evidence].slice(0, 8),
      };
    }
  }
  return out;
}

/**
 * Merge candidates into store:
 * - duplicate of existing → bump lastObservedAt / evidence / confidence
 * - conflict with confirmed → mark both conflicted (candidate stored as conflicted)
 * - new → proposed
 */
export function mergeCandidatesIntoStore(
  store: LearnerMemoryData,
  candidates: PipelineCandidate[],
  now = new Date().toISOString(),
): LearnerMemoryData {
  const memories = [...store.memories];
  const classified = dedupeCandidates(classifyCandidates(candidates));

  for (const c of classified) {
    // Skip if exact reject already exists with same text
    const rejectedDup = memories.find(
      (m) => m.status === 'rejected' && textsAreDuplicate(m.text, c.text),
    );
    if (rejectedDup) continue;

    const dupIdx = memories.findIndex(
      (m) =>
        m.status !== 'rejected' &&
        m.status !== 'expired' &&
        textsAreDuplicate(m.text, c.text),
    );

    if (dupIdx >= 0) {
      const prev = memories[dupIdx]!;
      memories[dupIdx] = {
        ...prev,
        confidence: Math.min(1, Math.max(prev.confidence, c.confidence)),
        evidence: [...prev.evidence, ...c.evidence].slice(0, 12),
        lastObservedAt: now,
        updatedAt: now,
        // Keep confirmed; proposed stays proposed
        status: prev.status === 'confirmed' ? 'confirmed' : prev.status,
      };
      continue;
    }

    // Conflict with any active confirmed preference/goal
    const conflictTarget = memories.find(
      (m) =>
        (m.status === 'confirmed' || m.status === 'proposed') &&
        textsConflict(m.text, c.text),
    );

    if (conflictTarget) {
      const tIdx = memories.findIndex((m) => m.id === conflictTarget.id);
      if (tIdx >= 0) {
        memories[tIdx] = {
          ...memories[tIdx]!,
          status: 'conflicted',
          updatedAt: now,
        };
      }
      memories.unshift({
        id: randomUUID(),
        text: c.text,
        source: 'ai',
        kind: c.kind,
        confidence: c.confidence,
        evidence: c.evidence,
        firstObservedAt: now,
        lastObservedAt: now,
        status: 'conflicted',
        sensitive: c.sensitive,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    memories.unshift({
      id: randomUUID(),
      text: c.text,
      source: 'ai',
      kind: c.kind,
      confidence: c.confidence,
      evidence: c.evidence,
      firstObservedAt: now,
      lastObservedAt: now,
      status: 'proposed',
      sensitive: c.sensitive,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { ...store, memories };
}

/** Full storage merge used by appendAiMemories / extractFromChat. */
export async function mergeAiMemoryCandidates(
  candidates: AiMemoryCandidate[],
): Promise<LearnerMemoryData> {
  const current = await readLearnerMemory();
  const next = mergeCandidatesIntoStore(current, candidates as PipelineCandidate[]);
  return writeMergedMemories(next);
}

/**
 * Append AI-extracted memories as `proposed` (after classify → dedupe → conflict → merge).
 * Accepts plain strings (legacy) or structured candidates.
 */
export async function appendAiMemories(
  texts: string[] | AiMemoryCandidate[],
): Promise<LearnerMemoryData> {
  const candidates: AiMemoryCandidate[] = texts.map((t) =>
    typeof t === 'string'
      ? { text: t, kind: 'preference' as const, confidence: 0.7 }
      : t,
  );
  return mergeAiMemoryCandidates(candidates);
}

/** System prompt fragment for LLM extract (Chinese). */
export const MEMORY_EXTRACT_SYSTEM = `你是 Minus 的记忆提炼器。从对话中提取用户**可复用的学习相关**偏好、目标与背景事实。

规则：
1. 只提取稳定、可验证、对后续学习/对话有用的信息。
2. **禁止**提取：问候语（你好/hi）、一次性寒暄、玩笑、天气闲聊、无偏好含义的短确认。
3. 无有效信息时返回 {"items":[]}。
4. 返回 JSON（不要 markdown）：
{
  "items": [
    {
      "text": "中文短句",
      "kind": "preference" | "goal" | "fact" | "other",
      "confidence": 0.0-1.0,
      "quote": "支撑该条的用户原话摘录（可选）",
      "sensitive": false
    }
  ]
}
最多 5 条。sensitive=true 表示含隐私（真实姓名住址证件等），默认 false。`;
