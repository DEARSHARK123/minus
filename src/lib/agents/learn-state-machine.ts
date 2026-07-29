/**
 * Deep Course teaching state machine + migration compatibility (B05 / UX02).
 *
 * UX02: The fixed ten-stage funnel MUST NOT drive Chat or Normal.
 * Experience Planner (`planExperience`) owns Chat / Normal / Deep Planning /
 * Calendar / Library / Desktop routing. This module remains for:
 *   1. Deep Course internal phases (teaching → recall → assessment → …)
 *   2. Compatibility migration of legacy stage names (memory → goal_clarification)
 *   3. Mid-flow guards while a Deep path is already active
 *
 * Canonical Deep Course flow (after Start Session commit):
 *   ready → teaching → recall → assessment → remediation → completed
 *
 * Pre-commit Deep Planning stages (intent_proposed … outline) are retained for
 * migration of in-flight sessions only; new Chat/Normal traffic does not enter
 * them via the Experience Planner.
 *
 * propose ≠ commit: course / task / calendar / progress persistence only on
 * explicit commit transitions (Start Session / session phase advances).
 *
 * Autonomy modes (B03) MUST NOT skip explicit commit / HITL gates.
 * ProgressNarrator is copy-only — never forges persisted mastery.
 */

import type { OrchestratorAction } from './types';

/**
 * Canonical learn stages.
 * Pre-session planning stages are Deep Planning / migration only (not Chat/Normal driver).
 * Session phases (ready…) are Deep Course internal.
 */
export type LearnStage =
  | 'idle'
  | 'intent_proposed'
  | 'goal_clarification'
  | 'calibration'
  | 'outline'
  | 'ready'
  | 'teaching'
  | 'recall'
  | 'assessment'
  | 'remediation'
  | 'completed';

/** Deep Course session phases (post Start Session). */
export const DEEP_COURSE_STAGES: LearnStage[] = [
  'ready',
  'teaching',
  'recall',
  'assessment',
  'remediation',
  'completed',
];

/** Legacy planning stages kept for migration of in-flight Deep flows. */
export const DEEP_PLANNING_COMPAT_STAGES: LearnStage[] = [
  'intent_proposed',
  'goal_clarification',
  'calibration',
  'outline',
];

/**
 * Non-learn / orthogonal stages kept for Desktop trust and reject UX.
 * Not part of the progress rail.
 */
export type LearnSideStage = 'rejected' | 'desktop_pending_trust';

/** Client store stage = canonical + side. */
export type LearnFlowStage = LearnStage | LearnSideStage;

/** @deprecated B04/B01 aliases — map via normalizeLearnStage. */
export type LegacyLearnStage =
  | 'memory'
  | 'calibrating'
  | 'resources';

export type LearnInputKind =
  | 'user_message'
  | 'confirm_intent'
  | 'reject_intent'
  | 'continue'
  | 'calibration_answer'
  | 'start_session'
  | 'session_phase_advance'
  | 'none';

export type LearnSideEffect =
  | 'none'
  | 'ui_artifacts'
  | 'stream_chat'
  | 'desktop_loop'
  /** Explicit user commit: persist course/units/tasks/session */
  | 'persist_course_session'
  /** SessionEngine / repository only */
  | 'persist_progress'
  | 'reset_flow';

export interface LearnStateSpec {
  stage: LearnStage;
  labelZh: string;
  allowedInputs: LearnInputKind[];
  skills: string[];
  artifacts: string[];
  sideEffects: LearnSideEffect[];
  /** Stages this state may transition to (exhaustively documented). */
  exits: LearnStage[];
  /** Human-readable exit conditions. */
  exitConditions: string[];
  /** Whether mid-flow free text must hit orchestrator (never silent chat). */
  midFlowOrchestrator: boolean;
}

/** Full machine table — single source of documentation + runtime checks. */
export const LEARN_STATE_SPECS: Record<LearnStage, LearnStateSpec> = {
  idle: {
    stage: 'idle',
    labelZh: '空闲',
    allowedInputs: ['user_message'],
    skills: ['plain-conversation', 'clarification'],
    artifacts: [],
    sideEffects: ['stream_chat', 'ui_artifacts', 'desktop_loop'],
    exits: ['intent_proposed', 'idle'],
    exitConditions: [
      'IntentJudge → learn → intent_proposed + confirm_gate',
      'IntentJudge → chat → stay idle + streamChat',
      'IntentJudge → desktop → desktop loop (side stage desktop_pending_trust if trust)',
    ],
    midFlowOrchestrator: false,
  },
  intent_proposed: {
    stage: 'intent_proposed',
    // UX08: natural user copy — never surface engineering "意图待确认" debug label
    labelZh: '确认目标',
    allowedInputs: ['confirm_intent', 'reject_intent', 'user_message'],
    skills: [],
    artifacts: ['confirm_gate'],
    sideEffects: ['ui_artifacts', 'reset_flow'],
    exits: ['goal_clarification', 'idle'],
    exitConditions: [
      'User confirms (confirm_learn) → goal_clarification (memory agent); NO course write',
      'User rejects → rejected/idle; no persistence',
      'User message re-proposes → stay or re-judge (still no commit)',
    ],
    midFlowOrchestrator: true,
  },
  goal_clarification: {
    stage: 'goal_clarification',
    labelZh: '目标澄清',
    allowedInputs: ['continue', 'user_message'],
    skills: ['goal-clarification', 'clarification'],
    artifacts: ['memory_card', 'progress_update'],
    sideEffects: ['ui_artifacts'],
    exits: ['calibration'],
    exitConditions: [
      'User continues (continue_memory) → calibration + calibrate agent',
      'No calendar/course/progress write',
    ],
    midFlowOrchestrator: true,
  },
  calibration: {
    stage: 'calibration',
    labelZh: '水平校准',
    allowedInputs: ['calibration_answer', 'user_message'],
    skills: ['prerequisite-analysis'],
    artifacts: ['single_choice', 'multi_choice', 'free_text', 'progress_update'],
    sideEffects: ['ui_artifacts'],
    exits: ['outline'],
    exitConditions: [
      'select_calibration with answer (choice index, multi-select, or free_text body)',
      'NEVER silent chat fallback while free_text / multi_choice pending',
    ],
    midFlowOrchestrator: true,
  },
  outline: {
    stage: 'outline',
    labelZh: '大纲与资源',
    allowedInputs: ['continue', 'start_session', 'user_message'],
    skills: ['learn-divide', 'outline-validator', 'prerequisite-analysis'],
    artifacts: ['resource_list', 'outline_card', 'progress_update', 'plain_assistant'],
    sideEffects: ['ui_artifacts', 'persist_course_session'],
    exits: ['ready', 'teaching'],
    exitConditions: [
      'Resources + outline shown (post-calibration)',
      'Start Session explicit click → persist OutlineAgent units + ready/teaching',
      'Autonomy MUST NOT auto Start Session',
    ],
    midFlowOrchestrator: true,
  },
  ready: {
    stage: 'ready',
    labelZh: '就绪',
    allowedInputs: ['start_session', 'session_phase_advance'],
    skills: [],
    artifacts: ['outline_card', 'progress_update'],
    sideEffects: ['persist_course_session', 'ui_artifacts'],
    exits: ['teaching', 'idle'],
    exitConditions: [
      'Session created → teaching',
      'User abandons → idle',
    ],
    midFlowOrchestrator: true,
  },
  teaching: {
    stage: 'teaching',
    labelZh: '教学',
    allowedInputs: ['session_phase_advance', 'user_message'],
    skills: ['learn-teach-format'],
    artifacts: [],
    sideEffects: ['persist_progress', 'ui_artifacts'],
    exits: ['recall'],
    exitConditions: ['SessionEngine teach complete → startRecall → recall'],
    midFlowOrchestrator: true,
  },
  recall: {
    stage: 'recall',
    labelZh: '主动回忆',
    allowedInputs: ['session_phase_advance', 'user_message'],
    skills: ['session-recall'],
    artifacts: [],
    sideEffects: ['persist_progress'],
    exits: ['assessment'],
    exitConditions: ['submitRecall → assessment'],
    midFlowOrchestrator: true,
  },
  assessment: {
    stage: 'assessment',
    labelZh: '评估',
    allowedInputs: ['session_phase_advance'],
    skills: ['session-assess'],
    artifacts: [],
    sideEffects: ['persist_progress'],
    exits: ['remediation', 'teaching', 'completed'],
    exitConditions: [
      'pass → next section teaching OR completed',
      'fail/partial → remediation',
      'Only SessionEngine.applyAssessment unlocks; Narrator cannot',
    ],
    midFlowOrchestrator: true,
  },
  remediation: {
    stage: 'remediation',
    labelZh: '补救',
    allowedInputs: ['session_phase_advance', 'user_message'],
    skills: ['session-remediate', 'learn-teach-format'],
    artifacts: [],
    sideEffects: ['persist_progress', 'ui_artifacts'],
    exits: ['recall'],
    exitConditions: ['Remediate teach → recall again'],
    midFlowOrchestrator: true,
  },
  completed: {
    stage: 'completed',
    labelZh: '完成',
    allowedInputs: ['none', 'user_message'],
    skills: [],
    artifacts: ['progress_update'],
    sideEffects: ['ui_artifacts', 'reset_flow'],
    exits: ['idle'],
    exitConditions: ['User starts new topic → idle'],
    midFlowOrchestrator: false,
  },
};

export const CANONICAL_LEARN_STAGES: LearnStage[] = [
  'idle',
  'intent_proposed',
  'goal_clarification',
  'calibration',
  'outline',
  'ready',
  'teaching',
  'recall',
  'assessment',
  'remediation',
  'completed',
];

/**
 * Progress rail steps (exclude idle).
 * UX02: only mount for Deep Course / active Deep Planning — never Chat/Normal.
 */
export const LEARN_PROGRESS_RAIL_STAGES = [
  'intent_proposed',
  'goal_clarification',
  'calibration',
  'outline',
  'ready',
  'teaching',
  'recall',
  'assessment',
  'remediation',
  'completed',
] as const satisfies readonly LearnStage[];

/**
 * UX02: whether a product experience mode may drive the fixed progress rail.
 * Chat and Normal must not use the ten-stage funnel rail.
 */
export function progressRailAllowedForExperienceMode(mode: string | undefined | null): boolean {
  return mode === 'deep_course' || mode === 'deep_planning';
}

/** True when stage is a Deep Course session phase (post commit). */
export function isDeepCourseStage(stage: string | undefined | null): boolean {
  const n = normalizeLearnStage(stage);
  return (DEEP_COURSE_STAGES as string[]).includes(n);
}

/**
 * UX02: Chat/Normal idle must not be treated as mid-funnel.
 * Active Deep planning/course stages still require orchestrator mid-flow guards.
 */
export function isFixedFunnelDriverStage(stage: string | undefined | null): boolean {
  const n = normalizeLearnStage(stage);
  if (n === 'idle' || n === 'rejected' || n === 'desktop_pending_trust' || n === 'completed') {
    return false;
  }
  return (
    (DEEP_PLANNING_COMPAT_STAGES as string[]).includes(n) ||
    (DEEP_COURSE_STAGES as string[]).includes(n)
  );
}

export type LearnProgressRailStage = (typeof LEARN_PROGRESS_RAIL_STAGES)[number];

/** Quarantined rail labels (Home rail unmounted UX08). Keep for Deep SM docs. */
export const LEARN_PROGRESS_RAIL_LABELS: Record<LearnProgressRailStage, string> = {
  intent_proposed: '确认目标',
  goal_clarification: '目标',
  calibration: '校准',
  outline: '大纲',
  ready: '就绪',
  teaching: '教学',
  recall: '回忆',
  assessment: '评估',
  remediation: '补救',
  completed: '完成',
};

/** Labels for any learn stage (compat + Deep SM; not Home rail chrome). */
export const LEARN_STAGE_LABELS: Record<LearnStage, string> = {
  idle: '空闲',
  intent_proposed: '确认目标',
  goal_clarification: '目标',
  calibration: '校准',
  outline: '大纲',
  ready: '就绪',
  teaching: '教学',
  recall: '回忆',
  assessment: '评估',
  remediation: '补救',
  completed: '完成',
};

/**
 * Normalize legacy B04 stage names to canonical B05 stages.
 */
export function normalizeLearnStage(stage: string | undefined | null): LearnFlowStage {
  if (!stage) return 'idle';
  switch (stage) {
    case 'memory':
      return 'goal_clarification';
    case 'calibrating':
      return 'calibration';
    case 'resources':
      return 'outline';
    case 'idle':
    case 'intent_proposed':
    case 'goal_clarification':
    case 'calibration':
    case 'outline':
    case 'ready':
    case 'teaching':
    case 'recall':
    case 'assessment':
    case 'remediation':
    case 'completed':
    case 'rejected':
    case 'desktop_pending_trust':
      return stage;
    default:
      return 'idle';
  }
}

export function isCanonicalLearnStage(stage: string): stage is LearnStage {
  return Object.prototype.hasOwnProperty.call(LEARN_STATE_SPECS, stage);
}

export function isLearnFlowActive(stage: LearnFlowStage): boolean {
  return (
    stage !== 'idle' &&
    stage !== 'rejected' &&
    stage !== 'desktop_pending_trust' &&
    stage !== 'completed'
  );
}

/**
 * Stages where a free-text user message must be routed through orchestrator
 * (never silent streamChat fallback).
 */
export function requiresMidFlowOrchestrator(stage: LearnFlowStage): boolean {
  const n = normalizeLearnStage(stage);
  if (n === 'rejected' || n === 'desktop_pending_trust') return false;
  if (!isCanonicalLearnStage(n)) return false;
  return LEARN_STATE_SPECS[n].midFlowOrchestrator;
}

export type MidFlowRouteDecision =
  | { kind: 'select_calibration'; action: 'select_calibration'; message: string }
  | { kind: 'orchestrator_intent'; action: 'intent'; message: string }
  | { kind: 'blocked_await_ui'; action: null; message: string; hint: string }
  | { kind: 'chat'; action: 'chat'; message: string };

/**
 * Mid-learn routing: never drop calibrating free_text into dumb chat.
 */
export function decideMidFlowRoute(input: {
  stage: string;
  message: string;
  hasFreeTextArtifact: boolean;
  hasMultiChoiceArtifact: boolean;
  hasSingleChoiceArtifact: boolean;
  calibrationPending: boolean;
}): MidFlowRouteDecision {
  const stage = normalizeLearnStage(input.stage);
  const text = input.message.trim();

  if (stage === 'idle' || stage === 'rejected') {
    return { kind: 'orchestrator_intent', action: 'intent', message: text };
  }

  if (stage === 'desktop_pending_trust') {
    return {
      kind: 'blocked_await_ui',
      action: null,
      message: text,
      hint: '请先确认或拒绝本机权限，再继续对话。',
    };
  }

  if (stage === 'calibration') {
    if (input.hasFreeTextArtifact && text) {
      return { kind: 'select_calibration', action: 'select_calibration', message: text };
    }
    if (input.hasMultiChoiceArtifact && input.calibrationPending) {
      return {
        kind: 'blocked_await_ui',
        action: null,
        message: text,
        hint: '请点选上方选项，选后会自动继续。',
      };
    }
    if (input.hasSingleChoiceArtifact && input.calibrationPending) {
      return {
        kind: 'blocked_await_ui',
        action: null,
        message: text,
        hint: '请点选上方选项，选后会自动继续。',
      };
    }
    // Answer already submitted or no card — still hit orchestrator, not silent chat
    if (text) {
      return { kind: 'select_calibration', action: 'select_calibration', message: text };
    }
  }

  if (stage === 'intent_proposed') {
    return {
      kind: 'blocked_await_ui',
      action: null,
      message: text,
      hint: '请先确认或取消学习意图（propose ≠ commit）。',
    };
  }

  if (requiresMidFlowOrchestrator(stage)) {
    // Keep flow on orchestrator; do not open raw chat that skips agents
    return { kind: 'orchestrator_intent', action: 'intent', message: text };
  }

  return { kind: 'chat', action: 'chat', message: text };
}

/** Allowed orchestrator actions per stage (runtime guard). */
export function isActionAllowedInStage(
  stage: LearnFlowStage,
  action: OrchestratorAction,
): boolean {
  const n = normalizeLearnStage(stage);
  switch (action) {
    case 'intent':
    case 'chat':
    case 'desktop':
      return n === 'idle' || n === 'rejected' || requiresMidFlowOrchestrator(n);
    case 'confirm_learn':
      return n === 'intent_proposed';
    case 'reject_learn':
      return n === 'intent_proposed';
    case 'continue_memory':
      return n === 'goal_clarification';
    case 'select_calibration':
      return n === 'calibration';
    case 'advance_resources':
    case 'request_outline':
      return n === 'outline' || n === 'calibration';
    case 'request_progress':
      return true;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * Explicit commit transitions that may write course/task/session/progress.
 * Autonomy auto-approve of tools does NOT imply these.
 */
export const LEARN_COMMIT_TRANSITIONS = [
  'start_session',
  'session_phase_advance',
  'apply_assessment',
] as const;

export type LearnCommitTransition = (typeof LEARN_COMMIT_TRANSITIONS)[number];

/** Narrator / agent copy must never call these. */
export function isPersistProgressOwner(owner: 'repository' | 'session_engine' | 'narrator' | 'agent'): boolean {
  return owner === 'repository' || owner === 'session_engine';
}

/**
 * Build default progress steps from repository-owned stage (not LLM invent).
 * ProgressNarrator may rephrase labels but statuses derive from current stage index.
 */
export function buildProgressStepsFromStage(stage: string): Array<{
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}> {
  const n = normalizeLearnStage(stage);
  const rail = LEARN_PROGRESS_RAIL_STAGES;
  let idx = (rail as readonly string[]).indexOf(n);
  if (n === 'idle' || n === 'rejected' || n === 'desktop_pending_trust') {
    return rail.slice(0, 5).map((id) => ({
      id,
      label: LEARN_PROGRESS_RAIL_LABELS[id],
      status: 'pending' as const,
    }));
  }
  if (idx < 0) idx = 0;
  return rail.map((id, i) => ({
    id,
    label: LEARN_PROGRESS_RAIL_LABELS[id],
    status: (i < idx ? 'done' : i === idx ? 'active' : 'pending') as
      | 'pending'
      | 'active'
      | 'done',
  }));
}

/** Map session section phase → learn stage for Home/session bridge. */
export function sessionPhaseToLearnStage(
  phase: 'teach' | 'active_recall' | 'assess' | 'remediate' | 'done',
): LearnStage {
  switch (phase) {
    case 'teach':
      return 'teaching';
    case 'active_recall':
      return 'recall';
    case 'assess':
      return 'assessment';
    case 'remediate':
      return 'remediation';
    case 'done':
      return 'completed';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
