import { describe, expect, it } from 'vitest';
import {
  buildHomeSuggestions,
  countPersonalHomeSuggestions,
  isNeutralOnlyHome,
  NEUTRAL_CAPABILITY_CHIPS,
} from '../home-suggestions';

describe('home-suggestions (UX03)', () => {
  it('empty user gets at most 3 neutral chips (no fake personalization)', () => {
    const chips = buildHomeSuggestions({});
    expect(isNeutralOnlyHome({})).toBe(true);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips.every((c) => c.source === 'capability')).toBe(true);
    expect(chips.some((c) => /为你推荐|专属|多 Agent|沙箱|policy/i.test(c.title))).toBe(
      false,
    );
    expect(chips.some((c) => /沙箱|propose|确认后才写入|Desktop 工具/i.test(c.prompt))).toBe(
      false,
    );
    expect(chips.length).toBeLessThanOrEqual(NEUTRAL_CAPABILITY_CHIPS.length);
  });

  it('contextual user gets at most one aggregated continue-learning entry', () => {
    const chips = buildHomeSuggestions({
      recentTasks: [
        {
          id: 't1',
          title: '线性代数 · 特征值',
          status: 'in_progress',
          courseId: 'c1',
          unitId: 'u1',
          updatedAt: '2026-07-13T12:00:00.000Z',
        },
        {
          id: 't2',
          title: '线性代数 · 特征值',
          status: 'in_progress',
          courseId: 'c1',
          unitId: 'u1',
          updatedAt: '2026-07-13T11:00:00.000Z',
        },
        {
          id: 't3',
          title: '完成微积分作业',
          status: 'confirmed',
          courseId: 'c2',
          updatedAt: '2026-07-12T10:00:00.000Z',
        },
      ],
    });
    expect(isNeutralOnlyHome({ recentTaskTitles: ['x'] })).toBe(false);
    expect(countPersonalHomeSuggestions(chips)).toBeLessThanOrEqual(1);
    const personal = chips.filter((c) => c.source !== 'capability');
    expect(personal).toHaveLength(1);
    expect(personal[0]!.title).toMatch(/继续学习/);
    expect(personal[0]!.title).toMatch(/线性代数/);
    // Not one chip per task
    expect(chips.filter((c) => c.source === 'recent_task').length).toBe(0);
  });

  it('includes context-based continue when hasContext + summary and no tasks', () => {
    const chips = buildHomeSuggestions({
      hasContext: true,
      contextSummaryLine: '偏好：先举例',
    });
    expect(chips.some((c) => c.source === 'context' || c.title.includes('继续'))).toBe(
      true,
    );
    expect(countPersonalHomeSuggestions(chips)).toBeLessThanOrEqual(1);
  });

  it('skips empty context even if summary set without hasContext', () => {
    const chips = buildHomeSuggestions({
      hasContext: false,
      contextSummaryLine: 'should ignore',
    });
    expect(chips.every((c) => c.source !== 'context')).toBe(true);
    expect(isNeutralOnlyHome({ hasContext: false, contextSummaryLine: 'x' })).toBe(true);
  });

  it('prompts are natural short phrases without system policy', () => {
    const chips = buildHomeSuggestions({
      recentTaskTitles: ['任务 A'],
      recentConversationTitles: ['关于 React'],
      hasContext: true,
      contextSummaryLine: '目标：CS',
    });
    for (const c of chips) {
      expect(c.defaultMode === 'send' || c.defaultMode === 'edit').toBe(true);
      expect(c.prompt.trim().length).toBeGreaterThan(0);
      expect(c.prompt).not.toMatch(/propose\s*[≠!=]=\s*commit|sandbox|SkillPlan|IntentJudge/i);
    }
  });

  it('titles-only recent tasks still collapse to one continue entry', () => {
    const chips = buildHomeSuggestions({
      recentTaskTitles: ['闭包练习', '闭包练习', '另一任务'],
    });
    expect(countPersonalHomeSuggestions(chips)).toBe(1);
  });
});
