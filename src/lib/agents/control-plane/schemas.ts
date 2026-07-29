import { z } from 'zod';

/** Product scene for skill routing (exhaustive). */
export const SceneIdSchema = z.enum([
  'chat',
  'planning',
  'outline',
  'session_teach',
  'session_recall',
  'session_assess',
  'session_remediate',
  'desktop',
  'memory',
  'settings',
]);

export type SceneId = z.infer<typeof SceneIdSchema>;

/** Coarse intent label carried on SceneContext. */
export const SceneIntentSchema = z.enum([
  'chat',
  'learn',
  'desktop',
  'teach',
  'greeting',
  'clarify',
  'plan',
  'other',
]);

export type SceneIntent = z.infer<typeof SceneIntentSchema>;

export const SceneContextSchema = z.object({
  scene: SceneIdSchema,
  intent: SceneIntentSchema,
  /** Learn / session stage label when relevant */
  stage: z.string().optional(),
  topic: z.string().optional(),
});

export type SceneContext = z.infer<typeof SceneContextSchema>;

export const SideEffectKindSchema = z.enum([
  'none',
  'prompt_only',
  'read',
  'write',
  'tool',
  'ui',
]);

export type SideEffectKind = z.infer<typeof SideEffectKindSchema>;

export const SkillManifestSchema = z.object({
  id: z.string().min(1),
  scenes: z.array(SceneIdSchema).min(1),
  intents: z.array(z.string()).default([]),
  conflictsWith: z.array(z.string()).default([]),
  sideEffects: SideEffectKindSchema.default('prompt_only'),
  maxCallsPerTurn: z.number().int().positive().default(1),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export const ResponseModeSchema = z.enum(['plain', 'teach', 'plan', 'tools']);

export type ResponseMode = z.infer<typeof ResponseModeSchema>;

export const OutputPolicySchema = z.object({
  responseMode: ResponseModeSchema,
  allowTeachFences: z.boolean(),
});

export type OutputPolicy = z.infer<typeof OutputPolicySchema>;

export const SkillBudgetSchema = z.object({
  maxSkillCalls: z.number().int().nonnegative(),
  maxTokensHint: z.number().int().positive().optional(),
});

export type SkillBudget = z.infer<typeof SkillBudgetSchema>;

/**
 * Supervisor plan: enabled + forbidden skills are both required.
 * `rationale` is the trigger reason for this plan.
 */
export const SkillPlanSchema = z.object({
  enabledSkills: z.array(z.string()),
  forbiddenSkills: z.array(z.string()),
  rationale: z.string().min(1),
  budget: SkillBudgetSchema,
  sideEffects: SideEffectKindSchema,
  outputPolicy: OutputPolicySchema,
});

export type SkillPlan = z.infer<typeof SkillPlanSchema>;
