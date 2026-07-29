import type { ResolvedProviderConfig } from '@/lib/config/server-env';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';
import { judgeIntent } from './intent-judge';
import { runMemoryAgent } from './memory';
import { runCalibrateAgent } from './calibrate';
import { runResourceAgent } from './resource';
import { runOutlineAgent } from './outline';
import { runProgressNarrator } from './progress-narrator';
import {
  buildProgressStepsFromStage,
  normalizeLearnStage,
  progressRailAllowedForExperienceMode,
} from './learn-state-machine';
import {
  planExperience,
  shouldRunResourceAgent,
  shouldRunMemoryStep,
  shouldRunCalibrationStep,
  skillPlanForExperience,
  toPublicExperiencePlanMeta,
  type ExperiencePlan,
} from './control-plane/experience-plan';
import {
  clarificationFieldTitle,
  clarificationSpecToArtifactKind,
} from './control-plane/clarification-spec';
import { reviewOutput } from './control-plane/output-reviewer';
import { gateArtifactCopy, gateOutboundCopy } from '@/lib/ui/outbound-copy-gate';
import type { AgentLLMOptions } from './llm-json';
import {
  newArtifactId,
  type LearnArtifact,
  type OrchestratorContext,
  type OrchestratorRequest,
  type OrchestratorResult,
} from './types';

function toLLMOptions(resolved: ResolvedProviderConfig): AgentLLMOptions {
  return {
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    providerId: resolved.providerId,
  };
}

/**
 * Public experience meta only — never include internalReason in client payloads.
 * Full plan.internalReason stays server-side for audit logs.
 */
function planToResultField(plan: ExperiencePlan): NonNullable<OrchestratorResult['experiencePlan']> {
  const pub = toPublicExperiencePlanMeta(plan);
  return {
    mode: pub.mode,
    requiredSteps: pub.requiredSteps,
    optionalSteps: pub.optionalSteps,
    skippedSteps: pub.skippedSteps,
    surface: pub.surface,
    nextAction: pub.nextAction,
    commitPolicy: pub.commitPolicy,
    confidence: pub.confidence,
    clarifyQuestionZh: pub.clarifyQuestionZh,
    clarificationSpec: pub.clarificationSpec,
    topic: pub.topic,
    skillScene: plan.skillScene,
  };
}

/** Server-only audit line (stdout / logs). Never attached to OrchestratorResult. */
function auditExperiencePlan(plan: ExperiencePlan): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.debug(
      '[experience-plan:audit]',
      plan.mode,
      plan.nextAction,
      plan.internalReason.slice(0, 200),
    );
  }
}

/**
 * Apply unified SkillPlan output gate to user-visible plain_assistant text.
 * Outline / planning must not leak :::summary / :::key fences.
 */
function gatePlainArtifacts(
  artifacts: LearnArtifact[],
  plan: ExperiencePlan,
  topic?: string,
): LearnArtifact[] {
  const skillPlan = skillPlanForExperience(plan, topic);
  return artifacts.map((a) => {
    const base = gateArtifactCopy(a);
    if (base.kind !== 'plain_assistant' || !base.content) return base;
    const reviewed = reviewOutput({
      scene: {
        scene: plan.skillScene ?? (plan.mode === 'deep_course' ? 'session_teach' : 'outline'),
        intent: 'learn',
        stage: plan.mode,
        topic: topic || plan.topic,
      },
      skillPlan,
      text: base.content,
    });
    const text = gateOutboundCopy(
      reviewed.modified ? reviewed.text : base.content,
      '正在处理…',
    );
    return { ...base, content: text };
  });
}

/** Build structured clarify artifact(s) from ExperiencePlan.clarificationSpec. */
function artifactsFromClarificationPlan(
  plan: ExperiencePlan,
  topic?: string,
): LearnArtifact[] {
  const spec = plan.clarificationSpec;
  if (!spec) {
    if (plan.clarifyQuestionZh) {
      return [
        {
          id: newArtifactId('clarify'),
          kind: 'plain_assistant',
          content: plan.clarifyQuestionZh,
          topic,
        },
      ];
    }
    return [];
  }
  const kind = clarificationSpecToArtifactKind(spec);
  return [
    {
      id: newArtifactId('clarify'),
      kind,
      title: clarificationFieldTitle(spec.field),
      content: spec.question,
      options: spec.options.map((o) => o.label),
      topic,
      clarification: {
        field: spec.field,
        selectionMode: spec.selectionMode,
        allowCustom: spec.allowCustom,
        optionIds: spec.options.map((o) => o.id),
      },
    },
  ];
}

function withPlan(
  result: OrchestratorResult,
  plan: ExperiencePlan,
): OrchestratorResult {
  return { ...result, experiencePlan: planToResultField(plan) };
}

/**
 * Recompute / merge skip flags from context + plan.
 * Explicit context booleans win (true = force skip, false = force run);
 * otherwise ExperiencePlan skippedSteps / shouldRun* apply.
 */
function resolveSkipFlags(
  ctx: OrchestratorContext,
  plan?: ExperiencePlan | null,
): { skipMemory: boolean; skipCalibration: boolean; skipResources: boolean } {
  const skipped = new Set<string>([
    ...(ctx.skippedSteps || []),
    ...(plan?.skippedSteps || []),
  ]);
  const fromPlan = {
    skipMemory:
      skipped.has('memory') || (plan ? !shouldRunMemoryStep(plan) : false),
    skipCalibration:
      skipped.has('calibration') ||
      (plan ? !shouldRunCalibrationStep(plan) : false),
    skipResources:
      skipped.has('resources') ||
      (plan ? !shouldRunResourceAgent(plan) : false),
  };
  return {
    skipMemory:
      ctx.skipMemory === true
        ? true
        : ctx.skipMemory === false
          ? false
          : fromPlan.skipMemory,
    skipCalibration:
      ctx.skipCalibration === true
        ? true
        : ctx.skipCalibration === false
          ? false
          : fromPlan.skipCalibration,
    skipResources:
      ctx.skipResources === true
        ? true
        : ctx.skipResources === false
          ? false
          : fromPlan.skipResources,
  };
}

function buildDeepPlanFromContext(
  ctx: OrchestratorContext,
  message: string,
  pack: {
    empty: boolean;
    summaryLine?: string;
    entries?: Array<{ text: string; kind?: string; confidence?: number }>;
  },
): ExperiencePlan {
  return planExperience({
    message: ctx.proposal || message,
    surface: ctx.surface || 'chat',
    contextPack: pack,
    knownGoal: ctx.knownGoal || ctx.topic || null,
    knownLevel:
      ctx.knownLevel ||
      ctx.calibrationAnswer ||
      (typeof ctx.calibrationSelected === 'number' ? `option:${ctx.calibrationSelected}` : null),
    intent: 'learn',
    confidence: 0.85,
    userModePreference:
      ctx.userModePreference === 'normal' || ctx.experienceMode === 'normal'
        ? 'normal'
        : 'deep',
    wantsResources: ctx.skipResources === true ? false : undefined,
    courseStage: ctx.stage,
    experienceMode: ctx.experienceMode || null,
  });
}

/**
 * Deep Planning outline path (batch-05 output boundary):
 * - Never emit buildMergedOutlineTeachMessage / :::summary / :::key dual-write
 * - User-visible: one natural guidance line + single editable outline_card
 * - SkillPlan: outline forbids learn-teach-format
 * - Outline edits stay preview-only; course commit is「开始学习」elsewhere
 */
async function runOutlinePath(opts: {
  topic: string;
  levelHint: string;
  llm: AgentLLMOptions;
  proposal?: string;
  skipResources: boolean;
  includeProgress: boolean;
  plan: ExperiencePlan;
}): Promise<OrchestratorResult> {
  const { topic, levelHint, llm, proposal, skipResources, plan } = opts;
  void opts.includeProgress; // progress dual chrome removed from outline path

  const skillPlan = skillPlanForExperience(plan, topic);
  // Hard boundary: teach-format skill must stay forbidden on outline
  if (
    skillPlan.enabledSkills.includes('learn-teach-format') ||
    skillPlan.outputPolicy.allowTeachFences
  ) {
    // Fail closed to plan mode — never dual-write teach chrome on outline
  }

  // ResourceAgent may still run for internal planning when not skipped, but
  // must not add a second primary surface next to the sole outline_card.
  if (!skipResources) {
    try {
      await runResourceAgent(topic, levelHint, llm);
    } catch {
      /* non-fatal: outline is the commit surface */
    }
  }

  const outline = await runOutlineAgent(topic, levelHint, llm, proposal);

  const guideContent = [
    `已为「${topic}」整理学习大纲，可直接调整单元与知识点。`,
    '确认「开始学习」后才会创建课程；日程排程需在日历中单独确认。',
  ].join('');

  let artifacts: LearnArtifact[] = [
    {
      id: newArtifactId('guide'),
      kind: 'plain_assistant',
      content: guideContent,
      topic,
    },
    {
      id: newArtifactId('out'),
      kind: 'outline_card',
      title: outline.goalTitle,
      units: outline.units,
      topic,
    },
  ];

  artifacts = gatePlainArtifacts(artifacts, plan, topic);

  // Uniqueness invariant
  const outlineCount = artifacts.filter((a) => a.kind === 'outline_card').length;
  if (outlineCount !== 1) {
    artifacts = artifacts.filter((a) => a.kind !== 'outline_card').concat(
      artifacts.filter((a) => a.kind === 'outline_card').slice(0, 1),
    );
  }

  auditExperiencePlan(plan);

  return withPlan(
    {
      route: skipResources ? 'learn_outline' : 'learn_resources',
      topic,
      nextStage: 'outline',
      artifacts,
    },
    plan,
  );
}

/**
 * Multi-agent orchestrator: Experience Planner routes chat | normal | deep | desktop.
 * Fixed ten-stage funnel no longer drives Chat/Normal (UX02).
 * Desktop execution stays in /api/agent (runAgentLoop); this returns runDesktop=true.
 * Side-effect / trust paths remain policy + HITL gated.
 */
export async function runOrchestrator(
  request: OrchestratorRequest,
  resolved: ResolvedProviderConfig,
  signal?: AbortSignal,
): Promise<OrchestratorResult> {
  const message = (request.message || '').trim();
  const action = request.action || 'intent';
  const ctx = request.context || {};
  const llm = {
    ...toLLMOptions(resolved),
    signal,
    userSystemPrompt: request.systemPrompt?.trim() || undefined,
  };
  const history = request.chatHistory;

  if (!message && action === 'intent') {
    return {
      route: 'chat',
      artifacts: [],
      streamChat: true,
      error: 'Empty message',
    };
  }

  try {
    switch (action) {
      case 'chat':
        return {
          route: 'chat',
          artifacts: [],
          streamChat: true,
          experiencePlan: planToResultField(
            planExperience({
              message,
              surface: ctx.surface || 'chat',
              intent: 'chat',
              confidence: 0.9,
              userModePreference: ctx.userModePreference,
            }),
          ),
        };

      case 'desktop': {
        const wantsTrust = ctx.requestedExecutionMode === 'trust';
        const deskPlan = planExperience({
          message: message || 'desktop',
          surface: ctx.surface || 'desktop',
          intent: 'desktop',
          confidence: 0.95,
        });
        if (wantsTrust && !ctx.trustConfirmed) {
          return withPlan(
            {
              route: 'desktop',
              artifacts: [],
              runDesktop: false,
              desktopEvents: [
                {
                  id: newArtifactId('confirm'),
                  kind: 'pending_tool_confirm',
                  content:
                    '请求提升到 trust 模式以进行本机更高权限操作。默认 sandbox；确认后才升权。',
                  confirmReason: 'trust_elevation',
                },
              ],
              nextStage: 'desktop_pending_trust',
            },
            deskPlan,
          );
        }
        return withPlan(
          {
            route: 'desktop',
            artifacts: [],
            runDesktop: true,
            desktopEvents: [
              {
                id: newArtifactId('think'),
                kind: 'thinking',
                content: '正在启动 Desktop 工具环（默认 sandbox）…',
              },
            ],
          },
          deskPlan,
        );
      }

      case 'reject_learn':
        return {
          route: 'chat',
          artifacts: [
            {
              id: newArtifactId('plain'),
              kind: 'plain_assistant',
              content: '好的，我们先聊别的。你随时可以再说想学什么。',
            },
          ],
          streamChat: false,
          nextStage: 'rejected',
          experiencePlan: planToResultField(
            planExperience({
              message: 'reject',
              surface: ctx.surface || 'chat',
              intent: 'chat',
              confidence: 1,
            }),
          ),
        };

      case 'confirm_learn': {
        // Explicit user confirm only — autonomy MUST NOT skip this gate.
        // propose ≠ commit: memory/goal only; no course/task/calendar write here.
        const topic = ctx.topic || message || '新主题';
        const proposal = ctx.proposal || message;
        const pack = await loadLearnerContextPack('intent');
        const plan = buildDeepPlanFromContext(
          { ...ctx, topic, proposal, userModePreference: ctx.userModePreference ?? 'deep' },
          message,
          pack,
        );
        const skips = resolveSkipFlags(
          { ...ctx, topic, proposal },
          plan,
        );

        // Fast path: ExperiencePlan says run outline (goal+level already known)
        if (plan.nextAction === 'run_outline') {
          return runOutlinePath({
            topic,
            levelHint: ctx.knownLevel || ctx.calibrationAnswer || '已提供基础',
            llm,
            proposal,
            skipResources: skips.skipResources,
            includeProgress: progressRailAllowedForExperienceMode(plan.mode),
            plan,
          });
        }

        // Explicit skip flags from client with known level (compat)
        if (
          skips.skipMemory &&
          skips.skipCalibration &&
          (ctx.knownLevel || ctx.calibrationAnswer)
        ) {
          return runOutlinePath({
            topic,
            levelHint: ctx.knownLevel || ctx.calibrationAnswer || '已提供基础',
            llm,
            proposal,
            skipResources: skips.skipResources,
            includeProgress: progressRailAllowedForExperienceMode(plan.mode),
            plan,
          });
        }

        // Natural one-question clarify when still missing a condition
        // (skip when caller forces memory/calibration compat path)
        if (
          plan.nextAction === 'natural_clarify' &&
          (plan.clarificationSpec || plan.clarifyQuestionZh) &&
          skips.skipMemory &&
          skips.skipCalibration
        ) {
          return withPlan(
            {
              route: 'learn_confirm',
              topic,
              proposal,
              nextStage: 'intent_proposed',
              streamChat: false,
              artifacts: artifactsFromClarificationPlan(plan, topic),
            },
            plan,
          );
        }

        // Skip memory but need calibration
        if (skips.skipMemory && !skips.skipCalibration) {
          const cal = await runCalibrateAgent(topic, llm, proposal);
          const kind =
            cal.kind === 'multi_choice'
              ? 'multi_choice'
              : cal.kind === 'free_text'
                ? 'free_text'
                : 'single_choice';
          const artifacts: LearnArtifact[] = [
            {
              id: newArtifactId('cal'),
              kind,
              title: '水平校准',
              content: cal.question,
              options: cal.options,
              topic,
            },
          ];
          if (progressRailAllowedForExperienceMode(plan.mode)) {
            const progress = await runProgressNarrator(topic, 'calibration', llm);
            const steps =
              progress.steps.length > 0
                ? progress.steps
                : buildProgressStepsFromStage('calibration');
            artifacts.push({
              id: newArtifactId('prog'),
              kind: 'progress_update',
              title: progress.title,
              content: progress.content,
              progressSteps: steps,
              topic,
            });
          }
          return withPlan(
            {
              route: 'learn_calibrate',
              topic,
              proposal,
              nextStage: 'calibration',
              artifacts,
            },
            plan,
          );
        }

        // Default deep confirm: memory (if not skipped) then goal_clarification
        const artifacts: LearnArtifact[] = [];
        if (!skips.skipMemory) {
          const memory = await runMemoryAgent(topic, llm, history, ctx.memoryEntries);
          // Vacuum empty memory — do not push empty card noise
          if (memory.entries.length > 0 || (memory.summary && !/暂无/.test(memory.summary))) {
            artifacts.push({
              id: newArtifactId('mem'),
              kind: 'memory_card',
              title: '召回记忆',
              content: memory.summary,
              memoryEntries: memory.entries,
              topic,
            });
          }
        }

        if (progressRailAllowedForExperienceMode(plan.mode)) {
          const progress = await runProgressNarrator(topic, 'goal_clarification', llm);
          const steps =
            progress.steps.length > 0
              ? progress.steps
              : buildProgressStepsFromStage('goal_clarification');
          artifacts.push({
            id: newArtifactId('prog'),
            kind: 'progress_update',
            title: progress.title,
            content: progress.content,
            progressSteps: steps,
            topic,
          });
        }

        // If memory was empty and we can skip to calibration, do so
        if (skips.skipCalibration) {
          return runOutlinePath({
            topic,
            levelHint: ctx.knownLevel || ctx.calibrationAnswer || '中等基础',
            llm,
            proposal,
            skipResources: skips.skipResources,
            includeProgress: progressRailAllowedForExperienceMode(plan.mode),
            plan,
          });
        }

        return withPlan(
          {
            route: 'learn_memory',
            topic,
            proposal,
            nextStage: 'goal_clarification',
            artifacts:
              artifacts.length > 0
                ? artifacts
                : [
                    {
                      id: newArtifactId('plain'),
                      kind: 'plain_assistant',
                      content: `好的，我们围绕「${topic}」继续。准备好后点继续即可。`,
                      topic,
                    },
                  ],
          },
          plan,
        );
      }

      case 'continue_memory': {
        const topic = ctx.topic || '新主题';
        const pack = await loadLearnerContextPack('calibrate');
        const plan = buildDeepPlanFromContext(ctx, message, pack);
        const skips = resolveSkipFlags(ctx, plan);

        if (skips.skipCalibration) {
          return runOutlinePath({
            topic,
            levelHint: ctx.knownLevel || ctx.calibrationAnswer || message || '中等基础',
            llm,
            proposal: ctx.proposal,
            skipResources: skips.skipResources,
            includeProgress: progressRailAllowedForExperienceMode(plan.mode),
            plan,
          });
        }

        const cal = await runCalibrateAgent(topic, llm, ctx.proposal);
        const kind =
          cal.kind === 'multi_choice'
            ? 'multi_choice'
            : cal.kind === 'free_text'
              ? 'free_text'
              : 'single_choice';
        const artifacts: LearnArtifact[] = [
          {
            id: newArtifactId('cal'),
            kind,
            title: '水平校准',
            content: cal.question,
            options: cal.options,
            topic,
          },
        ];
        if (progressRailAllowedForExperienceMode(plan.mode)) {
          const progress = await runProgressNarrator(topic, 'calibration', llm);
          const steps =
            progress.steps.length > 0
              ? progress.steps
              : buildProgressStepsFromStage('calibration');
          artifacts.push({
            id: newArtifactId('prog'),
            kind: 'progress_update',
            title: progress.title,
            content: progress.content,
            progressSteps: steps,
            topic,
          });
        }
        return withPlan(
          {
            route: 'learn_calibrate',
            topic,
            nextStage: 'calibration',
            artifacts,
          },
          plan,
        );
      }

      case 'select_calibration': {
        // free_text / multi_choice / single_choice all land here with calibrationAnswer
        const topic = ctx.topic || '新主题';
        const levelHint =
          ctx.calibrationAnswer ||
          (typeof ctx.calibrationSelected === 'number'
            ? `option index ${ctx.calibrationSelected}`
            : message);
        const pack = await loadLearnerContextPack('outline');
        const plan = buildDeepPlanFromContext(
          { ...ctx, knownLevel: String(levelHint), calibrationAnswer: String(levelHint) },
          message,
          pack,
        );
        const skips = resolveSkipFlags(
          { ...ctx, knownLevel: String(levelHint) },
          plan,
        );

        return runOutlinePath({
          topic,
          levelHint: String(levelHint),
          llm,
          proposal: ctx.proposal,
          skipResources: skips.skipResources,
          includeProgress: progressRailAllowedForExperienceMode(plan.mode),
          plan,
        });
      }

      case 'advance_resources': {
        const topic = ctx.topic || '新主题';
        const units = ctx.outlineUnits || [];
        const plan = planExperience({
          message: topic,
          surface: ctx.surface || 'chat',
          knownGoal: topic,
          knownLevel: ctx.knownLevel || ctx.calibrationAnswer,
          intent: 'learn',
          confidence: 0.9,
          userModePreference: 'deep',
        });
        const artifacts: LearnArtifact[] = [
          {
            id: newArtifactId('out'),
            kind: 'outline_card',
            title: `掌握 ${topic}`,
            units,
            topic,
          },
        ];
        if (progressRailAllowedForExperienceMode(plan.mode)) {
          const progress = await runProgressNarrator(topic, 'outline', llm);
          const steps =
            progress.steps.length > 0
              ? progress.steps
              : buildProgressStepsFromStage('outline');
          artifacts.push({
            id: newArtifactId('prog'),
            kind: 'progress_update',
            title: progress.title,
            content: progress.content,
            progressSteps: steps,
            topic,
          });
        }
        return withPlan(
          {
            route: 'learn_outline',
            topic,
            nextStage: 'outline',
            artifacts,
          },
          plan,
        );
      }

      case 'request_outline': {
        const topic = ctx.topic || '新主题';
        const levelHint = ctx.calibrationAnswer || ctx.knownLevel || message || '中等基础';
        const pack = await loadLearnerContextPack('outline');
        const plan = planExperience({
          message: `${topic} ${levelHint}`,
          surface: ctx.surface || 'chat',
          contextPack: pack,
          knownGoal: topic,
          knownLevel: String(levelHint),
          intent: 'learn',
          confidence: 0.9,
          userModePreference: 'deep',
          wantsResources: ctx.skipResources === true ? false : undefined,
        });
        const skips = resolveSkipFlags(ctx, plan);
        return runOutlinePath({
          topic,
          levelHint: String(levelHint),
          llm,
          proposal: ctx.proposal,
          skipResources: skips.skipResources,
          includeProgress: progressRailAllowedForExperienceMode(plan.mode),
          plan,
        });
      }

      case 'request_progress': {
        // Copy-only: ProgressNarrator explains repository stage; never persists mastery.
        const topic = ctx.topic || '新主题';
        const stage = normalizeLearnStage(ctx.stage || 'idle');
        const progress = await runProgressNarrator(topic, stage, llm);
        const steps =
          progress.steps.length > 0
            ? progress.steps
            : buildProgressStepsFromStage(stage);
        return {
          route: 'learn_progress',
          topic,
          artifacts: [
            {
              id: newArtifactId('prog'),
              kind: 'progress_update',
              title: progress.title,
              content: progress.content,
              progressSteps: steps,
              topic,
            },
          ],
        };
      }

      case 'intent':
      default: {
        const pack = await loadLearnerContextPack('intent');
        const judged = await judgeIntent(message, llm, history);

        const plan = planExperience({
          message,
          surface: ctx.surface || 'chat',
          contextPack: pack,
          knownGoal: ctx.knownGoal || judged.topic || null,
          knownLevel: ctx.knownLevel || null,
          intent: judged.intent,
          confidence: judged.confidence,
          userModePreference: ctx.userModePreference,
          wantsResources: undefined,
          courseStage: ctx.stage,
          experienceMode: ctx.experienceMode || null,
        });

        // Keep SkillPlan enabled/forbidden enforcement for this mode (audit + future gates)
        void skillPlanForExperience(plan, judged.topic);

        // ── Desktop ────────────────────────────────────────────────────
        if (plan.mode === 'desktop' || judged.intent === 'desktop') {
          const wantsTrust = ctx.requestedExecutionMode === 'trust';
          if (wantsTrust && !ctx.trustConfirmed) {
            return withPlan(
              {
                route: 'desktop',
                artifacts: [],
                runDesktop: false,
                topic: judged.topic,
                desktopEvents: [
                  {
                    id: newArtifactId('confirm'),
                    kind: 'pending_tool_confirm',
                    content:
                      '检测到 Desktop / 工具操控意图，且设置请求 trust。确认后才升权；否则以 sandbox 执行。',
                    confirmReason: 'trust_elevation',
                  },
                ],
                nextStage: 'desktop_pending_trust',
              },
              plan,
            );
          }
          return withPlan(
            {
              route: 'desktop',
              artifacts: [],
              runDesktop: true,
              topic: judged.topic,
              desktopEvents: [
                {
                  id: newArtifactId('think'),
                  kind: 'thinking',
                  content: judged.rationale || 'Desktop 工具环',
                },
              ],
            },
            plan,
          );
        }

        // ── Natural clarify (low confidence / missing deep condition) ──
        if (
          plan.nextAction === 'natural_clarify' &&
          (plan.clarificationSpec || plan.clarifyQuestionZh)
        ) {
          const clarifyTopic = plan.topic || judged.topic || undefined;
          return withPlan(
            {
              route: plan.mode === 'deep_planning' ? 'learn_confirm' : 'chat',
              topic: clarifyTopic,
              nextStage:
                plan.mode === 'deep_planning' ? 'intent_proposed' : 'idle',
              streamChat: false,
              artifacts: artifactsFromClarificationPlan(plan, clarifyTopic),
            },
            plan,
          );
        }

        // Deep short/greeting: do not restart planning
        if (
          plan.mode === 'deep_planning' &&
          plan.nextAction === 'await_user'
        ) {
          return withPlan(
            {
              route: 'chat',
              topic: plan.topic || judged.topic || undefined,
              nextStage: ctx.stage || 'intent_proposed',
              streamChat: false,
              artifacts: [
                {
                  id: newArtifactId('await'),
                  kind: 'plain_assistant',
                  content: '可以继续告诉我你想学的主题、基础，或直接描述目标。',
                  topic: plan.topic || judged.topic || undefined,
                },
              ],
            },
            plan,
          );
        }

        // ── Deep planning with enough info → outline (skip funnel) ─────
        if (plan.mode === 'deep_planning' && plan.nextAction === 'run_outline') {
          const topic =
            plan.topic || judged.topic || ctx.knownGoal || message.slice(0, 40) || '新主题';
          const levelHint = ctx.knownLevel || '已提供基础';
          // Re-extract level from message if planner saw it
          const levelFromPlan = message.match(
            /(零基础|完全不会|初学|入门|小白|中等基础|有(一点|些)?基础|学过|复过|进阶|高级|熟练)/,
          );
          return runOutlinePath({
            topic,
            levelHint: levelFromPlan?.[0] || levelHint,
            llm,
            proposal: judged.proposalSummary || message,
            skipResources: !shouldRunResourceAgent(plan),
            includeProgress: true,
            plan,
          });
        }

        // ── Calendar / Library surface signals ─────────────────────────
        if (plan.mode === 'calendar') {
          return withPlan(
            {
              route: 'chat',
              streamChat: true,
              topic: plan.topic,
              nextStage: 'idle',
              artifacts: [],
            },
            plan,
          );
        }

        if (plan.mode === 'library') {
          return withPlan(
            {
              route: 'chat',
              streamChat: true,
              nextStage: 'idle',
              artifacts: [],
            },
            plan,
          );
        }

        // ── Chat / Normal fast paths → stream (no ten-stage funnel) ────
        if (
          plan.mode === 'chat' ||
          plan.mode === 'normal' ||
          plan.nextAction === 'stream_chat'
        ) {
          return withPlan(
            {
              route: 'chat',
              artifacts: [],
              streamChat: true,
              topic: plan.topic || judged.topic || undefined,
              nextStage: 'idle',
            },
            plan,
          );
        }

        // Fallback: treat as chat (never force full funnel)
        return withPlan(
          {
            route: 'chat',
            artifacts: [],
            streamChat: true,
            topic: judged.topic || undefined,
            nextStage: 'idle',
          },
          plan,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Orchestrator failed';
    return {
      route: 'chat',
      artifacts: [
        {
          id: newArtifactId('err'),
          kind: 'plain_assistant',
          content: `刚才没处理完，可以再试一次。`,
        },
      ],
      streamChat: false,
      error: msg,
    };
  }
}
