/**
 * Batch-03: structured ClarificationSpec for one-field-at-a-time natural clarify.
 * Replaces free-form clarifyQuestionZh as the sole structured contract for options UI.
 */

import { z } from 'zod';

// ─── Zod schema ────────────────────────────────────────────────────────────

export const ClarificationFieldSchema = z.enum([
  'topic',
  'goal',
  'level',
  'intent_mode',
]);

export type ClarificationField = z.infer<typeof ClarificationFieldSchema>;

export const ClarificationSelectionModeSchema = z.enum(['single', 'multi']);

export type ClarificationSelectionMode = z.infer<
  typeof ClarificationSelectionModeSchema
>;

export const ClarificationOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export type ClarificationOption = z.infer<typeof ClarificationOptionSchema>;

export const ClarificationSpecSchema = z.object({
  field: ClarificationFieldSchema,
  question: z.string().min(1),
  options: z.array(ClarificationOptionSchema).default([]),
  selectionMode: ClarificationSelectionModeSchema.default('single'),
  allowCustom: z.boolean().default(false),
});

export type ClarificationSpec = z.infer<typeof ClarificationSpecSchema>;

// ─── Level options (product contract) ──────────────────────────────────────

export const LEVEL_CLARIFY_OPTIONS: ClarificationOption[] = [
  { id: 'level_zero', label: '零基础' },
  { id: 'level_some', label: '学过一点' },
  { id: 'level_basic', label: '能完成基础任务' },
  { id: 'level_advance', label: '想进阶' },
  { id: 'level_other', label: '其他' },
];

/** Default topic suggestion chips (allowCustom remains true). */
export const DEFAULT_TOPIC_CHIPS: ClarificationOption[] = [
  { id: 'topic_python', label: 'Python' },
  { id: 'topic_english', label: '英语' },
  { id: 'topic_math', label: '线性代数' },
  { id: 'topic_ml', label: '机器学习' },
  { id: 'topic_ts', label: 'TypeScript' },
];

// ─── Placeholder goal rejection ────────────────────────────────────────────

/**
 * Goals that look like filled slots but are not concrete subjects.
 * Used by extractGoalHint + planner knownGoal gate.
 */
const PLACEHOLDER_GOAL_EXACT = new Set(
  [
    '一个主题',
    '某个主题',
    '某主题',
    '某个领域',
    '某领域',
    '一个领域',
    '刚才的主题',
    '刚才主题',
    '一门课程',
    '某个课程',
    '一门课',
    '这个主题',
    '那个主题',
    '该主题',
    '主题',
    '课程',
    '领域',
    '随便',
    '都可以',
    '什么都行',
    '任意',
    'a topic',
    'some topic',
    'a course',
    'something',
  ].map((s) => s.toLowerCase()),
);

const PLACEHOLDER_GOAL_PHRASE_RE =
  /^(学习|想学|系统学习|深入学习|做)?\s*(一个主题|某个主题|某个领域|一门课程|一门课|刚才的主题|这个主题|那个主题)\s*$/i;

/**
 * True when text is an empty / generic placeholder, not a concrete learning goal.
 */
export function isPlaceholderGoal(text: string | null | undefined): boolean {
  if (text == null) return true;
  const t = text.trim();
  if (!t) return true;
  if (t.length < 2) return true;
  if (PLACEHOLDER_GOAL_EXACT.has(t.toLowerCase())) return true;
  if (PLACEHOLDER_GOAL_PHRASE_RE.test(t)) return true;
  // "学习一个主题" style mid-string exact placeholders after strip of learn verbs
  const stripped = t
    .replace(/^(我想|请帮我|帮我|请|如何|怎么|怎样)/, '')
    .replace(/^(学习|想学|系统学习|深入学习|掌握|入门)\s*/, '')
    .trim();
  if (stripped && PLACEHOLDER_GOAL_EXACT.has(stripped.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * Return concrete goal or null when placeholder / empty.
 */
export function sanitizeGoalCandidate(
  text: string | null | undefined,
): string | null {
  if (text == null) return null;
  const t = text.trim().slice(0, 80);
  if (!t || isPlaceholderGoal(t)) return null;
  return t;
}

// ─── Builders ──────────────────────────────────────────────────────────────

export function buildTopicClarificationSpec(opts?: {
  question?: string;
  chips?: ClarificationOption[];
}): ClarificationSpec {
  return ClarificationSpecSchema.parse({
    field: 'topic',
    question:
      opts?.question || '你想系统学习哪个主题？选一个建议，或自己写一句话。',
    options: opts?.chips ?? DEFAULT_TOPIC_CHIPS,
    selectionMode: 'single',
    allowCustom: true,
  });
}

export function buildGoalClarificationSpec(opts?: {
  question?: string;
}): ClarificationSpec {
  return ClarificationSpecSchema.parse({
    field: 'goal',
    question:
      opts?.question ||
      '你的具体学习目标是什么？用一句话描述想掌握的内容（不要只写「一个主题」）。',
    options: [],
    selectionMode: 'single',
    allowCustom: true,
  });
}

export function buildLevelClarificationSpec(topic?: string): ClarificationSpec {
  const label = topic?.trim() ? `「${topic.trim()}」` : '这个主题';
  return ClarificationSpecSchema.parse({
    field: 'level',
    question: `关于${label}，你目前大概是什么基础？`,
    options: LEVEL_CLARIFY_OPTIONS,
    selectionMode: 'single',
    allowCustom: true,
  });
}

/** Low-confidence intent: quick one-shot vs systematic plan. */
export function buildIntentModeClarificationSpec(knownGoal?: string | null): ClarificationSpec {
  const q = knownGoal
    ? `关于「${knownGoal}」，你更想先听一版简明讲解，还是做系统学习计划？`
    : '你更想先快速弄懂一个概念，还是做一份可跟进的学习计划？';
  return ClarificationSpecSchema.parse({
    field: 'intent_mode',
    question: q,
    options: [
      { id: 'intent_quick', label: '先简明讲解' },
      { id: 'intent_plan', label: '做系统学习计划' },
    ],
    selectionMode: 'single',
    allowCustom: false,
  });
}

/**
 * Map ClarificationSpec → LearnArtifact kind for UI cards.
 */
export function clarificationSpecToArtifactKind(
  spec: ClarificationSpec,
): 'single_choice' | 'multi_choice' | 'free_text' {
  if (spec.selectionMode === 'multi') return 'multi_choice';
  if (spec.options.length === 0 && spec.allowCustom) return 'free_text';
  return 'single_choice';
}

/** Human-readable field title for cards. */
export function clarificationFieldTitle(field: ClarificationField): string {
  switch (field) {
    case 'topic':
      return '选择主题';
    case 'goal':
      return '明确目标';
    case 'level':
      return '基础水平';
    case 'intent_mode':
      return '你更想怎样';
    default: {
      const _e: never = field;
      return _e;
    }
  }
}

/**
 * Short non-planning utterances that must not restart Deep planning.
 */
export function isNonPlanningShortMessage(message: string): boolean {
  const t = (message || '').trim();
  if (!t) return true;
  if (
    /^(你好|您好|哈喽|嗨|hi|hello|hey)([\s!！。.~～?]*)?$/i.test(t)
  ) {
    return true;
  }
  if (
    t.length <= 12 &&
    /^(好的?|嗯+|哦+|行|可以|知道了|明白了|谢谢|多谢|ok|okay|yes|yep|yeah|收到|了解)([\s!！。.~～]*)?$/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}
