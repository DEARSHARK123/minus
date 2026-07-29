import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  advanceCalendarPlanning,
  calendarPlanningFromSnapshot,
  shouldStartCalendarPlanning,
} from '@/lib/learning/calendar-chat-flow';
import {
  gateOutboundCopy,
  hasOutboundCopyLeak,
  SETTINGS_LEARNING_WRITE_COPY,
} from '@/lib/ui/outbound-copy-gate';
import { isTaskDone, normalizeTaskStatus } from '@/lib/learning/task-status';
import { selectContinuation, excludeHomeOwnedContinuation } from '@/lib/chat/continuation-selector';
import { SessionEngine } from '@/lib/learning/session-engine';
import type { SessionSection } from '@/types/learning';

describe('batch-07 outbound copy gate', () => {
  it('strips engineering terms from outbound strings', () => {
    expect(hasOutboundCopyLeak('propose ≠ commit')).toBe(true);
    expect(hasOutboundCopyLeak('sandbox mode')).toBe(true);
    expect(gateOutboundCopy('Agent is thinking')).not.toMatch(/Agent is thinking/i);
    expect(gateOutboundCopy('propose ≠ commit', '待确认')).toBe('待确认');
    expect(SETTINGS_LEARNING_WRITE_COPY).not.toMatch(/propose|sandbox/i);
  });

  it('settings modal primary copy has no propose≠commit', () => {
    const text = readFileSync(
      join(process.cwd(), 'src/components/settings/settings-modal.tsx'),
      'utf8',
    );
    expect(text).toContain('需要你明确确认后才会保存');
    expect(text).not.toMatch(/propose\s*[≠!=]=\s*commit/);
  });

  it('home-chat removes providerId badge from primary UI', () => {
    const text = readFileSync(
      join(process.cwd(), 'src/components/chat/home-chat.tsx'),
      'utf8',
    );
    expect(text).not.toMatch(/aria-hidden\}\{settings\.providerId\}/);
  });
});

describe('batch-07 calendar chat flow', () => {
  it('collects one constraint at a time', () => {
    const first = advanceCalendarPlanning({
      planning: {
        active: true,
        constraints: {},
        pendingKey: null,
        proposalPreviewId: null,
      },
      userMessage: '帮我排学习日历',
      courseId: 'c1',
    });
    expect(first.kind).toBe('ask');
    expect(first.artifacts[0]?.kind).toBe('calendar_constraint');
  });

  it('detects calendar planning start from mode or message', () => {
    expect(
      shouldStartCalendarPlanning({
        experienceMode: 'calendar',
        message: '你好',
        planning: calendarPlanningFromSnapshot(null),
      }),
    ).toBe(true);
    expect(
      shouldStartCalendarPlanning({
        experienceMode: 'chat',
        message: '安排一下学习日程',
        planning: calendarPlanningFromSnapshot(null),
      }),
    ).toBe(true);
  });
});

describe('batch-07 task status normalization', () => {
  it('maps completed → done', () => {
    expect(normalizeTaskStatus('completed')).toBe('done');
    expect(isTaskDone('completed')).toBe(true);
  });
});

describe('batch-07 calendar continuation dedupe', () => {
  it('excludes primary continuation task from today filter logic', () => {
    const now = Date.now();
    const tasks = [
      {
        id: 't1',
        courseId: 'c1',
        title: '继续学 A',
        status: 'in_progress' as const,
        estimatedMinutes: 30,
        scheduledStart: new Date(now).toISOString(),
        scheduledEnd: new Date(now + 3600000).toISOString(),
        createdAt: new Date(now - 1000).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 't2',
        courseId: 'c1',
        title: '其他任务',
        status: 'confirmed' as const,
        estimatedMinutes: 20,
        scheduledStart: new Date(now - 5000).toISOString(),
        createdAt: new Date(now - 5000).toISOString(),
        updatedAt: new Date(now - 5000).toISOString(),
      },
    ];
    const primary = selectContinuation(tasks, 'calendar', { sessions: [] });
    expect(primary).not.toBeNull();
    const todayTodos = excludeHomeOwnedContinuation(tasks, 'calendar', {
      sessions: [],
    }).filter(
      (t) => !['done', 'completed'].includes(t.status as string),
    );
    expect(todayTodos).toHaveLength(1);
    expect(todayTodos[0]!.id).not.toBe(primary!.task.id);
  });
});

describe('batch-07 session follow-up persistence', () => {
  it('SessionEngine.generateFollowUp keeps the section unchanged when no model is available', async () => {
    const engine = new SessionEngine();
    const section: SessionSection = {
      id: 'sec1',
      status: 'open',
      phase: 'teach',
      title: '闭包',
      turns: [],
    };
    await expect(engine.generateFollowUp(section, '什么是闭包？', { unitTitle: '闭包' }))
      .rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(section.turns).toHaveLength(0);
  });
});

describe('batch-07 legacy quarantine', () => {
  it('learning index does not export LearningFeed', () => {
    const text = readFileSync(
      join(process.cwd(), 'src/components/learning/index.ts'),
      'utf8',
    );
    expect(text).not.toMatch(/export\s+\{\s*LearningFeed/);
  });

  it('production entry sources do not import MainPanel or LearningFeed', () => {
    const roots = [
      join(process.cwd(), 'src/app'),
      join(process.cwd(), 'src/components/layout/app-shell.tsx'),
      join(process.cwd(), 'src/components/chat/home-chat.tsx'),
    ];
    const files: string[] = [];
    function walk(p: string) {
      const st = statSync(p);
      if (st.isFile() && /\.(tsx?|jsx?)$/.test(p)) files.push(p);
      else if (st.isDirectory()) {
        for (const name of readdirSync(p)) {
          if (name === 'node_modules' || name.startsWith('.')) continue;
          walk(join(p, name));
        }
      }
    }
    for (const r of roots) walk(r);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (/from\s+['"]@\/components\/layout\/main-panel['"]/.test(text)) {
        offenders.push(`${relative(process.cwd(), f)}:MainPanel`);
      }
      if (/from\s+['"]@\/components\/learning\/learning-feed['"]/.test(text)) {
        offenders.push(`${relative(process.cwd(), f)}:LearningFeed`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
