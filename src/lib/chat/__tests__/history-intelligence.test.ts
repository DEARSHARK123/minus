import { describe, expect, it } from 'vitest';
import {
  assertSafeResume,
  buildChatIntelligence,
  buildSafeResumePayload,
  buildSessionIntelligence,
  deriveChatTitle,
  isForbiddenHistoryPrimaryCopy,
} from '../history-intelligence';

describe('history-intelligence (B07/UX06)', () => {
  it('derives title from first user message when store title is generic', () => {
    const title = deriveChatTitle(
      [
        { role: 'user', content: '帮我规划线性代数学习路径' },
        { role: 'assistant', content: '好的…' },
      ],
      '新对话',
    );
    expect(title).toContain('线性代数');
  });

  it('builds chat summary without message counts; safe resume never replays tools', () => {
    const intel = buildChatIntelligence({
      id: 'conv_1',
      title: '新对话',
      messages: [
        { role: 'user', content: '请帮我确认是否开始学习' },
        {
          role: 'assistant',
          content: '等待你的确认后继续…',
        },
      ],
    });
    expect(intel.title).toMatch(/确认|开始学习/);
    expect(intel.summary.length).toBeGreaterThan(0);
    expect(intel.summary).not.toMatch(/\d+\s*条.*消息/);
    expect(intel.incomplete.length).toBeGreaterThan(0);
    expect(intel.safeResume.autoReplayTools).toBe(false);
    expect(intel.safeResume.mode).toBe('context_only');
    expect(intel.safeResume.target).toBe('home');
    expect(intel.hideFromPrimary.messageCount).toBe(true);
    expect(() => assertSafeResume(intel)).not.toThrow();
    const payload = buildSafeResumePayload(intel);
    expect(payload.autoReplayTools).toBe(false);
  });

  it('session intelligence uses goal title; lists incomplete; no session id title', () => {
    const intel = buildSessionIntelligence(
      {
        id: 'sess_1',
        courseId: 'c1',
        taskId: 't1',
        startedAt: '2026-07-13T10:00:00.000Z',
        sections: [
          {
            id: 's1',
            status: 'done',
            phase: 'done',
            title: '引入',
            assessment: { result: 'pass' },
            masteryLevel: 'mastered',
          },
          {
            id: 's2',
            status: 'open',
            phase: 'teach',
            title: '核心概念',
          },
        ],
      },
      { courseTitle: '微积分', taskTitle: '第 1 课' },
    );
    expect(intel.title).toBe('第 1 课');
    expect(intel.title).not.toContain('sess_');
    expect(intel.decisions.some((d) => /掌握得不错|通过/.test(d.label))).toBe(
      true,
    );
    expect(intel.incomplete.some((i) => i.label.includes('核心概念'))).toBe(
      true,
    );
    expect(intel.safeResume.autoReplayTools).toBe(false);
    expect(intel.safeResume.target).toBe('session');
    expect(intel.safeResume.courseId).toBe('c1');
  });

  it('assertSafeResume rejects tool replay', () => {
    const bad = buildChatIntelligence({ id: 'x', messages: [] });
    (bad.safeResume as { autoReplayTools: boolean }).autoReplayTools = true;
    expect(() => assertSafeResume(bad)).toThrow(/auto-replay/);
  });

  it('flags forbidden history primary copy', () => {
    expect(isForbiddenHistoryPrimaryCopy('Session ID: x')).toBe(true);
    expect(isForbiddenHistoryPrimaryCopy('2 条用户消息 · 1 条回复')).toBe(true);
    expect(isForbiddenHistoryPrimaryCopy('上次停在待你确认')).toBe(false);
  });
});
