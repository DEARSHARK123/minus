import { describe, expect, it } from 'vitest';
import {
  buildIntentModeClarificationSpec,
  buildLevelClarificationSpec,
  buildTopicClarificationSpec,
  ClarificationSpecSchema,
  clarificationSpecToArtifactKind,
  isNonPlanningShortMessage,
  isPlaceholderGoal,
  LEVEL_CLARIFY_OPTIONS,
  sanitizeGoalCandidate,
} from '../clarification-spec';
import {
  extractGoalHint,
  planExperience,
  toPublicExperiencePlanMeta,
} from '../experience-plan';

describe('ClarificationSpec schema', () => {
  it('parses topic spec with chips + allowCustom', () => {
    const spec = buildTopicClarificationSpec();
    const parsed = ClarificationSpecSchema.safeParse(spec);
    expect(parsed.success).toBe(true);
    expect(spec.field).toBe('topic');
    expect(spec.selectionMode).toBe('single');
    expect(spec.allowCustom).toBe(true);
    expect(spec.options.length).toBeGreaterThan(0);
    expect(clarificationSpecToArtifactKind(spec)).toBe('single_choice');
  });

  it('level options match product contract', () => {
    const spec = buildLevelClarificationSpec('Rust');
    expect(spec.field).toBe('level');
    expect(spec.options.map((o) => o.label)).toEqual(
      LEVEL_CLARIFY_OPTIONS.map((o) => o.label),
    );
    expect(spec.options.map((o) => o.label)).toEqual([
      '零基础',
      '学过一点',
      '能完成基础任务',
      '想进阶',
      '其他',
    ]);
    expect(spec.question).toMatch(/Rust/);
  });

  it('intent mode is single without custom', () => {
    const spec = buildIntentModeClarificationSpec(null);
    expect(spec.field).toBe('intent_mode');
    expect(spec.allowCustom).toBe(false);
    expect(spec.selectionMode).toBe('single');
    expect(spec.options).toHaveLength(2);
  });

  it('multi selectionMode maps to multi_choice artifact kind', () => {
    const parsed = ClarificationSpecSchema.parse({
      field: 'level',
      question: '选适用项',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      selectionMode: 'multi',
      allowCustom: false,
    });
    expect(clarificationSpecToArtifactKind(parsed)).toBe('multi_choice');
  });
});

describe('placeholder goal rejection', () => {
  it.each([
    '一个主题',
    '某个领域',
    '刚才的主题',
    '一门课程',
    '学习一个主题',
    '某个主题',
    '主题',
  ])('rejects placeholder %s', (text) => {
    expect(isPlaceholderGoal(text)).toBe(true);
    expect(sanitizeGoalCandidate(text)).toBeNull();
  });

  it('accepts concrete goals', () => {
    expect(isPlaceholderGoal('Rust')).toBe(false);
    expect(sanitizeGoalCandidate('线性代数')).toBe('线性代数');
    expect(extractGoalHint('我想学习机器学习')).toBe('机器学习');
  });

  it('extractGoalHint drops placeholder capture', () => {
    expect(extractGoalHint('我想学习一个主题')).toBeNull();
    expect(extractGoalHint('系统学习某个领域')).toBeNull();
  });

  it('deep with placeholder goal re-asks topic clarify', () => {
    const plan = planExperience({
      message: '我想学习一个主题',
      userModePreference: 'deep',
      intent: 'learn',
      confidence: 0.9,
    });
    expect(plan.mode).toBe('deep_planning');
    expect(plan.nextAction).toBe('natural_clarify');
    expect(plan.clarificationSpec?.field).toBe('topic');
    expect(plan.clarificationSpec?.allowCustom).toBe(true);
  });
});

describe('single vs multi selection contract', () => {
  it('topic/level deep clarifies are single-select one field at a time', () => {
    const missingGoal = planExperience({
      message: '深入学习',
      userModePreference: 'deep',
      confidence: 0.85,
    });
    expect(missingGoal.clarificationSpec?.field).toBe('topic');
    expect(missingGoal.clarificationSpec?.selectionMode).toBe('single');

    const missingLevel = planExperience({
      message: '深入学习 TypeScript',
      userModePreference: 'deep',
      knownGoal: 'TypeScript',
      confidence: 0.9,
    });
    expect(missingLevel.clarificationSpec?.field).toBe('level');
    expect(missingLevel.clarificationSpec?.selectionMode).toBe('single');
    // one field only — not both
    expect(missingLevel.clarificationSpec?.field).not.toBe('topic');
  });

  it('public meta includes clarificationSpec without internalReason', () => {
    const plan = planExperience({
      message: '深入学习',
      userModePreference: 'deep',
      confidence: 0.8,
    });
    const pub = toPublicExperiencePlanMeta(plan);
    expect(pub.clarificationSpec?.field).toBe('topic');
    expect('internalReason' in pub).toBe(false);
  });
});

describe('Deep greeting / ordinary short sentences', () => {
  it('detects non-planning shorts', () => {
    expect(isNonPlanningShortMessage('你好')).toBe(true);
    expect(isNonPlanningShortMessage('好的')).toBe(true);
    expect(isNonPlanningShortMessage('嗯')).toBe(true);
    expect(isNonPlanningShortMessage('谢谢')).toBe(true);
    expect(isNonPlanningShortMessage('想学 Rust')).toBe(false);
    expect(isNonPlanningShortMessage('零基础')).toBe(false);
  });

  it('deep preference + greeting does not start planning clarify', () => {
    const plan = planExperience({
      message: '你好',
      userModePreference: 'deep',
      confidence: 0.9,
    });
    expect(plan.nextAction).not.toBe('natural_clarify');
    expect(plan.nextAction).not.toBe('run_outline');
  });

  it('prior deep_planning + short 好的 does not restart outline/clarify', () => {
    const plan = planExperience({
      message: '好的',
      userModePreference: 'deep',
      experienceMode: 'deep_planning',
      knownGoal: 'Rust',
      knownLevel: '零基础',
      confidence: 0.9,
    });
    expect(plan.mode).toBe('deep_planning');
    expect(plan.nextAction).toBe('await_user');
    expect(plan.clarificationSpec).toBeUndefined();
  });

  it('ordinary short without deep stays chat stream', () => {
    const plan = planExperience({
      message: '嗯',
      userModePreference: 'normal',
      confidence: 0.9,
    });
    expect(plan.mode).toBe('chat');
    expect(plan.nextAction).toBe('stream_chat');
  });
});
