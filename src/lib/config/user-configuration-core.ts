import { z } from 'zod';
import { SceneIdSchema } from '@/lib/agents/control-plane/schemas';

export const LOCKED_SKILL_IDS = ['workspace-files', 'risk-review'] as const;

export const SkillOverrideSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i),
  enabled: z.boolean().default(true),
  body: z.string().max(40_000).optional(),
  extraInstructions: z.string().max(10_000).default(''),
  scenes: z.array(SceneIdSchema).default([]),
  priority: z.number().int().min(-100).max(100).default(0),
  updatedAt: z.string().datetime(),
});

export const CustomSkillSchema = SkillOverrideSchema.extend({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  body: z.string().min(1).max(40_000),
});

export const UserPlaybookStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  description: z.string().max(1000).default(''),
  tool: z.string().max(100).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  order: z.number().int().min(0),
});

export const UserPlaybookSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).default(''),
  prompt: z.string().max(40_000).default(''),
  tools: z.array(z.string().max(100)).max(30).default([]),
  steps: z.array(UserPlaybookStepSchema).max(50).default([]),
  scenes: z.array(SceneIdSchema).default([]),
  enabled: z.boolean().default(true),
  source: z.enum(['builtin', 'custom']).default('custom'),
  updatedAt: z.string().datetime(),
});

export const AutomationTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('once'),
    runAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z.string().min(1).default('Asia/Shanghai'),
  }),
  z.object({
    type: z.literal('weekly'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
    timeZone: z.string().min(1).default('Asia/Shanghai'),
  }),
  z.object({
    type: z.literal('event'),
    event: z.enum(['course_completed', 'assessment_failed', 'course_idle']),
    courseId: z.string().optional(),
    idleMinutes: z.number().int().min(30).max(43_200).default(1440),
  }),
  z.object({
    type: z.literal('idle'),
    minutes: z.number().int().min(5).max(720).default(30),
  }),
]);

export const AutomationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reminder'),
    title: z.string().min(1).max(200),
    message: z.string().max(2000).default(''),
    courseId: z.string().optional(),
  }),
  z.object({
    type: z.literal('review_proposal'),
    courseId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent_task'),
    prompt: z.string().min(1).max(20_000),
    providerId: z.string().default('openai'),
    skillIds: z.array(z.string()).max(20).default([]),
    playbookId: z.string().optional(),
    courseId: z.string().optional(),
    webSearchMode: z.enum(['auto', 'always', 'off']).default('auto'),
  }),
  z.object({
    type: z.literal('profile_digest'),
    providerId: z.string().default('openai'),
    dailyLimit: z.number().int().min(1).max(10).default(1),
  }),
]);

export const AutomationRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(160),
  enabled: z.boolean().default(false),
  trigger: AutomationTriggerSchema,
  action: AutomationActionSchema,
  approvalPolicy: z.enum(['supervised', 'bounded_auto']).default('supervised'),
  catchUp: z.boolean().default(true),
  lastRunAt: z.string().datetime().optional(),
  lastRunKey: z.string().optional(),
  lastStatus: z.enum(['success', 'failed', 'pending_confirmation', 'skipped']).optional(),
  lastError: z.string().max(2000).optional(),
  failureCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).max(5).default(2),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AuditPolicySchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).nullable().default(90),
  redactLevel: z.enum(['standard', 'strict']).default('standard'),
  maxFileBytes: z.number().int().min(64 * 1024).max(100 * 1024 * 1024).default(5 * 1024 * 1024),
  optionalKinds: z.array(z.string().max(100)).max(100).default([]),
});

export const AutomationNoticeSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  title: z.string().min(1).max(200),
  message: z.string().max(20_000).default(''),
  status: z.enum(['info', 'success', 'pending_confirmation', 'error']).default('info'),
  courseId: z.string().optional(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().optional(),
});

export const UserConfigurationSchema = z.object({
  version: z.literal(1),
  skillOverrides: z.array(SkillOverrideSchema).default([]),
  customSkills: z.array(CustomSkillSchema).default([]),
  playbooks: z.array(UserPlaybookSchema).default([]),
  automations: z.array(AutomationRuleSchema).default([]),
  automationNotices: z.array(AutomationNoticeSchema).max(500).default([]),
  auditPolicy: AuditPolicySchema.default({
    retentionDays: 90,
    redactLevel: 'standard',
    maxFileBytes: 5 * 1024 * 1024,
    optionalKinds: [],
  }),
  networkAccess: z.enum(['allow', 'ask', 'off']).default('ask'),
  updatedAt: z.string().datetime(),
});

export type SkillOverride = z.infer<typeof SkillOverrideSchema>;
export type CustomSkill = z.infer<typeof CustomSkillSchema>;
export type UserPlaybook = z.infer<typeof UserPlaybookSchema>;
export type AutomationRule = z.infer<typeof AutomationRuleSchema>;
export type AuditPolicy = z.infer<typeof AuditPolicySchema>;
export type AutomationNotice = z.infer<typeof AutomationNoticeSchema>;
export type UserConfiguration = z.infer<typeof UserConfigurationSchema>;

export function defaultUserConfiguration(now = new Date().toISOString()): UserConfiguration {
  return UserConfigurationSchema.parse({
    version: 1,
    updatedAt: now,
  });
}

export function isLockedSkill(id: string): boolean {
  return (LOCKED_SKILL_IDS as readonly string[]).includes(id);
}
