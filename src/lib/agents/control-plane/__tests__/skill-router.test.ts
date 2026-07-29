import { describe, expect, it } from 'vitest';
import {
  allowsTeachFences,
  buildSkillPlan,
  sceneIdFromStage,
  skillPlanAllowsTeachFences,
} from '../skill-router';
import { SkillPlanSchema } from '../schemas';

describe('buildSkillPlan', () => {
  it('chat / greeting: enables plain-conversation; forbids teach skills', () => {
    const plan = buildSkillPlan({
      scene: 'chat',
      intent: 'greeting',
      stage: 'idle',
    });
    expect(SkillPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.enabledSkills).toContain('plain-conversation');
    expect(plan.enabledSkills).toContain('clarification');
    expect(plan.enabledSkills).not.toContain('learn-teach-format');
    expect(plan.forbiddenSkills).toContain('learn-divide');
    expect(plan.outputPolicy.allowTeachFences).toBe(false);
    expect(plan.outputPolicy.responseMode).toBe('plain');
    expect(allowsTeachFences(plan)).toBe(false);
    expect(skillPlanAllowsTeachFences(plan)).toBe(false);
  });

  it('planning: goal / decompose / planning / scope; no teach-format', () => {
    const plan = buildSkillPlan({
      scene: 'planning',
      intent: 'learn',
      stage: 'calibrating',
      topic: '线性代数',
    });
    expect(plan.enabledSkills).toEqual(
      expect.arrayContaining([
        'goal-clarification',
        'problem-decomposition',
        'planning',
        'scope-control',
      ]),
    );
    expect(plan.enabledSkills).not.toContain('learn-teach-format');
    expect(plan.forbiddenSkills).toContain('common-mistakes');
    expect(plan.outputPolicy.allowTeachFences).toBe(false);
    expect(plan.outputPolicy.responseMode).toBe('plan');
  });

  it('outline: learn-divide + validators; forbids teach-format', () => {
    const plan = buildSkillPlan({
      scene: 'outline',
      intent: 'learn',
      stage: 'outline',
    });
    expect(plan.enabledSkills).toContain('learn-divide');
    expect(plan.enabledSkills).toContain('prerequisite-analysis');
    expect(plan.enabledSkills).toContain('outline-validator');
    expect(plan.enabledSkills).not.toContain('learn-teach-format');
    expect(plan.outputPolicy.allowTeachFences).toBe(false);
  });

  it('session_teach: teach-format only among session skills', () => {
    const plan = buildSkillPlan({
      scene: 'session_teach',
      intent: 'learn',
      stage: 'teaching',
    });
    expect(plan.enabledSkills).toContain('learn-teach-format');
    expect(plan.enabledSkills).not.toContain('session-recall');
    expect(plan.enabledSkills).not.toContain('session-assess');
    expect(plan.outputPolicy.allowTeachFences).toBe(false);
    expect(plan.outputPolicy.responseMode).toBe('teach');
  });

  it('session_recall / assess / remediate are phase-gated (not all at once)', () => {
    const recall = buildSkillPlan({
      scene: 'session_recall',
      intent: 'learn',
      stage: 'recall',
    });
    const assess = buildSkillPlan({
      scene: 'session_assess',
      intent: 'learn',
      stage: 'assessment',
    });
    const remediate = buildSkillPlan({
      scene: 'session_remediate',
      intent: 'learn',
      stage: 'remediation',
    });
    expect(recall.enabledSkills).toContain('session-recall');
    expect(recall.enabledSkills).not.toContain('learn-teach-format');
    expect(assess.enabledSkills).toContain('session-assess');
    expect(assess.enabledSkills).not.toContain('session-remediate');
    expect(remediate.enabledSkills).toContain('session-remediate');
    expect(remediate.forbiddenSkills).toContain('session-assess');
  });

  it('desktop: tool skills; teach-format only with explicit teach intent', () => {
    const plain = buildSkillPlan({
      scene: 'desktop',
      intent: 'desktop',
      stage: 'idle',
    });
    expect(plain.enabledSkills).toEqual(
      expect.arrayContaining([
        'task-planning',
        'tool-selection',
        'workspace-files',
        'risk-review',
      ]),
    );
    expect(plain.enabledSkills).not.toContain('learn-teach-format');
    expect(plain.outputPolicy.allowTeachFences).toBe(false);

    const teach = buildSkillPlan({
      scene: 'desktop',
      intent: 'teach',
      stage: 'idle',
      topic: '讲解这段代码',
    });
    expect(teach.enabledSkills).toContain('learn-teach-format');
    expect(teach.outputPolicy.allowTeachFences).toBe(false);
  });

  it('SkillPlan always has enabledSkills and forbiddenSkills', () => {
    const scenes = [
      'chat',
      'planning',
      'outline',
      'session_teach',
      'desktop',
      'memory',
      'settings',
    ] as const;
    for (const scene of scenes) {
      const plan = buildSkillPlan({ scene, intent: 'chat', stage: 'idle' });
      expect(Array.isArray(plan.enabledSkills)).toBe(true);
      expect(Array.isArray(plan.forbiddenSkills)).toBe(true);
      expect(plan.rationale.length).toBeGreaterThan(0);
      expect(plan.budget.maxSkillCalls).toBeGreaterThan(0);
    }
  });
});

describe('sceneIdFromStage', () => {
  it('maps idle + chat intent to chat', () => {
    expect(sceneIdFromStage('idle', { intent: 'chat', route: 'chat' })).toBe('chat');
  });

  it('maps learn calibrating to planning', () => {
    expect(
      sceneIdFromStage('calibrating', { intent: 'learn', route: 'learn_calibrate' }),
    ).toBe('planning');
  });

  it('maps outline stage to outline', () => {
    expect(sceneIdFromStage('outline', { intent: 'learn' })).toBe('outline');
  });
});
