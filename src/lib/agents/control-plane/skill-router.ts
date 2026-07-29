import {
  type SceneContext,
  type SceneId,
  type SkillPlan,
  SceneContextSchema,
  SkillPlanSchema,
} from './schemas';

/** Legacy export retained for compatibility; no skill may require display fences. */
export const TEACH_FORMAT_SKILLS: readonly string[] = [];

/** Content skills that produce full lesson-style output (forbidden on planning). */
export const LESSON_CONTENT_SKILLS = [
  'common-mistakes',
] as const;

function forbidExcept(_enabled: string[], extraForbidden: string[] = []): string[] {
  return Array.from(new Set(extraForbidden)).sort();
}

function plan(
  partial: Omit<SkillPlan, 'forbiddenSkills'> & { forbiddenSkills?: string[] },
): SkillPlan {
  const enabled = [...partial.enabledSkills];
  const forbidden =
    partial.forbiddenSkills ??
    forbidExcept(enabled);
  const full: SkillPlan = {
    enabledSkills: enabled,
    forbiddenSkills: forbidden,
    rationale: partial.rationale,
    budget: partial.budget,
    sideEffects: partial.sideEffects,
    outputPolicy: partial.outputPolicy,
  };
  return SkillPlanSchema.parse(full);
}

function routeChat(scene: SceneContext): SkillPlan {
  return plan({
    enabledSkills: ['plain-conversation', 'clarification'],
    forbiddenSkills: forbidExcept(
      ['plain-conversation', 'clarification'],
      ['learn-divide', 'common-mistakes'],
    ),
    rationale:
      scene.intent === 'greeting'
        ? 'chat/greeting: short natural reply'
        : 'chat: plain conversation + clarification when needed',
    budget: { maxSkillCalls: 2, maxTokensHint: 1024 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'plain', allowTeachFences: false },
  });
}

function routePlanning(scene: SceneContext): SkillPlan {
  const enabled = [
    'goal-clarification',
    'problem-decomposition',
    'planning',
    'scope-control',
  ];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'common-mistakes',
      'learn-divide',
    ]),
    rationale: `planning${scene.topic ? ` topic=${scene.topic}` : ''}: clarify goals and scope`,
    budget: { maxSkillCalls: 4, maxTokensHint: 2048 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'plan', allowTeachFences: false },
  });
}

function routeOutline(scene: SceneContext): SkillPlan {
  const enabled = [
    'learn-divide',
    'prerequisite-analysis',
    'outline-validator',
  ];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'common-mistakes',
    ]),
    rationale: `outline${scene.topic ? ` topic=${scene.topic}` : ''}: structure units only`,
    budget: { maxSkillCalls: 3, maxTokensHint: 2048 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'plan', allowTeachFences: false },
  });
}

function routeSessionTeach(scene: SceneContext): SkillPlan {
  const enabled = ['learn-teach-format'];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'learn-divide',
      'plain-conversation',
    ]),
    rationale: `session_teach${scene.topic ? ` topic=${scene.topic}` : ''}: adaptive teaching guidance`,
    budget: { maxSkillCalls: 1, maxTokensHint: 4096 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'teach', allowTeachFences: false },
  });
}

function routeSessionRecall(scene: SceneContext): SkillPlan {
  const enabled = ['session-recall', 'clarification'];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'common-mistakes',
      'learn-divide',
    ]),
    rationale: `session_recall${scene.topic ? ` topic=${scene.topic}` : ''}: quiz/recall only; no full teach chrome`,
    budget: { maxSkillCalls: 2, maxTokensHint: 2048 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'plain', allowTeachFences: false },
  });
}

function routeSessionAssess(scene: SceneContext): SkillPlan {
  const enabled = ['session-assess'];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'session-remediate',
      'learn-divide',
    ]),
    rationale: `session_assess${scene.topic ? ` topic=${scene.topic}` : ''}: assessment only`,
    budget: { maxSkillCalls: 1, maxTokensHint: 2048 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'plain', allowTeachFences: false },
  });
}

function routeSessionRemediate(scene: SceneContext): SkillPlan {
  // Phase-appropriate: remediate only — not full teach + assess at once
  const enabled = ['session-remediate', 'clarification'];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'learn-divide',
      'session-assess',
    ]),
    rationale: `session_remediate${scene.topic ? ` topic=${scene.topic}` : ''}: targeted fix`,
    budget: { maxSkillCalls: 2, maxTokensHint: 2048 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'plain', allowTeachFences: false },
  });
}

function routeDesktop(scene: SceneContext): SkillPlan {
  const teach =
    scene.intent === 'teach' || scene.intent === 'learn';
  const enabled = [
    'task-planning',
    'tool-selection',
    'workspace-files',
    'risk-review',
    ...(teach ? (['learn-teach-format'] as const) : []),
  ];
  return plan({
    enabledSkills: [...enabled],
    forbiddenSkills: forbidExcept([...enabled]),
    rationale: teach
      ? 'desktop + explicit teach intent: tools + teach-format'
      : 'desktop: task/tools/workspace/risk; teach-format forbidden by default',
    budget: { maxSkillCalls: teach ? 5 : 4, maxTokensHint: 4096 },
    sideEffects: 'tool',
    outputPolicy: {
      responseMode: 'tools',
      allowTeachFences: false,
    },
  });
}

function routeMemory(scene: SceneContext): SkillPlan {
  void scene;
  const enabled = ['plain-conversation', 'clarification'];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'learn-divide',
      'common-mistakes',
    ]),
    rationale: 'memory: plain dialogue over memory artifacts; no teach fences',
    budget: { maxSkillCalls: 2, maxTokensHint: 1024 },
    sideEffects: 'prompt_only',
    outputPolicy: { responseMode: 'plain', allowTeachFences: false },
  });
}

function routeSettings(scene: SceneContext): SkillPlan {
  void scene;
  const enabled = ['plain-conversation', 'clarification'];
  return plan({
    enabledSkills: enabled,
    forbiddenSkills: forbidExcept(enabled, [
      'learn-divide',
      'workspace-files',
    ]),
    rationale: 'settings: plain help only; no teach or tool skills',
    budget: { maxSkillCalls: 2, maxTokensHint: 512 },
    sideEffects: 'none',
    outputPolicy: { responseMode: 'plain', allowTeachFences: false },
  });
}

/**
 * Deterministic skill router. LLM-based planning can wrap this later.
 */
export function buildSkillPlan(sceneInput: SceneContext): SkillPlan {
  const scene = SceneContextSchema.parse(sceneInput);
  const id: SceneId = scene.scene;

  switch (id) {
    case 'chat':
      return routeChat(scene);
    case 'planning':
      return routePlanning(scene);
    case 'outline':
      return routeOutline(scene);
    case 'session_teach':
      return routeSessionTeach(scene);
    case 'session_recall':
      return routeSessionRecall(scene);
    case 'session_assess':
      return routeSessionAssess(scene);
    case 'session_remediate':
      return routeSessionRemediate(scene);
    case 'desktop':
      return routeDesktop(scene);
    case 'memory':
      return routeMemory(scene);
    case 'settings':
      return routeSettings(scene);
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return routeChat(scene);
    }
  }
}

/** True when plan allows :::summary / :::key (and learnMode repair). */
export function skillPlanAllowsTeachFences(plan: SkillPlan): boolean {
  void plan;
  return false;
}

/** Alias used by Home / callers. */
export const allowsTeachFences = skillPlanAllowsTeachFences;

/**
 * Map learn-flow / orchestrator stage labels onto SceneId.
 * Unknown stages fall back to chat.
 */
export function sceneIdFromLearnStage(stage: string | undefined | null): SceneId {
  const s = (stage || '').toLowerCase();
  switch (s) {
    case 'idle':
    case 'rejected':
    case '':
      return 'chat';
    case 'intent_proposed':
    case 'confirm':
    case 'goal_clarification':
    case 'calibration':
    case 'calibrate':
    case 'memory':
    case 'resources':
      return 'planning';
    case 'outline':
    case 'ready':
      return 'outline';
    case 'teaching':
    case 'teach':
    case 'session_teach':
      return 'session_teach';
    case 'recall':
    case 'session_recall':
      return 'session_recall';
    case 'assessment':
    case 'assess':
    case 'session_assess':
      return 'session_assess';
    case 'remediation':
    case 'remediate':
    case 'session_remediate':
      return 'session_remediate';
    case 'desktop':
    case 'desktop_pending_trust':
      return 'desktop';
    case 'completed':
      return 'chat';
    default:
      return 'chat';
  }
}

/**
 * Resolve SceneId from learn-flow stage, with optional intent/route override
 * (Home streamChat defaults to chat when IntentJudge routed chat).
 */
export function sceneIdFromStage(
  stage: string | undefined | null,
  opts?: { intent?: string; route?: string },
): SceneId {
  const route = (opts?.route || '').toLowerCase();
  const intent = (opts?.intent || '').toLowerCase();

  if (route === 'desktop' || intent === 'desktop') return 'desktop';
  if (route === 'chat' && intent === 'chat') {
    // Explicit casual chat path — ignore residual learn stage for fences
    const fromStage = sceneIdFromLearnStage(stage);
    if (
      fromStage === 'session_teach' ||
      fromStage === 'session_recall' ||
      fromStage === 'session_assess' ||
      fromStage === 'session_remediate'
    ) {
      return fromStage;
    }
    return 'chat';
  }
  if (route.startsWith('learn_') || intent === 'learn') {
    const fromStage = sceneIdFromLearnStage(stage);
    if (fromStage !== 'chat') return fromStage;
    return 'planning';
  }
  return sceneIdFromLearnStage(stage);
}

/** Build a SceneContext for Home streamChat after IntentJudge `chat`. */
export function buildChatSceneContext(opts?: {
  topic?: string;
  isGreeting?: boolean;
}): SceneContext {
  return SceneContextSchema.parse({
    scene: 'chat',
    intent: opts?.isGreeting ? 'greeting' : 'chat',
    stage: 'idle',
    topic: opts?.topic,
  });
}

/** Heuristic: short greeting-like user text (你好 / hi / hello). */
export function isGreetingLikeUserText(text: string): boolean {
  const t = (text || '').trim();
  if (!t || t.length > 24) return false;
  return /^(你好|您好|哈喽|嗨|hi|hello|hey|hola)([\s!！。.~～?]*)?$/i.test(t);
}
