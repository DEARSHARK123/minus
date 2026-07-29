import { describe, expect, it } from 'vitest';
import { automationRunKey, listDueAutomations } from '../scheduler';
import {
  AutomationRuleSchema,
  defaultUserConfiguration,
  type AutomationRule,
} from '@/lib/config/user-configuration-core';

function dailyRule(patch: Partial<AutomationRule> = {}): AutomationRule {
  return AutomationRuleSchema.parse({
    id: '98ae818a-7657-40bb-8843-d1e33eff23cb',
    name: '每日复习',
    enabled: true,
    trigger: { type: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' },
    action: { type: 'reminder', title: '复习', message: '开始复习' },
    approvalPolicy: 'supervised',
    catchUp: true,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...patch,
  });
}

describe('automation scheduler', () => {
  it('creates a stable daily run key and does not schedule it twice', () => {
    const now = new Date(2026, 6, 14, 10, 0, 0);
    const rule = dailyRule();
    const key = automationRunKey(rule, now);
    expect(key).toBe('daily:2026-07-14');
    if (!key) throw new Error('expected a due run key');

    const config = {
      ...defaultUserConfiguration(),
      automations: [{ ...rule, lastRunKey: key, lastStatus: 'success' as const }],
    };
    expect(listDueAutomations(config, { now: now.toISOString() })).toHaveLength(0);
  });

  it('retries a failed run only up to the configured limit', () => {
    const now = new Date(2026, 6, 14, 10, 0, 0);
    const key = 'daily:2026-07-14';
    const retryable = dailyRule({ lastRunKey: key, lastStatus: 'failed', failureCount: 2, maxRetries: 2 });
    const exhausted = dailyRule({ lastRunKey: key, lastStatus: 'failed', failureCount: 3, maxRetries: 2 });

    expect(listDueAutomations({ ...defaultUserConfiguration(), automations: [retryable] }, { now: now.toISOString() })).toHaveLength(1);
    expect(listDueAutomations({ ...defaultUserConfiguration(), automations: [exhausted] }, { now: now.toISOString() })).toHaveLength(0);
  });

  it('does not schedule disabled or not-yet-due rules', () => {
    const now = new Date(2026, 6, 14, 8, 59, 0);
    const config = {
      ...defaultUserConfiguration(),
      automations: [dailyRule(), dailyRule({ id: 'd3fbf50d-d0ae-4a33-9c25-5681b6dc2426', enabled: false })],
    };
    expect(listDueAutomations(config, { now: now.toISOString() })).toHaveLength(0);
  });

  it('matches learning events and filters by course', () => {
    const rule = AutomationRuleSchema.parse({
      ...dailyRule(),
      trigger: { type: 'event', event: 'assessment_failed', courseId: 'course-a' },
    });
    const now = new Date(2026, 6, 14, 10, 0, 0);
    expect(automationRunKey(rule, now, {
      event: { type: 'assessment_failed', courseId: 'course-a', eventId: 'assessment-1' },
    })).toBe('event:assessment_failed:assessment-1');
    expect(automationRunKey(rule, now, {
      event: { type: 'assessment_failed', courseId: 'course-b', eventId: 'assessment-2' },
    })).toBeNull();
  });

  it('runs course-idle rules at most once per day after the threshold', () => {
    const rule = AutomationRuleSchema.parse({
      ...dailyRule(),
      trigger: { type: 'event', event: 'course_idle', courseId: 'course-a', idleMinutes: 60 },
    });
    const now = new Date(2026, 6, 14, 10, 0, 0);
    const key = automationRunKey(rule, now, {
      courseActivity: [{ courseId: 'course-a', idleMinutes: 120 }],
    });
    expect(key).toBe('course_idle:course-a:2026-07-14');
  });

  it('does not replay a missed time trigger when catch-up is disabled', () => {
    const now = new Date(2026, 6, 14, 10, 0, 0);
    expect(automationRunKey(dailyRule({ catchUp: false }), now)).toBeNull();
  });
});
