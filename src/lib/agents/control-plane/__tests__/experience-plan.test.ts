import { describe, expect, it } from 'vitest';
import {
  ExperiencePlanSchema,
  extractGoalHint,
  extractLevelHint,
  funnelAllowedForMode,
  isSkillAllowedByExperience,
  planExperience,
  shouldRunCalibrationStep,
  shouldRunMemoryStep,
  shouldRunResourceAgent,
  skillPlanForExperience,
  toPublicExperiencePlanMeta,
} from '../experience-plan';
import { SkillPlanSchema } from '../schemas';

describe('ExperiencePlan schema', () => {
  it('validates required fields including internalReason', () => {
    const plan = planExperience({
      message: '什么是闭包',
      surface: 'chat',
      intent: 'chat',
      confidence: 0.9,
    });
    const parsed = ExperiencePlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.mode).toBe('normal');
    expect(plan.internalReason.length).toBeGreaterThan(0);
    expect(plan.surface).toBe('chat');
    expect(plan.commitPolicy).toBe('none');
  });

  it('toPublicExperiencePlanMeta keeps clarify but always includes steps', () => {
    const plan = planExperience({
      message: '深入学习',
      confidence: 0.8,
      userModePreference: 'deep',
    });
    const pub = toPublicExperiencePlanMeta(plan);
    expect(pub.mode).toBe('deep_planning');
    expect(pub.nextAction).toBe('natural_clarify');
    expect(pub.clarifyQuestionZh).toBeTruthy();
    // public meta intentionally omits internalReason key usage in UI
    expect('internalReason' in pub).toBe(false);
  });
});

describe('planExperience fast paths', () => {
  it('one-shot question → direct answer, no funnel steps', () => {
    const plan = planExperience({
      message: '什么是闭包？',
      surface: 'chat',
      intent: 'chat',
      confidence: 0.92,
    });
    expect(plan.mode).toBe('normal');
    expect(plan.nextAction).toBe('stream_chat');
    expect(plan.requiredSteps).toContain('direct_answer');
    expect(plan.skippedSteps).toEqual(
      expect.arrayContaining([
        'memory',
        'calibration',
        'resources',
        'outline',
        'start_session',
      ]),
    );
    expect(funnelAllowedForMode(plan.mode)).toBe(false);
    expect(shouldRunResourceAgent(plan)).toBe(false);
    expect(shouldRunMemoryStep(plan)).toBe(false);
  });

  it('goal + level present on explicit deep → skip memory & calibration, run outline', () => {
    const plan = planExperience({
      message: '深入学习 Rust，我是零基础',
      surface: 'chat',
      intent: 'learn',
      confidence: 0.9,
      userModePreference: 'deep',
      knownGoal: 'Rust',
      knownLevel: '零基础',
    });
    expect(plan.mode).toBe('deep_planning');
    expect(plan.nextAction).toBe('run_outline');
    expect(plan.skippedSteps).toContain('memory');
    expect(plan.skippedSteps).toContain('calibration');
    expect(plan.requiredSteps).toContain('outline');
    expect(shouldRunMemoryStep(plan)).toBe(false);
    expect(shouldRunCalibrationStep(plan)).toBe(false);
  });

  it('no resource need → resources skipped (ResourceAgent must not run)', () => {
    const plan = planExperience({
      message: '深入学习线性代数，有一点基础',
      intent: 'learn',
      confidence: 0.88,
      userModePreference: 'deep',
      knownGoal: '线性代数',
      knownLevel: '有一点基础',
      wantsResources: false,
    });
    expect(plan.skippedSteps).toContain('resources');
    expect(shouldRunResourceAgent(plan)).toBe(false);
  });

  it('explicit resource ask keeps resources on deep path', () => {
    const plan = planExperience({
      message: '深入学习概率论并推荐学习资料，零基础',
      intent: 'learn',
      confidence: 0.9,
      userModePreference: 'deep',
      knownGoal: '概率论',
      knownLevel: '零基础',
    });
    expect(plan.requiredSteps).toContain('resources');
    expect(shouldRunResourceAgent(plan)).toBe(true);
  });
});

describe('planExperience mode decisions', () => {
  it('normal learn-ish without Deep → stream, no outline funnel', () => {
    const plan = planExperience({
      message: '我想学习机器学习',
      surface: 'chat',
      intent: 'learn',
      confidence: 0.9,
      knownGoal: '机器学习',
    });
    expect(plan.mode).toBe('normal');
    expect(plan.nextAction).toBe('stream_chat');
    expect(plan.skippedSteps).toContain('outline');
    expect(plan.skippedSteps).toContain('memory');
    expect(funnelAllowedForMode(plan.mode)).toBe(false);
  });

  it('explicit deep missing goal → one natural clarify only', () => {
    const plan = planExperience({
      message: '我想深入学习',
      intent: 'learn',
      confidence: 0.85,
      userModePreference: 'deep',
    });
    expect(plan.mode).toBe('deep_planning');
    expect(plan.nextAction).toBe('natural_clarify');
    expect(plan.clarifyQuestionZh).toMatch(/主题/);
    expect(plan.requiredSteps.filter((s) => s === 'natural_clarify')).toHaveLength(1);
  });

  it('explicit deep has goal missing level → one level question', () => {
    const plan = planExperience({
      message: '深入学习 TypeScript',
      intent: 'learn',
      confidence: 0.9,
      knownGoal: 'TypeScript',
    });
    expect(plan.nextAction).toBe('natural_clarify');
    expect(plan.clarifyQuestionZh).toMatch(/基础/);
    expect(plan.skippedSteps).toContain('memory');
    expect(plan.skippedSteps).toContain('calibration');
  });

  it('calendar surface / phrasing → calendar mode', () => {
    const bySurface = planExperience({
      message: '看一下安排',
      surface: 'calendar',
      confidence: 0.7,
    });
    expect(bySurface.mode).toBe('calendar');
    expect(bySurface.nextAction).toBe('calendar_propose');
    expect(bySurface.skippedSteps).toContain('outline');

    const byText = planExperience({
      message: '帮我安排日程学习英语',
      surface: 'chat',
      confidence: 0.8,
    });
    expect(byText.mode).toBe('calendar');
  });

  it('course surface → deep_course (compat SM owner)', () => {
    const plan = planExperience({
      message: '下一节',
      surface: 'course',
      courseStage: 'teaching',
      confidence: 0.9,
    });
    expect(plan.mode).toBe('deep_course');
    expect(plan.nextAction).toBe('deep_course_advance');
    expect(funnelAllowedForMode(plan.mode)).toBe(true);
  });

  it('desktop intent → policy_gated desktop', () => {
    const plan = planExperience({
      message: '帮我在项目里跑一下测试',
      intent: 'desktop',
      confidence: 0.95,
    });
    expect(plan.mode).toBe('desktop');
    expect(plan.nextAction).toBe('run_desktop');
    expect(plan.commitPolicy).toBe('policy_gated');
  });
});

describe('planExperience low confidence', () => {
  it('low confidence → natural clarification, not confirm_gate funnel', () => {
    const plan = planExperience({
      message: '那个东西怎么办',
      intent: 'learn',
      confidence: 0.3,
    });
    expect(plan.nextAction).toBe('natural_clarify');
    expect(plan.mode).toBe('chat');
    expect(plan.clarifyQuestionZh).toBeTruthy();
    expect(plan.skippedSteps).toContain('outline');
    expect(plan.commitPolicy).toBe('none');
    expect(plan.internalReason).toMatch(/low_confidence|natural clarify/i);
  });
});

describe('SkillPlan enforcement via ExperiencePlan', () => {
  it('chat/normal forbids teach-format and learn-divide', () => {
    const plan = planExperience({
      message: '什么是闭包',
      intent: 'chat',
      confidence: 0.9,
    });
    const sp = skillPlanForExperience(plan);
    expect(SkillPlanSchema.safeParse(sp).success).toBe(true);
    expect(sp.enabledSkills).not.toContain('learn-teach-format');
    expect(isSkillAllowedByExperience(plan, 'learn-teach-format')).toBe(false);
    expect(isSkillAllowedByExperience(plan, 'plain-conversation')).toBe(true);
  });

  it('deep_planning outline scene forbids teach-format fences skill as primary', () => {
    const plan = planExperience({
      message: '深入学习 Rust，零基础',
      intent: 'learn',
      confidence: 0.9,
      userModePreference: 'deep',
      knownGoal: 'Rust',
      knownLevel: '零基础',
    });
    const sp = skillPlanForExperience(plan);
    expect(sp.enabledSkills).not.toContain('learn-teach-format');
    expect(sp.outputPolicy.allowTeachFences).toBe(false);
  });

  it('desktop keeps tool sideEffects and forbids teach by default', () => {
    const plan = planExperience({
      message: '改一下本地文件',
      intent: 'desktop',
      confidence: 0.9,
    });
    const sp = skillPlanForExperience(plan);
    expect(sp.sideEffects).toBe('tool');
    expect(sp.enabledSkills).not.toContain('learn-teach-format');
  });
});

describe('extract helpers', () => {
  it('extracts level and goal hints', () => {
    expect(extractLevelHint('我想学 Rust，零基础')).toBe('零基础');
    expect(extractGoalHint('想学机器学习')).toMatch(/机器学习/);
  });
});
