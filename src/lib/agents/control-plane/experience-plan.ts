/**
 * UX02 — Experience Planner
 *
 * Dynamic routing for Chat / Normal / Deep / Calendar / Library / Desktop.
 * Replaces the fixed ten-stage funnel for Chat/Normal.
 * `internalReason` is audit-only and must never be rendered in primary UI.
 */

import { z } from 'zod';
import {
  SceneIdSchema,
  type SceneContext,
  type SceneId,
  type SkillPlan,
} from './schemas';
import { buildSkillPlan } from './skill-router';
import {
  buildIntentModeClarificationSpec,
  buildLevelClarificationSpec,
  buildTopicClarificationSpec,
  ClarificationSpecSchema,
  isNonPlanningShortMessage,
  sanitizeGoalCandidate,
  type ClarificationSpec,
} from './clarification-spec';

// ─── Schemas ───────────────────────────────────────────────────────────────

export const ExperienceModeSchema = z.enum([
  'chat',
  'normal',
  'deep_planning',
  'deep_course',
  'calendar',
  'library',
  'desktop',
]);

export type ExperienceMode = z.infer<typeof ExperienceModeSchema>;

/**
 * Atomic experience steps the planner can require / skip.
 * Not the same as the Deep Course teaching state machine stages.
 */
export const ExperienceStepSchema = z.enum([
  'direct_answer',
  'natural_clarify',
  'memory',
  'calibration',
  'resources',
  'outline',
  'deep_confirm',
  'start_session',
  'desktop_loop',
  'calendar_plan',
  'library_assist',
  'course_teach',
]);

export type ExperienceStep = z.infer<typeof ExperienceStepSchema>;

export const ExperienceNextActionSchema = z.enum([
  'stream_chat',
  'natural_clarify',
  'run_outline',
  'run_memory',
  'run_calibration',
  'run_resources',
  'run_desktop',
  'calendar_propose',
  'library_assist',
  'deep_course_advance',
  'await_user',
]);

export type ExperienceNextAction = z.infer<typeof ExperienceNextActionSchema>;

/**
 * Commit / side-effect policy for this plan.
 * Does not weaken B03/B04 HITL — tool side effects still policy-gated.
 */
export const ExperienceCommitPolicySchema = z.enum([
  /** No course/calendar/library write */
  'none',
  /** Preview artifacts only (outline propose ≠ course commit) */
  'propose_only',
  /** User must explicitly confirm before course/session write */
  'explicit_confirm',
  /** Tool / host side effects go through policy + HITL */
  'policy_gated',
]);

export type ExperienceCommitPolicy = z.infer<typeof ExperienceCommitPolicySchema>;

export const ExperiencePlanSchema = z.object({
  mode: ExperienceModeSchema,
  requiredSteps: z.array(ExperienceStepSchema),
  optionalSteps: z.array(ExperienceStepSchema),
  skippedSteps: z.array(ExperienceStepSchema),
  /** Visible product surface / route key (e.g. chat, course, calendar). */
  surface: z.string().min(1),
  nextAction: ExperienceNextActionSchema,
  commitPolicy: ExperienceCommitPolicySchema,
  confidence: z.number().min(0).max(1),
  /**
   * Audit-only internal rationale. NEVER render in primary UI
   * (see natural-ux-copy-contract.md).
   */
  internalReason: z.string().min(1),
  /**
   * @deprecated Prefer clarificationSpec; kept for backward-compatible public meta.
   * At most one natural Chinese clarifying question when nextAction=natural_clarify.
   */
  clarifyQuestionZh: z.string().optional(),
  /**
   * Structured one-field clarification (topic | goal | level | intent_mode).
   * Only one field per plan turn.
   */
  clarificationSpec: ClarificationSpecSchema.optional(),
  topic: z.string().optional(),
  /** Bridge to existing SkillPlan router. */
  skillScene: SceneIdSchema.optional(),
});

export type ExperiencePlan = z.infer<typeof ExperiencePlanSchema>;

// ─── Input ─────────────────────────────────────────────────────────────────

export type ExperienceSurface =
  | 'chat'
  | 'course'
  | 'calendar'
  | 'library'
  | 'history'
  | 'desktop'
  | 'settings'
  | string;

export interface ExperienceContextPackHint {
  empty: boolean;
  summaryLine?: string;
  entries?: Array<{ text: string; kind?: string; confidence?: number }>;
  labeledBlock?: string;
}

export interface PlanExperienceInput {
  message: string;
  surface?: ExperienceSurface;
  contextPack?: ExperienceContextPackHint | null;
  knownGoal?: string | null;
  knownLevel?: string | null;
  /** Coarse intent from IntentJudge when available. */
  intent?: 'chat' | 'learn' | 'desktop' | string | null;
  confidence?: number | null;
  /** Explicit Normal / Deep control from UI (if any). */
  userModePreference?: 'normal' | 'deep' | null;
  /** True when user asked for materials / reading list. */
  wantsResources?: boolean | null;
  /** Active Deep Course stage (compat with learn-state-machine). */
  courseStage?: string | null;
  /**
   * Prior experience mode for this conversation (prevents greeting/short
   * sentences from restarting Deep planning).
   */
  experienceMode?: string | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const LOW_CONFIDENCE = 0.55;

const ALL_PLANNING_STEPS: ExperienceStep[] = [
  'memory',
  'calibration',
  'resources',
  'outline',
  'deep_confirm',
  'start_session',
];

// ─── Heuristics (deterministic; no production regex intent as sole classifier) ─

const ONE_SHOT_RE =
  /^(什么是|什么叫|what's|what\s+is|what\s+are|解释一下|简述|简要说明|帮我解释|为什么|为啥|how\s+does|how\s+do|why\s+)/i;

const ONE_SHOT_SOFT_RE =
  /(是什么意思|怎么理解|有什么区别|区别是什么|举例说明)/i;

const EXPLICIT_DEEP_RE =
  /(深入学习|系统学习|系统学|完整大纲|学习大纲|做(一门|个)?课程|deep\s*(mode|learning)?|生成.*大纲|规划.*学习路径|学习路径|开课|做成课程)/i;

const CALENDAR_RE =
  /(安排日程|日程安排|学习计划.*(周|月)|这(周|月).*学|排期|日历|什么时候学|时间表)/i;

const LIBRARY_RE =
  /(资料库|打开.*文档|上传.*文件|我的文件|阅读这份|用这份资料)/i;

const DESKTOP_RE =
  /(运行命令|改(一下|本地)?文件|执行脚本|跑(一下)?测试|sandbox|在项目里|写代码到|打开终端)/i;

const RESOURCE_WANT_RE =
  /(推荐.*资料|学习资料|参考资料|教材|书单|视频课程|资源列表|阅读清单)/i;

const LEVEL_RE =
  /(零基础|完全不会|初学|入门|小白|中等基础|有(一点|些)?基础|学过|复过|进阶|高级|熟练)/i;

// Longer verb phrases first so「想学习」does not match as「想学」+「习…」
const LEARN_GOAL_RE =
  /(想学习|系统学习|深入学习|学习|想学|掌握|入门|备考|复习|教我|系统梳理)\s*([^\s,，。！？!?]{1,40})/;

const GREETING_RE =
  /^(你好|您好|哈喽|嗨|hi|hello|hey)([\s!！。.~～?]*)?$/i;

function normalizeSurface(surface?: string | null): string {
  const s = (surface || 'chat').trim().toLowerCase();
  if (!s) return 'chat';
  if (s === '/' || s === '/chat' || s === 'home') return 'chat';
  if (s.startsWith('/course') || s === 'session' || s === 'course') return 'course';
  if (s.startsWith('/calendar') || s === 'calendar') return 'calendar';
  if (s.startsWith('/library') || s === 'library') return 'library';
  if (s.startsWith('/history') || s === 'history') return 'history';
  if (s === 'desktop') return 'desktop';
  if (s === 'settings') return 'settings';
  return s.replace(/^\//, '') || 'chat';
}

/** Extract a level hint from free text when present. */
export function extractLevelHint(text: string): string | null {
  const m = text.match(LEVEL_RE);
  return m ? m[0]! : null;
}

/** Extract a short goal/topic hint from free text when present. Rejects placeholders. */
export function extractGoalHint(text: string, fallbackTopic?: string | null): string | null {
  if (fallbackTopic && fallbackTopic.trim()) {
    return sanitizeGoalCandidate(fallbackTopic);
  }
  const m = text.match(LEARN_GOAL_RE);
  if (m?.[2]) return sanitizeGoalCandidate(m[2]!.trim());
  // Whole message as topic only when it is a concrete noun phrase under deep ask
  return null;
}

export {
  isPlaceholderGoal,
  sanitizeGoalCandidate,
  isNonPlanningShortMessage,
  ClarificationSpecSchema,
  type ClarificationSpec,
} from './clarification-spec';

function looksLikeOneShot(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 120) return false;
  if (EXPLICIT_DEEP_RE.test(t)) return false;
  if (ONE_SHOT_RE.test(t) || ONE_SHOT_SOFT_RE.test(t)) return true;
  // Short conceptual question ending with ? without learn journey verbs
  if (
    t.length <= 40 &&
    /[?？]$/.test(t) &&
    !/(想学|系统|课程|大纲|路径|计划)/.test(t)
  ) {
    return true;
  }
  return false;
}

function isExplicitDeep(
  message: string,
  userModePreference?: 'normal' | 'deep' | null,
): boolean {
  if (userModePreference === 'deep') return true;
  return EXPLICIT_DEEP_RE.test(message);
}

function wantsResourceList(message: string, flag?: boolean | null): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return RESOURCE_WANT_RE.test(message);
}

function packSuggestsGoal(
  pack?: ExperienceContextPackHint | null,
): string | null {
  if (!pack || pack.empty) return null;
  const goalEntry = pack.entries?.find(
    (e) => e.kind === 'goal' || /目标|想学|学习/.test(e.text),
  );
  if (goalEntry?.text) return goalEntry.text.slice(0, 80);
  if (pack.summaryLine && /想学|目标|学习/.test(pack.summaryLine)) {
    return pack.summaryLine.slice(0, 80);
  }
  return null;
}

function packSuggestsLevel(
  pack?: ExperienceContextPackHint | null,
): string | null {
  if (!pack || pack.empty) return null;
  const levelEntry = pack.entries?.find(
    (e) => e.kind === 'level' || /基础|水平|零基础|入门|进阶/.test(e.text),
  );
  if (levelEntry?.text) return levelEntry.text.slice(0, 80);
  const fromSummary = pack.summaryLine?.match(LEVEL_RE);
  return fromSummary ? fromSummary[0]! : null;
}

function uniqueSteps(steps: ExperienceStep[]): ExperienceStep[] {
  return Array.from(new Set(steps));
}

function finalize(partial: ExperiencePlan): ExperiencePlan {
  return ExperiencePlanSchema.parse({
    ...partial,
    requiredSteps: uniqueSteps(partial.requiredSteps),
    optionalSteps: uniqueSteps(partial.optionalSteps),
    skippedSteps: uniqueSteps(partial.skippedSteps),
  });
}

function skillSceneForMode(mode: ExperienceMode): SceneId {
  switch (mode) {
    case 'chat':
      return 'chat';
    case 'normal':
      return 'chat';
    case 'deep_planning':
      return 'outline';
    case 'deep_course':
      return 'session_teach';
    case 'desktop':
      return 'desktop';
    case 'calendar':
      return 'planning';
    case 'library':
      return 'memory';
    default:
      return 'chat';
  }
}

/**
 * Build SkillPlan for an ExperiencePlan. Preserves enabled/forbidden enforcement.
 */
export function skillPlanForExperience(plan: ExperiencePlan, topic?: string): SkillPlan {
  const scene = plan.skillScene ?? skillSceneForMode(plan.mode);
  const intent =
    plan.mode === 'desktop'
      ? 'desktop'
      : plan.mode === 'deep_planning' || plan.mode === 'deep_course'
        ? 'learn'
        : plan.mode === 'chat' && plan.confidence >= 0.9
          ? 'greeting'
          : 'chat';
  const ctx: SceneContext = {
    scene,
    intent: intent as SceneContext['intent'],
    stage: plan.mode === 'deep_course' ? 'teaching' : plan.mode,
    topic: topic || plan.topic,
  };
  return buildSkillPlan(ctx);
}

/** True when a skill id is allowed by the plan's SkillPlan. */
export function isSkillAllowedByExperience(
  plan: ExperiencePlan,
  skillId: string,
): boolean {
  const sp = skillPlanForExperience(plan);
  if (sp.forbiddenSkills.includes(skillId)) return false;
  return sp.enabledSkills.includes(skillId);
}

/** Whether ResourceAgent should run for this plan. */
export function shouldRunResourceAgent(plan: ExperiencePlan): boolean {
  if (plan.skippedSteps.includes('resources')) return false;
  if (plan.mode === 'chat' || plan.mode === 'normal') return false;
  return (
    plan.requiredSteps.includes('resources') ||
    plan.optionalSteps.includes('resources') ||
    plan.nextAction === 'run_resources'
  );
}

/** Whether Memory card step should run. */
export function shouldRunMemoryStep(plan: ExperiencePlan): boolean {
  if (plan.skippedSteps.includes('memory')) return false;
  return plan.requiredSteps.includes('memory') || plan.nextAction === 'run_memory';
}

/** Whether calibration step should run. */
export function shouldRunCalibrationStep(plan: ExperiencePlan): boolean {
  if (plan.skippedSteps.includes('calibration')) return false;
  return (
    plan.requiredSteps.includes('calibration') || plan.nextAction === 'run_calibration'
  );
}

/**
 * Core Experience Planner — deterministic routing from message + context.
 * IntentJudge confidence/intent are inputs, not the sole driver.
 */
export function planExperience(input: PlanExperienceInput): ExperiencePlan {
  const message = (input.message || '').trim();
  const surface = normalizeSurface(input.surface);
  const confidence =
    typeof input.confidence === 'number' && !Number.isNaN(input.confidence)
      ? Math.min(1, Math.max(0, input.confidence))
      : 0.5;
  const intent = (input.intent || '').toLowerCase();

  const levelFromMsg = extractLevelHint(message);
  const knownLevel =
    (input.knownLevel && input.knownLevel.trim()) ||
    levelFromMsg ||
    packSuggestsLevel(input.contextPack) ||
    null;
  const rawKnownGoal =
    (input.knownGoal && input.knownGoal.trim()) ||
    extractGoalHint(message, null) ||
    packSuggestsGoal(input.contextPack) ||
    null;
  /** Placeholder goals (一个主题 / 一门课程 / …) never count as concrete goals. */
  const knownGoal = sanitizeGoalCandidate(rawKnownGoal);

  const explicitDeep = isExplicitDeep(message, input.userModePreference);
  const oneShot = looksLikeOneShot(message);
  const resourceWanted = wantsResourceList(message, input.wantsResources);
  const packEmpty = !input.contextPack || input.contextPack.empty;
  const shortNonPlan = isNonPlanningShortMessage(message);
  const priorDeep =
    input.experienceMode === 'deep_planning' ||
    input.experienceMode === 'deep_course';

  // ── Surface-driven modes (page is source of truth) ─────────────────────
  if (surface === 'course') {
    return finalize({
      mode: 'deep_course',
      requiredSteps: ['course_teach'],
      optionalSteps: [],
      skippedSteps: ['memory', 'calibration', 'resources', 'direct_answer'],
      surface: 'course',
      nextAction: 'deep_course_advance',
      commitPolicy: 'explicit_confirm',
      confidence,
      internalReason: `surface=course; courseStage=${input.courseStage || 'unknown'}; deep_course SM only`,
      topic: knownGoal || undefined,
      skillScene: 'session_teach',
    });
  }

  if (surface === 'calendar' || CALENDAR_RE.test(message)) {
    return finalize({
      mode: 'calendar',
      requiredSteps: ['calendar_plan'],
      optionalSteps: [],
      skippedSteps: [...ALL_PLANNING_STEPS, 'direct_answer', 'course_teach'],
      surface: surface === 'calendar' ? 'calendar' : 'chat',
      nextAction: 'calendar_propose',
      commitPolicy: 'propose_only',
      confidence: Math.max(confidence, 0.7),
      internalReason: `calendar path; surface=${surface}; no learn funnel`,
      topic: knownGoal || undefined,
      skillScene: 'planning',
    });
  }

  if (surface === 'library' || (LIBRARY_RE.test(message) && surface !== 'chat')) {
    return finalize({
      mode: 'library',
      requiredSteps: ['library_assist'],
      optionalSteps: [],
      skippedSteps: [...ALL_PLANNING_STEPS, 'course_teach'],
      surface: 'library',
      nextAction: 'library_assist',
      commitPolicy: 'none',
      confidence: Math.max(confidence, 0.65),
      internalReason: `library surface assist; no ten-stage funnel`,
      skillScene: 'memory',
    });
  }

  // ── Desktop ────────────────────────────────────────────────────────────
  if (
    surface === 'desktop' ||
    intent === 'desktop' ||
    DESKTOP_RE.test(message)
  ) {
    return finalize({
      mode: 'desktop',
      requiredSteps: ['desktop_loop'],
      optionalSteps: [],
      skippedSteps: [...ALL_PLANNING_STEPS, 'course_teach', 'direct_answer'],
      surface: surface === 'desktop' ? 'desktop' : 'chat',
      nextAction: 'run_desktop',
      commitPolicy: 'policy_gated',
      confidence: Math.max(confidence, intent === 'desktop' ? confidence : 0.75),
      internalReason: `desktop tool loop; side effects policy_gated + HITL; intent=${intent}`,
      skillScene: 'desktop',
    });
  }

  // ── Empty / greeting / ordinary short — never restart Deep planning ────
  if (!message || GREETING_RE.test(message) || shortNonPlan) {
    // Stay in deep_planning mode for UI status if already planning, but do not
    // re-enter clarify/outline from a greeting or "好的/嗯".
    if (priorDeep || (explicitDeep && input.experienceMode === 'deep_planning')) {
      return finalize({
        mode: 'deep_planning',
        requiredSteps: [],
        optionalSteps: [],
        skippedSteps: [...ALL_PLANNING_STEPS, 'course_teach', 'direct_answer'],
        surface,
        nextAction: 'await_user',
        commitPolicy: 'none',
        confidence: Math.max(confidence, 0.9),
        internalReason:
          'deep_short_or_greeting: do not restart planning; await substantive user input',
        topic: knownGoal || undefined,
        skillScene: 'planning',
      });
    }
    return finalize({
      mode: 'chat',
      requiredSteps: ['direct_answer'],
      optionalSteps: [],
      skippedSteps: [...ALL_PLANNING_STEPS, 'course_teach', 'resources'],
      surface,
      nextAction: 'stream_chat',
      commitPolicy: 'none',
      confidence: Math.max(confidence, 0.9),
      internalReason: 'greeting_or_empty_or_short: plain chat, no funnel',
      skillScene: 'chat',
    });
  }

  // ── Low confidence → natural clarification (not 意图待确认 modal) ─────
  if (confidence < LOW_CONFIDENCE && !oneShot && !explicitDeep && intent !== 'chat') {
    const clarify = buildIntentModeClarificationSpec(knownGoal);
    return finalize({
      mode: 'chat',
      requiredSteps: ['natural_clarify'],
      optionalSteps: [],
      skippedSteps: [...ALL_PLANNING_STEPS, 'course_teach'],
      surface,
      nextAction: 'natural_clarify',
      commitPolicy: 'none',
      confidence,
      internalReason: `low_confidence=${confidence}; natural clarify once; no confirm_gate spam`,
      clarifyQuestionZh: clarify.question,
      clarificationSpec: clarify,
      topic: knownGoal || undefined,
      skillScene: 'chat',
    });
  }

  // ── One-shot conceptual Q → direct answer (Chat/Normal fast path) ──────
  if (oneShot || (intent === 'chat' && !explicitDeep)) {
    const mode: ExperienceMode =
      intent === 'learn' && !oneShot ? 'normal' : oneShot ? 'normal' : 'chat';
    return finalize({
      mode,
      requiredSteps: ['direct_answer'],
      optionalSteps: [],
      skippedSteps: [
        'memory',
        'calibration',
        'resources',
        'outline',
        'deep_confirm',
        'start_session',
        'course_teach',
        'desktop_loop',
        'calendar_plan',
      ],
      surface,
      nextAction: 'stream_chat',
      commitPolicy: 'none',
      confidence: Math.max(confidence, oneShot ? 0.8 : confidence),
      internalReason: `one_shot_or_chat: direct answer; skip funnel; intent=${intent}`,
      topic: knownGoal || undefined,
      skillScene: 'chat',
    });
  }

  // ── Explicit Deep Planning ─────────────────────────────────────────────
  if (explicitDeep || input.userModePreference === 'deep') {
    // Missing concrete goal (incl. rejected placeholders) → ask topic only
    if (!knownGoal) {
      const clarify = buildTopicClarificationSpec();
      return finalize({
        mode: 'deep_planning',
        requiredSteps: ['natural_clarify', 'outline', 'deep_confirm', 'start_session'],
        optionalSteps: resourceWanted ? ['resources'] : [],
        skippedSteps: resourceWanted
          ? ['memory', 'calibration', 'direct_answer']
          : ['memory', 'calibration', 'resources', 'direct_answer'],
        surface,
        nextAction: 'natural_clarify',
        commitPolicy: 'propose_only',
        confidence,
        internalReason:
          'explicit_deep missing goal: one topic clarify only; no full funnel; resources optional',
        clarifyQuestionZh: clarify.question,
        clarificationSpec: clarify,
        skillScene: 'planning',
      });
    }

    // Has goal, missing level → ask only level (one question)
    if (!knownLevel) {
      const clarify = buildLevelClarificationSpec(knownGoal);
      return finalize({
        mode: 'deep_planning',
        requiredSteps: ['natural_clarify', 'outline', 'deep_confirm', 'start_session'],
        optionalSteps: resourceWanted ? ['resources'] : [],
        skippedSteps: resourceWanted
          ? ['memory', 'calibration', 'direct_answer']
          : ['memory', 'calibration', 'resources', 'direct_answer'],
        surface,
        nextAction: 'natural_clarify',
        commitPolicy: 'propose_only',
        confidence,
        internalReason: `explicit_deep goal=${knownGoal} missing level: one level clarify; skip memory+calibration cards`,
        clarifyQuestionZh: clarify.question,
        clarificationSpec: clarify,
        topic: knownGoal,
        skillScene: 'planning',
      });
    }

    // Goal + level present → outline; skip memory + calibration; resources only if wanted
    const skipped: ExperienceStep[] = [
      'memory',
      'calibration',
      'direct_answer',
      'course_teach',
    ];
    const required: ExperienceStep[] = ['outline', 'deep_confirm', 'start_session'];
    const optional: ExperienceStep[] = [];
    if (resourceWanted) {
      required.unshift('resources');
    } else {
      skipped.push('resources');
    }

    return finalize({
      mode: 'deep_planning',
      requiredSteps: required,
      optionalSteps: optional,
      skippedSteps: skipped,
      surface,
      nextAction: 'run_outline',
      commitPolicy: 'propose_only',
      confidence: Math.max(confidence, 0.75),
      internalReason: `explicit_deep goal+level present; skip memory/calibration; resources=${resourceWanted}; outline propose_only`,
      topic: knownGoal,
      skillScene: 'outline',
    });
  }

  // ── Learn-oriented without explicit Deep → Normal (answer first) ───────
  if (intent === 'learn' || knownGoal) {
    const skipped: ExperienceStep[] = [
      'outline',
      'deep_confirm',
      'start_session',
      'course_teach',
      'desktop_loop',
    ];
    // Skip empty memory card always on Normal
    skipped.push('memory');
    // Skip calibration when level already known
    if (knownLevel) {
      skipped.push('calibration');
    } else {
      // optional light check — not a fixed funnel stage
      // still skip forced calibration card on Normal
      skipped.push('calibration');
    }
    // Resources only when asked
    if (!resourceWanted) {
      skipped.push('resources');
    }

    return finalize({
      mode: 'normal',
      requiredSteps: ['direct_answer'],
      optionalSteps: resourceWanted ? ['resources'] : [],
      skippedSteps: skipped,
      surface,
      nextAction: 'stream_chat',
      commitPolicy: 'none',
      confidence,
      internalReason: `normal learn-ish without explicit deep; answer first; skip funnel; goal=${knownGoal || 'none'}; level=${knownLevel || 'none'}; packEmpty=${packEmpty}`,
      topic: knownGoal || undefined,
      skillScene: 'chat',
    });
  }

  // ── Default: plain chat ────────────────────────────────────────────────
  return finalize({
    mode: 'chat',
    requiredSteps: ['direct_answer'],
    optionalSteps: [],
    skippedSteps: [...ALL_PLANNING_STEPS, 'course_teach', 'resources'],
    surface,
    nextAction: 'stream_chat',
    commitPolicy: 'none',
    confidence,
    internalReason: `default chat stream; intent=${intent || 'none'}`,
    topic: knownGoal || undefined,
    skillScene: 'chat',
  });
}

/**
 * Whether the fixed progress rail / ten-stage funnel may drive this mode.
 * Chat and Normal: never. Deep Course: yes (compat SM).
 */
export function funnelAllowedForMode(mode: ExperienceMode): boolean {
  return mode === 'deep_course' || mode === 'deep_planning';
}

/**
 * Strip plan fields that must never appear in user-visible payloads.
 * Call before any client serialization that might leak into UI debug.
 */
export function toPublicExperiencePlanMeta(plan: ExperiencePlan): {
  mode: ExperienceMode;
  nextAction: ExperienceNextAction;
  surface: string;
  commitPolicy: ExperienceCommitPolicy;
  confidence: number;
  requiredSteps: ExperienceStep[];
  optionalSteps: ExperienceStep[];
  skippedSteps: ExperienceStep[];
  topic?: string;
  clarifyQuestionZh?: string;
  clarificationSpec?: ClarificationSpec;
} {
  return {
    mode: plan.mode,
    nextAction: plan.nextAction,
    surface: plan.surface,
    commitPolicy: plan.commitPolicy,
    confidence: plan.confidence,
    requiredSteps: plan.requiredSteps,
    optionalSteps: plan.optionalSteps,
    skippedSteps: plan.skippedSteps,
    topic: plan.topic,
    clarifyQuestionZh: plan.clarifyQuestionZh,
    clarificationSpec: plan.clarificationSpec,
  };
}
