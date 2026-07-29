/**
 * Batch-05 — Deep output boundary focused suite:
 * - unified SkillPlan output gate
 * - outline uniqueness (single outline_card + natural guide)
 * - no fence leak in public payloads
 * - learn-teach-format only for deep_course / session_teach
 * - course commit gate (no auto confirmTask)
 * - PublicExperiencePlan omits internalReason
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildSkillPlan,
  planExperience,
  reviewOutput,
  skillPlanForExperience,
  toPublicExperiencePlanMeta,
} from '@/lib/agents/control-plane';
import {
  hasLearnContentMarkup,
  toPublicTeachPayload,
  buildMergedOutlineTeachMessage,
  learningBlocksToDisplayText,
} from '@/lib/chat/learn-content';
import {
  canCommitCourseStart,
  courseStartAutoConfirmsPendingTasks,
  describeCalendarConfirmSteps,
  describeCourseCommitSteps,
  isOutlineEditCommitAction,
} from '@/lib/learning/course-commit';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import type { ResolvedProviderConfig } from '@/lib/config/server-env';

vi.mock('@/lib/agents/llm-json', () => ({
  callAgentJson: vi.fn(),
}));

vi.mock('@/lib/agents/resource', () => ({
  runResourceAgent: vi.fn(async () => ({
    resources: [{ title: 'Book A', reason: 'r', source: 'llm' as const }],
  })),
}));

vi.mock('@/lib/memory/context-pack-server', () => ({
  loadLearnerContextPack: vi.fn(async () => ({
    empty: true,
    labeledBlock: '',
    summaryLine: '',
    entries: [],
  })),
}));

import { callAgentJson } from '@/lib/agents/llm-json';
import { runResourceAgent } from '@/lib/agents/resource';

const resolved: ResolvedProviderConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  model: 'test-model',
  source: 'server',
  providerId: 'openai',
};

const units = [
  {
    title: 'Unit 1',
    knowledgePoints: ['KP1'],
    description: 'd',
    estimatedMinutes: 30,
  },
  {
    title: 'Unit 2',
    knowledgePoints: ['KP2'],
    description: 'd2',
    estimatedMinutes: 30,
  },
  {
    title: 'Unit 3',
    knowledgePoints: ['KP3'],
    description: 'd3',
    estimatedMinutes: 30,
  },
];

beforeEach(() => {
  vi.mocked(callAgentJson).mockReset();
  vi.mocked(runResourceAgent).mockClear();
});

describe('batch-05 SkillPlan gate', () => {
  it('outline forbids learn-teach-format and ::: fences', () => {
    const plan = buildSkillPlan({
      scene: 'outline',
      intent: 'learn',
      stage: 'outline',
    });
    expect(plan.enabledSkills).not.toContain('learn-teach-format');
    expect(plan.outputPolicy.allowTeachFences).toBe(false);

    const fenced = ':::summary\n大纲误用摘要\n:::\n\n:::key\n- 点\n:::';
    const reviewed = reviewOutput({
      scene: { scene: 'outline', intent: 'learn', stage: 'outline' },
      skillPlan: plan,
      text: fenced,
    });
    expect(reviewed.modified || reviewed.stripped).toBe(true);
    expect(hasLearnContentMarkup(reviewed.text)).toBe(false);
    expect(reviewed.text).not.toMatch(/:::summary|:::key/);
  });

  it('learn-teach-format only for session_teach / deep_course', () => {
    const teach = buildSkillPlan({
      scene: 'session_teach',
      intent: 'learn',
      stage: 'teaching',
    });
    expect(teach.enabledSkills).toContain('learn-teach-format');
    expect(teach.outputPolicy.allowTeachFences).toBe(false);

    const deepCourse = planExperience({
      message: '继续学',
      surface: 'course',
      courseStage: 'teaching',
      experienceMode: 'deep_course',
      knownGoal: 'Rust',
      knownLevel: '零基础',
      intent: 'learn',
      confidence: 0.9,
      contextPack: { empty: true },
    });
    const spCourse = skillPlanForExperience(deepCourse);
    expect(spCourse.enabledSkills).toContain('learn-teach-format');

    const deepPlan = planExperience({
      message: '深入学习 Rust 零基础',
      surface: 'chat',
      userModePreference: 'deep',
      knownGoal: 'Rust',
      knownLevel: '零基础',
      intent: 'learn',
      confidence: 0.9,
      contextPack: { empty: true },
    });
    const spOutline = skillPlanForExperience(deepPlan);
    expect(spOutline.enabledSkills).not.toContain('learn-teach-format');
    expect(spOutline.outputPolicy.allowTeachFences).toBe(false);
  });
});

describe('batch-05 fence leak / typed blocks', () => {
  it('toPublicTeachPayload strips fences and returns typed blocks', () => {
    const raw = `:::summary
闭包是捕获环境的函数。
:::

:::key
- 捕获
- 所有权
:::

**实践**
写一个例子。`;
    const pub = toPublicTeachPayload(raw);
    expect(pub.content).not.toMatch(/:::summary|:::key|:::/);
    expect(pub.contentBlocks.some((b) => b.kind === 'summary')).toBe(true);
    expect(pub.contentBlocks.some((b) => b.kind === 'key')).toBe(true);
    expect(pub.content).toContain('闭包');
    const display = learningBlocksToDisplayText(pub.contentBlocks);
    expect(display).not.toMatch(/:::summary/);
  });

  it('buildMergedOutlineTeachMessage must not be used as outline dual-write payload', () => {
    // Function still exists for session teach repair only; outline path must not emit it.
    const dual = buildMergedOutlineTeachMessage({
      topic: 'Rust',
      goalTitle: '掌握 Rust',
      units,
    });
    expect(hasLearnContentMarkup(dual)).toBe(true);
    // Public teach egress converts away fences
    const pub = toPublicTeachPayload(dual);
    expect(pub.content).not.toMatch(/:::/);
    expect(pub.contentBlocks.length).toBeGreaterThan(0);
  });
});

describe('batch-05 PublicExperiencePlan', () => {
  it('toPublicExperiencePlanMeta omits internalReason', () => {
    const plan = planExperience({
      message: '你好',
      surface: 'chat',
      intent: 'greeting',
      confidence: 0.95,
      contextPack: { empty: true },
    });
    expect(plan.internalReason.length).toBeGreaterThan(0);
    const pub = toPublicExperiencePlanMeta(plan);
    expect('internalReason' in pub).toBe(false);
    expect(pub.mode).toBeTruthy();
  });
});

describe('batch-05 outline uniqueness via orchestrator', () => {
  it('runOutlinePath emits natural guide + exactly one outline_card, no fences', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      goalTitle: '掌握 Rust',
      units,
    });

    const result = await runOrchestrator(
      {
        message: 'ok',
        action: 'confirm_learn',
        context: {
          topic: 'Rust',
          proposal: '学 Rust',
          knownGoal: 'Rust',
          knownLevel: '零基础',
          skipMemory: true,
          skipCalibration: true,
          skipResources: true,
          userModePreference: 'deep',
        },
      },
      resolved,
    );

    const outlines = result.artifacts.filter((a) => a.kind === 'outline_card');
    const guides = result.artifacts.filter((a) => a.kind === 'plain_assistant');
    expect(outlines).toHaveLength(1);
    expect(guides.length).toBeGreaterThanOrEqual(1);
    expect(result.artifacts.some((a) => a.kind === 'resource_list')).toBe(false);
    expect(result.artifacts.some((a) => a.kind === 'progress_update')).toBe(false);
    for (const a of result.artifacts) {
      expect(a.content || '').not.toMatch(/:::summary|:::key/);
    }
    expect(guides[0]?.content).toMatch(/大纲|开始学习/);
    expect(
      result.experiencePlan && 'internalReason' in result.experiencePlan,
    ).toBe(false);
  });
});

describe('batch-05 course commit gate', () => {
  it('outline edits are preview-only; 开始学习 is sole course commit', () => {
    expect(isOutlineEditCommitAction('rename')).toBe(false);
    expect(isOutlineEditCommitAction('add')).toBe(false);
    expect(
      canCommitCourseStart({
        stage: 'outline',
        outlineUnits: units,
        confirmed: false,
      }).ok,
    ).toBe(false);
    expect(
      canCommitCourseStart({
        stage: 'outline',
        outlineUnits: units,
        confirmed: true,
      }).ok,
    ).toBe(true);
  });

  it('course start does not auto-confirm pending calendar tasks', () => {
    expect(courseStartAutoConfirmsPendingTasks()).toBe(false);
    const courseSteps = describeCourseCommitSteps();
    expect(courseSteps).not.toContain('confirmPendingTasks');
    expect(courseSteps).not.toContain('confirmTask');
    expect(courseSteps).toContain('createCourse');
    expect(describeCalendarConfirmSteps()).toContain('confirmTask');
  });
});
