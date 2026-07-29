/**
 * Batch-03 focused integration of selector + multi toggle contract + placeholder.
 * Does not claim browser E2E.
 */

import { describe, expect, it } from 'vitest';
import {
  canUpgradeToDeep,
  effectiveExperienceMode,
  modeToggleUiState,
} from '../effective-experience-mode';
import {
  ClarificationSpecSchema,
  isPlaceholderGoal,
  LEVEL_CLARIFY_OPTIONS,
} from '@/lib/agents/control-plane/clarification-spec';
import { planExperience } from '@/lib/agents/control-plane/experience-plan';

describe('batch-03 mode + clarification integration', () => {
  it('single mode truth: conversation deep pref + route chat → deep_planning UI status', () => {
    const mode = effectiveExperienceMode({
      conversation: {
        modePreference: 'deep',
        experience: { experienceMode: 'deep_planning', modePreference: 'deep' },
      },
      route: '/chat',
      experienceMode: 'deep_planning',
    });
    expect(mode).toBe('deep_planning');
    const ui = modeToggleUiState(mode);
    expect(ui.showDeepStatus).toBe(true);
    expect(ui.showToggle).toBe(false);
    expect(ui.showUpgradeCta).toBe(false);
  });

  it('only chat/normal may show upgrade-to-deep', () => {
    expect(canUpgradeToDeep(effectiveExperienceMode({ route: '/chat' }))).toBe(
      true,
    );
    expect(
      canUpgradeToDeep(
        effectiveExperienceMode({
          route: '/chat',
          experienceMode: 'deep_planning',
        }),
      ),
    ).toBe(false);
    expect(
      canUpgradeToDeep(effectiveExperienceMode({ route: '/course/1' })),
    ).toBe(false);
  });

  it('ClarificationSpec zod rejects invalid field', () => {
    const bad = ClarificationSpecSchema.safeParse({
      field: 'not_a_field',
      question: 'q',
      options: [],
      selectionMode: 'single',
      allowCustom: false,
    });
    expect(bad.success).toBe(false);
  });

  it('multi selectionMode requires explicit continue (schema contract)', () => {
    const multi = ClarificationSpecSchema.parse({
      field: 'level',
      question: '选你熟悉的',
      options: LEVEL_CLARIFY_OPTIONS.slice(0, 3),
      selectionMode: 'multi',
      allowCustom: false,
    });
    expect(multi.selectionMode).toBe('multi');
    // Product rule: multi never auto-submits on first click — UI uses toggle + 继续.
    // Enforced in learn-flow selectCalibration (toggle-only for multi_choice).
    expect(multi.selectionMode).not.toBe('single');
  });

  it('placeholder goals never become knownGoal on deep path', () => {
    for (const p of ['一个主题', '某个领域', '刚才的主题', '一门课程']) {
      expect(isPlaceholderGoal(p)).toBe(true);
      const plan = planExperience({
        message: `我想学习${p}`,
        userModePreference: 'deep',
        confidence: 0.9,
        intent: 'learn',
      });
      expect(plan.topic).toBeUndefined();
      expect(plan.clarificationSpec?.field).toBe('topic');
    }
  });

  it('normal short question still answers first (no deep funnel)', () => {
    const plan = planExperience({
      message: '什么是闭包？',
      userModePreference: 'normal',
      intent: 'chat',
      confidence: 0.92,
    });
    expect(plan.mode).toBe('normal');
    expect(plan.nextAction).toBe('stream_chat');
    expect(plan.clarificationSpec).toBeUndefined();
  });
});
