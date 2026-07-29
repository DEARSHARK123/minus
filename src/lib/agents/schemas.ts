import { z } from 'zod';

/** IntentJudge output */
export const IntentJudgeOutputSchema = z.object({
  intent: z.enum(['chat', 'learn', 'desktop']),
  topic: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
  rationale: z.string().default('classified'),
  proposalSummary: z.string().default(''),
});

export type IntentJudgeOutput = z.infer<typeof IntentJudgeOutputSchema>;

/** MemoryAgent output */
export const MemoryAgentOutputSchema = z.object({
  entries: z.array(z.string()).default([]),
  summary: z.string().default('暂无长期记忆'),
});

export type MemoryAgentOutput = z.infer<typeof MemoryAgentOutputSchema>;

/** CalibrateAgent output */
export const CalibrateAgentOutputSchema = z.object({
  kind: z.enum(['single_choice', 'multi_choice', 'free_text']).default('single_choice'),
  question: z.string().min(1),
  options: z.array(z.string()).default([]),
});

export type CalibrateAgentOutput = z.infer<typeof CalibrateAgentOutputSchema>;

/** ResourceAgent output */
export const ResourceItemSchema = z.object({
  title: z.string().min(1),
  reason: z.string().default(''),
  source: z.literal('llm').default('llm'),
});

export const ResourceAgentOutputSchema = z.object({
  resources: z.array(ResourceItemSchema).min(1).max(6),
});

export type ResourceAgentOutput = z.infer<typeof ResourceAgentOutputSchema>;

/**
 * OutlineAgent unit — Zod is source of truth for shape.
 * Counts are adaptive. Technical limits only prevent empty or pathological payloads.
 */
export const OutlineUnitOutputSchema = z.object({
  title: z.string().min(1),
  knowledgePoints: z.array(z.string()).default([]),
  description: z.string().optional(),
  estimatedMinutes: z.number().positive().optional(),
});

export const OutlineAgentOutputSchema = z.object({
  goalTitle: z.string().min(1),
  /** Keep a generous technical ceiling; product quality is validated semantically. */
  units: z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(0, 12) : v),
    z.array(OutlineUnitOutputSchema).min(1).max(12),
  ),
});

export type OutlineUnitOutput = z.infer<typeof OutlineUnitOutputSchema>;
export type OutlineAgentOutput = z.infer<typeof OutlineAgentOutputSchema>;

/** ProgressNarrator output */
export const ProgressStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['pending', 'active', 'done']).default('pending'),
});

export const ProgressNarratorOutputSchema = z.object({
  title: z.string().default('学习进度'),
  content: z.string().default(''),
  steps: z.array(ProgressStepSchema).default([]),
});

export type ProgressNarratorOutput = z.infer<typeof ProgressNarratorOutputSchema>;
