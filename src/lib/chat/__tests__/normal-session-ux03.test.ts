/**
 * UX03 focused acceptance: greeting/simple Q, fast answer, inline continue,
 * no rail, context copy, error sanitization (pure-function level).
 */
import { describe, expect, it } from 'vitest';
import { planExperience } from '@/lib/agents/control-plane/experience-plan';
import { progressRailAllowedForExperienceMode } from '@/lib/agents/learn-state-machine';
import {
  filterVisibleArtifacts,
  shouldShowLearnProgressRail,
} from '../artifact-visibility';
import {
  containsRawDisconnectText,
  friendlyErrorMessageBody,
  friendlyErrorToast,
} from '../error-sanitize';
import { buildHomeSuggestions, isNeutralOnlyHome } from '../home-suggestions';
import type { LearnArtifact } from '@/lib/agents/types';

describe('UX03 Normal Session acceptance (pure)', () => {
  it('greeting routes to chat stream without funnel', () => {
    const plan = planExperience({
      message: '你好',
      intent: 'chat',
      confidence: 0.9,
      surface: 'chat',
      userModePreference: 'normal',
      contextPack: { empty: true, summaryLine: '' },
    });
    expect(plan.mode).toBe('chat');
    expect(plan.nextAction).toBe('stream_chat');
    expect(plan.skippedSteps).toEqual(
      expect.arrayContaining(['memory', 'calibration', 'outline']),
    );
    expect(plan.internalReason).toBeTruthy(); // audit only
  });

  it('simple one-shot question → fast answer (normal stream)', () => {
    const plan = planExperience({
      message: '什么是闭包',
      intent: 'chat',
      confidence: 0.85,
      surface: 'chat',
      userModePreference: 'normal',
      contextPack: { empty: true, summaryLine: '' },
    });
    expect(plan.mode).toBe('normal');
    expect(plan.nextAction).toBe('stream_chat');
    expect(plan.requiredSteps).toContain('direct_answer');
    expect(progressRailAllowedForExperienceMode(plan.mode)).toBe(false);
    expect(shouldShowLearnProgressRail(plan.mode, 'calibration')).toBe(false);
  });

  it('inline interaction auto-continue: choices visible, no submit-calibration CTA copy required', () => {
    const arts: LearnArtifact[] = [
      {
        id: '1',
        kind: 'plain_assistant',
        content: '闭包是函数与其词法环境的组合。',
      },
      {
        id: '2',
        kind: 'single_choice',
        content: '想再看一个例子吗？',
        options: ['好', '先这样'],
      },
      {
        id: '3',
        kind: 'progress_update',
        title: '进度',
        progressSteps: [{ id: 'a', label: '校准', status: 'active' }],
      },
      {
        id: '4',
        kind: 'memory_card',
        content: '暂无长期记忆',
        memoryEntries: [],
      },
    ];
    const visible = filterVisibleArtifacts(arts, { experienceMode: 'normal' });
    expect(visible.map((a) => a.kind)).toEqual(['plain_assistant', 'single_choice']);
    // No submit calibration flow artifacts
    expect(visible.every((a) => a.kind !== 'progress_update')).toBe(true);
  });

  it('Normal has no progress rail', () => {
    expect(shouldShowLearnProgressRail('normal', 'outline')).toBe(false);
    expect(shouldShowLearnProgressRail('chat', 'intent_proposed')).toBe(false);
    // UX04: outline surface uses editable outline, not Home progress rail
    expect(shouldShowLearnProgressRail('deep_planning', 'outline')).toBe(false);
    // UX08: Home rail fully quarantined (including mid deep-planning)
    expect(shouldShowLearnProgressRail('deep_planning', 'calibration')).toBe(false);
  });

  it('context copy: no defensive hasContext:false disclaimer on empty home', () => {
    const chips = buildHomeSuggestions({ hasContext: false });
    expect(isNeutralOnlyHome({ hasContext: false })).toBe(true);
    for (const c of chips) {
      expect(c.title + c.prompt).not.toMatch(
        /hasContext|暂无长期记忆|no relevant memory|防御|上下文为空|没有记忆/i,
      );
    }
  });

  it('errors: friendly toast + message body without raw disconnect', () => {
    const toast = friendlyErrorToast(new Error('[连接中断: HTTP 500]'));
    const body = friendlyErrorMessageBody(new Error('[连接中断: HTTP 500]'));
    expect(toast).not.toMatch(/连接中断|HTTP 500/);
    expect(containsRawDisconnectText(body)).toBe(false);
    expect(body).toMatch(/重试/);
  });

  it('deep preference from Home can enter deep planning clarify', () => {
    const plan = planExperience({
      message: '我想系统学线性代数',
      intent: 'learn',
      confidence: 0.8,
      surface: 'chat',
      userModePreference: 'deep',
      contextPack: { empty: true, summaryLine: '' },
    });
    expect(plan.mode).toBe('deep_planning');
    expect(plan.nextAction).toMatch(/clarify|outline|natural/);
  });
});
